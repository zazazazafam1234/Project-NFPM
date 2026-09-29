#!/usr/bin/env python3
"""Start the profile PIN rotation API.

Reuses the Netflix login/profile code from ../tools/netflix_login_checker.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
for path in (ROOT, ROOT.parent / "tools"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from pin_service.app import main  # noqa: E402

if __name__ == "__main__":
    main()
