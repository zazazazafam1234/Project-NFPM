from __future__ import annotations

import os
import sys
from pathlib import Path


if getattr(sys, "frozen", False) and "PLAYWRIGHT_BROWSERS_PATH" not in os.environ:
    bundled_browsers = (
        Path(getattr(sys, "_MEIPASS", ""))
        / "playwright"
        / "driver"
        / "package"
        / ".local-browsers"
    )
    if bundled_browsers.exists():
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(bundled_browsers)
