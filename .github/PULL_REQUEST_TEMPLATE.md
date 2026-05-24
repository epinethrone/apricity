<!--
Thanks for the PR. A short, focused description helps reviewers a lot.
If your change is user-visible, please update README.md and CHANGELOG.md ("Unreleased" section) in the same PR.
-->

## Summary

<!-- One or two sentences: what changes and why. -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would change existing behaviour)
- [ ] Documentation only
- [ ] Internal refactor / chore

## Related issues

<!-- e.g. "Closes #12" or "Refs #34". Remove this section if not applicable. -->

## How I verified this

<!--
Manual repro steps. The project has no automated tests yet — describe what you clicked, what you curl'd, and what you saw.
-->

- [ ] Started `python3 server.py` against a real MemPalace install.
- [ ] Exercised the affected UI in a browser.
- [ ] Verified destructive actions still produce a recoverable snapshot (if touched).
- [ ] Confirmed no new runtime dependencies or build steps were introduced.

## Screenshots

<!-- For UI changes, before/after screenshots are very helpful. Drop them inline or as attachments. -->

## Checklist

- [ ] I read [CONTRIBUTING.md](../CONTRIBUTING.md).
- [ ] My change keeps the server stdlib-only and the frontend build-step-free.
- [ ] I updated `README.md` if user-visible behaviour changed.
- [ ] I added an entry to `CHANGELOG.md` under "Unreleased" if user-visible.
- [ ] I am happy for this contribution to be licensed under the project's MIT licence.
