#!/usr/bin/env python3
"""Compatibility shim — `python3 server.py` keeps working after packaging.

The real implementation lives in `mempalace_dashboard/server.py`. Once you've
installed the package (`pipx install apricity`), prefer the `apricity` command
or `python -m mempalace_dashboard` instead.
"""

from mempalace_dashboard.server import main

if __name__ == "__main__":
    main()
