# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
import playwright
from PyInstaller.utils.hooks import collect_all, collect_submodules

TOOLS_DIR = Path(SPECPATH).parent   # tools\
RUNTIME_HOOK = TOOLS_DIR / "build" / "pyi_playwright_runtime.py"

pyside6_datas, pyside6_binaries, pyside6_hiddenimports = collect_all("PySide6")
playwright_datas, playwright_binaries, playwright_hiddenimports = collect_all("playwright")
playwright_browser_datas = []
playwright_browsers_dir = Path(playwright.__file__).parent / "driver" / "package" / ".local-browsers"
if playwright_browsers_dir.exists():
    for path in playwright_browsers_dir.rglob("*"):
        if path.is_file():
            destination = Path("playwright") / "driver" / "package" / ".local-browsers" / path.relative_to(playwright_browsers_dir).parent
            playwright_browser_datas.append((str(path), str(destination)))

a = Analysis(
    [str(TOOLS_DIR / "scripts" / "netflix_gui.py")],
    pathex=[str(TOOLS_DIR)],
    binaries=pyside6_binaries + playwright_binaries,
    datas=pyside6_datas + playwright_datas + playwright_browser_datas,
    hiddenimports=(
        pyside6_hiddenimports
        + playwright_hiddenimports
        + [
            "flask",
            "werkzeug",
            "jinja2",
            "click",
            "itsdangerous",
            "greenlet",
            "pyee",
            "netflix_login_checker",
            "netflix_login_checker.core",
            "netflix_login_checker.gui",
            "netflix_login_checker.post_login_workflow",
            "netflix_login_checker.server",
            "netflix_login_checker.cli",
        ]
    ),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[str(RUNTIME_HOOK)],
    excludes=["tkinter", "unittest", "test"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="NetflixProfileCreator",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,       # ไม่แสดง cmd window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,           # ใส่ path .ico ได้ เช่น "assets/icon.ico"
)
