# OntoBench

A desktop application for viewing, exploring, and querying OWL/RDF ontologies. OntoBench loads ontology files, automatically resolves their imports, and provides interactive visualizations, SPARQL querying, and AI-assisted exploration.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Python](https://www.python.org/) (3.10+)
- [Rust](https://www.rust-lang.org/tools/install) (for Tauri)

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

```bash
npm run tauri dev
```

This starts everything: the Vite dev server, the Tauri desktop shell, and the Python backend. The Python backend is managed automatically by Tauri -- do not start it manually.

### Building

```bash
npm run tauri build
```

Produces a standalone desktop executable.

## Example Ontologies

The `examples/CDMC/` directory contains the EDM Council's Cloud Data Management Capabilities (CDMC) ontology suite -- 10 interconnected ontology files. To try it:

1. Launch OntoBench
2. Use **File > Open** and select `examples/CDMC/AboutCDMC.ttl`
3. OntoBench will automatically discover and load all 9 imported ontologies from the same directory

## Features

### Automatic Import Resolution

When you load an ontology that declares `owl:imports`, OntoBench automatically finds and loads the imported ontologies if they are in the same directory structure. It resolves relative paths, tries common file extensions (`.ttl`, `.rdf`, `.owl`), and tracks the status of each import (loaded, already loaded, not found, error). The Import Hierarchy tab shows the full import tree with status indicators.

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
