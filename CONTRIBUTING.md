# Contributing to MemPalace Dashboard

Thanks for considering a contribution. This document describes how the project is structured, how to run it during development, and the conventions PRs are expected to follow.

## Project values

These shape what gets accepted and what doesn't:

- **Local-first, always.** No telemetry, no analytics, no outbound network calls in the data path.
- **Zero runtime dependencies.** The server is one file of standard-library Python. The frontend is plain HTML / CSS / JS, no build step. Please do not introduce a package manager.
- **Safety over convenience.** Every destructive action must be snapshotted or confirmed. Never bypass the `mempalace` Python package for writes.
- **Read the diff in one sitting.** Prefer small, single-purpose PRs. If a change touches more than ~400 lines or three files, please open an issue first to discuss the shape.

## Getting set up

```bash
git clone https://github.com/epinethrone/mempalace-frontend
cd mempalace-frontend
python3 server.py
```

You need:

- Python 3.11+ on `$PATH`.
- A working MemPalace install — see the project [README](README.md#prerequisites) for the env vars that point at it.

There is no `requirements.txt`, no virtualenv, no compile step. If your change introduces one, please open an issue to discuss it first.

## Repository layout

```
.
├── mempalace_dashboard/        # The installable package.
│   ├── __init__.py             # Exposes __version__.
│   ├── __main__.py             # `python -m mempalace_dashboard` entry point.
│   ├── server.py               # The entire backend: HTTP server, auth, snapshots, mempalace bridge.
│   └── static/
│       ├── index.html          # Single-page shell — every panel and sheet lives here.
│       ├── app.js              # All frontend behaviour. No framework.
│       ├── styles.css          # All styling. CSS custom properties drive the theme.
│       └── *.png / *.ico       # Logo and favicons.
├── server.py                   # Compatibility shim — keeps `python3 server.py` working from a clone.
├── pyproject.toml              # Packaging metadata and the `mempalace-dashboard` console script.
├── .env.example                # Documented environment variables.
├── .github/                    # Issue templates, PR template, CI + release workflows.
├── README.md                   # User-facing docs.
├── SECURITY.md                 # Threat model + disclosure process.
└── CHANGELOG.md                # Notable user-visible changes per release.
```

If you add a new API route, please:

1. Implement it in `server.py`.
2. Document it in the **API reference** table in `README.md`.
3. Add a one-line entry to `CHANGELOG.md` under "Unreleased".

## Development loop

There is no test suite yet — verification is manual. For most changes:

1. Start a scratch MemPalace install (or point env vars at a copy you're willing to lose).
2. Run `python3 server.py`.
3. Exercise the affected code path in the browser at <http://127.0.0.1:8765>.
4. Check that snapshots/recovery still work for any destructive action you touched.
5. Try the affected endpoint with `curl` to confirm it behaves correctly under direct API use.

If you write a test harness, please put it under `tests/` and keep it stdlib-only (`unittest` is fine).

## Code conventions

- **Python:** PEP 8, 4-space indent, type hints on new public functions, no third-party imports.
- **JavaScript:** vanilla ES2020+, no frameworks, no module bundler. Match the existing style in `static/app.js`.
- **CSS:** custom properties for theming, BEM-ish class names, mobile-first where reasonable.
- **Comments:** only when the *why* is non-obvious. Don't paraphrase the code.
- **Commit messages:** imperative mood, scope-prefix optional (`fix:`, `feat:`, `docs:`). Keep the subject ≤ 72 chars.

## Submitting a PR

1. Fork and branch from `main`.
2. Make the change. Update `README.md` and `CHANGELOG.md` if user-visible.
3. Verify manually in the browser.
4. Open a PR using the template. Describe what changed, *why*, and how you tested it.

A maintainer will review within a few days. PRs that touch the safety model (snapshots, deletes, auth) get extra scrutiny — please err toward more explanation rather than less.

## Reporting bugs

Use the **Bug report** issue template. The most useful reports include:

- The exact commit SHA you're on (`git rev-parse HEAD`).
- Your Python version (`python3 --version`).
- A redacted server-log excerpt showing the failure.
- Reproduction steps starting from a fresh `python3 server.py`.

## Reporting security issues

**Do not** open a public issue. See [SECURITY.md](SECURITY.md) for the private disclosure process.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE) that covers the project.
