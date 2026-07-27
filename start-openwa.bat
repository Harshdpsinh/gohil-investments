@echo off
setlocal EnableExtensions
title OpenWA - WhatsApp API Gateway
color 0A

REM Start OpenWA separately from the Gohil CRM web app.
REM Keep this window OPEN while using OpenWA.

cd /d "%~dp0openwa"
if not exist "package.json" (
  echo [ERROR] OpenWA folder not found:
  echo   %~dp0openwa
  pause
  exit /b 1
)

REM Ensure Node/npm are found even if PATH is incomplete (double-click from Explorer)
if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
if exist "C:\Program Files (x86)\nodejs\node.exe" set "PATH=C:\Program Files (x86)\nodejs;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install Node.js 22+ from https://nodejs.org
  echo Then close this window and run start-openwa.bat again.
  pause
  exit /b 1
)

echo Node version:
node -v
echo.

if not exist "node_modules\" (
  echo Installing OpenWA dependencies first run - this can take several minutes...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

if not exist "dashboard\node_modules\" (
  echo Installing dashboard dependencies...
  pushd dashboard
  call npm.cmd install
  popd
  if errorlevel 1 (
    echo [ERROR] dashboard npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo ============================================
echo   OpenWA starting...
echo.
echo   Dashboard:  http://localhost:2886
echo   API:        http://localhost:2785/api
echo   Swagger:    http://localhost:2785/api/docs
echo.
echo   API key file:
echo   %~dp0openwa\data\.api-key
echo.
echo   IMPORTANT: Keep this window open.
echo   If you close it, OpenWA stops and the
echo   dashboard shows "Unable to connect".
echo ============================================
echo.

call npm.cmd run dev
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo [ERROR] OpenWA exited with code %ERR%
  echo Scroll up for the red error lines.
)
pause
exit /b %ERR%
