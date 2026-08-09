# Security policy

## Threat model

Apricity is designed to run on **a single trusted machine**, bound to `127.0.0.1` by
default, against a MemPalace install owned by the same user. Palace APIs fail closed
until an owner enrolls with the generated setup secret or supplies the configured API
token. Non-loopback binding is an explicit, authenticated deployment mode.

- **In scope:** authentication bypass, privilege escalation, unauthenticated remote code execution, path traversal, persistence of malicious payloads in the snapshot log, leaks of credential material, anything that lets one local user read or modify another local user's palace, anything that breaks the "no raw DB writes" invariant.
- **Out of scope:** exposing Apricity to the public internet without a reverse proxy, running Apricity as root, manually editing the SQLite files behind its back, social-engineering attacks against the local user, denial of service achieved by filling the disk.

If you're unsure whether a finding is in scope, please report it — we'd rather review and decline than miss something.

## Supported versions

The project is on a rolling release. Only the `main` branch receives security fixes. Please verify your finding reproduces on the latest commit before reporting.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Use one of the following private channels:

1. **Preferred:** [GitHub private security advisory](https://github.com/epinethrone/apricity/security/advisories/new) — encrypted, threaded, and creates a CVE if appropriate.
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

Apricity enforces these boundaries by default:

- The listener defaults to `127.0.0.1`; a non-loopback bind is refused unless an owner
  account or `MEMPALACE_TOKEN` is configured.
- Missing, invalid, or unreadable credentials never enable anonymous palace access.
  First-run account creation requires the setup secret printed in the server log.
- Host-header checks reject DNS-rebinding hosts. Browser mutations require a trusted
  same-origin request, `application/json`, and a per-session CSRF token.
- A Content Security Policy limits script execution, and rendered Markdown links only
  allow `http`, `https`, and `mailto` destinations.
- Caller-supplied sync directories are disabled unless `MEMPALACE_SYNC_ROOTS` is set;
  resolved paths and symlink targets must remain beneath an allowed root.

Operators can tighten deployments further:

- Keep the server on `127.0.0.1` and reach it via SSH port-forwarding or a Tailscale/WireGuard tunnel instead of binding to a LAN-visible address.
- When using an HTTPS reverse proxy, add its hostname to `MEMPALACE_ALLOWED_HOSTS` and
  set `MEMPALACE_COOKIE_SECURE=true`.
- Set `MEMPALACE_CREDENTIALS` and `MEMPALACE_SESSIONS` to paths on an encrypted volume; both files are written with mode `0600`.
- Rotate the `MEMPALACE_TOKEN` shared secret when sharing scripted access ends.
- Set `APRICITY_DISABLE_UPDATE_CHECK=true` if the optional GitHub releases request is
  not appropriate for the deployment.
- Periodically prune `MEMPALACE_VERSIONS` if it contains snapshots you no longer want recoverable (`POST /api/versions/clear`).
