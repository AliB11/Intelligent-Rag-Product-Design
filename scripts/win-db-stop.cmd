@echo off
REM ---------------------------------------------------------------------------
REM win-db-stop.cmd — stop the portable PostgreSQL 16 server of the ALM twin
REM ---------------------------------------------------------------------------
setlocal
set "PG_HOME=%~dp0..\..\..\tools\pg16-extract\pgsql"
set "PGDATA=%~dp0..\..\..\tools\pgdata"
if defined PG_HOME_ENV set "PG_HOME=%PG_HOME_ENV%"
if defined PGDATA_ENV set "PGDATA=%PGDATA_ENV%"

if not exist "%PG_HOME%\bin\pg_ctl.exe" (
  echo [win-db-stop] pg_ctl.exe not found under "%PG_HOME%".
  exit /b 1
)
"%PG_HOME%\bin\pg_ctl.exe" -D "%PGDATA%" -l "%PGDATA%\pg.log" stop
endlocal
