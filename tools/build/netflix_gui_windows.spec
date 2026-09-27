# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

TOOLS_DIR = Path(SPECPATH).parent   # tools\

pyside6_datas, pyside6_binaries, pyside6_hiddenimports = collect_all("PySide6")

# Playwright Python package (ไม่รวม driver — ผู้ใช้ต้อง run playwright install ก่อน)
playwright_hiddenimports = collect_submodules("playwright")

a = Analysis(
    [str(TOOLS_DIR / "scripts" / "netflix_gui.py")],
    pathex=[str(TOOLS_DIR)],
    binaries=pyside6_binaries,
    datas=pyside6_datas,
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
    runtime_hooks=[],
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
