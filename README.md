# OntoBench

A web application for viewing, exploring, and querying OWL/RDF ontologies. OntoBench loads ontology files, automatically resolves their imports, and provides interactive visualizations, SPARQL querying, and AI-assisted exploration.

## Getting Started

### Prerequisites

- [Python](https://www.python.org/) (3.10+)
- [Node.js](https://nodejs.org/) (v18+), to build the frontend
- [Docker](https://www.docker.com/), optional

### Setup

1. **Install Node dependencies:**
   ```bash
   npm install
   ```

2. **Set up the Python backend:**

   **Windows:**
   ```powershell
   .\setup-python.bat
   ```

   **Linux/Mac:**
   ```bash
   python -m venv python-backend/venv
   source python-backend/venv/bin/activate
   pip install -r python-backend/requirements.txt
   ```

### Running

**Single server:** build the frontend, then let the backend serve it:

```bash
npm run build
python python-backend/server.py
```

Open http://localhost:8000. Pass a different port as an argument or set `PORT`.

**Frontend development with hot reload:** run the backend and the Vite dev server side by side:

```bash
python python-backend/server.py   # backend on :8000
npm run dev                       # http://localhost:1420, proxies API calls to :8000
```

**Docker:**

```bash
docker build -t ontobench .
docker run -p 8000:8000 ontobench
```

> `src-tauri/` contains the original Tauri desktop shell. The current frontend no longer uses it, so `npm run tauri dev` is not a supported way to run OntoBench.

## Loading Ontologies

The **File** menu has three ways in. See **Help > User Guide** in the app for details.

- **Load file...** uploads one file. Imports that point at web URIs are fetched live; imports of other local files are not, because only the one file is uploaded.
- **Load directory...** uploads a folder and resolves `owl:imports` between its files by ontology URI. The folder must contain `core/ontology.ttl` as the entry point.
- **Load from URL...** fetches an ontology from the web and recursively follows all its `owl:imports` ("Follow Your Nose").

Loads accumulate; use **File > Clear** to start over.

## Example Ontologies

The `examples/CDMC/` directory contains the EDM Council's Cloud Data Management Capabilities (CDMC) ontology suite, 10 interconnected ontology files. `examples/FIBO_2025Q4/` contains the Financial Industry Business Ontology (FIBO) Production release, 220 interconnected files covering business entities, financial instruments, derivatives, indices, and more.

Neither example folder has a `core/ontology.ttl` yet, so **Load directory...** won't accept them as-is. To load a whole local suite offline, add a `core/ontology.ttl` inside the folder that `owl:imports` the suite's top ontology (e.g. the URI declared in `AboutCDMC.ttl` or `AboutFIBOProd.ttl`).

The easiest way to try them is to load them live:

- **CDMC:** **Load from URL...** with
  `https://raw.githubusercontent.com/edmcouncil/cdmc/refs/heads/main/ontology/AboutCDMC.ttl`.
  CDMC's own URIs return HTML rather than RDF, so OntoBench resolves each import relative to the GitHub raw URL instead.
- **FIBO subset (recommended to start):** `https://spec.edmcouncil.org/fibo/ontology/BE/SoleProprietorships/SoleProprietorships/`
- **FIBO full production release:** `https://spec.edmcouncil.org/fibo/ontology/AboutFIBOProd/`

**Load file...** on a single FIBO file such as `examples/FIBO_2025Q4/BE/SoleProprietorships/SoleProprietorships.ttl` also works when you're online. FIBO serves RDF by content negotiation, so its imports are fetched from spec.edmcouncil.org rather than from the local copies.

**Warning:** FIBO is vastly larger and more complex than CDMC. Loading all of it triggers hundreds of HTTP downloads and may take several minutes. The resulting diagram is dense; the ring layout works best with smaller suites, and SPARQL queries and the tree view are more practical ways to explore FIBO.

## Features

### Automatic Import Resolution

When you load an ontology that declares `owl:imports`, OntoBench finds and loads each import in this order: a matching file from an uploaded directory (by ontology URI), a file relative to the importing file, a live HTTP fetch of the import URI, and finally a URL relative to where the importing file was fetched from. Each import's status (loaded, fetched, already loaded, not found, fetch failed, error) and how it was resolved appear in the Import Hierarchy tab. Known gaps are listed in `wish.md`.

### Ring-Based Ontology Visualization

The default "Rings by Ontology" layout places each imported ontology in its own ring. Roots are arranged around each ring, with subclass trees radiating outward in concentric arcs. The layout algorithm:

- Uses force-directed simulation to determine which ontologies are neighbors
- Places the most-connected ontology at the center
- Gives constrained roots (those with cross-ontology connections) priority placement on the ring, pointing toward the ontology they connect to
- Minimizes edge crossings when placing unconstrained roots
- Adds extra spacing between rings that have many cross-ontology edges

Two additional layouts are available: **Single Ring** (all classes on one ring) and **Top-Down** (breadthfirst hierarchy).

### Color-Coded Ontology Distinction

Each imported ontology gets a distinct color (using golden-angle hue spacing for maximum visual separation). Root classes use a stronger shade; descendants use a lighter shade. A legend in the upper-left of the diagram shows which color corresponds to which ontology.

### Dark Mode

Toggle dark mode from the diagram toolbar for a dark background with white lines and edge labels, while keeping node colors vivid.

### SPARQL Query Interface

Run SPARQL queries (SELECT, ASK, CONSTRUCT, DESCRIBE) against the loaded ontology data. Results display as interactive tables (SELECT) or Turtle serialization (CONSTRUCT/DESCRIBE).

Namespace prefixes from all loaded ontologies are available automatically -- no need to redeclare them in every query.

If a query fails, the **Fix Query** button sends the query and error to the AI assistant for automatic correction.

### AI Assistant

An integrated chat interface that is informed by the currently loaded ontology. Supports three providers:

- **Ollama** -- local/offline models, no API key needed
- **OpenAI** -- requires API key
- **Claude (Anthropic)** -- requires API key, supports tool use for executing SPARQL queries as part of the conversation

The AI can answer questions about the ontology's structure, suggest SPARQL queries, and execute them directly via tool use (Claude provider).

### Class Search and Navigation

Search for classes by label or URI from the toolbar. Results link to the class in the tree view, which shows annotations, properties, and the class's position in the hierarchy.

### Annotations and Properties

Select any class to see all its RDF annotations and properties, including labels, definitions, domains, ranges, datatypes, and language tags. Structural properties (rdf:type, rdfs:subClassOf) are filtered out to focus on descriptive metadata.

### Adaptive Font Sizing

Class node labels in the diagram automatically scale to fill their box -- short names like "Agent" get large fonts, while longer names like "Data Quality Dimension Category" scale down to fit.
