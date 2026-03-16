@echo off
title Parametric Rolling Calculator
color 0B

echo.
echo  ============================================================
echo   PARAMETRIC ROLLING CALCULATOR  ^|  IMO MSC.1/Circ.1228
echo   Desktop Edition  ^|  powered by Electron
echo  ============================================================
echo.

cd /d "C:\PROJECTS\PARAMETRIC_ROLLING_CALCULATOR"

:: Build React app if dist is missing or stale
if not exist "dist\index.html" (
  echo  Building application...
  call npm run build
  if errorlevel 1 ( echo  Build failed! & pause & exit /b 1 )
)

:: Launch Electron — it starts the CMEMS server and loads dist/index.html internally
echo  Launching application...
echo  (CMEMS proxy server will start automatically inside the app)
echo.

:: Track Electron PID for clean exit
for /f "tokens=2" %%P in ('start /b "" npx electron . ^& echo PID=%%ERRORLEVEL%%') do set ELECTRON_PID=%%P
npx electron .

echo.
echo  Application closed.
pause >nul
