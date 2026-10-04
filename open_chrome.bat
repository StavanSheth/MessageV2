@echo off
setlocal

set "TARGET_PROFILE=Default"
if not "%~1"=="" set "TARGET_PROFILE=%~1"

title MessageV2 - Live Visible Chrome Launcher (%TARGET_PROFILE%)
echo ========================================================
echo   Launching Visible Google Chrome for Live Automation
echo   Profile: %TARGET_PROFILE% (Existing Chrome Profile)
echo   Port: 9222 (DevTools Protocol)
echo ========================================================
echo.
echo Launching Google Chrome live on your screen...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%~dp0data\chrome_junction" --profile-directory="%TARGET_PROFILE%" --remote-debugging-port=9222 --remote-allow-origins=* --start-maximized --no-first-run --no-default-browser-check --restore-last-session http://localhost:5173 https://www.instagram.com
echo.
echo Chrome has been launched live on your screen!
