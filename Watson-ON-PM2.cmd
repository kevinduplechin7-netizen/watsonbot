@echo off
setlocal
cd /d "%~dp0"

where pm2 >nul 2>nul
if %errorlevel% neq 0 (
  echo pm2 is not installed.
  echo Install once: npm install -g pm2
  echo.
  pause
  exit /b 1
)

echo Starting Watson with pm2...
call npm run start:pm2
echo.
echo Watson is now running in the background.
echo Use Watson-OFF-PM2.cmd to stop.
pause
