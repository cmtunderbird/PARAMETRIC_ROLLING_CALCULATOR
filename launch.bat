@echo off
title Parametric Rolling Calculator
color 0B
cd /d "C:\PROJECTS\PARAMETRIC_ROLLING_CALCULATOR"

echo.
echo  ============================================================
echo   PARAMETRIC ROLLING CALCULATOR  ^|  IMO MSC.1/Circ.1228
echo   Desktop Edition  ^|  Electron
echo  ============================================================
echo.

:: ── Find node.exe and export it so Electron's main process can find it ────
:: When launched from a desktop shortcut the child-process PATH may miss nodejs.
:: We locate it here (in the shell that DOES have the full PATH) and pass it in.
for /f "delims=" %%N in ('where node 2^>nul') do (
  set "NODE_EXE=%%N"
  goto :found_node
)
echo  [WARN] node not found via where — trying default install path...
if exist "C:\Program Files\nodejs\node.exe" (
  set "NODE_EXE=C:\Program Files\nodejs\node.exe"
  goto :found_node
)
echo  [ERROR] Node.js not found. Please install Node.js from https://nodejs.org/
pause
exit /b 1
:found_node
echo  [OK] Node.js: %NODE_EXE%

:: ── Always rebuild dist so stale bundles never cause issues ───────────────
echo  [BUILD] Building application bundle...
call npm run build
if errorlevel 1 (
  echo  [ERROR] Build failed.
  pause & exit /b 1
)
echo  [BUILD] Done.
echo.

:: ── Launch Electron (NODE_EXE is in env, Electron reads it in main.js) ────
echo  [START] Launching Parametric Rolling Calculator...
echo  CMEMS proxy server will start automatically.
echo.
npx electron .

echo.
echo  Application closed.
