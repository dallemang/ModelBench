@echo off
echo Setting up Python virtual environment for OntoBench...

REM Create virtual environment
python -m venv python-backend\venv

REM Activate virtual environment and install dependencies
call python-backend\venv\Scripts\activate.bat
pip install --upgrade pip
pip install -r python-backend\requirements.txt

echo Python virtual environment setup complete!
echo To activate manually: python-backend\venv\Scripts\activate.bat