# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_dynamic_libs

TOOLS_DIR = Path(SPECPATH).parent   # tools/

pyside6_datas, pyside6_binaries, pyside6_hiddenimports = collect_all("PySide6")

# Playwright Python package only — ไม่รวม Node driver/browser (ใหญ่มาก)
# ผู้ใช้ต้อง run: playwright install chromium  ก่อนใช้งาน
from PyInstaller.utils.hooks import collect_submodules
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

# onedir — ปลอดภัยกว่า onefile สำหรับ Qt บน macOS
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="NetflixProfileCreator",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="NetflixProfileCreator",
)

app = BUNDLE(
    coll,
    name="NetflixProfileCreator.app",
    icon=None,
    bundle_identifier="com.fastmovie.netflix-profile-creator",
    info_plist={
        "CFBundleShortVersionString": "1.0.0",
        "NSHighResolutionCapable": True,
        "LSMinimumSystemVersion": "12.0",
    },
)
