@echo off
title Parametric Rolling Calculator
color 0B

echo.
echo  ============================================================
echo   PARAMETRIC ROLLING CALCULATOR  ^|  IMO MSC.1/Circ.1228
echo   Desktop Edition  ^|  Electron
echo  ============================================================
echo.

cd /d "C:\PROJECTS\PARAMETRIC_ROLLING_CALCULATOR"

:: Build React app if dist is missing
if not exist "dist\index.html" (
  echo  [BUILD] First run - building application...
  call npm run build
  if errorlevel 1 (
    echo  [ERROR] Build failed. Check npm output above.
    pause & exit /b 1
  )
  echo  [BUILD] Done.
  echo.
)

:: Launch Electron — it starts cmems-server.js internally
echo  [START] Launching Parametric Rolling Calculator...
echo  CMEMS proxy server will start automatically.
echo.
npx electron .

:: After Electron exits
echo.
echo  Application closed.
