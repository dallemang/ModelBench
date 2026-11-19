@echo off
REM Starts the OntoBench server at http://localhost:8000 (close this window to stop it)
cd /d "%~dp0"
title OntoBench server
"python-backend\venv\Scripts\python.exe" python-backend\server.py %*
pause
