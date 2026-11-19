# AGENTS.md

This file provides guidance to coding agents (e.g. Codex) working with code in this repository. `CLAUDE.md` carries the same content for Claude Code — keep the two in sync.

## Project Architecture

OntoBench is a web application for viewing, exploring, and querying OWL/RDF ontologies:
- **Frontend**: Vanilla JavaScript/HTML (`index.html`, `main.js`, `js/`) built with Vite. Talks to the backend with plain `fetch` calls (`js/api.js`), using relative URLs.
- **Backend**: Python FastAPI server (`python-backend/server.py`) over rdflib (`python-backend/main.py`). Serves the API and, when `dist/` exists, the built frontend.
- **Deployment**: `Dockerfile` builds the frontend and runs the backend on port 8000 (honours the `PORT` env var, e.g. on Railway).

`src-tauri/` holds the original Tauri desktop shell. It is legacy: the frontend no longer calls any Tauri API, and the shell starts the backend on a random port the frontend never looks for. Don't treat `npm run tauri dev` as the way to run the app.

## Key Development Commands

### Setup
```bash
npm install
python -m venv python-backend/venv
source python-backend/venv/bin/activate        # Windows: python-backend\venv\Scripts\activate  (or .\setup-python.bat)
pip install -r python-backend/requirements.txt
```

### Run (single server)
```bash
npm run build                        # builds the frontend into dist/
python python-backend/server.py      # serves API + dist/ at http://localhost:8000 (optional port arg)
```

### Run (frontend hot reload)
```bash
python python-backend/server.py      # backend on :8000
npm run dev                          # Vite on :1420, proxies API paths to :8000 (see vite.config.js)
```
Any new backend endpoint must also be added to the proxy list in `vite.config.js`, or it will 404 in dev mode.

### Docker
```bash
docker build -t ontobench .
docker run -p 8000:8000 ontobench
```

Run only one backend instance at a time — all state lives in that process (see below).

## CRITICAL ARCHITECTURE RULE - RDF Data Storage

**SINGLE SOURCE OF TRUTH**: All RDF triple data is stored ONLY in `main.current_dataset` global variable in `python-backend/main.py`.

**ZERO EXCEPTIONS**:
- NO triples are ever cached anywhere else in the system
- ALL data access MUST go through `server.py` endpoints that reference `main.current_dataset`
- To check if dataset is loaded, MUST call a function from `main.py` or use existing API endpoints
- NEVER directly access `main.current_dataset` from `server.py` - always call functions from `main.py`

**Data Flow**: Frontend → server.py endpoints → main.py functions → main.current_dataset

This architecture ensures data consistency and single source of truth for all RDF operations.

## Loading and Import Resolution

Three load paths, all ending in `load_imports_recursive()` in `main.py`:
- `/upload_rdf` — single file from the browser, written to a temp file.
- `/upload_directory` — whole folder; entry point must be `core/ontology.ttl`; every RDF file is indexed into a URI map (`build_ontology_uri_map`) keyed by `@base`, else the `owl:Ontology` subject.
- `/load_rdf` — given an http(s) URI, delegates to `load_rdf_uri()` (Follow Your Nose).

Resolution order for each `owl:imports`: (0) URI map, (1) file relative to the importing file, (2) FYN over HTTP, (3) URL heuristic relative to where the importer was actually fetched from. Loads add to the existing dataset; `/clear_dataset` resets it. Known gaps are tracked in `wish.md`.

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
- `index.html`, `main.js` - Frontend entry point and menu/load logic
- `js/` - Frontend modules (API helpers, Cytoscape diagrams, ring layout, tree view, SPARQL, AI chat)
- `public/` - Static assets copied into the build, including `HELP.md` (the in-app user guide)
- `python-backend/server.py` - FastAPI endpoints; `main.py` - RDF loading/query logic; `hierarchy.py`; `ai_*.py` - AI providers/config
- `examples/` - CDMC and FIBO 2025Q4 ontology suites
- `wish.md` - Known gaps not yet fixed
- `dist/` - Built frontend (generated)
- `src-tauri/` - Legacy Tauri desktop shell (unused by the current frontend)
