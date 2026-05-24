# Changelog

All notable changes to MemPalace Dashboard are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it tags a `v1.0.0`.

## [Unreleased]

_No unreleased changes._

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

[Unreleased]: https://github.com/epinethrone/mempalace-frontend/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/epinethrone/mempalace-frontend/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/epinethrone/mempalace-frontend/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/epinethrone/mempalace-frontend/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/epinethrone/mempalace-frontend/releases/tag/v0.1.0
