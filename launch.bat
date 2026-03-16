@echo off
title Parametric Rolling Calculator
color 0B

echo.
echo  ============================================================
echo   PARAMETRIC ROLLING CALCULATOR  ^|  IMO MSC.1/Circ.1228
echo  ============================================================
echo.

cd /d "C:\PROJECTS\PARAMETRIC_ROLLING_CALCULATOR"

:: ── Step 0: Kill any stale node / Vite processes from previous sessions ──────
echo  [0/2] Clearing stale processes...
taskkill /F /IM node.exe /T >nul 2>&1
timeout /t 1 /nobreak >nul

:: ── Step 1: Start CMEMS proxy server (port 5174) in its own window ─────────
echo  [1/2] Starting CMEMS proxy server (port 5174)...
start "CMEMS Proxy Server" cmd /k "cd /d C:\PROJECTS\PARAMETRIC_ROLLING_CALCULATOR && node cmems-server.js"
timeout /t 2 /nobreak >nul

:: ── Step 2: Start Vite dev server in background — ONE instance only ─────────
echo  [2/2] Starting Vite dev server...
start /b npm run dev > "%TEMP%\prc_vite.log" 2>&1

:: Poll until Vite binds to a port (3000 → 3005)
echo  Waiting for Vite to start...
set VITE_PORT=0
:POLL
timeout /t 1 /nobreak >nul
for %%P in (3000 3001 3002 3003 3004 3005) do (
  powershell -NoProfile -Command "try{$null=Invoke-WebRequest 'http://localhost:%%P' -TimeoutSec 1 -UseBasicParsing -EA Stop;exit 0}catch{exit 1}" >nul 2>&1
  if not errorlevel 1 (
    set VITE_PORT=%%P
    goto OPEN
  )
)
goto POLL

:OPEN
:: Open browser ONCE on the correct port
echo  Server ready on port %VITE_PORT%!
start "" "http://localhost:%VITE_PORT%"

echo.
echo  ============================================================
echo   [RUNNING]
echo   App:          http://localhost:%VITE_PORT%
echo   CMEMS Server: http://localhost:5174  (separate window)
echo  ============================================================
echo.
echo  Press any key to stop both servers and exit.
echo.
pause >nul

:: Cleanup on exit
echo  Stopping servers...
taskkill /F /IM node.exe /T >nul 2>&1
echo  Done.
