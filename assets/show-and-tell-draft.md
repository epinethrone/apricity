<!-- ============================================================
     APRICITY — Show & Tell draft for MemPalace/mempalace Discussions
     Theme-adaptive images use GitHub's #gh-dark-mode-only /
     #gh-light-mode-only URL-fragment trick (works in Discussions
     without <picture>, which Discussions sanitizes inconsistently).
     ============================================================ -->

# 🌅 Apricity — a local, zero-dependency front-end for your MemPalace

Once my palace passed a few hundred memories, I wanted to *see* it — search, edit, and curate without dropping into SQL or living in an MCP shell. So I built **Apricity**: a browser UI that talks to the official `mempalace` package, binds to `127.0.0.1`, ships **zero runtime dependencies** (one file of stdlib Python + vanilla HTML/CSS/JS), and snapshots every destructive action so nothing is ever lost.

It's not a memory system of its own — **it's the window onto yours.**

> 🔗 **Repo:** https://github.com/epinethrone/apricity · MIT · runs from a clone with `python3 server.py`

---

### 🔎 Search that feels alive

The search bar carries an always-on rotating ring — the "alive and listening" affordance. `⌘K` from anywhere; `Enter` jumps to the first match.

![Apricity search bar — rotating ring + live typing](https://raw.githubusercontent.com/epinethrone/apricity/main/assets/apricity-search-light.svg#gh-light-mode-only)
![Apricity search bar — rotating ring + live typing](https://raw.githubusercontent.com/epinethrone/apricity/main/assets/apricity-search-dark.svg#gh-dark-mode-only)

### ✍️ Write & edit inline — no raw-Markdown round-trip

A real WYSIWYG editor: circular toolbar, live bold/italic, `## ` → heading autoformat, and callouts. Edits apply optimistically and revert on failure.

![Apricity inline editor](https://raw.githubusercontent.com/epinethrone/apricity/main/assets/apricity-editor-light.svg#gh-light-mode-only)
![Apricity inline editor](https://raw.githubusercontent.com/epinethrone/apricity/main/assets/apricity-editor-dark.svg#gh-dark-mode-only)

### ♻️ Nothing is ever lost

Delete a memory, a room, or a whole wing — every delete is snapshotted into **Recently deleted**, one click from restore.

![Apricity delete-and-recover flow](https://raw.githubusercontent.com/epinethrone/apricity/main/assets/apricity-recover-light.svg#gh-light-mode-only)
![Apricity delete-and-recover flow](https://raw.githubusercontent.com/epinethrone/apricity/main/assets/apricity-recover-dark.svg#gh-dark-mode-only)

### 🔔 See who did what

A notification bell surfaces every memory as it's filed or revised — with the **originating model's avatar** (Claude, Codex, Gemini…) and a **created vs updated** tag at a glance.

![Apricity notifications cascade](https://raw.githubusercontent.com/epinethrone/apricity/main/assets/apricity-notify-light.svg#gh-light-mode-only)
![Apricity notifications cascade](https://raw.githubusercontent.com/epinethrone/apricity/main/assets/apricity-notify-dark.svg#gh-dark-mode-only)

### 🎨 Make it yours

Auto / Light / Dark — follow the system or pick a side; your choice is persisted.

![Apricity theme switcher](https://raw.githubusercontent.com/epinethrone/apricity/main/assets/apricity-theme-light.svg#gh-light-mode-only)
![Apricity theme switcher](https://raw.githubusercontent.com/epinethrone/apricity/main/assets/apricity-theme-dark.svg#gh-dark-mode-only)

---

### Why you might like it

- 🏠 **Local-first** — binds to `127.0.0.1`, no telemetry, no cloud, no accounts.
- 🪶 **Zero runtime deps** — stdlib server + vanilla front-end. No `npm`, no Docker, no build step.
- 🛡️ **Safe by construction** — every write routes through `mempalace`; every delete/edit is snapshotted; ETag concurrency prevents lost edits.
- ⚡ **Fast** — reads SQLite/Chroma directly; localStorage cache + gzip + serve-time minify make reloads feel instant.
- 🧠 **Built for the graph** — view triples, add/invalidate facts, explore tunnels and a force-directed knowledge graph.

It expects an installed MemPalace on the same machine — it doesn't ship MemPalace itself. Everything above is animated SVG (no video), so it plays right here in the thread.

Would love feedback from other MemPalace users — especially on the curation workflows. 🙏

— built with way too much care for a dashboard
