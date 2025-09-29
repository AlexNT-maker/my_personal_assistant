@echo off
setlocal ENABLEDELAYEDEXPANSION
cd /d "%~dp0"

REM --- pick python ---
set PYEXE=
if exist ".venv\Scripts\python.exe" set "PYEXE=.venv\Scripts\python.exe"
if "%PYEXE%"=="" (where py >nul 2>&1 && for /f "delims=" %%P in ('py -3 -c "import sys;print(sys.executable)"') do set "PYEXE=py -3")
if "%PYEXE%"=="" (where python >nul 2>&1 && set "PYEXE=python")
if "%PYEXE%"=="" (
  echo [ERROR] Python not found. Install Python 3.x or create .venv\Scripts\python.exe
  pause
  exit /b 1
)

echo Using Python: %PYEXE%
echo Starting server... (logs -> server.log)

REM --- start watcher to open PWA when server is up ---
start "" cmd /c ^
 "for /l %%i in (1,1,180) do (curl -s http://127.0.0.1:5000 >nul 2>&1 && (start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app-id=dpckklemgligkjpihmopkkknllapmclp & exit) || timeout /t 1 >nul)"

REM --- run server, keep console open, log output ---
%PYEXE% main.py 1>>server.log 2>&1

echo.
echo -------- server.log (tail) --------
type server.log
echo -----------------------------------
pause
