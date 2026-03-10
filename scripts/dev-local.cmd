@echo off
setlocal

set FRONTEND_PORT=5173
set BACKEND_PORT=8000

echo Starting backend on http://localhost:%BACKEND_PORT% ...
start "NorthStar Backend" powershell -NoExit -Command "cd /d %~dp0..\backend; uvicorn main:app --reload --port %BACKEND_PORT%"

echo Starting frontend on http://localhost:%FRONTEND_PORT% ...
start "NorthStar Frontend" powershell -NoExit -Command "cd /d %~dp0..\frontend; python -m http.server %FRONTEND_PORT%"

timeout /t 1 >nul
start http://localhost:%FRONTEND_PORT%

endlocal
