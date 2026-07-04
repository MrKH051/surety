@echo off
rem Reliable local run: always start from this folder.
cd /d "%~dp0"
echo Starting Surety on http://localhost:3100 ...
npm start
pause
