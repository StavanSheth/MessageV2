@echo off
title MessageV2 - Visible Chrome Launcher (Profile 4)
echo ========================================================
echo   Launching Your Existing Logged-in Chrome (Profile 4)
echo ========================================================
echo.
echo Launching Google Chrome with your Profile 4, port 9222, and both Dashboard + Instagram...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --profile-directory="Profile 4" --restore-last-session http://localhost:5173 https://www.instagram.com
echo.
echo Chrome has been launched with your existing profile and both tabs in the same window!
echo.
