@echo off
setlocal
cd /d "%~dp0"

if not exist data mkdir data

echo Starting Watson in a minimized window...
start "Watson" /min cmd /c "npm start >> data\watson.log 2>&1"

echo Done.
echo Log: data\watson.log
pause
