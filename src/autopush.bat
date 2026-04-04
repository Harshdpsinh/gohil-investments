@echo off
:: ─────────────────────────────────────────────
::  Gohil Investments — Auto Push to Vercel
::  Just double-click this file anytime.
:: ─────────────────────────────────────────────

:: SET YOUR PROJECT FOLDER PATH HERE
set PROJECT=C:\Users\123\Desktop\GOHIL INSURANCE\WEB APP\gohil-investments
cd /d "%PROJECT%"

echo.
echo Checking for changes...
echo.

:: Check if there is anything to commit
git status --porcelain > "%TEMP%\gitstatus.txt"
for %%A in ("%TEMP%\gitstatus.txt") do set SIZE=%%~zA
if %SIZE%==0 (
  echo.
  echo  No changes detected. Nothing to push.
  echo  Make your edits and run this file again.
  echo.
  pause
  exit /b
)

:: Show what changed
echo  Changes found:
git status --short
echo.

:: Stage everything
git add -A

:: Auto commit message with date and time
for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set D=%%c-%%b-%%a
for /f "tokens=1-2 delims=: " %%a in ("%time%") do set T=%%a:%%b
set MSG=auto: update %D% %T%

git commit -m "%MSG%"

:: Push
echo.
echo  Pushing to GitHub...
git push origin main

echo.
echo ─────────────────────────────────────────────
echo  Done! Vercel is deploying now.
echo  Check: https://vercel.com/dashboard
echo ─────────────────────────────────────────────
echo.
pause
