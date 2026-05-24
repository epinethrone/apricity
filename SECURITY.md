# Security policy

## Threat model

MemPalace Dashboard is designed to run on **a single trusted machine**, bound to `127.0.0.1`, against a MemPalace install owned by the same user. That assumption shapes everything below.

- **In scope:** authentication bypass, privilege escalation, unauthenticated remote code execution, path traversal, persistence of malicious payloads in the snapshot log, leaks of credential material, anything that lets one local user read or modify another local user's palace, anything that breaks the "no raw DB writes" invariant.
- **Out of scope:** exposing the dashboard to the public internet without a reverse proxy, running the dashboard as root, manually editing the SQLite files behind its back, social-engineering attacks against the local user, denial of service achieved by filling the disk.

If you're unsure whether a finding is in scope, please report it — we'd rather review and decline than miss something.

## Supported versions

The project is on a rolling release. Only the `main` branch receives security fixes. Please verify your finding reproduces on the latest commit before reporting.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Use one of the following private channels:

1. **Preferred:** [GitHub private security advisory](https://github.com/epinethrone/mempalace-frontend/security/advisories/new) — encrypted, threaded, and creates a CVE if appropriate.
2. **Fallback:** open an issue titled "Security report — please contact me" with no details, and a maintainer will reach out to set up a private channel.

When you report, please include:

- A description of the vulnerability and its impact.
- The exact commit SHA you reproduced against.
- Step-by-step reproduction (a minimal `curl` invocation or short script is ideal).
- Any logs or stack traces, with sensitive paths redacted.
- Your assessment of severity and any suggested mitigation.

## What to expect

- **Acknowledgement** within 5 business days.
- **Triage and a proposed timeline** within 14 days.
- **Fix and coordinated disclosure** typically within 90 days, faster for high-severity issues.
- **Credit** in the release notes and the advisory (unless you ask to remain anonymous).

## Hardening notes for operators

Even though the dashboard is local-first, operators can tighten things further:

- Keep the server on `127.0.0.1` and reach it via SSH port-forwarding or a Tailscale/WireGuard tunnel instead of binding to a LAN-visible address.
- Set `MEMPALACE_CREDENTIALS` and `MEMPALACE_SESSIONS` to paths on an encrypted volume; both files are written with mode `0600`.
- Rotate the `MEMPALACE_TOKEN` shared secret when sharing scripted access ends.
- Periodically prune `MEMPALACE_VERSIONS` if it contains snapshots you no longer want recoverable (`POST /api/versions/clear`).
