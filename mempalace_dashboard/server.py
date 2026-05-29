#!/usr/bin/env python3
from __future__ import annotations

import base64
import gzip
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
from collections import Counter
from datetime import datetime, timedelta
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


SERVER_STARTED_AT = datetime.now()


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"

# ---- serve-time JS minification (optional, graceful) -----------------------
# app.js is ~440KB of readable source; minified it's ~175KB, which cuts the
# browser's PARSE time (the dominant cold-load cost once assets are cached).
# Rather than a build step (which would break the edit→cp→refresh live-iterate
# workflow), we minify ON DEMAND the first time a .js file is requested after
# it changes, then cache the result in-memory keyed by the file's mtime+size.
# Subsequent requests serve the cached minified bytes with zero work.
#
# This is the one place the dashboard shells out to a non-stdlib tool (terser
# / esbuild, whichever is on PATH). It degrades gracefully: if no minifier is
# found, or minification errors/times out, we fall back to the raw file bytes,
# so the "zero-dependency Python stdlib server" promise still holds when the
# optional tool is absent. Set MEMPALACE_NO_MINIFY=1 to force raw always.
_MINIFY_CACHE: dict[str, tuple[float, int, bytes]] = {}
_MINIFIER_CMD: list[str] | None = None
_MINIFIER_PROBED = False


def _find_minifier() -> list[str] | None:
    """Locate a JS minifier on PATH once. Prefer terser, then esbuild.
    Returns the base argv (reads stdin, writes stdout) or None."""
    global _MINIFIER_CMD, _MINIFIER_PROBED
    if _MINIFIER_PROBED:
        return _MINIFIER_CMD
    _MINIFIER_PROBED = True
    if os.environ.get("MEMPALACE_NO_MINIFY"):
        _MINIFIER_CMD = None
        return None
    terser = shutil.which("terser")
    if terser:
        # -c compress, -m mangle; reads stdin, writes stdout by default.
        _MINIFIER_CMD = [terser, "-c", "-m"]
        return _MINIFIER_CMD
    esbuild = shutil.which("esbuild")
    if esbuild:
        _MINIFIER_CMD = [esbuild, "--minify", "--loader=js"]
        return _MINIFIER_CMD
    _MINIFIER_CMD = None
    return None


def get_minified_js(path: Path) -> bytes:
    """Return minified bytes for a .js file, cached by (mtime, size).
    Falls back to the raw bytes if no minifier is available or it fails."""
    raw = path.read_bytes()
    cmd = _find_minifier()
    if not cmd:
        return raw
    try:
        st = path.stat()
        key = str(path)
        cached = _MINIFY_CACHE.get(key)
        if cached and cached[0] == st.st_mtime and cached[1] == st.st_size:
            return cached[2]
        proc = subprocess.run(
            cmd, input=raw, capture_output=True, timeout=30, check=True,
        )
        out = proc.stdout
        # Sanity: a successful minify should produce non-empty output that's
        # no larger than the source. If something's off, keep the raw file.
        if not out or len(out) > len(raw):
            return raw
        _MINIFY_CACHE[key] = (st.st_mtime, st.st_size, out)
        return out
    except (subprocess.SubprocessError, OSError):
        return raw


# All filesystem locations default to the standard MemPalace home (~/.mempalace) but
# can be overridden per-deployment with environment variables.
def _env_path(var: str, default: Path) -> Path:
    raw = os.environ.get(var)
    return Path(raw).expanduser() if raw else default

MEMPALACE_HOME = _env_path("MEMPALACE_HOME", Path.home() / ".mempalace")
PALACE_DB = _env_path("MEMPALACE_PALACE_DB", MEMPALACE_HOME / "palace" / "chroma.sqlite3")
KG_DB = _env_path("MEMPALACE_KG_DB", MEMPALACE_HOME / "knowledge_graph.sqlite3")
INBOX_DIR = _env_path("MEMPALACE_INBOX", MEMPALACE_HOME / "dashboard-inbox")
ARCHIVE_DIR = INBOX_DIR / "filed"
VERSIONS_LOG = _env_path("MEMPALACE_VERSIONS", MEMPALACE_HOME / "dashboard-versions.jsonl")
# MemPalace's own write-ahead log — records every mutation including
# MCP-initiated ones (Codex calling mempalace_update_drawer, Claude in
# another session, sync tool, etc.). The dashboard's own VERSIONS_LOG
# only sees mutations routed through dashboard /api endpoints, so
# without consulting the MP WAL the "Updated Xh ago" indicator never
# refreshes for off-dashboard writes. See enrich_drawers_with_updated_at.
MP_WAL_LOG = _env_path("MEMPALACE_WAL_LOG", MEMPALACE_HOME / "wal" / "write_log.jsonl")
# One-line-per-restore ledger. When the dashboard restores a deleted
# drawer it calls tool_add_drawer, which appends an `add_drawer` entry
# to the MP WAL with the current timestamp — so the WAL-derived
# updated_at for the restored drawer is the restore time, not its
# original last-edit time. We preserve the original filed_at via direct
# SQL (see restore_version) but had no way to override the WAL-derived
# updated_at, which made the bell pulse + "Updated · just now" badge
# fire on every restore as if someone had just edited the memory.
# Recording the new drawer_id here lets enrich_drawers_with_updated_at
# clamp updated_at = filed_at for restored drawers, which is honest:
# nothing was edited, just recovered. Plain text so it survives a
# server restart without re-bumping every previously-restored drawer.
RESTORED_DRAWERS_LOG = _env_path(
    "MEMPALACE_RESTORED_DRAWERS",
    MEMPALACE_HOME / "dashboard-restored-drawers.jsonl",
)
# Shared seen-state map — drawer_id → ISO timestamp of when ANY client
# on this Pi last marked the drawer as seen. Lives server-side (not in
# each browser's localStorage) so the bell-cleared state syncs across
# every browser/device hitting this dashboard on the LAN. Single JSON
# object, rewritten atomically on each update. The file is small even
# for thousands of drawers (one short key+value per entry) so a full
# rewrite is cheaper than tracking diffs.
SEEN_FILE = _env_path(
    "MEMPALACE_SEEN",
    MEMPALACE_HOME / "dashboard-seen.json",
)
CREDENTIALS_FILE = _env_path("MEMPALACE_CREDENTIALS", MEMPALACE_HOME / "dashboard-credentials.json")
SESSIONS_FILE = _env_path("MEMPALACE_SESSIONS", MEMPALACE_HOME / "dashboard-sessions.json")
PREFERENCES_FILE = _env_path("MEMPALACE_PREFERENCES", MEMPALACE_HOME / "dashboard-preferences.json")

# ---------- version tracking ----------
# Source of truth for the displayed version is the INSTALLED package
# metadata — never a hardcoded string in the UI. Reading via
# importlib.metadata means the About pane automatically reflects
# whatever pyproject.toml says when the package was built, which
# updates whenever the user runs `pipx upgrade mempalace-dashboard`.
# No manual HTML edit per release.
#
# Latest-available comparison goes one step further: we fetch the
# GitHub releases API (cached 30 minutes per process so we stay well
# under the 60/hr unauthenticated rate limit), and the dashboard
# shows an "update available" affordance when latest > installed.
_VERSION_INSTALLED: str | None = None
_GITHUB_LATEST_CACHE: dict = {"version": None, "fetched_at": 0.0}
_GITHUB_LATEST_TTL = 1800  # 30 minutes
_GITHUB_LATEST_BACKOFF = 60  # On failure, wait this long before retrying
_GITHUB_LATEST_URL = (
    "https://api.github.com/repos/epinethrone/mempalace-frontend/releases/latest"
)


def get_installed_version() -> str:
    """Return the installed mempalace-dashboard package version, or
    'unknown' if metadata isn't available (running from a non-
    installed checkout, etc.). Cached for the life of the process —
    a different installed version means a different Python process."""
    global _VERSION_INSTALLED
    if _VERSION_INSTALLED is None:
        try:
            _VERSION_INSTALLED = importlib.metadata.version("mempalace-dashboard")
        except importlib.metadata.PackageNotFoundError:
            _VERSION_INSTALLED = "unknown"
    return _VERSION_INSTALLED


def get_latest_github_version() -> str | None:
    """Fetch the most recent release tag from the project repo on
    GitHub. Cached 30 minutes per process; on failure (network,
    rate-limit, no releases yet, repo renamed), returns whatever
    previous value we have — possibly None — and sets a short
    backoff so we don't hammer GitHub on the next request."""
    now = time.time()
    cached_age = now - _GITHUB_LATEST_CACHE["fetched_at"]
    if _GITHUB_LATEST_CACHE["version"] is not None and cached_age < _GITHUB_LATEST_TTL:
        return _GITHUB_LATEST_CACHE["version"]
    try:
        req = urllib.request.Request(
            _GITHUB_LATEST_URL,
            headers={
                "User-Agent": "Apricity-dashboard",
                "Accept": "application/vnd.github+json",
            },
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        tag = (data.get("tag_name") or "").strip()
        # Strip leading "v" so the value parallels what importlib.metadata
        # returns ("0.6.0" not "v0.6.0") — makes the JS comparison cleaner.
        normalized = tag.lstrip("v") if tag else None
        _GITHUB_LATEST_CACHE["version"] = normalized
        _GITHUB_LATEST_CACHE["fetched_at"] = now
        return normalized
    except Exception:
        # Pretend the cache is fresh-ish so the next request waits
        # GITHUB_LATEST_BACKOFF seconds, not immediately re-tries.
        _GITHUB_LATEST_CACHE["fetched_at"] = now - _GITHUB_LATEST_TTL + _GITHUB_LATEST_BACKOFF
        return _GITHUB_LATEST_CACHE["version"]


def get_version_info() -> dict:
    """Combined payload for the /api/version endpoint — installed
    version always present; latest_github may be null if we couldn't
    reach GitHub (the client treats null as 'unknown', NOT as 'no
    update available')."""
    return {
        "installed": get_installed_version(),
        "latest_github": get_latest_github_version(),
        "releases_url": "https://github.com/epinethrone/mempalace-frontend/releases",
    }
SESSION_COOKIE = "mempalace_session"
SESSION_DURATION_SHORT = timedelta(hours=12)
SESSION_DURATION_LONG = timedelta(days=30)
MEMPALACE_PYTHON = _env_path("MEMPALACE_PYTHON_BIN", Path.home() / ".local" / "share" / "mempalace-venv" / "bin" / "python")
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
TUNNEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,127}$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.@-]{0,62}$")
AUTH_TOKEN = os.environ.get("MEMPALACE_TOKEN", "").strip()


def load_sessions() -> dict:
    if not SESSIONS_FILE.exists():
        return {}
    try:
        return json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_sessions(sessions: dict) -> None:
    SESSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SESSIONS_FILE.write_text(json.dumps(sessions, ensure_ascii=False), encoding="utf-8")
    try:
        # 0o600 keeps the session-token file owner-readable only —
        # important since these tokens grant full dashboard access if
        # exfiltrated. The bare-except is for filesystems that don't
        # implement POSIX permissions (FAT32, exFAT, some NAS mounts);
        # the dashboard targets a Pi running ext4, so this is belt-
        # and-suspenders. Failing silently is the right move there —
        # the file STILL gets written, just at whatever umask permits.
        SESSIONS_FILE.chmod(0o600)
    except OSError:
        pass


def prune_sessions(sessions: dict) -> dict:
    now = datetime.now()
    return {
        sid: s for sid, s in sessions.items()
        if _safe_iso(s.get("expires_at")) and _safe_iso(s["expires_at"]) > now
    }


def _safe_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def create_session(username: str, remember: bool) -> tuple[str, datetime]:
    sessions = prune_sessions(load_sessions())
    sid = secrets.token_urlsafe(32)
    duration = SESSION_DURATION_LONG if remember else SESSION_DURATION_SHORT
    expires = datetime.now() + duration
    sessions[sid] = {
        "username": username,
        "expires_at": expires.isoformat(timespec="seconds"),
        "remember": bool(remember),
    }
    save_sessions(sessions)
    return sid, expires


def validate_session(sid: str) -> str | None:
    if not sid:
        return None
    sessions = load_sessions()
    record = sessions.get(sid)
    if not record:
        return None
    expires = _safe_iso(record.get("expires_at"))
    if not expires or expires <= datetime.now():
        sessions.pop(sid, None)
        save_sessions(sessions)
        return None
    return record.get("username")


def delete_session(sid: str) -> None:
    if not sid:
        return
    sessions = load_sessions()
    if sid in sessions:
        sessions.pop(sid)
        save_sessions(sessions)


def session_cookie_header(sid: str, remember: bool) -> str:
    parts = [f"{SESSION_COOKIE}={sid}", "Path=/", "HttpOnly", "SameSite=Lax"]
    if remember:
        parts.append(f"Max-Age={int(SESSION_DURATION_LONG.total_seconds())}")
    return "; ".join(parts)


def clear_session_cookie_header() -> str:
    return f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    iterations = 200_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${base64.b64encode(salt).decode('ascii')}${base64.b64encode(digest).decode('ascii')}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations_str, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iterations_str)
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return secrets.compare_digest(expected, actual)


def load_credentials() -> dict | None:
    if not CREDENTIALS_FILE.exists():
        return None
    try:
        return json.loads(CREDENTIALS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def save_credentials(username: str, password_hash: str) -> None:
    CREDENTIALS_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"username": username, "password_hash": password_hash}, ensure_ascii=False)
    CREDENTIALS_FILE.write_text(payload, encoding="utf-8")
    try:
        # 0o600 — same reasoning as the sessions-file chmod (see
        # save_sessions). The credentials file stores the bcrypt hash
        # of the dashboard password; locking it owner-only stops other
        # users on the same machine from offline-cracking it. Silent
        # OSError fallback is for non-POSIX filesystems.
        CREDENTIALS_FILE.chmod(0o600)
    except OSError:
        pass


def get_settings_status() -> dict:
    creds = load_credentials()
    if not creds:
        return {"credentials_configured": False, "username": None}
    return {"credentials_configured": True, "username": creds.get("username")}


def _file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def import_palace(payload: dict, actor: str = "User") -> dict:
    """Restore drawers + facts from a mempalace-export payload, deduping by content."""
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        raise ValueError("Missing export payload — upload the JSON file produced by Export data.")
    if data.get("format") != "mempalace-export":
        raise ValueError("File doesn't look like a MemPalace export (missing format marker).")
    incoming_drawers = data.get("drawers") or []
    incoming_facts = data.get("facts") or data.get("triples") or []
    if not isinstance(incoming_drawers, list) or not isinstance(incoming_facts, list):
        raise ValueError("Export payload is malformed: drawers/facts must be lists.")

    existing = read_drawers()
    seen_drawer_keys = {
        (d.get("wing", ""), d.get("room", ""), (d.get("content") or "").strip())
        for d in existing
    }

    added_drawers = 0
    skipped_drawers = 0
    drawer_errors: list[dict] = []

    timestamp = datetime.now().isoformat(timespec="seconds")

    for entry in incoming_drawers:
        if not isinstance(entry, dict):
            skipped_drawers += 1
            continue
        wing = str(entry.get("wing", "")).strip()
        room = str(entry.get("room", "")).strip()
        content = str(entry.get("content", "") or "").strip()
        if not wing or not room or len(content) < 10:
            skipped_drawers += 1
            continue
        if not NAME_RE.match(wing) or not NAME_RE.match(room):
            skipped_drawers += 1
            continue
        key = (wing, room, content)
        if key in seen_drawer_keys:
            skipped_drawers += 1
            continue
        try:
            # JSON bulk-restore via dashboard → source="Import", actor =
            # the authenticated dashboard user (e.g. "zhiar"), not generic
            # "User". The session captured `actor` in the request handler.
            mempalace_add_drawer(
                wing=wing,
                room=room,
                content=content,
                source_file="Import",
                added_by=actor,
            )
            seen_drawer_keys.add(key)
            added_drawers += 1
        except (RuntimeError, ValueError) as exc:
            drawer_errors.append({"drawer_id": entry.get("drawer_id"), "error": str(exc)})

    existing_triples = read_triples()
    active_fact_keys = {
        (t.get("subject"), t.get("predicate"), t.get("object"))
        for t in existing_triples
        if not t.get("valid_to")
    }

    added_facts = 0
    skipped_facts = 0
    fact_errors: list[dict] = []

    for entry in incoming_facts:
        if not isinstance(entry, dict):
            skipped_facts += 1
            continue
        subject = str(entry.get("subject", "")).strip()
        predicate = str(entry.get("predicate", "")).strip()
        obj = str(entry.get("object", "")).strip()
        if not subject or not predicate or not obj:
            skipped_facts += 1
            continue
        key = (subject, predicate, obj)
        if key in active_fact_keys:
            skipped_facts += 1
            continue
        try:
            mempalace_kg_add(
                subject,
                predicate,
                obj,
                valid_from=str(entry.get("valid_from", "")).strip(),
                source_drawer_id="",
            )
            active_fact_keys.add(key)
            added_facts += 1
        except (RuntimeError, ValueError) as exc:
            fact_errors.append({"fact": f"{subject} {predicate} {obj}", "error": str(exc)})

    return {
        "success": True,
        "added": {"drawers": added_drawers, "facts": added_facts},
        "skipped": {"drawers": skipped_drawers, "facts": skipped_facts},
        "errors": {"drawers": drawer_errors, "facts": fact_errors},
    }


def build_export() -> dict:
    drawers = read_drawers()
    triples = read_triples()
    return {
        "format": "mempalace-export",
        "format_version": 1,
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "host": platform.uname().node,
        "palace_home": str(MEMPALACE_HOME),
        "counts": {
            "drawers": len(drawers),
            "facts": len(triples),
        },
        "drawers": drawers,
        "facts": triples,
    }


def get_system_info() -> dict:
    uname = platform.uname()
    palace_bytes = _file_size(PALACE_DB)
    kg_bytes = _file_size(KG_DB)
    uptime = datetime.now() - SERVER_STARTED_AT
    return {
        "repo_url": "https://github.com/epinethrone/mempalace-frontend",
        "host": {
            "name": uname.node,
            "os": uname.system,
            "release": uname.release,
            "arch": uname.machine,
        },
        "python": platform.python_version(),
        "port": int(os.environ.get("PORT", "8765")),
        "palace_home": str(MEMPALACE_HOME),
        "db_bytes": {
            "palace": palace_bytes,
            "knowledge_graph": kg_bytes,
            "total": palace_bytes + kg_bytes,
        },
        "uptime_seconds": int(uptime.total_seconds()),
        "started_at": SERVER_STARTED_AT.isoformat(timespec="seconds"),
    }


def update_credentials(payload: dict) -> dict:
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))
    if not USERNAME_RE.match(username):
        raise ValueError("Username must start with a letter or number and use only letters, numbers, dots, underscores, hyphens, or '@'.")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    if len(password) > 256:
        raise ValueError("Password must be 256 characters or fewer.")

    existing = load_credentials()
    if existing and existing.get("password_hash"):
        current = str(payload.get("current_password", ""))
        if not current or not verify_password(current, existing["password_hash"]):
            raise ValueError("Current password is incorrect.")

    save_credentials(username, hash_password(password))
    sid, expires = create_session(username, remember=False)
    return {
        "success": True,
        "username": username,
        "credentials_configured": True,
        "_session_id": sid,
        "_session_expires": expires.isoformat(timespec="seconds"),
    }


def content_etag(content: str) -> str:
    return hashlib.sha256((content or "").encode("utf-8")).hexdigest()[:16]


def log_version(action: str, drawer: dict, *, note: str = "") -> None:
    record = {
        "action": action,
        "logged_at": datetime.now().isoformat(timespec="seconds"),
        "drawer_id": drawer.get("drawer_id"),
        "wing": drawer.get("wing"),
        "room": drawer.get("room"),
        "title": drawer.get("title"),
        "content": drawer.get("content", ""),
        "source_file": drawer.get("source_file", ""),
        "added_by": drawer.get("added_by", ""),
        "filed_at": drawer.get("filed_at", ""),
        "note": note,
    }
    VERSIONS_LOG.parent.mkdir(parents=True, exist_ok=True)
    with VERSIONS_LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_versions(limit: int = 200) -> list[dict]:
    if not VERSIONS_LOG.exists():
        return []
    lines = VERSIONS_LOG.read_text(encoding="utf-8", errors="replace").splitlines()
    records: list[dict] = []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(records) >= limit:
            break
    return records


def _row_dicts(cursor: sqlite3.Cursor) -> list[dict]:
    return [dict(row) for row in cursor.fetchall()]


def read_drawers() -> list[dict]:
    if not PALACE_DB.exists():
        return []
    try:
        con = sqlite3.connect(PALACE_DB)
        con.row_factory = sqlite3.Row
        rows = _row_dicts(
            con.execute(
                """
                select e.id, e.embedding_id, em.key,
                       coalesce(em.string_value, em.int_value, em.float_value, em.bool_value) as value
                from embeddings e
                join embedding_metadata em on em.id = e.id
                where e.embedding_id like 'drawer_%'
                order by e.id
                """
            )
        )
        con.close()
    except sqlite3.OperationalError:
        # MemPalace schema not initialised on this host — render an empty palace
        # so the dashboard stays usable for first-time setup or testing.
        return []

    by_id: dict[int, dict] = {}
    for row in rows:
        item = by_id.setdefault(
            row["id"],
            {
                "id": row["id"],
                "drawer_id": row["embedding_id"],
                "wing": "unknown",
                "room": "unknown",
                "title": "Untitled",
                "content": "",
                "source_file": "",
                "filed_at": "",
                "added_by": "",
                "metadata": {},
            },
        )
        key = row["key"]
        value = row["value"]
        if key == "chroma:document":
            item["content"] = value or ""
            item["title"] = extract_title(item["content"], item["drawer_id"])
        elif key in item:
            item[key] = value or ""
        else:
            item["metadata"][key] = value

    for item in by_id.values():
        item["etag"] = content_etag(item.get("content", ""))
    drawers = list(by_id.values())
    enrich_drawers_with_updated_at(drawers)
    return drawers


# ----- updated_at log cache -----
# Caches the parsed latest_by_id dict + per-log read offset so the
# /api/palace hot path doesn't re-parse both append-only log files on
# every request. The previous implementation walked every line of
# dashboard-versions.jsonl + wal/write_log.jsonl on each request —
# O(total mutations ever) work for a signal most pages only need to
# refresh when a write happens. With this cache, the steady-state cost
# is one stat() per log per request (cheap, page-cached by the OS) and
# only the BYTES APPENDED since last read get parsed. After a write the
# tail-read parses a handful of new lines; the first request after a
# log truncation/rotation falls back to a full re-read.
#
# Layout: {log_path: {"offset": int, "mtime": float, "size": int}}
# - offset:  byte position we've already parsed up to
# - mtime/size: tripwire — if either is smaller than the cached value,
#   the log was truncated/rotated/replaced and we must restart from 0
# Module-level so it survives across requests, NOT per-instance.
_UPDATED_AT_CACHE = {
    "by_id": {},                # drawer_id -> latest ISO ts seen across both logs
    "sources": {},              # one entry per log path, shape above
}

# Module-level set of every drawer_id ever recovered from the trash
# (lazily loaded from RESTORED_DRAWERS_LOG on first read). enrich_drawers
# _with_updated_at consults this to clamp updated_at = filed_at on
# restored drawers so the bell + Updated badge don't misfire — a restore
# is recovery, not an edit, and the UI signals shouldn't pretend it was.
_RESTORED_DRAWER_IDS: set[str] = set()
_RESTORED_DRAWER_IDS_LOADED = False


def _load_restored_drawer_ids() -> None:
    """Read RESTORED_DRAWERS_LOG once per process and seed the in-memory
    set. Each line is JSON: {"drawer_id": "...", "restored_at": "..."}.
    Idempotent — guarded by _RESTORED_DRAWER_IDS_LOADED so callers can
    re-invoke without re-parsing. Missing or malformed file is fine; an
    empty set means no clamping happens, same as if no restores ever
    occurred."""
    global _RESTORED_DRAWER_IDS_LOADED
    if _RESTORED_DRAWER_IDS_LOADED:
        return
    _RESTORED_DRAWER_IDS_LOADED = True
    if not RESTORED_DRAWERS_LOG.exists():
        return
    try:
        for line in RESTORED_DRAWERS_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            drawer_id = str(record.get("drawer_id") or "").strip()
            if drawer_id:
                _RESTORED_DRAWER_IDS.add(drawer_id)
    except OSError:
        # Log file unreadable — fall back to empty set. enrich just
        # won't clamp anything, no functional break.
        pass


def _record_restored_drawer(drawer_id: str) -> None:
    """Append one restore record to RESTORED_DRAWERS_LOG and update the
    in-memory set. Called from restore_version after a successful add.
    Best-effort write — a disk failure means the next enrich won't
    clamp updated_at for this drawer (bell may pulse once), but the
    restore itself succeeded so we don't propagate the error."""
    if not drawer_id:
        return
    _load_restored_drawer_ids()
    _RESTORED_DRAWER_IDS.add(drawer_id)
    record = {
        "drawer_id": drawer_id,
        "restored_at": datetime.now().isoformat(timespec="seconds"),
    }
    try:
        RESTORED_DRAWERS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with RESTORED_DRAWERS_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        # In-memory set was already updated, so the current process
        # will still clamp this drawer. Persistence loss only matters
        # if the process restarts; even then, after RECENT_UPDATE_MS
        # (24h) the freshness window expires and the bell won't pulse
        # for this drawer anyway.
        pass


# ---------- shared seen-state map ----------
# Map of drawer_id → ISO seen-at timestamp. Single source of truth for
# "which notifications has the user dismissed" across every browser/
# device hitting this Pi dashboard. Loaded lazily on first access;
# rewritten atomically on every mark-seen so concurrent multi-client
# writes don't corrupt the file (last write wins, which is fine — the
# semantic is "any client marking this drawer seen is enough").
_SEEN_CACHE: dict | None = None


def load_seen_map() -> dict[str, str]:
    """Return the current seen-state dict. Lazy-loads from SEEN_FILE on
    first call, then memoizes. Subsequent calls return the cached dict
    (mutations via mark_drawers_seen flush to disk and update the
    cache in lockstep). Missing file / parse error → empty map."""
    global _SEEN_CACHE
    if _SEEN_CACHE is not None:
        return _SEEN_CACHE
    _SEEN_CACHE = {}
    if not SEEN_FILE.exists():
        return _SEEN_CACHE
    try:
        raw = SEEN_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
        if isinstance(data, dict):
            # Keep only string→string entries — defensive against a
            # manually-edited file that picked up non-conforming values.
            for k, v in data.items():
                if isinstance(k, str) and isinstance(v, str):
                    _SEEN_CACHE[k] = v
    except (OSError, ValueError):
        pass
    return _SEEN_CACHE


def mark_drawers_seen(drawer_ids: list[str], seen_at: str | None = None) -> dict[str, str]:
    """Stamp each id in `drawer_ids` with `seen_at` (or now) in the
    shared map and persist to disk. Returns the updated map. Caller
    is expected to filter to non-empty string ids — we defensively
    skip blanks just in case."""
    if seen_at is None:
        seen_at = datetime.now().isoformat(timespec="seconds")
    current = load_seen_map()
    changed = False
    for did in drawer_ids:
        if isinstance(did, str) and did.strip():
            current[did] = seen_at
            changed = True
    if changed:
        try:
            SEEN_FILE.parent.mkdir(parents=True, exist_ok=True)
            tmp = SEEN_FILE.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(current, ensure_ascii=False), encoding="utf-8")
            tmp.replace(SEEN_FILE)
        except OSError:
            # Disk write failed — the in-memory cache is still updated
            # so THIS process treats the drawers as seen, but other
            # clients won't pick up the change. Acceptable degradation.
            pass
    return current


def _ingest_updated_at_log_tail(
    log_path: Path,
    handler,                    # (record: dict, _bump) -> None
) -> None:
    """Read NEW lines appended to ``log_path`` since the last call and
    feed each JSON-decoded record to ``handler``. The handler is
    expected to call ``_bump(drawer_id, ts)`` for any entry that
    represents a content-changing mutation. Truncation / size-shrink /
    mtime-rewind force a full restart from offset 0 (handles log
    rotation, manual edits, or the file being recreated).
    """
    src = _UPDATED_AT_CACHE["sources"].setdefault(
        str(log_path), {"offset": 0, "mtime": 0.0, "size": 0},
    )
    if not log_path.exists():
        # File gone since last read → drop our offset so a freshly
        # recreated log gets parsed from the top next time.
        src["offset"] = 0
        src["mtime"] = 0.0
        src["size"] = 0
        return
    try:
        st = log_path.stat()
    except OSError:
        return
    # Tripwire: if the file shrank or its mtime went backwards, the log
    # was truncated/replaced. Restart from offset 0 so we don't skip
    # over freshly-written lines that landed before our cached cursor.
    if st.st_size < src["offset"] or st.st_mtime < src["mtime"]:
        src["offset"] = 0
    if st.st_size == src["offset"] and st.st_mtime == src["mtime"]:
        # Nothing changed since last call — the cached by_id dict
        # already reflects everything in the file.
        return
    try:
        # errors="replace" matches the original full-read path so any
        # latin-1 bytes that snuck in don't blow up the parser. The
        # logs ARE supposed to be UTF-8 JSON but we'd rather degrade
        # gracefully than 500 on one bad line.
        with log_path.open("r", encoding="utf-8", errors="replace") as fh:
            fh.seek(src["offset"])
            for line in fh:
                line = line.rstrip("\n")
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                handler(record, _bump_updated_at)
            src["offset"] = fh.tell()
    except OSError:
        return
    src["mtime"] = st.st_mtime
    src["size"] = st.st_size


def _bump_updated_at(drawer_id: str, ts: str) -> None:
    """Record a mutation's timestamp into the module-level cache,
    keeping only the latest per drawer_id. Latest wins via string
    compare on ISO 8601 (canonical form on both logs — Python's
    datetime.isoformat() is lexicographically ordered, so microsecond
    vs second precision compare cleanly)."""
    if not drawer_id or not ts:
        return
    by_id = _UPDATED_AT_CACHE["by_id"]
    if ts > by_id.get(drawer_id, ""):
        by_id[drawer_id] = ts


def _handle_mp_wal_record(record: dict, bump) -> None:
    """wal/write_log.jsonl entry: {timestamp, operation, params: {drawer_id,
    content_changed, ...}, result}. Only add_drawer and content-changing
    update_drawer count — rename-only updates and tunnel/kg ops are
    ignored since the freshness signal is per-drawer body, not
    per-graph."""
    op = record.get("operation", "")
    if op not in ("add_drawer", "update_drawer"):
        return
    params = record.get("params") or {}
    if op == "update_drawer" and not params.get("content_changed"):
        return
    bump(params.get("drawer_id"), record.get("timestamp", ""))


def enrich_drawers_with_updated_at(drawers: list[dict]) -> None:
    """Stamp each drawer with `updated_at` derived from MemPalace's
    write-ahead log.

    MemPalace stores `filed_at` (creation) in drawer metadata but no
    updated_at. Edits land in ``wal/write_log.jsonl`` (MemPalace's own
    WAL) as ``{timestamp, operation: "update_drawer", params: {...}}``
    entries — captures EVERY mutation, including external MCP writes
    (Codex, scripted, another Claude session) that bypass the
    dashboard. The WAL is the single source of truth.

    The dashboard used to also write a per-edit `update-before`
    snapshot to its own log (`dashboard-versions.jsonl`) and this
    function merged both. That dashboard-side snapshot was removed
    2026-05-28 per the snapshots-only-for-deletions policy. The MP
    WAL covers the same events because the dashboard's update path
    ultimately calls the same MCP tool, so dropping the dashboard-log
    branch costs no signal for dashboard-mediated edits, and external-
    MCP edits were already going through this path exclusively.

    Hot path: this function is called from build_payload() on every
    /api/palace request. Re-parsing the WAL line by line on every
    call would be O(total mutations ever), which scales poorly. Cache
    via _UPDATED_AT_CACHE — keep the parsed by_id dict module-level,
    only read the BYTES APPENDED since last call. Steady-state: one
    stat() per request (page-cached by the OS, sub-microsecond) and
    a tail-read of whatever's been written since. Truncation /
    rotation detection in _ingest_updated_at_log_tail handles edge
    cases by restarting from offset 0.

    Drawers that have never been mutated fall back to `filed_at`
    (which is both creation AND last-update by definition).
    """
    # Incrementally absorb any new tail bytes from the WAL into the
    # shared module-level cache. No-op on a hot cache (file size
    # unchanged → early return without opening the fd).
    _ingest_updated_at_log_tail(MP_WAL_LOG, _handle_mp_wal_record)
    # Lazy-load the restored-drawer set on first request — afterwards
    # it lives in memory and _record_restored_drawer keeps it in sync
    # with disk on every restore.
    _load_restored_drawer_ids()
    by_id = _UPDATED_AT_CACHE["by_id"]
    for drawer in drawers:
        drawer_id = drawer.get("drawer_id", "")
        filed_at = drawer.get("filed_at", "")
        # Restored drawers: clamp updated_at to filed_at so the bell +
        # Updated-badge pipelines treat them as creation events (no
        # delta), not edits. Restore goes through tool_add_drawer which
        # appended an add_drawer record to the WAL with the restore
        # timestamp — without this clamp, isUpdateEvent on the client
        # would see (updated_at - filed_at) > 10s and misclassify the
        # recovery as a fresh edit. See RESTORED_DRAWERS_LOG comment
        # for the full rationale.
        if drawer_id in _RESTORED_DRAWER_IDS:
            drawer["updated_at"] = filed_at
            continue
        log_time = by_id.get(drawer_id, "")
        drawer["updated_at"] = log_time or filed_at


def extract_title(content: str, fallback: str) -> str:
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip() or fallback
        if stripped:
            return stripped[:80]
    return fallback


def read_triples() -> list[dict]:
    if not KG_DB.exists():
        return []
    try:
        con = sqlite3.connect(KG_DB)
        con.row_factory = sqlite3.Row
        rows = _row_dicts(
            con.execute(
                """
                select id, subject, predicate, object, valid_from, valid_to,
                       confidence, source_drawer_id, extracted_at
                from triples
                order by extracted_at desc, subject, predicate
                """
            )
        )
        con.close()
        return rows
    except sqlite3.OperationalError:
        # Knowledge-graph DB exists but the schema hasn't been initialised yet.
        return []


def build_payload() -> dict:
    drawers = read_drawers()
    triples = read_triples()
    wings: dict[str, dict] = {}
    room_counts: Counter[tuple[str, str]] = Counter()

    for drawer in drawers:
        wing = drawer["wing"]
        room = drawer["room"]
        room_counts[(wing, room)] += 1
        wings.setdefault(wing, {"name": wing, "count": 0, "rooms": {}})
        wings[wing]["count"] += 1
        wings[wing]["rooms"].setdefault(room, {"name": room, "count": 0})
        wings[wing]["rooms"][room]["count"] += 1

    for wing in wings.values():
        wing["rooms"] = sorted(wing["rooms"].values(), key=lambda room: room["name"])

    active_facts = sum(1 for triple in triples if not triple.get("valid_to"))
    return {
        "stats": {
            "drawers": len(drawers),
            "wings": len(wings),
            "rooms": len(room_counts),
            "facts": len(triples),
            "activeFacts": active_facts,
        },
        "wings": sorted(wings.values(), key=lambda wing: wing["name"]),
        "drawers": drawers,
        "triples": triples,
        # Shared seen-state map — piggy-backs on the palace response so
        # every poll picks up notification-dismissal events from any
        # browser/device on the LAN without an extra round trip. Empty
        # dict for fresh installs.
        "seen": load_seen_map(),
    }


def search_payload(query: str) -> dict:
    q = query.strip().lower()
    drawers = read_drawers()
    triples = read_triples()
    if not q:
        return {"drawers": drawers, "triples": triples}

    def hit(*values: object) -> bool:
        return any(q in str(value or "").lower() for value in values)

    return {
        "drawers": [
            d
            for d in drawers
            if hit(d["title"], d["content"], d["wing"], d["room"], d["source_file"], d["drawer_id"])
        ],
        "triples": [
            t
            for t in triples
            if hit(t["subject"], t["predicate"], t["object"], t["source_drawer_id"])
        ],
    }


def slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", value.strip()).strip("-")
    return cleaned[:64] or "memory"


def validate_memory_payload(payload: dict) -> tuple[str, str, str, str]:
    wing = str(payload.get("wing", "")).strip()
    room = str(payload.get("room", "")).strip()
    title = str(payload.get("title", "")).strip()
    content = str(payload.get("content", "")).strip()

    if not NAME_RE.match(wing):
        raise ValueError("Wing must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.")
    if not NAME_RE.match(room):
        raise ValueError("Room must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.")
    if len(title) > 120:
        raise ValueError("Title must be 120 characters or fewer.")
    if len(content) < 10:
        raise ValueError("Content must be at least 10 characters.")
    if len(content) > 12000:
        raise ValueError("Content must be 12,000 characters or fewer.")

    return wing, room, title, content


def draft_path(draft_id: str) -> Path:
    if not re.fullmatch(r"[0-9TZ._-]+-[A-Za-z0-9_.-]+", draft_id):
        raise ValueError("Invalid draft id.")
    return INBOX_DIR / f"{draft_id}.md"


def list_drafts() -> list[dict]:
    """List staged drafts as {id, title, wing, room, created_at} dicts.

    Reads only the FRONTMATTER HEADER of each draft (the YAML-ish
    `---` block + first ~12 lines) — never the full body. Drafts can
    be large (tens of KB) and the list endpoint is hit on every
    Drafts-sheet open, so bounding the per-file read keeps the
    endpoint fast even with hundreds of drafts in the inbox. 1024
    bytes comfortably covers the 7-line stock header plus a few lines
    of slack, while still being well under the 4KB page cache block
    on every modern filesystem so each read is essentially free.
    """
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    drafts = []
    for path in sorted(INBOX_DIR.glob("*.md"), reverse=True):
        meta = {"id": path.stem, "title": path.stem, "wing": "", "room": "", "created_at": ""}
        try:
            with path.open("rb") as fh:
                # Bounded read — header lives in the first ~7 lines of
                # the template (see save_draft); 1024 bytes is plenty.
                # decode("utf-8", errors="replace") matches the prior
                # read_text behaviour for stray non-UTF-8 bytes.
                head = fh.read(1024).decode("utf-8", errors="replace")
        except OSError:
            # Skip unreadable drafts rather than 500 the whole list —
            # other drafts can still surface, and the Drafts UI will
            # show whatever did parse.
            continue
        for line in head.splitlines()[:12]:
            if line.startswith("Title: "):
                meta["title"] = line.removeprefix("Title: ").strip()
            elif line.startswith("Wing: "):
                meta["wing"] = line.removeprefix("Wing: ").strip()
            elif line.startswith("Room: "):
                meta["room"] = line.removeprefix("Room: ").strip()
            elif line.startswith("Created: "):
                meta["created_at"] = line.removeprefix("Created: ").strip()
        drafts.append(meta)
    return drafts


def save_draft(payload: dict) -> dict:
    wing, room, title, content = validate_memory_payload(payload)
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    created = datetime.now().isoformat(timespec="seconds")
    draft_id = f"{created.replace(':', '').replace('-', '').replace('+', '_')}-{slug(title or room)}"
    path = INBOX_DIR / f"{draft_id}.md"
    heading = title or f"{wing}/{room} memory"
    body = (
        "---\n"
        f"Title: {heading}\n"
        f"Wing: {wing}\n"
        f"Room: {room}\n"
        f"Created: {created}\n"
        "Status: staged\n"
        "---\n\n"
        f"# {heading}\n\n"
        f"{content}\n"
    )
    path.write_text(body, encoding="utf-8")
    return {"success": True, "draft": {"id": draft_id, "title": heading, "wing": wing, "room": room, "created_at": created}}


def load_draft(draft_id: str) -> dict:
    path = draft_path(draft_id)
    if not path.exists():
        raise ValueError("Draft not found.")
    text = path.read_text(encoding="utf-8", errors="replace")
    meta = {"id": draft_id, "title": "", "wing": "", "room": "", "created_at": "", "content": ""}
    lines = text.splitlines()
    content_start = 0
    seen_open = False
    for index, line in enumerate(lines):
        if line == "---":
            if not seen_open:
                seen_open = True
                continue
            content_start = index + 1
            break
        if ": " in line:
            key, value = line.split(": ", 1)
            key = key.lower().strip()
            if key in {"title", "wing", "room", "created", "created_at"}:
                meta[("created_at" if key == "created" else key)] = value.strip()
    raw_content = "\n".join(lines[content_start:]).strip()
    # The draft body starts with `# Heading\n\n<body>`; strip the heading so the editor shows body only.
    body_lines = raw_content.splitlines()
    while body_lines and not body_lines[0].strip():
        body_lines.pop(0)
    if body_lines and body_lines[0].startswith("# "):
        body_lines.pop(0)
        while body_lines and not body_lines[0].strip():
            body_lines.pop(0)
    meta["content"] = "\n".join(body_lines).strip()
    return meta


def update_draft(payload: dict) -> dict:
    draft_id = str(payload.get("id", "")).strip()
    path = draft_path(draft_id)
    if not path.exists():
        raise ValueError("Draft not found.")
    wing, room, title, content = validate_memory_payload(payload)
    created = datetime.now().isoformat(timespec="seconds")
    heading = title or f"{wing}/{room} memory"
    body = (
        "---\n"
        f"Title: {heading}\n"
        f"Wing: {wing}\n"
        f"Room: {room}\n"
        f"Created: {created}\n"
        "Status: staged\n"
        "---\n\n"
        f"# {heading}\n\n"
        f"{content}\n"
    )
    path.write_text(body, encoding="utf-8")
    return {"success": True, "draft": {"id": draft_id, "title": heading, "wing": wing, "room": room, "created_at": created}}


def delete_draft(payload: dict) -> dict:
    draft_id = str(payload.get("id", "")).strip()
    path = draft_path(draft_id)
    if not path.exists():
        raise ValueError("Draft not found.")
    path.unlink()
    return {"success": True, "id": draft_id}


def parse_mempalace_result(proc: subprocess.CompletedProcess) -> dict:
    lines = []
    for stream in (proc.stdout, proc.stderr):
        lines.extend(line.strip() for line in stream.splitlines() if line.strip())

    for line in reversed(lines):
        if not line.startswith("{"):
            continue
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue

    detail = "\n".join(lines[-6:]).strip()
    raise RuntimeError(f"Unexpected MemPalace response: {detail or 'no output'}")


def mempalace_add_drawer(wing: str, room: str, content: str, source_file: str, added_by: str = "User") -> dict:
    # Default attribution is "User" because every dashboard-driven write
    # path (Write panel, drafts commit, JSON import, trash restore) has
    # the user as the actor. MCP-driven writes (Claude/Codex calling
    # tool_add_drawer directly) set their own added_by per the protocol
    # documented in CLAUDE.md / AGENTS.md / claude/rules/attribution.
    code = """
import json, sys
from mempalace.mcp_server import tool_add_drawer
payload = json.load(sys.stdin)
result = tool_add_drawer(
    wing=payload["wing"],
    room=payload["room"],
    content=payload["content"],
    source_file=payload["source_file"],
    added_by=payload["added_by"],
)
print(json.dumps(result))
"""
    proc = subprocess.run(
        [str(MEMPALACE_PYTHON), "-c", code],
        input=json.dumps({"wing": wing, "room": room, "content": content, "source_file": source_file, "added_by": added_by}),
        text=True,
        capture_output=True,
        timeout=45,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "MemPalace write failed.")

    result = parse_mempalace_result(proc)
    if not result.get("success"):
        raise RuntimeError(result.get("error") or "MemPalace rejected the write.")
    return result


def file_memory(payload: dict, actor: str = "User") -> dict:
    wing, room, title, content = validate_memory_payload(payload)
    heading = title or extract_title(content, f"{wing}/{room} memory")
    body = content if content.lstrip().startswith("#") else f"# {heading}\n\n{content}"
    # source = "UI" + added_by = <auth username> (e.g. "zhiar"). The
    # actor is captured at the request handler from the authenticated
    # session — see claude/rules/attribution for the vocabulary.
    result = mempalace_add_drawer(
        wing=wing,
        room=room,
        content=body,
        source_file="UI",
        added_by=actor,
    )
    return {"success": True, "result": result, "wing": wing, "room": room, "title": heading}


def mempalace_delete_drawer(drawer_id: str) -> dict:
    code = """
import json, sys
from mempalace.mcp_server import tool_delete_drawer
payload = json.load(sys.stdin)
result = tool_delete_drawer(payload["drawer_id"])
print(json.dumps(result))
"""
    proc = subprocess.run(
        [str(MEMPALACE_PYTHON), "-c", code],
        input=json.dumps({"drawer_id": drawer_id}),
        text=True,
        capture_output=True,
        timeout=45,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "MemPalace delete failed.")

    result = parse_mempalace_result(proc)
    if not result.get("success"):
        raise RuntimeError(result.get("error") or f"MemPalace rejected delete for {drawer_id}.")
    return result


def mempalace_update_drawer(drawer_id: str, content: str | None = None, wing: str | None = None, room: str | None = None) -> dict:
    code = """
import json, sys
from mempalace.mcp_server import tool_update_drawer
payload = json.load(sys.stdin)
kwargs = {k: v for k, v in payload.items() if k != 'drawer_id' and v is not None}
result = tool_update_drawer(drawer_id=payload["drawer_id"], **kwargs)
print(json.dumps(result))
"""
    proc = subprocess.run(
        [str(MEMPALACE_PYTHON), "-c", code],
        input=json.dumps({"drawer_id": drawer_id, "content": content, "wing": wing, "room": room}),
        text=True,
        capture_output=True,
        timeout=45,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "MemPalace update failed.")

    result = parse_mempalace_result(proc)
    if not result.get("success"):
        raise RuntimeError(result.get("error") or f"MemPalace rejected update for {drawer_id}.")
    return result


def update_memory(payload: dict) -> dict:
    drawer_id = str(payload.get("drawer_id", "")).strip()
    if not drawer_id.startswith("drawer_"):
        raise ValueError("Invalid drawer id.")

    drawers = read_drawers()
    current = next((d for d in drawers if d["drawer_id"] == drawer_id), None)
    if not current:
        raise ValueError("Drawer not found.")

    expected_etag = str(payload.get("etag", "")).strip()
    if expected_etag and expected_etag != current["etag"]:
        raise ValueError("Memory changed since you opened it. Reload to see the latest version.")

    new_content = payload.get("content")
    new_wing = payload.get("wing")
    new_room = payload.get("room")

    if new_content is not None:
        new_content = str(new_content)
        if len(new_content.strip()) < 10:
            raise ValueError("Content must be at least 10 characters.")
        if len(new_content) > 12000:
            raise ValueError("Content must be 12,000 characters or fewer.")

    if new_wing is not None:
        new_wing = str(new_wing).strip()
        if not NAME_RE.match(new_wing):
            raise ValueError("Wing must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.")

    if new_room is not None:
        new_room = str(new_room).strip()
        if not NAME_RE.match(new_room):
            raise ValueError("Room must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.")

    if new_content is None and new_wing is None and new_room is None:
        raise ValueError("Nothing to update — provide content, wing, or room.")

    # No log_version("update-before", ...) here per the snapshots-only-
    # for-deletions policy (2026-05-28). The dashboard used to write a
    # snapshot of the pre-edit state on every save, but that filled the
    # trash bin with restorable "version history" entries that were
    # confusing the user (looked like duplicate deletions of the same
    # drawer). Going forward, only explicit deletions produce snapshot
    # rows. Client-side optimistic-edit failure recovery uses an in-
    # memory snapshot in the editor (see commitEditMode in app.js), so
    # the server-side snapshot is no longer the only line of defense.

    result = mempalace_update_drawer(drawer_id, new_content, new_wing, new_room)
    return {"success": True, "result": result, "drawer_id": drawer_id}


def drawers_for_delete(payload: dict) -> tuple[str, list[dict]]:
    scope = str(payload.get("scope", "")).strip()
    drawers = read_drawers()

    if scope == "drawer":
        drawer_id = str(payload.get("drawer_id", "")).strip()
        if not drawer_id.startswith("drawer_"):
            raise ValueError("Invalid drawer id.")
        matches = [drawer for drawer in drawers if drawer["drawer_id"] == drawer_id]
        return "memory", matches

    if scope == "room":
        wing = str(payload.get("wing", "")).strip()
        room = str(payload.get("room", "")).strip()
        if not NAME_RE.match(wing) or not NAME_RE.match(room):
            raise ValueError("Invalid wing or room.")
        matches = [drawer for drawer in drawers if drawer["wing"] == wing and drawer["room"] == room]
        return f"room {wing}/{room}", matches

    if scope == "wing":
        wing = str(payload.get("wing", "")).strip()
        if not NAME_RE.match(wing):
            raise ValueError("Invalid wing.")
        matches = [drawer for drawer in drawers if drawer["wing"] == wing]
        return f"wing {wing}", matches

    raise ValueError("Delete scope must be drawer, room, or wing.")


def delete_memories(payload: dict) -> dict:
    confirm = str(payload.get("confirm", "")).strip()
    if confirm != "DELETE":
        raise ValueError("Delete requires confirmation value DELETE.")

    label, drawers = drawers_for_delete(payload)
    if not drawers:
        raise ValueError(f"No drawers found for {label}.")

    results = []
    for drawer in drawers:
        log_version("delete", drawer, note=f"scope={label}")
        result = mempalace_delete_drawer(drawer["drawer_id"])
        results.append({"drawer_id": drawer["drawer_id"], "result": result})

    return {"success": True, "deleted": len(results), "target": label, "results": results}


def rename_scope(payload: dict) -> dict:
    """Rename a wing or room by updating every drawer under it."""
    scope = str(payload.get("scope", "")).strip()
    new_name = str(payload.get("new_name", "")).strip()
    if not NAME_RE.match(new_name):
        raise ValueError("New name must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.")

    drawers = read_drawers()

    if scope == "wing":
        wing = str(payload.get("wing", "")).strip()
        if not NAME_RE.match(wing):
            raise ValueError("Invalid wing.")
        if wing == new_name:
            return {"success": True, "renamed": 0, "target": f"wing {wing}", "noop": True}
        matches = [drawer for drawer in drawers if drawer["wing"] == wing]
        if not matches:
            raise ValueError(f"No drawers found in wing {wing}.")
        results = []
        for drawer in matches:
            # No log_version("rename-before", ...) — snapshots-only-
            # for-deletions policy (2026-05-28). Rename is a non-
            # destructive operation; the drawer survives, just with a
            # new wing. If a rename ever needs to be undone, the user
            # renames it back; the dashboard doesn't try to be a VCS.
            result = mempalace_update_drawer(drawer["drawer_id"], wing=new_name)
            results.append({"drawer_id": drawer["drawer_id"], "result": result})
        return {"success": True, "renamed": len(results), "target": f"wing {wing} -> {new_name}", "scope": "wing"}

    if scope == "room":
        wing = str(payload.get("wing", "")).strip()
        room = str(payload.get("room", "")).strip()
        if not NAME_RE.match(wing) or not NAME_RE.match(room):
            raise ValueError("Invalid wing or room.")
        if room == new_name:
            return {"success": True, "renamed": 0, "target": f"room {wing}/{room}", "noop": True}
        matches = [drawer for drawer in drawers if drawer["wing"] == wing and drawer["room"] == room]
        if not matches:
            raise ValueError(f"No drawers found in room {wing}/{room}.")
        results = []
        for drawer in matches:
            # No log_version("rename-before", ...) per the snapshots-
            # only-for-deletions policy. See the wing-rename branch
            # above for the same rationale.
            result = mempalace_update_drawer(drawer["drawer_id"], room=new_name)
            results.append({"drawer_id": drawer["drawer_id"], "result": result})
        return {"success": True, "renamed": len(results), "target": f"room {wing}/{room} -> {wing}/{new_name}", "scope": "room"}

    raise ValueError("Rename scope must be wing or room.")


def mempalace_kg_add(subject: str, predicate: str, obj: str, *, valid_from: str = "", source_drawer_id: str = "") -> dict:
    code = """
import json, sys
from mempalace.mcp_server import tool_kg_add
payload = json.load(sys.stdin)
kwargs = {k: v for k, v in payload.items() if v}
result = tool_kg_add(**kwargs)
print(json.dumps(result))
"""
    proc = subprocess.run(
        [str(MEMPALACE_PYTHON), "-c", code],
        input=json.dumps({
            "subject": subject,
            "predicate": predicate,
            "object": obj,
            "valid_from": valid_from,
            "source_drawer_id": source_drawer_id,
        }),
        text=True,
        capture_output=True,
        timeout=45,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "MemPalace fact add failed.")
    result = parse_mempalace_result(proc)
    if not result.get("success"):
        raise RuntimeError(result.get("error") or "MemPalace rejected the fact.")
    return result


def mempalace_kg_invalidate(subject: str, predicate: str, obj: str, *, ended: str = "") -> dict:
    code = """
import json, sys
from mempalace.mcp_server import tool_kg_invalidate
payload = json.load(sys.stdin)
kwargs = {k: v for k, v in payload.items() if v}
result = tool_kg_invalidate(**kwargs)
print(json.dumps(result))
"""
    proc = subprocess.run(
        [str(MEMPALACE_PYTHON), "-c", code],
        input=json.dumps({
            "subject": subject,
            "predicate": predicate,
            "object": obj,
            "ended": ended,
        }),
        text=True,
        capture_output=True,
        timeout=45,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "MemPalace fact invalidate failed.")
    result = parse_mempalace_result(proc)
    if not result.get("success"):
        raise RuntimeError(result.get("error") or "MemPalace rejected the invalidation.")
    return result


def _validate_fact_field(name: str, value: str, *, max_len: int = 200) -> str:
    value = str(value or "").strip()
    if not value:
        raise ValueError(f"{name} is required.")
    if len(value) > max_len:
        raise ValueError(f"{name} must be {max_len} characters or fewer.")
    return value


def add_fact(payload: dict) -> dict:
    subject = _validate_fact_field("Subject", payload.get("subject", ""))
    predicate = _validate_fact_field("Predicate", payload.get("predicate", ""))
    obj = _validate_fact_field("Object", payload.get("object", ""))
    valid_from = str(payload.get("valid_from", "")).strip()
    source_drawer_id = str(payload.get("source_drawer_id", "")).strip()
    if source_drawer_id and not source_drawer_id.startswith("drawer_"):
        raise ValueError("source_drawer_id must start with 'drawer_'.")
    result = mempalace_kg_add(subject, predicate, obj, valid_from=valid_from, source_drawer_id=source_drawer_id)
    return {"success": True, "result": result, "subject": subject, "predicate": predicate, "object": obj}


def invalidate_fact(payload: dict) -> dict:
    subject = _validate_fact_field("Subject", payload.get("subject", ""))
    predicate = _validate_fact_field("Predicate", payload.get("predicate", ""))
    obj = _validate_fact_field("Object", payload.get("object", ""))
    ended = str(payload.get("ended", "")).strip()
    result = mempalace_kg_invalidate(subject, predicate, obj, ended=ended)
    return {"success": True, "result": result}


def delete_version(payload: dict) -> dict:
    # Snapshots are matched by (logged_at, identifier). Drawer snapshots
    # carry drawer_id at the top level; tunnel snapshots carry tunnel.id
    # nested inside. Accept either identifier from the caller so a single
    # trash UI can permanently delete both kinds.
    drawer_id = str(payload.get("drawer_id", "")).strip()
    tunnel_id = str(payload.get("tunnel_id", "")).strip()
    logged_at = str(payload.get("logged_at", "")).strip()
    if not (drawer_id or tunnel_id) or not logged_at:
        raise ValueError("logged_at plus either drawer_id or tunnel_id is required.")
    if not VERSIONS_LOG.exists():
        return {"success": True, "removed": 0}
    lines = VERSIONS_LOG.read_text(encoding="utf-8", errors="replace").splitlines()
    kept: list[str] = []
    removed = 0
    for line in lines:
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            kept.append(line)
            continue
        rec_tunnel = rec.get("tunnel") or {}
        rec_tunnel_id = str(rec_tunnel.get("id") or rec_tunnel.get("tunnel_id") or "")
        matches = (
            (drawer_id and rec.get("drawer_id") == drawer_id and rec.get("logged_at") == logged_at)
            or (tunnel_id and rec_tunnel_id == tunnel_id and rec.get("logged_at") == logged_at)
        )
        if matches:
            removed += 1
            continue
        kept.append(line)
    if kept:
        VERSIONS_LOG.write_text("\n".join(kept) + "\n", encoding="utf-8")
    else:
        VERSIONS_LOG.unlink(missing_ok=True)
    return {"success": True, "removed": removed}


def clear_versions(payload: dict) -> dict:
    confirm = str(payload.get("confirm", "")).strip()
    if confirm != "CLEAR":
        raise ValueError("Clear requires confirmation value CLEAR.")
    if VERSIONS_LOG.exists():
        VERSIONS_LOG.unlink()
    return {"success": True}


# ---------- Dashboard preferences (machine-wide, server-stored) ----------
# Lives in ~/.mempalace/dashboard-preferences.json — same directory and
# permission shape as credentials/sessions. Plain JSON, atomically
# rewritten on every change. Currently only stores trash retention but
# the structure is open-ended for future per-install settings.
PREFERENCES_DEFAULTS: dict = {
    # 0 = keep forever; otherwise allow-listed by TRASH_RETENTION_ALLOWED.
    "trash_auto_delete_days": 0,
    # Disable ambient/decorative animations (search-ring rotation,
    # settings gear spin, memory-card waterfall, theme-dropdown
    # cascade). Honoured client-side via an html.reduce-motion class.
    "reduce_motion": False,
    # Default sort for the memories list when no URL hash overrides it.
    # Allow-listed by SORT_ALLOWED below.
    "default_sort": "filed-desc",
    # When false, the footer's stats + system-info blocks are hidden
    # for a cleaner bottom edge (privacy bonus during screen-sharing).
    "show_footer_info": True,
    # User-remappable keyboard shortcuts. Values are KeyboardEvent.key
    # strings ("f", "x", "Backspace", "Enter", etc.). The client reads
    # these via getShortcut(action) with these defaults as fallback,
    # so leaving the key absent or empty re-enables the default. Each
    # action maps to one global keyboard handler in app.js — collisions
    # (e.g. mapping two actions to the same key) are the user's choice;
    # whichever handler runs first in the keydown listener wins.
    "shortcuts": {"maximize": "f", "close": "x", "delete": "Backspace", "edit": "e"},
    # Memories panel browse mode: instead of always 4 columns and an
    # always-visible toggle, scale columns to the filtered count and
    # hide the toggle when the list is short enough to scroll easily.
    # Thresholds live in app.js (adaptiveBrowseCols). Off-mode restores
    # the original "always 4 cols, always show toggle" behavior.
    "adaptive_browse": True,
    # Display-layer cosmetic text normalization: drawer titles get
    # Title-Cased and underscores → spaces (cleanTitle), wing/room
    # slugs get Title-Cased with acronyms upper (humanizeName), author
    # names get re-capitalized (prettifyActorName). When OFF, the raw
    # stored text is rendered as-is — useful for debugging or for
    # users who want to see exactly what's on disk. Storage is never
    # touched either way; this only affects rendering.
    "polish_text": True,
    # Relative-time format on card kickers and the meta-strip "Updated"
    # cell ("2h ago", "yesterday", "3d ago"). When OFF, all date
    # surfaces render the absolute timestamp instead — formatDate
    # ("28 May 2026") for card kickers, formatTimestamp ("28 May
    # 2026 – 03:31") for the meta-strip UPDATED cell so it matches
    # the format of the sibling FILED cell. Detail-panel timestamps
    # are unaffected (they were always absolute).
    "relative_time": True,
    # Memories + Detail panel chrome (maximize / close pill) visibility.
    # Default FALSE = macOS-style hover-reveal: the controls fade in only
    # when the user's cursor is over the parent panel (or a child has
    # keyboard focus). When TRUE the controls stay opacity:1 at all
    # times — useful for discoverability or frequent
    # maximize/close cycling. CSS rule lives in styles.css; this flag
    # drives a body class the client toggles on/off.
    "panel_controls_always_visible": False,
    # Notification bell: when TRUE, suppress drawer-update notifications
    # (the "Updated 5m ago" entries that fire when a memory is edited
    # via the dashboard or via an external MCP client). Failed-save
    # notifications still appear regardless — those are errors that
    # need user attention. Default FALSE = show all notifications.
    "suppress_update_notifications": False,
    # Notification bell: when TRUE, play a brief synthesized two-tone
    # chime via Web Audio API whenever the notification count grows
    # (new failure pushed onto failedSaves, or a drawer becomes
    # recently-updated). Default TRUE — Apple-style modest audio
    # affordance for arriving notifications. The client debounces to
    # avoid back-to-back tones within 500ms.
    "notification_sounds": True,
    # Background polling cadence (seconds) for the live-notification
    # refresh — how often the client re-fetches /api/palace so the
    # bell catches drawer updates from external MCP clients without a
    # hard refresh. Allow-listed to {15, 30, 60} via
    # NOTIFICATION_POLL_INTERVAL_ALLOWED below. Default 30s strikes a
    # balance between "feels live" and "doesn't burn Pi CPU every
    # second".
    "notification_poll_interval": 30,
}
NOTIFICATION_POLL_INTERVAL_ALLOWED: set[int] = {15, 30, 60}
TRASH_RETENTION_ALLOWED: set[int] = {0, 1, 7, 14, 30}
SORT_ALLOWED: set[str] = {"filed-desc", "filed-asc", "title", "wing"}
SHORTCUT_ACTIONS: set[str] = {"maximize", "close", "delete", "edit"}


def load_preferences() -> dict:
    """Read the preferences file, returning DEFAULTS overlaid with any
    valid values from disk. Missing file → defaults. Malformed file →
    defaults (never crashes the server)."""
    prefs = dict(PREFERENCES_DEFAULTS)
    if not PREFERENCES_FILE.exists():
        return prefs
    try:
        raw = PREFERENCES_FILE.read_text(encoding="utf-8")
        stored = json.loads(raw)
        if isinstance(stored, dict):
            tad = stored.get("trash_auto_delete_days")
            if isinstance(tad, (int, float)) and int(tad) in TRASH_RETENTION_ALLOWED:
                prefs["trash_auto_delete_days"] = int(tad)
            rm = stored.get("reduce_motion")
            if isinstance(rm, bool):
                prefs["reduce_motion"] = rm
            ds = stored.get("default_sort")
            if isinstance(ds, str) and ds in SORT_ALLOWED:
                prefs["default_sort"] = ds
            sfi = stored.get("show_footer_info")
            if isinstance(sfi, bool):
                prefs["show_footer_info"] = sfi
            ab = stored.get("adaptive_browse")
            if isinstance(ab, bool):
                prefs["adaptive_browse"] = ab
            pt = stored.get("polish_text")
            if isinstance(pt, bool):
                prefs["polish_text"] = pt
            rt = stored.get("relative_time")
            if isinstance(rt, bool):
                prefs["relative_time"] = rt
            pcav = stored.get("panel_controls_always_visible")
            if isinstance(pcav, bool):
                prefs["panel_controls_always_visible"] = pcav
            sun = stored.get("suppress_update_notifications")
            if isinstance(sun, bool):
                prefs["suppress_update_notifications"] = sun
            ns = stored.get("notification_sounds")
            if isinstance(ns, bool):
                prefs["notification_sounds"] = ns
            npi = stored.get("notification_poll_interval")
            if isinstance(npi, (int, float)) and int(npi) in NOTIFICATION_POLL_INTERVAL_ALLOWED:
                prefs["notification_poll_interval"] = int(npi)
            scs = stored.get("shortcuts")
            if isinstance(scs, dict):
                merged = dict(PREFERENCES_DEFAULTS["shortcuts"])
                for action, key in scs.items():
                    if (
                        action in SHORTCUT_ACTIONS
                        and isinstance(key, str)
                        and 0 < len(key) <= 32
                    ):
                        merged[action] = key
                prefs["shortcuts"] = merged
    except (OSError, ValueError):
        pass
    return prefs


def save_preferences(updates: dict) -> dict:
    """Merge `updates` into the current preferences and persist.
    Returns the resulting dict (post-validation). Unknown keys are
    silently dropped; invalid values are ignored (the existing value
    is kept)."""
    current = load_preferences()
    if "trash_auto_delete_days" in updates:
        candidate = updates["trash_auto_delete_days"]
        if isinstance(candidate, (int, float)) and int(candidate) in TRASH_RETENTION_ALLOWED:
            current["trash_auto_delete_days"] = int(candidate)
    if "reduce_motion" in updates and isinstance(updates["reduce_motion"], bool):
        current["reduce_motion"] = updates["reduce_motion"]
    if "default_sort" in updates and isinstance(updates["default_sort"], str) and updates["default_sort"] in SORT_ALLOWED:
        current["default_sort"] = updates["default_sort"]
    if "show_footer_info" in updates and isinstance(updates["show_footer_info"], bool):
        current["show_footer_info"] = updates["show_footer_info"]
    if "adaptive_browse" in updates and isinstance(updates["adaptive_browse"], bool):
        current["adaptive_browse"] = updates["adaptive_browse"]
    if "polish_text" in updates and isinstance(updates["polish_text"], bool):
        current["polish_text"] = updates["polish_text"]
    if "relative_time" in updates and isinstance(updates["relative_time"], bool):
        current["relative_time"] = updates["relative_time"]
    if "panel_controls_always_visible" in updates and isinstance(updates["panel_controls_always_visible"], bool):
        current["panel_controls_always_visible"] = updates["panel_controls_always_visible"]
    if "suppress_update_notifications" in updates and isinstance(updates["suppress_update_notifications"], bool):
        current["suppress_update_notifications"] = updates["suppress_update_notifications"]
    if "notification_sounds" in updates and isinstance(updates["notification_sounds"], bool):
        current["notification_sounds"] = updates["notification_sounds"]
    if "notification_poll_interval" in updates:
        candidate = updates["notification_poll_interval"]
        if isinstance(candidate, (int, float)) and int(candidate) in NOTIFICATION_POLL_INTERVAL_ALLOWED:
            current["notification_poll_interval"] = int(candidate)
    if "shortcuts" in updates and isinstance(updates["shortcuts"], dict):
        # Per-action merge so a patch can update one binding without
        # wiping the other two. Same per-key validation as load_pref-
        # erences keeps the disk format consistent across both paths.
        merged = dict(current.get("shortcuts", PREFERENCES_DEFAULTS["shortcuts"]))
        for action, key in updates["shortcuts"].items():
            if (
                action in SHORTCUT_ACTIONS
                and isinstance(key, str)
                and 0 < len(key) <= 32
            ):
                merged[action] = key
        current["shortcuts"] = merged
    PREFERENCES_FILE.parent.mkdir(parents=True, exist_ok=True)
    PREFERENCES_FILE.write_text(
        json.dumps(current, indent=2) + "\n",
        encoding="utf-8",
    )
    return current


def prune_versions_older_than(days: int) -> int:
    """Physically remove entries from VERSIONS_LOG whose `logged_at` is
    older than `days` days ago. Returns the count of pruned entries.

    Called LAZILY from /api/versions GET when the client passes
    ?prune_after_days=N (driven by the dashboard's Settings → Trash
    bin → auto-delete-after preference). No background sweeper — the
    cleanup runs whenever the trash is read, which means: the moment
    the user opens the dashboard's Recently-deleted view, anything
    older than their chosen threshold is gone for good before the
    list renders. If the dashboard is closed for a month, the prune
    runs the next time it opens (correct behaviour either way).

    Entries with malformed JSON or a missing/unparseable `logged_at`
    are KEPT — pruning is conservative; we never destroy data we
    can't reason about. """
    if days <= 0 or not VERSIONS_LOG.exists():
        return 0
    threshold = datetime.now() - timedelta(days=days)
    lines = VERSIONS_LOG.read_text(encoding="utf-8", errors="replace").splitlines()
    kept: list[str] = []
    pruned = 0
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        try:
            record = json.loads(stripped)
        except json.JSONDecodeError:
            kept.append(line)
            continue
        logged_at = record.get("logged_at", "")
        try:
            ts = datetime.fromisoformat(logged_at)
        except (ValueError, TypeError):
            kept.append(line)
            continue
        if ts < threshold:
            pruned += 1
            continue
        kept.append(line)
    if pruned > 0:
        if kept:
            VERSIONS_LOG.write_text("\n".join(kept) + "\n", encoding="utf-8")
        else:
            VERSIONS_LOG.unlink(missing_ok=True)
    return pruned


def restore_version(payload: dict) -> dict:
    # Restore dispatches on snapshot kind. Drawer snapshots carry
    # drawer_id at the top level; tunnel snapshots have kind="tunnel" and
    # the full tunnel record nested under "tunnel". Callers send whichever
    # identifier matches the kind they're restoring.
    drawer_id = str(payload.get("drawer_id", "")).strip()
    tunnel_id = str(payload.get("tunnel_id", "")).strip()
    logged_at = str(payload.get("logged_at", "")).strip()
    if not (drawer_id or tunnel_id):
        raise ValueError("drawer_id or tunnel_id is required to restore.")
    records = read_versions(limit=2000)

    if tunnel_id:
        # Tunnel restore. Match exact (id, logged_at) first; fall back to
        # the most-recent delete_tunnel for that id if logged_at is stale.
        def _rec_tunnel_id(r: dict) -> str:
            t = r.get("tunnel") or {}
            return str(t.get("id") or t.get("tunnel_id") or "")

        record = next(
            (r for r in records if _rec_tunnel_id(r) == tunnel_id and r.get("logged_at") == logged_at),
            None,
        )
        if not record:
            record = next(
                (r for r in records if _rec_tunnel_id(r) == tunnel_id and r.get("action") == "delete_tunnel"),
                None,
            )
        if not record:
            raise ValueError("No snapshot found for that tunnel.")
        tunnel = record.get("tunnel") or {}
        src = tunnel.get("source") or {}
        tgt = tunnel.get("target") or {}
        source_wing = str(src.get("wing") or "").strip()
        source_room = str(src.get("room") or "").strip()
        target_wing = str(tgt.get("wing") or "").strip()
        target_room = str(tgt.get("room") or "").strip()
        if not (source_wing and source_room and target_wing and target_room):
            raise ValueError("Snapshot endpoints are incomplete; cannot restore automatically.")
        result = mcp_call(
            "tool_create_tunnel",
            source_wing=source_wing,
            source_room=source_room,
            target_wing=target_wing,
            target_room=target_room,
            label=str(tunnel.get("label") or "") or None,
            source_drawer_id=(str(src.get("drawer_id") or "") or None),
            target_drawer_id=(str(tgt.get("drawer_id") or "") or None),
        )
        # Consume the snapshot: once a tunnel is back in the live store,
        # the deletion record in Recently deleted is stale and confusing
        # (the same row would still read as "deleted" on re-open). Remove
        # it so trash reflects current truth.
        delete_version({"tunnel_id": tunnel_id, "logged_at": record.get("logged_at", "")})
        return {"success": True, "kind": "tunnel", "result": result}

    # Drawer restore (existing flow).
    record = next((r for r in records if r.get("drawer_id") == drawer_id and r.get("logged_at") == logged_at), None)
    if not record:
        record = next((r for r in records if r.get("drawer_id") == drawer_id and r.get("action") in ("delete", "update-before")), None)
    if not record:
        raise ValueError("No version found for that drawer.")

    wing = str(record.get("wing") or "").strip()
    room = str(record.get("room") or "").strip()
    content = record.get("content") or ""
    if not NAME_RE.match(wing) or not NAME_RE.match(room):
        raise ValueError("Stored wing/room are invalid; cannot restore automatically.")

    # Restore must preserve the original provenance — added_by, source_file,
    # filed_at all come from the snapshot, NOT from the restore action.
    # The earlier version stamped "User"/"Restore"/<now> over the original
    # values, which is a bug: deleting + restoring shouldn't quietly rewrite
    # who wrote a memory or when. The new drawer_id is necessarily fresh
    # (Chroma drops the old id on delete), but the other metadata is
    # immutable as far as authorship goes.
    original_added_by = str(record.get("added_by") or "").strip() or "Direct"
    original_source = str(record.get("source_file") or "").strip() or "Direct"
    original_filed_at = str(record.get("filed_at") or "").strip()
    result = mempalace_add_drawer(
        wing=wing,
        room=room,
        content=content,
        source_file=original_source,
        added_by=original_added_by,
    )
    new_drawer_id = result.get("drawer_id")
    # Stamp original filed_at over the fresh one tool_add_drawer set.
    # Direct SQL on the new row's metadata because MP exposes no hook for
    # preserving filed_at through the write API.
    if new_drawer_id and original_filed_at:
        try:
            con = sqlite3.connect(PALACE_DB)
            con.row_factory = sqlite3.Row
            row = con.execute(
                "SELECT id FROM embeddings WHERE embedding_id = ?", (new_drawer_id,)
            ).fetchone()
            if row:
                con.execute(
                    "UPDATE embedding_metadata SET string_value = ? WHERE id = ? AND key = 'filed_at'",
                    (original_filed_at, row["id"]),
                )
                con.commit()
            con.close()
        except sqlite3.Error:
            # Filed-at preservation is best-effort — a failure here doesn't
            # invalidate the restore itself, the user just sees a fresh
            # timestamp instead of the original. Log via the audit entry.
            pass
    # Mark the new drawer_id as a restoration so enrich_drawers_with_
    # updated_at clamps its updated_at = filed_at on every subsequent
    # /api/palace read. Without this the bell pulses + the "Updated"
    # badge fires on every restore (the WAL's add_drawer record for
    # the restore is younger than the preserved filed_at by definition).
    if new_drawer_id:
        _record_restored_drawer(new_drawer_id)
    # Audit log entry for the restore action; then consume the original
    # delete/update-before snapshot so trash stops listing it. Behavior
    # parallels the tunnel branch above.
    log_version("restore", record, note=f"restored from {logged_at}")
    delete_version({"drawer_id": drawer_id, "logged_at": record.get("logged_at", "")})
    # new_drawer_id is also exposed at top level (not just nested in
    # result) so the client can call markDrawerSeen on it without
    # digging into the MP-tool-return shape — keeps the optimistic-
    # restore flow's client code simpler.
    return {
        "success": True,
        "kind": "drawer",
        "result": result,
        "wing": wing,
        "room": room,
        "new_drawer_id": new_drawer_id,
    }


def commit_draft(payload: dict, actor: str = "User") -> dict:
    draft_id = str(payload.get("id", "")).strip()
    confirm = str(payload.get("confirm", "")).strip()
    if confirm != "FILE":
        raise ValueError("Commit requires confirmation value FILE.")

    path = draft_path(draft_id)
    if not path.exists():
        raise ValueError("Draft not found.")

    text = path.read_text(encoding="utf-8", errors="replace")
    meta = {}
    content_start = 0
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if line == "---" and index > 0:
            content_start = index + 1
            break
        if ": " in line and line != "---":
            key, value = line.split(": ", 1)
            meta[key.lower()] = value

    wing = meta.get("wing", "").strip()
    room = meta.get("room", "").strip()
    content = "\n".join(lines[content_start:]).strip()
    validate_memory_payload({"wing": wing, "room": room, "title": meta.get("title", ""), "content": content})

    # Drafts are written via the dashboard UI even though they live on
    # disk first — source = "UI", actor = the authenticated dashboard
    # user (e.g. "zhiar"), captured in the request handler.
    result = mempalace_add_drawer(wing=wing, room=room, content=content, source_file="UI", added_by=actor)

    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    archived = ARCHIVE_DIR / path.name
    path.replace(archived)
    return {"success": True, "result": result, "archived": str(archived)}


# ---------------------------------------------------------------------------
# Generic MCP-tool dispatcher + Lab endpoints
# ---------------------------------------------------------------------------
#
# Every MemPalace MCP tool is callable via `mcp_call(tool_name, **kwargs)`.
# The helpers below wrap each Lab-surface endpoint, validate inputs minimally,
# and route to the right tool. Lab endpoints intentionally do NOT enforce
# `result.get("success")` because read-style tools return data dicts directly.


_MCP_DEFAULT_TIMEOUT = 60
# Per-tool subprocess timeout overrides (seconds). Tools that touch the
# embedding model or mine project trees need more headroom than the
# 60-second default.
_MCP_TIMEOUTS: dict[str, int] = {
    "tool_sync": 300,
    "tool_check_duplicate": 120,
    "tool_kg_query": 120,
    "tool_kg_timeline": 120,
    "tool_kg_stats": 120,
    "tool_graph_stats": 120,
    "tool_traverse_graph": 120,
}


def mcp_call(tool_name: str, *, timeout: int | None = None, **kwargs) -> dict:
    # Fresh nonce per call: avoids any chance that a tool's own output
    # collides with the result marker.
    marker = f"__MCP_RESULT_{secrets.token_hex(8)}__"
    payload = {k: v for k, v in kwargs.items() if v is not None}
    code = (
        "import json, sys\n"
        f"from mempalace.mcp_server import {tool_name}\n"
        "payload = json.load(sys.stdin)\n"
        f"result = {tool_name}(**payload)\n"
        "if isinstance(result, list):\n"
        "    result = {'items': result}\n"
        "elif not isinstance(result, dict):\n"
        "    result = {'value': result}\n"
        f"sys.stdout.write({marker!r})\n"
        "json.dump(result, sys.stdout, default=str)\n"
        "sys.stdout.write('\\n')\n"
    )
    proc = subprocess.run(
        [str(MEMPALACE_PYTHON), "-c", code],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        timeout=timeout if timeout is not None else _MCP_TIMEOUTS.get(tool_name, _MCP_DEFAULT_TIMEOUT),
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            proc.stderr.strip() or proc.stdout.strip() or f"MemPalace {tool_name} failed."
        )
    # MemPalace's embedding deps print to stderr and sometimes redirect
    # stdout, so the marker can land in either stream. Check both.
    for stream in (proc.stdout, proc.stderr):
        if not stream:
            continue
        idx = stream.rfind(marker)
        if idx < 0:
            continue
        body = stream[idx + len(marker):].strip()
        # Strip ANSI color escapes that onnxruntime emits before the marker
        # may also wrap the body; trim everything after the JSON close.
        if body.startswith("{"):
            depth = 0
            end = -1
            in_string = False
            escape = False
            for i, ch in enumerate(body):
                if in_string:
                    if escape:
                        escape = False
                    elif ch == "\\":
                        escape = True
                    elif ch == '"':
                        in_string = False
                    continue
                if ch == '"':
                    in_string = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
            if end > 0:
                body = body[:end]
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"MemPalace {tool_name} returned non-JSON: {body[:200]}"
            ) from exc
    combined = ((proc.stdout or "") + (proc.stderr or "")).strip().splitlines()[-3:]
    raise RuntimeError(
        f"Unexpected MemPalace response for {tool_name}: " + " | ".join(combined)
    )


def _qs_first(query: dict, key: str, default: str | None = None) -> str | None:
    values = query.get(key) or []
    if not values:
        return default
    value = values[0]
    return value if value not in (None, "") else default


def kg_query_endpoint(query: dict) -> dict:
    entity = (_qs_first(query, "entity") or "").strip()
    if not entity:
        raise ValueError("entity is required.")
    direction = _qs_first(query, "direction")
    as_of = _qs_first(query, "as_of")
    return mcp_call("tool_kg_query", entity=entity, direction=direction, as_of=as_of)


def kg_timeline_endpoint(query: dict) -> dict:
    entity = _qs_first(query, "entity")
    return mcp_call("tool_kg_timeline", entity=entity)


def diary_read_endpoint(query: dict) -> dict:
    agent = (_qs_first(query, "agent_name") or "").strip()
    if not agent:
        raise ValueError("agent_name is required.")
    last_n_raw = _qs_first(query, "last_n", "10") or "10"
    try:
        last_n = max(1, min(int(last_n_raw), 200))
    except (TypeError, ValueError):
        last_n = 10
    wing = _qs_first(query, "wing")
    return mcp_call("tool_diary_read", agent_name=agent, last_n=last_n, wing=wing)


def diary_write_endpoint(payload: dict) -> dict:
    agent = str(payload.get("agent_name", "")).strip()
    entry = str(payload.get("entry", "")).strip()
    if not agent:
        raise ValueError("agent_name is required.")
    if not entry:
        raise ValueError("entry is required.")
    topic = str(payload.get("topic", "")).strip() or "general"
    wing = str(payload.get("wing", "")).strip() or None
    return mcp_call("tool_diary_write", agent_name=agent, entry=entry, topic=topic, wing=wing)


def list_tunnels_endpoint(query: dict) -> dict:
    wing = _qs_first(query, "wing")
    return mcp_call("tool_list_tunnels", wing=wing)


def find_tunnels_endpoint(query: dict) -> dict:
    wing_a = _qs_first(query, "wing_a")
    wing_b = _qs_first(query, "wing_b")
    return mcp_call("tool_find_tunnels", wing_a=wing_a, wing_b=wing_b)


def follow_tunnels_endpoint(query: dict) -> dict:
    wing = (_qs_first(query, "wing") or "").strip()
    room = (_qs_first(query, "room") or "").strip()
    if not wing or not room:
        raise ValueError("wing and room are required.")
    return mcp_call("tool_follow_tunnels", wing=wing, room=room)


def create_tunnel_endpoint(payload: dict) -> dict:
    required = ("source_wing", "source_room", "target_wing", "target_room")
    args: dict[str, str] = {}
    for key in required:
        value = str(payload.get(key, "")).strip()
        if not value:
            raise ValueError(f"{key} is required.")
        if not NAME_RE.match(value):
            raise ValueError(f"{key} contains invalid characters.")
        args[key] = value
    label = str(payload.get("label", "")).strip() or None
    source_drawer_id = str(payload.get("source_drawer_id", "")).strip() or None
    target_drawer_id = str(payload.get("target_drawer_id", "")).strip() or None
    return mcp_call(
        "tool_create_tunnel",
        label=label,
        source_drawer_id=source_drawer_id,
        target_drawer_id=target_drawer_id,
        **args,
    )


def _find_tunnel(tunnel_id: str) -> dict | None:
    try:
        result = mcp_call("tool_list_tunnels")
    except (RuntimeError, subprocess.TimeoutExpired):
        return None
    candidates = result.get("items") or result.get("tunnels") or []
    if not isinstance(candidates, list):
        return None
    for tunnel in candidates:
        if not isinstance(tunnel, dict):
            continue
        identifier = str(tunnel.get("tunnel_id") or tunnel.get("id") or "")
        if identifier == tunnel_id:
            return tunnel
    return None


def log_tunnel_version(action: str, tunnel: dict) -> None:
    record = {
        "action": action,
        "kind": "tunnel",
        "logged_at": datetime.now().isoformat(timespec="seconds"),
        "tunnel": tunnel,
    }
    VERSIONS_LOG.parent.mkdir(parents=True, exist_ok=True)
    with VERSIONS_LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def delete_tunnel_endpoint(payload: dict) -> dict:
    tunnel_id = str(payload.get("tunnel_id", "")).strip()
    if not tunnel_id:
        raise ValueError("tunnel_id is required.")
    if not TUNNEL_ID_RE.match(tunnel_id):
        raise ValueError("tunnel_id contains invalid characters.")
    # Snapshot before destruction, matching the drawer-delete flow.
    snapshot = _find_tunnel(tunnel_id) or {"tunnel_id": tunnel_id, "note": "snapshot lookup failed"}
    log_tunnel_version("delete_tunnel", snapshot)
    return mcp_call("tool_delete_tunnel", tunnel_id=tunnel_id)


def traverse_endpoint(query: dict) -> dict:
    start_room = (_qs_first(query, "start_room") or "").strip()
    if not start_room:
        raise ValueError("start_room is required.")
    max_hops_raw = _qs_first(query, "max_hops", "2") or "2"
    try:
        max_hops = max(1, min(int(max_hops_raw), 5))
    except (TypeError, ValueError):
        max_hops = 2
    return mcp_call("tool_traverse_graph", start_room=start_room, max_hops=max_hops)


def check_duplicate_endpoint(payload: dict) -> dict:
    content = str(payload.get("content", "")).strip()
    if not content:
        raise ValueError("content is required.")
    try:
        threshold = float(payload.get("threshold", 0.9))
    except (TypeError, ValueError):
        threshold = 0.9
    threshold = max(0.0, min(threshold, 1.0))
    return mcp_call("tool_check_duplicate", content=content, threshold=threshold)


def hook_settings_get_endpoint() -> dict:
    return mcp_call("tool_hook_settings")


def hook_settings_set_endpoint(payload: dict) -> dict:
    kwargs: dict[str, bool] = {}
    if "silent_save" in payload:
        kwargs["silent_save"] = bool(payload.get("silent_save"))
    if "desktop_toast" in payload:
        kwargs["desktop_toast"] = bool(payload.get("desktop_toast"))
    if not kwargs:
        raise ValueError("Provide silent_save and/or desktop_toast.")
    return mcp_call("tool_hook_settings", **kwargs)


def sync_endpoint(payload: dict) -> dict:
    apply_changes = bool(payload.get("apply", False))
    wing = str(payload.get("wing", "")).strip() or None
    project_dir = str(payload.get("project_dir", "")).strip() or None
    return mcp_call("tool_sync", apply=apply_changes, wing=wing, project_dir=project_dir)


def reconnect_endpoint(_payload: dict | None = None) -> dict:
    return mcp_call("tool_reconnect")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "static"), **kwargs)

    def end_headers(self) -> None:
        # Cache policy is conditional on whether the request carries a
        # ?v= cache-buster query (app.js?v=250, styles.css?v=328, …).
        #
        # Versioned static assets are IMMUTABLE for that version — the
        # query string changes whenever the file content changes, so
        # the browser can hold the bytes for a year and skip the
        # download entirely on subsequent refreshes. Previously EVERY
        # response (including the 440KB app.js + 288KB styles.css) was
        # `no-store`, forcing a full re-download + re-parse on every
        # single page load — that was the "content briefly blank on
        # refresh" the user reported (the static assets had to travel
        # the LAN again before the SPA could boot).
        #
        # Everything else — the HTML entry point, API responses,
        # un-versioned assets — stays `no-store` so the app always
        # boots against fresh data and the index always picks up the
        # newest ?v= references. The index being uncached is what makes
        # the immutable-asset strategy safe: a version bump in the HTML
        # is seen immediately, pointing at a new (uncached) asset URL.
        path = self.path or ""
        if "?v=" in path or "&v=" in path:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _accepts_gzip(self) -> bool:
        return "gzip" in (self.headers.get("Accept-Encoding") or "").lower()

    def _maybe_gzip(self, body: bytes, min_size: int = 1024) -> tuple[bytes, bool]:
        """Gzip the body when the client accepts it and it's worth it.
        Returns (bytes, was_gzipped). Small bodies skip compression (the
        gzip header overhead isn't worth it under ~1KB)."""
        if len(body) < min_size or not self._accepts_gzip():
            return body, False
        try:
            return gzip.compress(body, compresslevel=6), True
        except OSError:
            return body, False

    def respond_json(self, payload: dict, status: int = 200, extra_headers: list[tuple[str, str]] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        # Gzip large JSON payloads on the wire — /api/palace is ~470KB raw,
        # ~135KB gzipped. The LAN is fast but the browser still has to read
        # the whole body before parsing, so this shaves real transfer time
        # for the big endpoints while tiny responses pass through untouched.
        body, gzipped = self._maybe_gzip(body)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if gzipped:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        for name, value in (extra_headers or []):
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _read_session_id(self) -> str:
        raw = self.headers.get("Cookie") or ""
        if not raw:
            return ""
        try:
            jar = SimpleCookie()
            jar.load(raw)
            morsel = jar.get(SESSION_COOKIE)
            return morsel.value if morsel else ""
        except Exception:
            return ""

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 20000:
            raise ValueError("Request body is too large.")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8") or "{}")

    def _auth_ok(self) -> bool:
        # 1. Static env-var token bypass (for scripts/automation).
        if AUTH_TOKEN:
            provided = (self.headers.get("X-Auth-Token") or "").strip()
            if provided == AUTH_TOKEN:
                return True
        # 2. If no credentials are configured, the dashboard is open
        #    so the user can perform first-time setup via Settings.
        if not load_credentials():
            return True
        # 3. Session cookie.
        return bool(validate_session(self._read_session_id()))

    def _enforce_auth(self) -> bool:
        if self._auth_ok():
            return True
        self.respond_json({"success": False, "error": "Authentication required."}, status=401)
        return False

    def _auth_exempt(self, path: str) -> bool:
        return path in ("/api/login", "/api/logout", "/api/session")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.respond_json({"ok": True, "auth_required": bool(AUTH_TOKEN) or bool(load_credentials())})
            return
        if parsed.path.startswith("/api/"):
            if parsed.path == "/api/session":
                username = validate_session(self._read_session_id())
                creds = load_credentials()
                self.respond_json({
                    "authenticated": bool(username) or (not creds and not AUTH_TOKEN),
                    "username": username,
                    "credentials_required": bool(creds),
                })
                return
            if not self._enforce_auth():
                return
            if parsed.path == "/api/palace":
                self.respond_json(build_payload())
                return
            if parsed.path == "/api/search":
                query = parse_qs(parsed.query).get("q", [""])[0]
                self.respond_json(search_payload(query))
                return
            if parsed.path == "/api/drafts":
                query = parse_qs(parsed.query)
                if "id" in query:
                    try:
                        self.respond_json({"draft": load_draft(query["id"][0])})
                    except (ValueError, RuntimeError) as exc:
                        self.respond_json({"success": False, "error": str(exc)}, status=400)
                    return
                self.respond_json({"drafts": list_drafts()})
                return
            if parsed.path == "/api/versions":
                # Lazy auto-prune driven by the SERVER-side preference
                # (machine-wide, set via Settings → Trash bin). On
                # every read of the trash, anything older than the
                # stored retention is physically removed before the
                # list is returned — so every read is also the cleanup
                # pass. No background sweeper.
                prefs = load_preferences()
                retention = int(prefs.get("trash_auto_delete_days", 0))
                if retention > 0:
                    prune_versions_older_than(retention)
                self.respond_json({"versions": read_versions()})
                return
            if parsed.path == "/api/preferences":
                self.respond_json({"preferences": load_preferences()})
                return
            if parsed.path == "/api/seen":
                # Standalone GET for the shared seen map. Also included
                # in /api/palace payload so most clients never hit this
                # endpoint directly — it's here as the canonical source
                # for any tooling/scripting that wants the seen state
                # without pulling the full palace.
                self.respond_json({"seen": load_seen_map()})
                return
            if parsed.path == "/api/settings":
                self.respond_json(get_settings_status())
                return
            if parsed.path == "/api/system":
                self.respond_json(get_system_info())
                return
            if parsed.path == "/api/version":
                self.respond_json(get_version_info())
                return
            if parsed.path == "/api/export":
                self.respond_json(build_export())
                return
            # ---- Lab endpoints (read-side) ------------------------------------
            try:
                query = parse_qs(parsed.query)
                if parsed.path == "/api/kg/query":
                    self.respond_json(kg_query_endpoint(query))
                    return
                if parsed.path == "/api/kg/stats":
                    self.respond_json(mcp_call("tool_kg_stats"))
                    return
                if parsed.path == "/api/kg/timeline":
                    self.respond_json(kg_timeline_endpoint(query))
                    return
                if parsed.path == "/api/graph/stats":
                    self.respond_json(mcp_call("tool_graph_stats"))
                    return
                if parsed.path == "/api/taxonomy":
                    self.respond_json(mcp_call("tool_get_taxonomy"))
                    return
                if parsed.path == "/api/checkpoint":
                    self.respond_json(mcp_call("tool_memories_filed_away"))
                    return
                if parsed.path == "/api/aaak-spec":
                    self.respond_json(mcp_call("tool_get_aaak_spec"))
                    return
                if parsed.path == "/api/diary":
                    self.respond_json(diary_read_endpoint(query))
                    return
                if parsed.path == "/api/tunnels":
                    self.respond_json(list_tunnels_endpoint(query))
                    return
                if parsed.path == "/api/tunnels/find":
                    self.respond_json(find_tunnels_endpoint(query))
                    return
                if parsed.path == "/api/tunnels/follow":
                    self.respond_json(follow_tunnels_endpoint(query))
                    return
                if parsed.path == "/api/traverse":
                    self.respond_json(traverse_endpoint(query))
                    return
                if parsed.path == "/api/hooks":
                    self.respond_json(hook_settings_get_endpoint())
                    return
            except (ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
                self.respond_json({"success": False, "error": str(exc)}, status=400)
                return
            self.respond_json({"success": False, "error": "Not found"}, status=404)
            return
        # Static files: try the custom server (minify .js + gzip text) first;
        # fall back to the stdlib handler for anything it doesn't special-case
        # (binary assets, directory listings, range requests, etc.).
        if self._serve_static(parsed.path):
            return
        super().do_GET()

    def _serve_static(self, url_path: str) -> bool:
        """Serve a static file with JS-minify + gzip when applicable.
        Returns True if it fully handled the response, False to defer to
        the stdlib SimpleHTTPRequestHandler (binary, missing, etc.)."""
        # Map URL → file under static/. "/" → index.html. Strip query.
        rel = url_path.lstrip("/") or "index.html"
        # Resolve and confine to STATIC_DIR (defense-in-depth against ..).
        try:
            target = (STATIC_DIR / rel).resolve()
            target.relative_to(STATIC_DIR.resolve())
        except (ValueError, OSError):
            return False
        if not target.is_file():
            return False
        suffix = target.suffix.lower()
        # Only special-case the text assets that benefit. Everything else
        # (png, ico, svg, …) defers to stdlib (which handles binary + ranges).
        if suffix == ".js":
            body = get_minified_js(target)
            ctype = "text/javascript; charset=utf-8"
        elif suffix == ".css":
            body = target.read_bytes()
            ctype = "text/css; charset=utf-8"
        elif suffix in (".html", ".htm"):
            body = target.read_bytes()
            ctype = "text/html; charset=utf-8"
        elif suffix == ".json":
            body = target.read_bytes()
            ctype = "application/json; charset=utf-8"
        elif suffix == ".svg":
            body = target.read_bytes()
            ctype = "image/svg+xml"
        else:
            return False  # binary / unknown → stdlib
        body, gzipped = self._maybe_gzip(body)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        if gzipped:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        # end_headers() applies the ?v= immutable / no-store cache policy.
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        return True

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/login":
                payload = self.read_json()
                username = str(payload.get("username", "")).strip()
                password = str(payload.get("password", ""))
                remember = bool(payload.get("remember", False))
                creds = load_credentials()
                if not creds:
                    self.respond_json({"success": False, "error": "No credentials configured yet. Open Settings to set them."}, status=400)
                    return
                if creds.get("username") != username or not verify_password(password, creds.get("password_hash", "")):
                    self.respond_json({"success": False, "error": "Invalid username or password."}, status=401)
                    return
                sid, expires = create_session(username, remember)
                self.respond_json(
                    {"success": True, "username": username, "expires_at": expires.isoformat(timespec="seconds"), "remember": remember},
                    extra_headers=[("Set-Cookie", session_cookie_header(sid, remember))],
                )
                return
            if parsed.path == "/api/logout":
                delete_session(self._read_session_id())
                self.respond_json({"success": True}, extra_headers=[("Set-Cookie", clear_session_cookie_header())])
                return
        except json.JSONDecodeError:
            self.respond_json({"success": False, "error": "Invalid JSON."}, status=400)
            return
        if parsed.path.startswith("/api/") and not self._auth_exempt(parsed.path) and not self._enforce_auth():
            return
        # Pull the authenticated username so write paths can attribute by
        # account, not the generic "User". Falls back to "User" only
        # when no auth is configured at all (first-boot edge case).
        actor = validate_session(self._read_session_id()) or "User"
        try:
            if parsed.path == "/api/drafts":
                self.respond_json(save_draft(self.read_json()), status=201)
                return
            if parsed.path == "/api/drafts/update":
                self.respond_json(update_draft(self.read_json()))
                return
            if parsed.path == "/api/drafts/delete":
                self.respond_json(delete_draft(self.read_json()))
                return
            if parsed.path == "/api/drafts/commit":
                self.respond_json(commit_draft(self.read_json(), actor=actor))
                return
            if parsed.path == "/api/memories":
                self.respond_json(file_memory(self.read_json(), actor=actor), status=201)
                return
            if parsed.path == "/api/memories/update":
                self.respond_json(update_memory(self.read_json()))
                return
            if parsed.path == "/api/delete":
                self.respond_json(delete_memories(self.read_json()))
                return
            if parsed.path == "/api/rename":
                self.respond_json(rename_scope(self.read_json()))
                return
            if parsed.path == "/api/import":
                self.respond_json(import_palace(self.read_json(), actor=actor))
                return
            if parsed.path == "/api/facts":
                self.respond_json(add_fact(self.read_json()), status=201)
                return
            if parsed.path == "/api/facts/invalidate":
                self.respond_json(invalidate_fact(self.read_json()))
                return
            if parsed.path == "/api/versions/restore":
                self.respond_json(restore_version(self.read_json()))
                return
            if parsed.path == "/api/versions/delete":
                self.respond_json(delete_version(self.read_json()))
                return
            if parsed.path == "/api/versions/clear":
                self.respond_json(clear_versions(self.read_json()))
                return
            if parsed.path == "/api/preferences":
                # Merge-style write: only the keys present in the body
                # are updated; everything else keeps its current value.
                updated = save_preferences(self.read_json() or {})
                self.respond_json({"preferences": updated})
                return
            if parsed.path == "/api/seen":
                # Body: {drawer_ids: [...], seen_at?: iso}. Stamps each
                # id with seen_at (or now) in the shared map and
                # persists to dashboard-seen.json. Returns the updated
                # map so the calling client doesn't have to re-fetch
                # to confirm the write landed.
                body = self.read_json() or {}
                ids = body.get("drawer_ids") or []
                if not isinstance(ids, list):
                    ids = []
                seen_at = body.get("seen_at") if isinstance(body.get("seen_at"), str) else None
                updated = mark_drawers_seen([str(i) for i in ids if i], seen_at)
                self.respond_json({"seen": updated})
                return
            if parsed.path == "/api/settings/credentials":
                result = update_credentials(self.read_json())
                sid = result.pop("_session_id", None)
                result.pop("_session_expires", None)
                extra = [("Set-Cookie", session_cookie_header(sid, remember=False))] if sid else None
                self.respond_json(result, extra_headers=extra)
                return
            # ---- Lab endpoints (write-side) -----------------------------------
            if parsed.path == "/api/diary":
                self.respond_json(diary_write_endpoint(self.read_json()), status=201)
                return
            if parsed.path == "/api/tunnels":
                self.respond_json(create_tunnel_endpoint(self.read_json()), status=201)
                return
            if parsed.path == "/api/tunnels/delete":
                self.respond_json(delete_tunnel_endpoint(self.read_json()))
                return
            if parsed.path == "/api/check-duplicate":
                self.respond_json(check_duplicate_endpoint(self.read_json()))
                return
            if parsed.path == "/api/hooks":
                self.respond_json(hook_settings_set_endpoint(self.read_json()))
                return
            if parsed.path == "/api/sync":
                self.respond_json(sync_endpoint(self.read_json()))
                return
            if parsed.path == "/api/reconnect":
                self.respond_json(reconnect_endpoint(self.read_json()))
                return
            self.respond_json({"success": False, "error": "Not found"}, status=404)
        except json.JSONDecodeError:
            self.respond_json({"success": False, "error": "Invalid JSON."}, status=400)
        except (ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
            self.respond_json({"success": False, "error": str(exc)}, status=400)


def main() -> None:
    port = int(os.environ.get("PORT", "8765"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"MemPalace dashboard: http://127.0.0.1:{port}")
    print("Palace DB:", PALACE_DB)
    print("Knowledge graph:", KG_DB)
    print(f"Auth: {'enabled (X-Auth-Token required)' if AUTH_TOKEN else 'disabled (set MEMPALACE_TOKEN to enable)'}")
    server.serve_forever()


if __name__ == "__main__":
    main()
