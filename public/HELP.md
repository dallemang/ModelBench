# OntoBench User Guide

OntoBench loads RDF/OWL ontologies and lets you explore their class hierarchy, imports, and diagrams, run SPARQL queries, and chat with an AI assistant about the loaded data.

Everything starts from the **File** menu.

## Load file...

Loads a single RDF file. Accepted extensions: `.ttl`, `.rdf`, `.owl`, `.n3`, `.nt`.

Use this for a self-contained ontology that doesn't `owl:import` other files, or when you only care about one file in isolation. Any `owl:imports` statements in the file will be listed, but the imported ontologies themselves won't be loaded — there's nothing else on disk for OntoBench to find them in.

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
- Upload just the one file you care about via **Load file...** instead (cross-file imports won't resolve).

## Load from URL...

Prompts for a URI and fetches an RDF ontology directly from the web. Use this for ontologies published at a stable URL (e.g. a published vocabulary). Only the single fetched document is loaded — the same import limitation as **Load file...** applies.

## Clear

Clears the currently loaded dataset and resets the UI (class hierarchy, import hierarchy, diagrams, and query results all empty out). Use this before loading a new, unrelated ontology.
