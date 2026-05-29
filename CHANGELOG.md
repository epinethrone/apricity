# Changelog

All notable changes to Apricity (formerly "MemPalace Dashboard") are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it tags a `v1.0.0`.

## [Unreleased]

Work layered on top of the 0.6.0 baseline (the dated 0.6.0 entry below
documents the earlier tunnel-inspector design, since superseded). This
batch is the "Apricity" baseline pushed as a known-good recovery point.

### Added
- **Apricity rebrand.** App is now "Apricity — MemPalace Companion": logo in the top bar, favicon set regenerated from the Apricity mark, official lobe-icons model SVGs (Claude/Codex/Gemini/Grok) under `static/icons/`.
- **Wikilink + hyperlink back-navigation.** Following a `[[drawer_id|Title]]` link to another memory pushes a nav stack; a `← Back to previous memory` bar pops it. Supports arbitrary depth and restores scroll position.
- **localStorage palace cache (stale-while-revalidate).** Reloads paint memories instantly from the last cached payload, then reconcile against the live fetch. A dedicated `apricity-seen-cache-v1` key keeps notification-dismissal state from flashing back on refresh.
- **Server gzip + serve-time JS minify.** `server.py` gzips text responses ≥1KB and minifies `app.js` on demand via `terser`/`esbuild` (cached by mtime, graceful raw fallback). app.js 441KB → 175KB minified → ~45KB gzipped on the wire.
- **Notification bell overhaul.** Suppress toggle, synthesized success/error sounds (Web Audio, unlock-on-gesture), configurable poll interval (15/30/60s), retry buttons for failed saves, test affordance, LAN-wide shared seen-state via `dashboard-seen.json`.
- **Optimistic edit/delete/restore** with revert-on-failure + failed-save notification, retry button, and a red `.is-failed` card tint.

### Changed
- **Renamed to Apricity.** The distribution is now `apricity` (`pipx install apricity`, `apricity` command); `mempalace-dashboard` is kept as a deprecated console-script alias so existing launchers keep working. The repo moved to `epinethrone/apricity`; all `pyproject` URLs, the GitHub release-check endpoint, `README.md`, and `CONTRIBUTING.md` were rewritten to match and to frame Apricity as a front-end for MemPalace. The Python import package stays `mempalace_dashboard` for now.
- **Tunnel detail redesign.** Endpoint cards stack vertically with a graph-edge connector; "Open memory" moved to a compact header link rendered only for drawer-bound endpoints.
- **Tunnel-bind indicator.** Replaced the cramped "TUNNELS" meta cell with a floating chip (linked-memory title + glyph, opens the linked memory) plus a low-opacity graph-edge watermark in the meta strip; edit mode adds an inline unbind ×.
- **Versioned static assets cached `immutable`**; HTML + API stay `no-store`. Fixes the blank-content flash on every refresh.
- **Reload polish.** Pre-paint priming of pane widths / theme / grid layout from a synchronous `<head>` script + deferred app.js IIFE, eliminating logo, Tools-button, search-box, panel-header, theme-icon, and detail-meta flicker/shift on reload.

### Fixed
- Numerous reload layout-shift / flash regressions (search box left-snap, panel-header count shift, theme icon pop-in, detail meta-strip grey-band flicker, wrong slide-direction on first post-reload nav).
- `loadTunnels` no longer self-recurses; boot fetches (session/preferences/palace/tunnels) run in parallel instead of serially.
- Mobile: panel controls reachable on touch (no-hover) devices.

## [0.6.0] — 2026-05-26

### Added
- **Resizable panes.** Drag handles between sidebar/main, rooms/drawers, and drawers/detail let you resize each pane to taste. Widths persist across reloads via localStorage (one key per pane: `mempalace-pane--sidebar-w`, `mempalace-pane--rooms-w`, `mempalace-pane--drawers-w`). Each width is clamped to safe bounds (sidebar 200–520, rooms 200–600, drawers 280–900px). **Double-click** a resizer to reset that pane to default. **Arrow keys** when a resizer is focused nudge ±16px (or ±64px with Shift held). Hit target is 14px wide; there's no visible divider line — the `col-resize` cursor on hover is the only affordance, which keeps the chrome quiet between adjacent panels.
- **Layout fallback.** New `.shell.resizable` and `.content-grid.resizable` CSS classes mean the resizable grid template only takes effect once JS has injected the handles. If app.js fails to load, the dashboard falls back to the original responsive layout instead of breaking.
- **Detail-panel tunnel jump.** Whenever the selected memory's room has at least one tunnel, the metadata header gains a tunnel-glyph button to the left of `Copy ID`. Tap it to jump to the other end — to the bound drawer if the tunnel was created with one, otherwise to the first drawer in the target room.
- **In-pane "Open memory" navigation with iOS-style slide.** Clicking `Open memory` on a drawer-bound endpoint card now pushes the drawer into the same right pane (instead of changing wing/room/drawer selection in the other panes). A chevron-and-label `← Back to tunnel` sits above the metadata block; tap it to pop back to the tunnel inspector. Forward transitions slide the new content in from the right; back transitions slide it in from the left. Easing curve `cubic-bezier(0.32, 0.72, 0, 1)` to match UIKit's default push/pop. Honors `prefers-reduced-motion: reduce`. `Open room` on unbound endpoints still navigates the whole UI.
- **Standardized delete + tunnel trash recovery.** Tunnel deletion now flows through the same confirmation sheet memories/rooms/wings use (`openDeleteSheet` + `confirmDelete`), with the same trash-can icon as draft deletion. `data-delete-scope="tunnel"` plus the existing document-level `[data-delete-scope]` dispatcher routes one click to the standard prompt. Server-side, `delete_tunnel_endpoint` already snapshots the tunnel into `VERSIONS_LOG` before deletion (using `log_tunnel_version` with `kind: "tunnel"`); the snapshot now appears in **Recently deleted** alongside drawer snapshots. **Restore from trash** brings the tunnel back exactly as stored — same id (canonical from endpoints), label, and any drawer bindings. The trash UI renders tunnel rows differently from drawer rows (route in the title slot, optional label preview below the meta line).
- **Tunnel inspector in the right pane.** Tapping a tunnel entry inside a room-row expansion now opens a graphical tunnel-detail view in the detail panel instead of navigating away. The view stacks: an accented "Tunnel" eyebrow with the tunnel id and Copy ID; two endpoint cards joined by a dashed arrow (`From` / `To`, wing + room + memory count, or the bound memory's title when the tunnel has a `source_drawer_id` / `target_drawer_id`); the tunnel label rendered as the body (with an italic fallback when no label was set); a metadata footer (created, kind); and a `Delete tunnel` action that calls `/api/tunnels/delete` and refreshes the cache. Endpoint cards have `Open room` / `Open memory` buttons that clear the tunnel selection and navigate the rest of the UI to that endpoint. The tunnel id is persisted in the URL hash as `t=…` so deep-links and refreshes restore the view. A container query (`@container (max-width: 520px)`) auto-stacks the endpoint cards vertically when the detail pane is dragged narrow, so neither card truncates aggressively. The entry box that opened the inspector is highlighted in the room expansion via a new `.room-tunnel-link.active` style so users can see which tunnel maps to the open view.

### Changed
- **Tunnel indicator is now a pure visual badge.** The room-row icon no longer has its own click target or per-row expansion panel. Whenever a room with tunnels is selected and no specific memory is chosen, the right pane automatically renders the tunnel inspector for the first tunnel — which makes the icon read as "open this room to see its tunnel info on the right" instead of "expand for a list". This removes one click and an entire UI surface (the inline expansion + per-tunnel entry boxes from 0.5.0) now that the inspector is the canonical place tunnel data lives. Rooms with multiple tunnels show the first; navigate via the inspector's `Swap direction` / endpoint cards to reach the others.
- **Wing counts zero-padded to two digits.** Single-digit counts now render as `01`, `02`, `03` so wing rows stay vertically aligned at a glance. Same rule applies to the All-rooms / per-room counts in the rooms panel. Counts ≥100 still take their natural width.
- **Wing-row tunnel chip removed.** The accent-color pill that showed the cross-wing tunnel count next to each wing was visually loud and broke the same count-column symmetry the icon refactor fixes for rooms; cross-wing context is still available from the Tools → Tunnels pane.
- `.shell` grid base template stays at the old `280px 1fr` until `initResizers()` adds the `.resizable` class.
- `.content-grid` similar: stays at the old `minmax(200px, 0.55fr) minmax(320px, 0.95fr) minmax(380px, 1.5fr)` with 16px gap until `.resizable` flips it to fixed-px columns with the resizer tracks.

### Removed
- `.wing-tunnel-chip`, `.nav-item-meta`, `.room-tunnel-chip`, `.room-tunnel-add` styles and the wing-chip render path in `renderNav`. `state.tunnelsByWing` is gone.
- **Room-row tunnel expansion.** `.room-tunnel-list`, `.room-tunnel-link*`, `.room-row.tunnel-open .room-item`, and `@keyframes tunnel-expand` are all out, along with `state.expandedTunnelRooms` and the icon's click/keyboard handlers. The tunnel inspector replaces this surface entirely.
- `state.selectedTunnelId` and the `t=…` URL-hash key. Tunnel selection is now derived from `selectedWing` + `selectedRoom` instead of being its own state.

## [0.5.1] — 2026-05-26

### Fixed
- **Stack overflow on initial load (`Maximum call stack size exceeded`).** 0.5.0 added two lines at the end of the new tunnel-loader block:
  ```js
  window.loadTunnels = (...args) => loadTunnels(...args);
  window.openTunnelCreate = openTunnelCreate;
  ```
  intended to "expose" the functions to `lab.js`. The first one was a self-referencing arrow because function declarations in classic scripts auto-attach to the global object — assigning to `window.loadTunnels` rebound the same global property the bare `loadTunnels` inside the arrow body resolved to. Every call recursed until the stack blew. Triggered immediately on page load because `loadPalace()` fires `loadTunnels().catch(...)` once palace data arrives. The wrappers are gone; the underlying functions are already on `window` from their declarations.

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

[Unreleased]: https://github.com/epinethrone/apricity/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/epinethrone/apricity/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/epinethrone/apricity/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/epinethrone/apricity/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/epinethrone/apricity/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/epinethrone/apricity/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/epinethrone/apricity/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/epinethrone/apricity/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/epinethrone/apricity/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/epinethrone/apricity/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/epinethrone/apricity/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/epinethrone/apricity/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/epinethrone/apricity/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/epinethrone/apricity/releases/tag/v0.1.0
