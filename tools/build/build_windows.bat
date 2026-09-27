@echo off
:: รันจาก root ของ project เสมอ: .\tools\build\build_windows.bat
echo =============================================
echo  Netflix Profile Creator - Windows Build
echo =============================================

:: ตรวจสอบ Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] ไม่พบ Python กรุณาติดตั้งจาก https://python.org
    pause
    exit /b 1
)

echo [1/4] ติดตั้ง dependencies...
pip install -r tools\requirements.txt
if errorlevel 1 goto error

echo [2/4] ติดตั้ง PyInstaller...
pip install pyinstaller
if errorlevel 1 goto error

echo [3/4] ติดตั้ง Playwright browser...
playwright install chromium --with-deps
if errorlevel 1 goto error

echo [4/4] Build EXE...
pyinstaller tools\build\netflix_gui_windows.spec -y --clean
if errorlevel 1 goto error

echo.
echo =============================================
echo  Build สำเร็จ!
echo  ไฟล์อยู่ที่: dist\NetflixProfileCreator.exe
echo =============================================
explorer dist
exit /b 0

:error
echo.
echo [ERROR] Build ล้มเหลว ดูข้อความด้านบน
pause
exit /b 1
