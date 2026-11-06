@echo off
rem Starts the LearnHarness production server, reachable from this PC only.
rem Pulls learning data from the other computer first. A failed pull must not block the server.
set "REPO=%~dp0..\.."
cd /d "%REPO%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-data.ps1" -PullOnly
call npm.cmd start -- -H 127.0.0.1 > "%LOCALAPPDATA%\LearnHarnessAutostart\server.log" 2>&1
