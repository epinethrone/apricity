# Changelog

All notable changes to MemPalace Dashboard are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it tags a `v1.0.0`.

## [Unreleased]

_No unreleased changes._

## [0.5.0] — 2026-05-26

### Added
- **Tunnels are now first-class on every room.** Each room nav row gets a small connection chip (`⤵ N`) when it has any tunnels. Click the chip and the row expands inline to show the connected rooms — each is a button that navigates straight to that wing+room. No more digging into a modal to see what a room links to.
- **Wing-level tunnel counts.** Sidebar wing rows also pick up a small accent chip showing how many cross-wing tunnels involve that wing, so you can see at a glance which wings are well-connected.
- **"+ Connect this room…" inline create.** Two affordances: a pill button in the rooms-panel toolbar (visible whenever a specific room is selected) and a dashed footer button at the end of every chip expansion. Both prefill the source endpoint in the Tools tunnel-create form so you only have to pick a target.

### Changed
- **Lab → Tools.** The top-bar entry, sheet title, and aria-labels all renamed to "Tools" — better reflects what's left after the read panes moved inline. Subtitle now explains where browsing went.
- **Tunnels pane in Tools.** Browse / Find tunnels between wings / Follow tunnels from a room panes were removed (chips replace them inline). Only **Create tunnel** (open by default) and the advanced **Traverse graph** query remain.
- **Diary pane in Tools.** Read pane was removed — diary now lives as a regular wing (`wing_{agent}`) browsable from the sidebar like any other wing. Only **Write diary entry** remains.
- **Knowledge Graph and Timeline panes flagged transitional.** They keep working, but their content is slated to surface inline on entity drawers in 0.5.1 once the entity-matching design is settled.

### Fixed
- The "needs a click to load" friction on the Tunnels Browse pane is fully gone (because the pane is gone — the chips are always on).

### Notes for 0.5.1
- Inline KG facts on drawer detail view. Needs a design pass on how to compute "entities mentioned in this drawer" — either an `/api/kg/entities` listing endpoint with client-side substring matching, or explicit drawer-entity tagging in the MemPalace schema.

## [0.4.2] — 2026-05-26

### Fixed
- **Lab → Tunnels rendered every row as `?/? → ?/?`.** The Tunnels renderer was reading flat keys (`source_wing` / `source_room` / `target_wing` / `target_room` / `from_*` / `to_*`) but `tool_list_tunnels` returns nested `{source: {wing, room}, target: {wing, room}}`. None of the legacy flat keys ever matched, so every row fell through to the literal `"?"` placeholder. The renderer now reads the nested shape first and falls back to the flat keys for compatibility with any future tool that returns the flatter form.

### Added
- **Click-to-jump on tunnel rows.** Wing/room labels in each tunnel row are now buttons. Clicking either endpoint navigates to that wing+room in the main dashboard view and closes the Lab sheet, so tunnels are useful for actual exploration instead of just listing. The lookup tries both `name`, `name.replace("_","-")`, and `name.replace("-","_")` to bridge the wing-name normalization mismatch between tunnel storage and drawer storage (tracked as [MemPalace#1621](https://github.com/MemPalace/mempalace/issues/1621)).
- **Auto-load on tab open.** Opening the Tunnels tab in Lab now fires the list immediately, so you don't have to click *List tunnels* on every visit. Fires once per page load.

## [0.4.1] — 2026-05-24

### Added
- `README.md` now documents every Lab endpoint introduced in 0.4.0 (knowledge-graph query / timeline / stats, taxonomy, diary read/write, tunnel CRUD + traverse, duplicate check, hook settings, sync, reconnect, AAAK spec) and lists the Lab panel under Features.

### Changed
- **Per-tool MCP timeouts.** `mcp_call` now picks a per-tool subprocess timeout (default 60 s, 120 s for embedding-touching tools, 300 s for `tool_sync`) instead of a flat 60 s, so a real codebase sync no longer 504s.
- **Random per-call marker.** The MCP result marker is now a fresh `__MCP_RESULT_<random-hex>__` per call rather than a fixed string, so a tool that happens to emit the literal marker text in its own output can't confuse the parser.

### Fixed
- **Snapshot before tunnel deletion.** `/api/tunnels/delete` now records the tunnel's metadata to the versions log before invoking `tool_delete_tunnel`, restoring the project's "snapshot before destruction" promise for the Lab write surface.
- **`tunnel_id` validation.** The delete endpoint now enforces a bounded character set on `tunnel_id` (alphanumeric + `_.-`, max 128 chars) instead of accepting whatever string the client sends.
- **Version drift between wheel and runtime.** v0.4.0 bumped `pyproject.toml` to 0.4.0 but left `mempalace_dashboard.__version__` at `0.3.3`. CI also passed because the verify-tag step only checks `pyproject.toml`. 0.4.1 brings both in sync (`__version__ = "0.4.1"`); the release workflow continues to verify the tag against `pyproject.toml`, which is the source of truth for the wheel.

## [0.4.0] — 2026-05-24

### Added
- **Lab panel** — new top-bar entry that surfaces every previously-unused MemPalace MCP tool in one sheet with six tabs:
  - **Knowledge Graph** — query an entity, with direction filter (both / outgoing / incoming) and an `as_of` date pin.
  - **Timeline** — chronological view of an entity's facts (or the whole palace).
  - **Tunnels** — list, create, delete, find between wings, follow from a room, and graph-traverse from a starting room with a configurable hop budget.
  - **Diary** — read agent-specific AAAK diary entries and write new ones.
  - **Stats** — knowledge-graph stats, palace graph stats, recent-checkpoint state.
  - **Maintenance** — taxonomy tree, duplicate check, hook settings (silent-save / desktop-toast toggles), sync (dry-run + apply), force-reconnect, AAAK spec reference.
- Generic `mcp_call(tool_name, **kwargs)` dispatcher in the server: any MemPalace tool callable through one helper. Marker-based parser scans both stdout and stderr so the embedding library's chatter on stderr doesn't swallow the response.
- New JSON endpoints (auth-gated like the rest): `/api/kg/query`, `/api/kg/stats`, `/api/kg/timeline`, `/api/graph/stats`, `/api/taxonomy`, `/api/checkpoint`, `/api/aaak-spec`, `/api/diary` (GET/POST), `/api/tunnels` (GET/POST), `/api/tunnels/delete`, `/api/tunnels/find`, `/api/tunnels/follow`, `/api/traverse`, `/api/check-duplicate`, `/api/hooks` (GET/POST), `/api/sync`, `/api/reconnect`.

## [0.3.3] — 2026-05-24

### Changed
- `release.yml` workflow: pass `append_body: false` to `softprops/action-gh-release` so re-runs and tag force-pushes don't pile up duplicate "Full Changelog" lines on the release body.
- `release.yml` workflow: add a `workflow_dispatch` trigger so the release can be re-triggered manually from the Actions UI without force-pushing a tag.

### Fixed
- After the email-scrub history rewrite force-pushed every tag, the v0.3.1 release workflow re-fired with its frozen (pre-`skip-existing`) PyPI step and turned the `pypi` deployment indicator red. This release publishes a clean v0.3.3 so the most-recent `pypi` deployment is green again.

## [0.3.2] — 2026-05-24

### Fixed
- README hero logo — the image src was stale after the `static/ → mempalace_dashboard/static/` move in 0.3.0 and rendered as a broken image on GitHub and PyPI. Now uses an absolute `raw.githubusercontent.com` URL so it renders correctly on both.
- `release.yml` PyPI publish step now passes `skip-existing: true`, so re-running the workflow on an already-published tag (e.g. after a tag force-push) no longer leaves the `pypi` deployment marked as failed.

## [0.3.1] — 2026-05-24

### Changed
- Enable the PyPI trusted-publisher job in the release workflow now that the `pypi` environment and pending publisher are registered. From this tag onward, releases also publish to `https://pypi.org/project/mempalace-dashboard/`.

## [0.3.0] — 2026-05-24

### Added
- **Distribution as a Python package.** Install with `pipx install mempalace-dashboard` (or `uv tool install`) and run as `mempalace-dashboard` or `python -m mempalace_dashboard`. The wheel ships the static assets as package data.
- `pyproject.toml` with metadata, classifiers, project URLs, and the `mempalace-dashboard` console-script entry point.
- GitHub Actions:
  - `ci.yml` — builds the wheel and sdist on every push / PR across Python 3.11, 3.12, 3.13, and smoke-tests the resulting wheel.
  - `release.yml` — on every `v*` tag, builds artifacts, publishes a GitHub Release with auto-generated notes, and is ready (but disabled) to publish to PyPI via trusted publishing.
- `SECURITY.md` with threat model and private-disclosure process.
- `CONTRIBUTING.md` describing the development loop, repo layout, and code conventions.
- GitHub issue and pull request templates under `.github/`.
- Expanded `.env.example` covering every environment variable the dashboard reads.
- Social-sharing meta tags (Open Graph + Twitter Card) and a search-engine description on the HTML shell.
- Polished `README.md` with badges, quickstart, architecture diagram, troubleshooting, and FAQ.

### Changed
- **Repository layout.** `server.py` and `static/` now live inside the `mempalace_dashboard/` package. A top-level `server.py` shim preserves the `python3 server.py` workflow from prior versions.

### Fixed
- Broken upstream link in `README.md` — now points at the canonical [MemPalace/mempalace](https://github.com/MemPalace/mempalace) repository.
- `git clone` snippet in `README.md` — removed the `<…>` angle brackets that broke copy-paste.

## [0.2.0] — 2026-05-23

### Added
- Three-pane dashboard layout (Wings · Rooms · Memories) with a dedicated detail column.
- Knowledge-graph visualisation with a force-directed graph view alongside the existing list view.
- In-app **Settings** sheet for setting and rotating the username / password.
- Sample screenshot in the README.

### Changed
- Major visual refresh: typography, spacing, dark-mode contrast, panel chrome.

## [0.1.1] — 2026-05-23

### Fixed
- Render an empty palace gracefully when the MemPalace databases are missing or have not yet been schematised, instead of throwing.

## [0.1.0] — 2026-05-23

### Added
- Initial public release of the MemPalace Dashboard.
- Browse / write / edit / delete memories with snapshot-and-restore semantics.
- Drafts inbox.
- Knowledge-graph triple add / invalidate.
- Optional username + password auth with PBKDF2-SHA256 hashing and session cookies.
- Light / dark theme toggle with persisted preference.
- URL state for current wing / room / drawer / query / sort.
- Keyboard shortcuts (`⌘K`, `Esc`, `R`).

[Unreleased]: https://github.com/epinethrone/mempalace-frontend/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/epinethrone/mempalace-frontend/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/epinethrone/mempalace-frontend/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/epinethrone/mempalace-frontend/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/epinethrone/mempalace-frontend/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/epinethrone/mempalace-frontend/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/epinethrone/mempalace-frontend/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/epinethrone/mempalace-frontend/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/epinethrone/mempalace-frontend/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/epinethrone/mempalace-frontend/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/epinethrone/mempalace-frontend/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/epinethrone/mempalace-frontend/releases/tag/v0.1.0
