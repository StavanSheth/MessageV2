@echo off
title MessageV2 - Visible Chrome Launcher (Default Profile)
echo ========================================================
echo   Launching Your Existing Logged-in Chrome (Default Profile)
echo ========================================================
echo.
echo Launching Google Chrome with your Default profile, port 9222, and both Dashboard + Instagram...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --profile-directory="Default" --restore-last-session http://localhost:5173 https://www.instagram.com
echo.
echo Chrome has been launched with your existing profile and both tabs in the same window!
echo.
