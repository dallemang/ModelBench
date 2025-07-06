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

**IMPORTANT**: NEVER manually start the Python backend! Tauri automatically manages it.

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

## CRITICAL ARCHITECTURE RULE - RDF Data Storage

**SINGLE SOURCE OF TRUTH**: All RDF triple data is stored ONLY in `main.current_dataset` global variable in `python-backend/main.py`. 

**ZERO EXCEPTIONS**: 
- NO triples are ever cached anywhere else in the system
- ALL data access MUST go through `server.py` endpoints that reference `main.current_dataset`
- To check if dataset is loaded, MUST call a function from `main.py` or use existing API endpoints
- NEVER directly access `main.current_dataset` from `server.py` - always call functions from `main.py`

**Data Flow**: Frontend → server.py endpoints → main.py functions → main.current_dataset

This architecture ensures data consistency and single source of truth for all RDF operations.

## Python Backend Management

**CRITICAL**: The Python backend is automatically managed by Tauri. DO NOT start it manually!

**How it works**:
- Tauri auto-starts Python backend on a random available port when needed
- Tauri manages the process lifecycle (starts, restarts if crashed, stops on exit)
- All operations (file loading, AI, queries) use the same auto-managed backend instance
- Frontend automatically detects the current backend port for AI operations

**What NOT to do**:
- ❌ `python server.py 8731` (manual start)
- ❌ Running multiple Python backends simultaneously

**What TO do**:
- ✅ `npm run tauri dev` (starts everything including auto-managed Python backend)
- ✅ Load files through UI (data goes to auto-managed backend)
- ✅ Use AI features (connects to same backend with loaded data)

## Planned AI Features

### AI-Assisted Relationship Naming
**Goal**: When users create connections between classes in the ontology editor, AI suggests meaningful relationship names and allows discussion about naming.

**Workflow**:
1. User connects Class A → Class B in editor
2. System calls AI with context: source class, target class, current ontology
3. AI suggests relationship name(s) based on semantic meaning
4. User can accept suggestion or discuss alternatives with AI
5. Final relationship name is applied to the connection

**Implementation notes**: 
- Will integrate with existing ontology editing workflow (separate from current AI chat tab)
- Should use same AI infrastructure (providers, context building) but different UI integration point
- AI context should include both classes' definitions, properties, and relationships for informed suggestions

## File Structure
- `main.js` - Frontend logic and Tauri API integration
- `src-tauri/` - Rust application code and Tauri configuration
- `python-backend/` - Python scripts for backend processing
- `dist/` - Built frontend assets (generated)
- `src-tauri/target/` - Rust build artifacts (generated)