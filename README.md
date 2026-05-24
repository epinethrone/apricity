<div align="center">
  <img src="static/mempalace-logo-transparent.png" alt="MemPalace Dashboard" width="148" />

  <h1>MemPalace Dashboard</h1>

  <p>
    <strong>A local, zero-dependency web UI for browsing, curating, and reasoning about your
    <a href="https://github.com/MemPalace/mempalace">MemPalace</a> personal-memory store.</strong>
  </p>

  <p>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
    <a href="https://pypi.org/project/mempalace-dashboard/"><img alt="PyPI" src="https://img.shields.io/pypi/v/mempalace-dashboard.svg?label=pypi" /></a>
    <img alt="Python 3.11+" src="https://img.shields.io/badge/python-3.11%2B-3776ab.svg" />
    <img alt="No runtime dependencies" src="https://img.shields.io/badge/runtime-stdlib%20only-brightgreen.svg" />
    <img alt="Local-first" src="https://img.shields.io/badge/data-local--first-success.svg" />
    <a href="https://github.com/epinethrone/mempalace-frontend/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/epinethrone/mempalace-frontend?include_prereleases&sort=semver" /></a>
  </p>
</div>

![MemPalace Dashboard — three-pane view of wings, rooms, drawers, and the knowledge graph](https://github.com/user-attachments/assets/fb218c65-fa51-4613-aede-9ec033f76edc)

## Why MemPalace Dashboard?

[MemPalace](https://github.com/MemPalace/mempalace) gives your AI assistant a structured, durable memory — wings, rooms, drawers, and a knowledge graph, all stored locally. Once you have hundreds of memories, you need a way to **see, search, and curate** them without dropping to SQL or living inside an MCP shell. That's what this dashboard is for.

- 🏠 **Local-first.** Binds to `127.0.0.1`. Nothing leaves your machine. No telemetry. No accounts. No cloud.
- 🪶 **Zero runtime dependencies.** Pure-Python standard library server + plain HTML / CSS / vanilla JS frontend. No `pip install`, no `npm`, no Docker, no build step.
- 🛡️ **Safe by construction.** Every write goes through the official `mempalace` Python package. Every destructive action is snapshotted and recoverable. ETag concurrency control prevents lost edits.
- ⚡ **Fast.** Reads the SQLite/Chroma backends directly; cold-start is sub-second on a typical palace.
- ⌨️ **Keyboard-driven.** `⌘K` to search, `Esc` to dismiss, `R` to reload — works the way you expect.

> ⚠️ The dashboard expects an installed and initialised MemPalace instance on the same machine. It does **not** ship MemPalace itself — install it first from [MemPalace/mempalace](https://github.com/MemPalace/mempalace).

## Contents

- [Features](#features)
- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [Securing the dashboard](#securing-the-dashboard)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [API reference](#api-reference)
- [Safety model](#safety-model)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Features

- **Browse** memories by wing/room, search across content and metadata, filter by author, sort by date or title.
- **Write** new memories straight into the palace, or stage them as drafts in an inbox for later.
- **Edit** content, metadata (wing/room/title), and move drawers between rooms — with content-hash ETag protection against concurrent edits.
- **Delete** a single memory, a whole room, or a whole wing. Every delete is snapshotted to a recoverable log.
- **Recently deleted** view with one-click restore (creates a fresh copy) and a "Delete all" purge.
- **Drafts inbox** — save partial memories, edit them in place, and file them into the palace when ready.
- **Knowledge graph** view of triples, with one-click "End" to invalidate stale facts, a form to add new ones, and a force-directed graph visualisation.
- **Wiki-style links** — `[[name]]` references in memory content become clickable jumps to the matching memory.
- **URL state** — current wing / room / drawer / query / sort survive page reloads and are linkable.
- **Keyboard shortcuts** — `⌘K`/`Ctrl+K` focuses search, `Esc` closes any open sheet, `R` reloads data.
- **Auth** — optional username + password lock with PBKDF2-SHA256 hashing and HTTP-only session cookies (12-hour default, 30-day "Remember me").
- **Theme** — light/dark toggle that overrides the system preference, with persisted choice.

## Quickstart

### Prerequisites

- Python **3.11 or newer** (uses only the standard library — no `pip install` required).
- A working **MemPalace** install with its own venv. The dashboard shells out to it for writes, so it must be importable from `$MEMPALACE_PYTHON_BIN`.

### Install & run

Pick whichever fits how you already manage Python tools:

```bash
# Recommended — isolated install via pipx (or `uv tool install`):
pipx install mempalace-dashboard
mempalace-dashboard
```

```bash
# Or run from a clone — no install step required:
git clone https://github.com/epinethrone/mempalace-frontend mempalace-dashboard
cd mempalace-dashboard
python3 server.py            # equivalent to `python -m mempalace_dashboard`
```

```bash
# Or grab the zipapp / wheel from a GitHub Release:
# https://github.com/epinethrone/mempalace-frontend/releases
```

Then open <http://127.0.0.1:8765>.

There's no build step and no third-party runtime dependencies — the package is published purely so installing it is one command. If your MemPalace install lives somewhere non-standard, copy [`.env.example`](.env.example) to `.env` (or export the variables in your shell) and adjust the paths before launching.

### First-run checklist

1. ✅ MemPalace itself is installed and you've successfully filed at least one memory through it.
2. ✅ `~/.mempalace/palace/chroma.sqlite3` and `~/.mempalace/knowledge_graph.sqlite3` exist (or you've pointed `MEMPALACE_PALACE_DB` / `MEMPALACE_KG_DB` at where they actually live).
3. ✅ `MEMPALACE_PYTHON_BIN` points at a Python that can `import mempalace`.
4. ✅ You opened the dashboard, clicked **Settings**, and set a username + password.

## Configuration

All filesystem locations default to the standard MemPalace home (`~/.mempalace`). Override with environment variables if your installation differs (see [`.env.example`](.env.example) for a starter file):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8765` | Port the dashboard listens on. |
| `MEMPALACE_HOME` | `~/.mempalace` | Root for all dashboard data. |
| `MEMPALACE_PALACE_DB` | `<HOME>/palace/chroma.sqlite3` | The Chroma SQLite backend. |
| `MEMPALACE_KG_DB` | `<HOME>/knowledge_graph.sqlite3` | The knowledge-graph SQLite database. |
| `MEMPALACE_INBOX` | `<HOME>/dashboard-inbox` | Where drafts are staged before filing. |
| `MEMPALACE_VERSIONS` | `<HOME>/dashboard-versions.jsonl` | Append-only log of deletes and edits (powers Recently deleted). |
| `MEMPALACE_CREDENTIALS` | `<HOME>/dashboard-credentials.json` | Username + PBKDF2 hash. Mode `0600`. |
| `MEMPALACE_SESSIONS` | `<HOME>/dashboard-sessions.json` | Active session tokens. Mode `0600`. |
| `MEMPALACE_PYTHON_BIN` | `~/.local/share/mempalace-venv/bin/python` | Python that can import `mempalace`. |
| `MEMPALACE_TOKEN` | _(unset)_ | Optional shared-secret used by scripts via the `X-Auth-Token` header. Coexists with the cookie flow. |

## Securing the dashboard

1. Start the server, open the UI, click **Settings** in the sidebar.
2. Choose a username and password (≥ 8 characters).
3. Save — you're logged in immediately and the dashboard refuses every other client until they sign in.

Credentials are stored as `pbkdf2_sha256$200000$<salt>$<hash>` and never leave the host.

If you forget the password, delete `~/.mempalace/dashboard-credentials.json` and `~/.mempalace/dashboard-sessions.json` and restart the server — the dashboard reverts to open setup mode so you can re-enroll.

For scripted access, set `MEMPALACE_TOKEN=<some-secret>` in the environment and send it as the `X-Auth-Token` header. This coexists with the cookie flow; it does not replace it.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Focus the search box |
| `Esc` | Close any open sheet (write, drafts, settings, login) |
| `R` | Reload palace data |
| `Enter` (in search) | Jump to the first matching memory |

## API reference

All endpoints are JSON over HTTP. Auth is by session cookie (`mempalace_session`) or `X-Auth-Token` header when `MEMPALACE_TOKEN` is set.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET`  | `/health` | open | Liveness + whether auth is active. |
| `GET`  | `/api/session` | open | Current auth state. |
| `POST` | `/api/login` | open | `{username, password, remember}` — issues a session cookie. |
| `POST` | `/api/logout` | open | Clears the session. |
| `GET`  | `/api/palace` | auth | Full palace snapshot (wings, drawers, triples, stats). |
| `GET`  | `/api/search?q=…` | auth | Filtered subset of drawers + triples. |
| `GET`  | `/api/versions` | auth | Recently deleted/edited snapshots. |
| `POST` | `/api/memories` | auth | File a new memory. |
| `POST` | `/api/memories/update` | auth | Patch content / wing / room of an existing drawer; supports ETag. |
| `POST` | `/api/delete` | auth | Delete a drawer, room, or wing (`{scope, …, confirm: "DELETE"}`). |
| `GET`  | `/api/drafts` | auth | List drafts; `?id=<draft-id>` returns one with body. |
| `POST` | `/api/drafts` | auth | Save a new draft. |
| `POST` | `/api/drafts/update` | auth | Replace a draft in place. |
| `POST` | `/api/drafts/delete` | auth | Remove a draft. |
| `POST` | `/api/drafts/commit` | auth | File a draft into the palace. |
| `POST` | `/api/versions/restore` | auth | Recreate a deleted memory from a snapshot. |
| `POST` | `/api/versions/delete` | auth | Remove one snapshot from the log. |
| `POST` | `/api/versions/clear` | auth | Wipe the snapshot log (`{confirm: "CLEAR"}`). |
| `POST` | `/api/facts` | auth | Add a knowledge-graph triple. |
| `POST` | `/api/facts/invalidate` | auth | Mark a triple as ended. |
| `GET`  | `/api/settings` | auth | Whether credentials are configured + username. |
| `POST` | `/api/settings/credentials` | auth | Set or rotate the username + password. |

Example — file a memory from the command line:

```bash
curl -X POST http://127.0.0.1:8765/api/memories \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: $MEMPALACE_TOKEN" \
  -d '{"wing":"notes","room":"general","title":"hello","content":"first memory from curl"}'
```

## Safety model

- **No raw DB writes.** Every mutation routes through the official `mempalace` Python package — the dashboard never modifies SQLite directly.
- **Snapshot before destruction.** Every delete and every metadata edit appends a record to the versions log so the content is recoverable.
- **ETag concurrency.** The edit form sends the content hash it was opened with; the server refuses to overwrite if it has changed.
- **Confirmation values.** Bulk deletes and snapshot wipes require an exact-string confirmation in the request body.
- **No plaintext secrets.** Credentials are hashed with PBKDF2-HMAC-SHA256 (200 000 iterations, 16-byte salt). Sessions are stored server-side; cookies are `HttpOnly` + `SameSite=Lax`.
- **Loopback by default.** The server binds to `127.0.0.1`. If you put it behind a reverse proxy, terminate TLS there and keep the upstream on loopback.

## Architecture

```
┌────────────────────┐   HTTP/JSON   ┌───────────────────────┐  subprocess  ┌─────────────────┐
│ Browser (vanilla   │ ────────────► │ server.py             │ ───────────► │ mempalace venv  │
│ HTML + JS, no      │ ◄──────────── │ (stdlib only,         │ ◄─────────── │ (writes only)   │
│ build step)        │   snapshots   │  ThreadingHTTPServer) │              └─────────────────┘
└────────────────────┘               │                       │  read-only
                                     │                       │ ─────────────► palace/chroma.sqlite3
                                     │                       │ ─────────────► knowledge_graph.sqlite3
                                     └───────────────────────┘
```

- **Reads** go directly against the SQLite files for speed.
- **Writes** are dispatched to a child Python that imports `mempalace` — keeps the dashboard in lock-step with the canonical schema.
- **State that belongs to the dashboard** (drafts, snapshots, credentials, sessions) lives in `$MEMPALACE_HOME` alongside the palace data so a single backup captures everything.

## Troubleshooting

<details>
<summary><strong>Dashboard loads but the palace is empty</strong></summary>

The dashboard rendered, but `Wings: 0` and the list is empty.

- Confirm `~/.mempalace/palace/chroma.sqlite3` exists. If it doesn't, MemPalace itself hasn't been initialised on this machine.
- If your palace lives elsewhere, set `MEMPALACE_PALACE_DB` and `MEMPALACE_KG_DB` to the correct absolute paths and restart.
- Check the server log — the dashboard reports the exact paths it tried to open.
</details>

<details>
<summary><strong>"mempalace package not found" when writing</strong></summary>

Reads work, but every save / delete fails with a subprocess error mentioning `ModuleNotFoundError: No module named 'mempalace'`.

- `MEMPALACE_PYTHON_BIN` points at a Python that can't `import mempalace`. Run it manually:
  ```bash
  $MEMPALACE_PYTHON_BIN -c "import mempalace; print(mempalace.__file__)"
  ```
- Fix the path, or install `mempalace` into that venv, then restart the dashboard.
</details>

<details>
<summary><strong>I forgot my dashboard password</strong></summary>

```bash
rm ~/.mempalace/dashboard-credentials.json ~/.mempalace/dashboard-sessions.json
```

Restart the server and re-enroll via Settings. This does **not** touch your memories.
</details>

<details>
<summary><strong>Port 8765 is already in use</strong></summary>

```bash
PORT=9000 python3 server.py
```
</details>

<details>
<summary><strong>I want to expose the dashboard to another machine on my LAN</strong></summary>

The server binds to `127.0.0.1` deliberately. Put it behind a reverse proxy (Caddy, nginx, Tailscale Serve) that terminates TLS and forwards to the loopback port. Never expose the raw port to the public internet — the dashboard is designed for a trusted host.
</details>

## FAQ

**Is this an official MemPalace project?**
No. It's a community front-end that talks to the official `mempalace` package. The MemPalace project itself lives at [MemPalace/mempalace](https://github.com/MemPalace/mempalace).

**Does it work offline?**
Yes. The server is loopback-only and the frontend is vendored — no CDNs, no analytics, no outbound calls.

**Do my memories leave my machine?**
Never. The dashboard reads and writes only files under `$MEMPALACE_HOME`. There's no network code in the data path.

**Can I run multiple dashboards on one host?**
Yes — give each one its own `PORT` and (if you want isolated palaces) its own `MEMPALACE_HOME`.

**Why no `pip install`?**
The whole server is one file of standard-library Python. Keeping it dependency-free means you can audit it, vendor it, or run it on a fresh box without thinking about supply chains.

**Can I script against it?**
Yes. Set `MEMPALACE_TOKEN=…` and pass it as `X-Auth-Token`. See [API reference](#api-reference).

## Contributing

Issues, ideas, and PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development loop, code conventions, and how to file a useful bug report.

If you're adding a feature, please open an issue first to talk through the shape of it — the project values being small and dependency-free, so not every feature is the right fit.

## Security

If you find a vulnerability, please **do not** open a public issue. See [SECURITY.md](SECURITY.md) for the disclosure process.

## License

[MIT](./LICENSE) © MemPalace Dashboard contributors.
