@echo off
REM ---------------------------------------------------------------------------
REM win-dev.cmd — full Windows development start: PostgreSQL + Next.js dev server
REM   scripts\win-dev.cmd
REM Then open http://localhost:3000
REM ---------------------------------------------------------------------------
setlocal
set "ROOT=%~dp0.."
call "%ROOT%\scripts\win-db-start.cmd"
if errorlevel 1 exit /b 1
cd /d "%ROOT%"
if not exist ".env" (
  echo [win-dev] .env not found — copying .env.example
  copy /y ".env.example" ".env" >nul
)
if not exist "node_modules" (
  echo [win-dev] Installing npm dependencies ...
  call npm ci --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
echo [win-dev] Pushing the Drizzle schema to PostgreSQL ...
call npx drizzle-kit push
echo [win-dev] Starting the Next.js dev server on http://localhost:3000 ...
call npm run dev
endlocal
