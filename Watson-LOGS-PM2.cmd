@echo off
setlocal
cd /d "%~dp0"

where pm2 >nul 2>nul
if %errorlevel% neq 0 (
  echo pm2 is not installed.
  echo.
  pause
  exit /b 1
)

call npm run logs:pm2
