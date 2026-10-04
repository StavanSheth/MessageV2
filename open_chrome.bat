@echo off
title MessageV2 - Visible Chrome Launcher (Profile 4)
echo ========================================================
echo   Launching Your Existing Logged-in Chrome (Profile 4)
echo ========================================================
echo.
echo Launching Google Chrome with your Profile 4 and port 9222...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --profile-directory="Profile 4" --restore-last-session https://www.instagram.com
echo.
echo Chrome has been launched with your existing profile and tabs!
echo.
