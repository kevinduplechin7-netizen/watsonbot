@echo off
setlocal
cd /d "%~dp0"

echo Starting Watson...
echo.

REM Simple mode (runs in this window). Close window to stop.
npm start
