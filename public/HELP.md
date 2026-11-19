# OntoBench User Guide

OntoBench loads RDF/OWL ontologies and lets you explore their class hierarchy, imports, and diagrams, run SPARQL queries, and chat with an AI assistant about the loaded data.

Everything starts from the **File** menu.

## Load file...

Uploads a single RDF file. Accepted extensions: `.ttl`, `.rdf`, `.owl`, `.n3`, `.nt`.

Only that one file is sent to OntoBench, so imports can't be resolved against other files on your disk. Any `owl:imports` that point at web (http/https) URIs are still fetched live, the same way **Load from URL...** does it, as long as OntoBench has internet access. Imports that can't be found are listed in the Imports tab with their status.

Use this for a self-contained ontology, or for one whose imports are published on the web.

## Load directory...

Loads a whole folder of RDF files, resolving `owl:imports` between them.

**Required structure:** somewhere inside the folder you upload, there must be a subfolder named exactly **`core`** containing a file named exactly **`ontology.ttl`**. This is your entry point — OntoBench looks for `core/ontology.ttl` and starts loading from there.

```
my-upload/
├── core/
│   └── ontology.ttl     <- required entry point
├── modules/
│   ├── people.ttl
│   └── locations.ttl
└── vocab/
    └── terms.ttl
```

Once it finds the entry point, OntoBench scans every `.ttl`, `.owl`, `.rdf`, `.n3`, and `.nt` file anywhere in the uploaded folder and builds a map from each file's declared ontology URI (its `owl:Ontology` / `@base` URI) to its file path. When `core/ontology.ttl` (or anything it imports) declares `owl:imports <some-uri>`, OntoBench looks up `<some-uri>` in that map and loads the matching file — regardless of what the file is named.

**Why you can't just upload a pile of TTL files with no structure:** RDF has no inherent "main file." A folder of `.ttl` files is just a bag of triples until something designates a starting point. The `core/ontology.ttl` convention exists purely to give OntoBench a deterministic place to start; from there, `owl:imports` chains (matched by URI, not filename) pull in the rest of the files in your folder.

If your ontology isn't organized this way, either:
- Restructure so one file sits at `<folder>/core/ontology.ttl`, with everything else it imports elsewhere in the same tree, or
- Upload just the one file you care about via **Load file...** instead (local cross-file imports won't resolve; web imports still will).

**Known limitations:** files are matched by their `@base` / `owl:Ontology` URI only, not by `owl:versionIRI`. An import that names a versioned IRI misses the local map and falls back to fetching from the web. A file with neither `@base` nor an `owl:Ontology` declaration can't be reached via `owl:imports` at all.

## Load from URL...

Prompts for a URI and fetches an RDF ontology directly from the web, then follows its `owl:imports` recursively ("Follow Your Nose"). Each import URI is requested with RDF content negotiation. If a server answers with HTML instead of RDF, OntoBench tries to find the import relative to the URL the importing file actually came from. This is how a GitHub raw copy like `https://raw.githubusercontent.com/edmcouncil/cdmc/refs/heads/main/ontology/AboutCDMC.ttl` pulls in its sibling files.

Large suites can trigger hundreds of downloads; full FIBO takes several minutes.

## Loading more than one thing

Each load adds to whatever is already loaded; it doesn't replace it. Use **Clear** first if you want a fresh start.

## Clear

Clears the currently loaded dataset and resets the UI (class hierarchy, import hierarchy, diagrams, and query results all empty out). Use this before loading a new, unrelated ontology.
