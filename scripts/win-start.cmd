@echo off
REM ---------------------------------------------------------------------------
REM win-start.cmd — production start: PostgreSQL + Next.js production server
REM   scripts\win-start.cmd
REM Then open http://localhost:3000
REM ---------------------------------------------------------------------------
setlocal
set "ROOT=%~dp0.."
call "%ROOT%\scripts\win-db-start.cmd"
if errorlevel 1 exit /b 1
cd /d "%ROOT%"
if not exist ".env" (
  echo [win-start] .env not found — copying .env.example
  copy /y ".env.example" ".env" >nul
)
if not exist "node_modules" (
  echo [win-start] Installing npm dependencies ...
  call npm ci --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
if not exist ".next\BUILD_ID" (
  echo [win-start] Building the production bundle ...
  call npm run build
  if errorlevel 1 exit /b 1
)
echo [win-start] Starting the production server on http://localhost:3000 ...
call npm run start
endlocal
