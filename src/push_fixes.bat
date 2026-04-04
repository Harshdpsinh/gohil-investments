@echo off
echo ========================================
echo   Gohil Investments — Push Fixed Files
echo ========================================
echo.

REM ── STEP 1: Copy fixed files into your project ──────────────
REM Change this path to wherever your project folder is
set PROJECT=C:\Users\Harshdip\gohil-investments

copy /Y "%~dp0PoliciesPage.jsx"  "%PROJECT%\src\pages\PoliciesPage.jsx"
copy /Y "%~dp0ClientsPage.jsx"   "%PROJECT%\src\pages\ClientsPage.jsx"
copy /Y "%~dp0RenewalsPage.jsx"  "%PROJECT%\src\pages\RenewalsPage.jsx"
copy /Y "%~dp0ClaimsPage.jsx"    "%PROJECT%\src\pages\ClaimsPage.jsx"
copy /Y "%~dp0TasksPage.jsx"     "%PROJECT%\src\pages\TasksPage.jsx"
copy /Y "%~dp0useAuth.jsx"       "%PROJECT%\src\hooks\useAuth.jsx"

echo Files copied successfully.
echo.

REM ── STEP 2: Git add, commit, push ───────────────────────────
cd /d "%PROJECT%"

git add src/pages/PoliciesPage.jsx
git add src/pages/ClientsPage.jsx
git add src/pages/RenewalsPage.jsx
git add src/pages/ClaimsPage.jsx
git add src/pages/TasksPage.jsx
git add src/hooks/useAuth.jsx

git commit -m "fix: renewal atomicity rollback, undefined Firestore fields, insurer switch modal, blank page import, error handling"

git push origin main

echo.
echo ========================================
echo   Done! Vercel will auto-deploy now.
echo   Watch: https://vercel.com/dashboard
echo ========================================
pause
