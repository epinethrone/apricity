# Changelog

All notable changes to MemPalace Dashboard are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it tags a `v1.0.0`.

## [Unreleased]

_No unreleased changes._

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

[Unreleased]: https://github.com/epinethrone/mempalace-frontend/compare/v0.3.3...HEAD
[0.3.3]: https://github.com/epinethrone/mempalace-frontend/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/epinethrone/mempalace-frontend/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/epinethrone/mempalace-frontend/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/epinethrone/mempalace-frontend/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/epinethrone/mempalace-frontend/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/epinethrone/mempalace-frontend/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/epinethrone/mempalace-frontend/releases/tag/v0.1.0
