@echo off
REM ---------------------------------------------------------------------------
REM win-db-start.cmd — start the portable PostgreSQL 16 server for the ALM twin
REM
REM Expects the EnterpriseDB portable binaries layout:
REM   <PG_HOME>\bin\pg_ctl.exe ...
REM Override the default locations with environment variables:
REM   set PG_HOME=C:\path\to\pgsql
REM   set PGDATA=C:\path\to\pgdata
REM Default credentials match .env / docker-compose.yml: postgres / postgres.
REM ---------------------------------------------------------------------------
setlocal
set "PG_HOME=%~dp0..\..\..\tools\pg16-extract\pgsql"
set "PGDATA=%~dp0..\..\..\tools\pgdata"
if defined PG_HOME_ENV set "PG_HOME=%PG_HOME_ENV%"
if defined PGDATA_ENV set "PGDATA=%PGDATA_ENV%"

if not exist "%PG_HOME%\bin\pg_ctl.exe" (
  echo [win-db-start] pg_ctl.exe not found under "%PG_HOME%".
  echo [win-db-start] Download the portable zip from
  echo [win-db-start]   https://get.enterprisedb.com/postgresql/postgresql-16.9-1-windows-x64-binaries.zip
  echo [win-db-start] extract it, then re-run with PG_HOME_ENV and PGDATA_ENV set.
  exit /b 1
)

if not exist "%PGDATA%\PG_VERSION" (
  echo [win-db-start] Initialising a fresh data directory at "%PGDATA%" ...
  echo postgres> "%TEMP%\pg_pwfile.txt"
  "%PG_HOME%\bin\initdb.exe" -D "%PGDATA%" -U postgres --pwfile="%TEMP%\pg_pwfile.txt" -E UTF8 -A scram-sha-256 --locale=C
  del "%TEMP%\pg_pwfile.txt"
  if errorlevel 1 exit /b 1
)

"%PG_HOME%\bin\pg_ctl.exe" -D "%PGDATA%" -l "%PGDATA%\pg.log" -o "-p 5432" start
if errorlevel 1 (
  echo [win-db-start] pg_ctl reported a failure; the server may already be running.
  "%PG_HOME%\bin\pg_isready.exe" -h 127.0.0.1 -p 5432
)
"%PG_HOME%\bin\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -c "CREATE DATABASE app_db;" 2>nul
endlocal
