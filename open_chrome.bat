@echo off
setlocal

title MessageV2 - Live Visible Chrome Launcher
echo ========================================================
echo   Launching Visible Google Chrome for Live Automation
echo   Profile: Stavan Sheth (Live Synced Profile)
echo   Port: 9222 (DevTools Protocol)
echo ========================================================
echo.
echo Launching Google Chrome live on your screen...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%~dp0data\chrome_live_profile" --profile-directory="Default" --remote-debugging-port=9222 --remote-allow-origins=* --start-maximized --no-first-run --no-default-browser-check http://localhost:5173 https://www.instagram.com
echo.
echo Chrome has been launched live on your screen!
