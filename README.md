# MemPalace Dashboard

A local web UI for browsing, editing, and curating a [MemPalace](https://github.com/) personal-memory store. Reads directly from the MemPalace SQLite/Chroma backends; all mutations go through the official `mempalace` Python package (`tool_add_drawer`, `tool_update_drawer`, `tool_delete_drawer`, `tool_kg_add`, `tool_kg_invalidate`).

> ⚠️ The dashboard expects an installed and initialised MemPalace instance on the same machine. It does **not** ship MemPalace itself.

## Features

- **Browse** memories by wing/room, search, filter by author, sort by date/title.
- **Write** new memories directly or stage them as drafts in an inbox.
- **Edit** content, metadata (wing/room/title), and move drawers between rooms — with content-hash ETag protection against concurrent edits.
- **Delete** a single memory, a whole room, or a whole wing. Every delete is snapshotted to a recoverable log.
- **Recently deleted** view with one-click restore (creates a fresh copy) and a "Delete all" purge.
- **Drafts inbox** — save partial memories for later, edit them in place, and File them when ready.
- **Knowledge graph** view of triples, with one-click "End" to invalidate stale facts and a form to add new ones.
- **Wiki-style links** — `[[name]]` references in memory content become clickable jumps to the matching memory.
- **URL state** — current wing/room/drawer/query/sort survive page reloads and are linkable.
- **Keyboard shortcuts** — `⌘K`/`Ctrl+K` focuses search, `Esc` closes any open sheet, `R` reloads data.
- **Auth** — optional username + password lock with PBKDF2-SHA256 hashing and HTTP-only session cookies (12-hour default, 30-day "Remember me").
- **Theme** — light/dark toggle that overrides the system preference, with persisted choice.

## Setup

### Prerequisites

- Python 3.11+
- A running MemPalace install with its own venv (the dashboard shells out to it for writes).

### Run

```bash
git clone <this-repo-url> mempalace-dashboard
cd mempalace-dashboard
PORT=8765 python3 server.py
```

Open `http://127.0.0.1:8765`.

### Configuration

All filesystem locations default to the standard MemPalace home (`~/.mempalace`). Override with env vars if your installation differs:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8765` | Port the dashboard listens on. |
| `MEMPALACE_HOME` | `~/.mempalace` | Root for all dashboard data. |
| `MEMPALACE_PALACE_DB` | `<HOME>/palace/chroma.sqlite3` | The Chroma SQLite backend. |
| `MEMPALACE_KG_DB` | `<HOME>/knowledge_graph.sqlite3` | The knowledge-graph SQLite database. |
| `MEMPALACE_INBOX` | `<HOME>/dashboard-inbox` | Where drafts are staged before filing. |
| `MEMPALACE_VERSIONS` | `<HOME>/dashboard-versions.jsonl` | Append-only log of deletes and edits (used for Recently deleted). |
| `MEMPALACE_CREDENTIALS` | `<HOME>/dashboard-credentials.json` | Username + PBKDF2 hash. Mode `0600`. |
| `MEMPALACE_SESSIONS` | `<HOME>/dashboard-sessions.json` | Active session tokens. Mode `0600`. |
| `MEMPALACE_PYTHON_BIN` | `~/.local/share/mempalace-venv/bin/python` | Path to a Python that can import `mempalace`. |
| `MEMPALACE_TOKEN` | _(unset)_ | Optional shared-secret used by scripts via `X-Auth-Token`. Coexists with the cookie flow. |

A starter file is provided in [`.env.example`](.env.example).

### Securing the dashboard

1. Start the server, open the UI, click **Settings** in the sidebar.
2. Choose a username and password (≥ 8 chars).
3. Save — you're logged in immediately and the dashboard refuses every other client until they sign in.

Credentials are stored as `pbkdf2_sha256$200000$<salt>$<hash>` and never leave the host.

If you forget the password, delete `~/.mempalace/dashboard-credentials.json` and `~/.mempalace/dashboard-sessions.json` and restart the server — the dashboard reverts to open setup mode.

## API

All endpoints are JSON over HTTP.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | Open | Liveness + whether auth is active. |
| GET | `/api/session` | Open | Current auth state. |
| POST | `/api/login` | Open | `{username, password, remember}` — issues a session cookie. |
| POST | `/api/logout` | Open | Clears the session. |
| GET | `/api/palace` | Auth | Full palace snapshot (wings, drawers, triples, stats). |
| GET | `/api/search?q=…` | Auth | Filtered subset of drawers + triples. |
| GET | `/api/versions` | Auth | Recently deleted/edited snapshots. |
| POST | `/api/memories` | Auth | File a new memory. |
| POST | `/api/memories/update` | Auth | Patch content/wing/room of an existing drawer; supports ETag. |
| POST | `/api/delete` | Auth | Delete a drawer, room, or wing (`{scope, …, confirm: "DELETE"}`). |
| GET | `/api/drafts` | Auth | List drafts; `?id=<draft-id>` returns one with body. |
| POST | `/api/drafts` | Auth | Save a new draft. |
| POST | `/api/drafts/update` | Auth | Replace a draft in place. |
| POST | `/api/drafts/delete` | Auth | Remove a draft. |
| POST | `/api/drafts/commit` | Auth | File a draft into the palace. |
| POST | `/api/versions/restore` | Auth | Recreate a deleted memory from a snapshot. |
| POST | `/api/versions/delete` | Auth | Remove one snapshot from the log. |
| POST | `/api/versions/clear` | Auth | Wipe the snapshot log (`{confirm: "CLEAR"}`). |
| POST | `/api/facts` | Auth | Add a triple. |
| POST | `/api/facts/invalidate` | Auth | Mark a triple as ended. |
| GET | `/api/settings` | Auth | Whether credentials are configured + username. |
| POST | `/api/settings/credentials` | Auth | Set or rotate the username + password. |

## Safety model

- **No raw DB writes.** Every mutation routes through the official `mempalace` package.
- **Snapshot before destruction.** Every delete and every metadata edit appends a record to the versions log so the content is recoverable.
- **ETag concurrency.** The edit form sends the content hash it was opened with; the server refuses to overwrite if it has changed.
- **Confirmation values.** Bulk deletes and snapshot wipes require an exact-string confirmation in the request body.
- **No plaintext secrets.** Credentials hashed (PBKDF2-HMAC-SHA256, 200k iterations, 16-byte salt). Sessions stored server-side; cookies are `HttpOnly` + `SameSite=Lax`.

## License

[MIT](./LICENSE).
