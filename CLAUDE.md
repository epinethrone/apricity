# Notes for Claude

Operational and architectural notes for working on MemPalace Dashboard. Things written here are meant for Claude Code (and any developer) to read when starting a session.

## What this repo is

A local-first web UI for a [MemPalace](https://github.com/MemPalace/mempalace) personal-memory store. The server is one Python file (stdlib only); the frontend is plain HTML / CSS / vanilla JS. Published on PyPI as `mempalace-dashboard`.

User-facing docs live in [`README.md`](README.md). Contributing conventions in [`CONTRIBUTING.md`](CONTRIBUTING.md). This file is for *Claude-specific* context — keep it short and operational.

## Release flow

The release pipeline is fully automated on `v*` tag pushes.

1. Bump `version` in `pyproject.toml` **and** `__version__` in `mempalace_dashboard/__init__.py` (they're verified to match in CI).
2. Add a `## [X.Y.Z] — YYYY-MM-DD` entry to `CHANGELOG.md` with Added / Changed / Fixed sub-sections.
3. Commit. Open a PR if working on a branch; merge to `main`.
4. Tag the resulting commit and push:
   ```bash
   git tag -a vX.Y.Z -m "MemPalace Dashboard vX.Y.Z"
   git push origin vX.Y.Z
   ```
5. The `release.yml` workflow builds the wheel + sdist, attaches them to a new GitHub Release with auto-generated notes, and publishes to PyPI via OIDC trusted publishing. No tokens involved.

Re-running the workflow on an already-published tag is safe — the PyPI step uses `skip-existing: true`.

## Upgrading the maintainer's running dashboard on the Pi

The maintainer's primary deployment is a `pipx`-installed `mempalace-dashboard` on a Raspberry Pi, bound to port 8765, backed by `~/.mempalace/`. To upgrade after a new release:

```bash
pipx upgrade mempalace-dashboard
kill $(pgrep -f mempalace-dashboard) && nohup mempalace-dashboard >/tmp/mempalace.log 2>&1 & disown
```

Data in `~/.mempalace/` is never touched by an upgrade — credentials, sessions, snapshots, and the palace/KG SQLite files persist.

## Things not to touch without asking

- **Runtime dependencies.** The package ships with `dependencies = []` on purpose. Adding one breaks the "stdlib only" promise that's in the README badges.
- **Build step.** There is none. Don't add a bundler, transpiler, or package.json.
- **Network defaults.** The server is meant to bind to loopback / a trusted LAN only. Don't introduce an upstream-facing default.
- **Write path.** Every mutation goes through the official `mempalace` Python package via subprocess. Don't add raw SQLite writes.

## Useful paths in this repo

- `mempalace_dashboard/server.py` — the whole backend.
- `mempalace_dashboard/static/` — frontend; served verbatim.
- `server.py` (top level) — 5-line shim so `python3 server.py` from a clone still works.
- `.github/workflows/ci.yml` — build + smoke-test on every PR (Py 3.11/3.12/3.13).
- `.github/workflows/release.yml` — tag-triggered release + PyPI publish.
