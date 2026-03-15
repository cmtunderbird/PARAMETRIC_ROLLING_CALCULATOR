@echo off
title Parametric Rolling Calculator
color 0B

echo.
echo  ============================================================
echo   PARAMETRIC ROLLING CALCULATOR  ^|  IMO MSC.1/Circ.1228
echo  ============================================================
echo.

cd /d "C:\PROJECTS\PARAMETRIC_ROLLING_CALCULATOR"

:: ── Step 1: Start CMEMS proxy server (port 5174) in its own window ─────────
echo  [1/2] Starting CMEMS proxy server (port 5174)...
start "CMEMS Proxy Server" cmd /k "cd /d C:\PROJECTS\PARAMETRIC_ROLLING_CALCULATOR && node cmems-server.js"

:: Give the CMEMS server 2 seconds to bind
timeout /t 2 /nobreak >nul

:: ── Step 2: Start Vite dev server in background ────────────────────────────
echo  [2/2] Starting Vite dev server...
start /b npm run dev > "%TEMP%\prc_vite.log" 2>&1

:: Poll until Vite is ready (tries port 3000 first, then 3001, 3002...)
echo  Waiting for Vite to start...
:WAIT_LOOP
timeout /t 1 /nobreak >nul
for %%P in (3000 3001 3002 3003 3004 3005) do (
  powershell -NoProfile -Command "try{Invoke-WebRequest 'http://localhost:%%P' -TimeoutSec 1 -UseBasicParsing -EA Stop|Out-Null; exit 0}catch{exit 1}" >nul 2>&1
  if not errorlevel 1 (
    set VITE_PORT=%%P
    goto READY
  )
)
goto WAIT_LOOP

:READY
:: Open browser
echo  Server ready! Opening browser...
start "" "http://localhost:%VITE_PORT%"

echo.
echo  ============================================================
echo   [RUNNING]
echo   Vite:         http://localhost:%VITE_PORT%
echo   CMEMS Server: http://localhost:5174  (separate window)
echo  ============================================================
echo.
echo  Close this window OR the CMEMS Proxy window to stop.
echo.
pause >nul
