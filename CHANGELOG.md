# Changelog

All notable changes to MemPalace Dashboard are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it tags a `v1.0.0`.

## [Unreleased]

### Added
- `SECURITY.md` with threat model and private-disclosure process.
- `CONTRIBUTING.md` describing the development loop, repo layout, and code conventions.
- GitHub issue and pull request templates under `.github/`.
- Expanded `.env.example` covering every environment variable the dashboard reads.
- Social-sharing meta tags (Open Graph + Twitter Card) and a search-engine description on the HTML shell.
- Polished `README.md` with badges, quickstart, architecture diagram, troubleshooting, and FAQ.

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

[Unreleased]: https://github.com/epinethrone/mempalace-frontend/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/epinethrone/mempalace-frontend/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/epinethrone/mempalace-frontend/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/epinethrone/mempalace-frontend/releases/tag/v0.1.0
