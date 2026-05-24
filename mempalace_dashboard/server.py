#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import os
import platform
import re
import secrets
import sqlite3
import subprocess
import sys
from collections import Counter
from datetime import datetime, timedelta
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


SERVER_STARTED_AT = datetime.now()


ROOT = Path(__file__).resolve().parent

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
CREDENTIALS_FILE = _env_path("MEMPALACE_CREDENTIALS", MEMPALACE_HOME / "dashboard-credentials.json")
SESSIONS_FILE = _env_path("MEMPALACE_SESSIONS", MEMPALACE_HOME / "dashboard-sessions.json")
SESSION_COOKIE = "mempalace_session"
SESSION_DURATION_SHORT = timedelta(hours=12)
SESSION_DURATION_LONG = timedelta(days=30)
MEMPALACE_PYTHON = _env_path("MEMPALACE_PYTHON_BIN", Path.home() / ".local" / "share" / "mempalace-venv" / "bin" / "python")
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
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


def import_palace(payload: dict) -> dict:
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
            mempalace_add_drawer(
                wing=wing,
                room=room,
                content=content,
                source_file=f"mempalace-import:{timestamp}",
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
    return list(by_id.values())


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
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    drafts = []
    for path in sorted(INBOX_DIR.glob("*.md"), reverse=True):
        text = path.read_text(encoding="utf-8", errors="replace")
        meta = {"id": path.stem, "title": path.stem, "wing": "", "room": "", "created_at": ""}
        for line in text.splitlines()[:12]:
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


def mempalace_add_drawer(wing: str, room: str, content: str, source_file: str) -> dict:
    code = """
import json, sys
from mempalace.mcp_server import tool_add_drawer
payload = json.load(sys.stdin)
result = tool_add_drawer(
    wing=payload["wing"],
    room=payload["room"],
    content=payload["content"],
    source_file=payload["source_file"],
    added_by="mempalace-dashboard",
)
print(json.dumps(result))
"""
    proc = subprocess.run(
        [str(MEMPALACE_PYTHON), "-c", code],
        input=json.dumps({"wing": wing, "room": room, "content": content, "source_file": source_file}),
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


def file_memory(payload: dict) -> dict:
    wing, room, title, content = validate_memory_payload(payload)
    heading = title or extract_title(content, f"{wing}/{room} memory")
    body = content if content.lstrip().startswith("#") else f"# {heading}\n\n{content}"
    result = mempalace_add_drawer(
        wing=wing,
        room=room,
        content=body,
        source_file=f"mempalace-dashboard:{datetime.now().isoformat(timespec='seconds')}",
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

    log_version("update-before", current, note=f"set " + ",".join(
        k for k, v in {"content": new_content, "wing": new_wing, "room": new_room}.items() if v is not None
    ))

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
            log_version("rename-before", drawer, note=f"wing {wing} -> {new_name}")
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
            log_version("rename-before", drawer, note=f"room {wing}/{room} -> {wing}/{new_name}")
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
    drawer_id = str(payload.get("drawer_id", "")).strip()
    logged_at = str(payload.get("logged_at", "")).strip()
    if not drawer_id and not logged_at:
        raise ValueError("drawer_id and logged_at are required.")
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
        if rec.get("drawer_id") == drawer_id and rec.get("logged_at") == logged_at:
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


def restore_version(payload: dict) -> dict:
    drawer_id = str(payload.get("drawer_id", "")).strip()
    logged_at = str(payload.get("logged_at", "")).strip()
    if not drawer_id:
        raise ValueError("drawer_id is required to restore.")
    records = read_versions(limit=2000)
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

    result = mempalace_add_drawer(
        wing=wing,
        room=room,
        content=content,
        source_file=f"mempalace-dashboard:restore:{drawer_id}:{datetime.now().isoformat(timespec='seconds')}",
    )
    log_version("restore", record, note=f"restored from {logged_at}")
    return {"success": True, "result": result, "wing": wing, "room": room}


def commit_draft(payload: dict) -> dict:
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

    result = mempalace_add_drawer(wing=wing, room=room, content=content, source_file=str(path))

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


_MCP_MARKER = "__MCP_RESULT__"


def mcp_call(tool_name: str, **kwargs) -> dict:
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
        f"sys.stdout.write({_MCP_MARKER!r})\n"
        "json.dump(result, sys.stdout, default=str)\n"
        "sys.stdout.write('\\n')\n"
    )
    proc = subprocess.run(
        [str(MEMPALACE_PYTHON), "-c", code],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        timeout=60,
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
        idx = stream.rfind(_MCP_MARKER)
        if idx < 0:
            continue
        body = stream[idx + len(_MCP_MARKER):].strip()
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


def delete_tunnel_endpoint(payload: dict) -> dict:
    tunnel_id = str(payload.get("tunnel_id", "")).strip()
    if not tunnel_id:
        raise ValueError("tunnel_id is required.")
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
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def respond_json(self, payload: dict, status: int = 200, extra_headers: list[tuple[str, str]] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
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
                self.respond_json({"versions": read_versions()})
                return
            if parsed.path == "/api/settings":
                self.respond_json(get_settings_status())
                return
            if parsed.path == "/api/system":
                self.respond_json(get_system_info())
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
        super().do_GET()

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
                self.respond_json(commit_draft(self.read_json()))
                return
            if parsed.path == "/api/memories":
                self.respond_json(file_memory(self.read_json()), status=201)
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
                self.respond_json(import_palace(self.read_json()))
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
