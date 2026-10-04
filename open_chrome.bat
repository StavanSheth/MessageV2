@echo off
set "CHROME_PROFILE=Default"
if not "%~1"=="" set "CHROME_PROFILE=%~1"

title MessageV2 - Visible Chrome Launcher (%CHROME_PROFILE%)
echo ========================================================
echo   Launching Your Existing Logged-in Chrome (%CHROME_PROFILE%)
echo   User: Stavan Sheth (stavanasheth@gmail.com)
echo ========================================================
echo.
echo Launching Google Chrome with profile "%CHROME_PROFILE%", port 9222, and both Dashboard + Instagram...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --profile-directory="%CHROME_PROFILE%" --restore-last-session http://localhost:5173 https://www.instagram.com
echo.
echo Chrome has been launched live on screen with profile "%CHROME_PROFILE%"!
echo.
