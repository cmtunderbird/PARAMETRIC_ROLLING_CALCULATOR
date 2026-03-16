@echo off
title Parametric Rolling Calculator
color 0B

echo.
echo  ============================================================
echo   PARAMETRIC ROLLING CALCULATOR  ^|  IMO MSC.1/Circ.1228
echo  ============================================================
echo.

cd /d "C:\PROJECTS\PARAMETRIC_ROLLING_CALCULATOR"

:: ── Step 1: Start CMEMS proxy server (port 5174) in its own window ───────────
echo  [1/2] Starting CMEMS proxy server (port 5174)...
start "CMEMS Proxy Server" cmd /k "cd /d C:\PROJECTS\PARAMETRIC_ROLLING_CALCULATOR && node cmems-server.js"
timeout /t 2 /nobreak >nul

:: Capture the PID of the CMEMS node process
for /f "tokens=2" %%P in ('tasklist /fi "imagename eq node.exe" /fi "windowtitle eq CMEMS Proxy Server*" /fo csv /nh 2^>nul') do (
    set CMEMS_PID=%%~P
)


:: ── Step 2: Start Vite dev server — capture its PID ─────────────────────────
echo  [2/2] Starting Vite dev server...
start /b npm run dev > "%TEMP%\prc_vite.log" 2>&1

:: Give Vite a moment to spawn, then capture its node PID
timeout /t 3 /nobreak >nul
for /f "tokens=1" %%P in ('tasklist /fi "imagename eq node.exe" /fo csv /nh 2^>nul ^| findstr /v "%CMEMS_PID%"') do (
    set VITE_PID=%%~P
    goto :got_vite_pid
)
:got_vite_pid

:: Poll until Vite binds to a port (3000 → 3005)
echo  Waiting for Vite to start...
set VITE_PORT=0
:POLL
timeout /t 1 /nobreak >nul
for %%P in (3000 3001 3002 3003 3004 3005) do (
  powershell -NoProfile -Command "try{$null=Invoke-WebRequest 'http://localhost:%%P' -TimeoutSec 1 -UseBasicParsing -EA Stop;exit 0}catch{exit 1}" >nul 2>&1
  if not errorlevel 1 (
    set VITE_PORT=%%P
    goto :OPEN
  )
)
goto :POLL

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
echo  Press any key to stop only THIS app's servers and exit.
echo.
pause >nul

:: ── Cleanup: kill ONLY the PIDs we started ───────────────────────────────────
echo  Stopping servers (PID %CMEMS_PID% and %VITE_PID%)...
if defined CMEMS_PID (taskkill /F /PID %CMEMS_PID% >nul 2>&1)
if defined VITE_PID  (taskkill /F /PID %VITE_PID%  >nul 2>&1)
:: Also kill any child processes of Vite (esbuild, etc.)
for /f "tokens=1" %%P in ('tasklist /fi "imagename eq node.exe" /fo csv /nh 2^>nul') do (
    wmic process where "ParentProcessId=%%~P AND Name='node.exe'" delete >nul 2>&1
)
echo  Done. Other Node processes on your machine were not affected.
