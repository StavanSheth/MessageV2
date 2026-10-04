@echo off
title MessageV2 - Visible Chrome Launcher
echo ========================================================
echo   Launching Visible Chrome for MessageV2 Automation
echo ========================================================
echo.
echo Launching Google Chrome with remote debugging on port 9222...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%~dp0data\browser_profiles\instagram" https://www.instagram.com
echo.
echo Chrome has been launched. Please complete any Instagram login if needed.
echo.
pause
