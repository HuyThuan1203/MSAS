@echo off
setlocal
cd /d "%~dp0"
set "HOST=127.0.0.1"
set "PORT=8081"
set "DATA_DIR=%~dp0data"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
set "PYCMD=C:\Program Files\Python310\python.exe"
if exist "%PYCMD%" goto run_python
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Open PowerShell and check: python --version
  pause
  exit /b 1
)
set "PYCMD=python"
:run_python
echo Market Structure Studio V5 - Python portable
 echo Project: %~dp0
 echo URL: http://127.0.0.1:8081
 echo Press Ctrl+C to stop.
"%PYCMD%" -u app\server.py
if errorlevel 1 (
  echo Server failed. The default port 8081 may be occupied.
  pause
)
