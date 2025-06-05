# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Architecture

This is a Tauri desktop application (product name: "OntoBench") with three main components:
- **Frontend**: Vanilla JavaScript/HTML with Vite build system
- **Rust Backend**: Tauri framework handling native desktop functionality
- **Python Backend**: Standalone scripts for file processing

The app creates a simple desktop application with a file dialog interface. Users can load files through the File menu, which displays the selected file path in the UI.

## Key Development Commands

### Development
```bash
npm run tauri dev          # Start development server with hot reload
npm run dev               # Start Vite dev server only (port 1420)
```

### Building
```bash
npm run tauri build       # Build production executable
npm run build             # Build frontend only
```

### Setup
```bash
npm install                           # Install Node.js dependencies
```

#### Python Virtual Environment Setup (Windows)
```powershell
# Run the setup script to create venv and install dependencies
.\setup-python.bat

# Or manually:
python -m venv python-backend\venv
python-backend\venv\Scripts\activate
pip install -r python-backend\requirements.txt
```

#### Python Virtual Environment Setup (Linux/Mac)
```bash
python -m venv python-backend/venv
source python-backend/venv/bin/activate
pip install -r python-backend/requirements.txt
```

## Architecture Details

### Frontend (Vite + Vanilla JS)
- Entry point: `index.html` with `main.js`
- Uses Tauri API for native file dialogs (`@tauri-apps/plugin-dialog`)
- Vite dev server runs on port 1420 (configured in `vite.config.js`)

### Rust Backend (Tauri)
- Main application in `src-tauri/src/lib.rs` with basic Tauri setup
- Logging enabled in debug mode only
- Window title: "OntoBench", default size 800x600

### Python Backend
- `python-backend/main.py` provides file processing utilities
- Can be called with command line arguments for file operations
- Currently has minimal dependencies (requirements.txt mostly empty)

## File Structure
- `main.js` - Frontend logic and Tauri API integration
- `src-tauri/` - Rust application code and Tauri configuration
- `python-backend/` - Python scripts for backend processing
- `dist/` - Built frontend assets (generated)
- `src-tauri/target/` - Rust build artifacts (generated)