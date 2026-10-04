@echo off
setlocal

echo ===================================================
echo     MessageV2 - Instagram DM Automation System
echo ===================================================

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found! Please run:
    echo   py -3.12 -m venv .venv
    echo   .venv\Scripts\pip install -r requirements.txt
    echo   .venv\Scripts\playwright install chromium
    pause
    exit /b 1
)

echo Starting MessageV2 Development Environment...
.venv\Scripts\python.exe scripts\start_dev.py

pause
