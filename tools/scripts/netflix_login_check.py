#!/usr/bin/env python3
"""CLI wrapper for the reusable Netflix login checker package."""

from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from netflix_login_checker.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
