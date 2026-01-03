@echo off
setlocal

echo Stopping Watson (background window titled "Watson")...

rem Kills the minimized cmd window started by Start-Watson-Background.bat, which also stops the child node process.
taskkill /FI "WINDOWTITLE eq Watson" /T /F >nul 2>&1

if %ERRORLEVEL%==0 (
  echo Stopped.
) else (
  echo Could not find a window titled "Watson".
  echo If Watson is running in a normal console, close that window instead.
)

pause
