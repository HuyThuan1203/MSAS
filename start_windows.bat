@echo off
setlocal
cd /d "%~dp0"
where docker >nul 2>&1
if errorlevel 1 (
  echo Docker not found. Please install/start Docker Desktop first.
  pause
  exit /b 1
)
echo Building and starting Market Structure Studio...
docker compose up --build -d
if errorlevel 1 (
  echo Docker Compose failed. Run: docker compose logs market-structure
  pause
  exit /b 1
)
start "" "http://localhost:8080"
echo Opened http://localhost:8080
pause
