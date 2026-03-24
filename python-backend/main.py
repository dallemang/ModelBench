#!/usr/bin/env python3
"""
RDF Backend for OntoBench - loads and manages RDF graphs using rdflib
"""

import sys
import json
import os
import re
import uuid
from rdflib import Graph, Dataset, URIRef, Literal, BNode
from rdflib.namespace import RDF, RDFS, OWL

# Import hierarchy building functions
from hierarchy import (
    build_class_hierarchy_from_dataset,
    build_import_hierarchy_from_dataset,
    get_label
)

# Global dataset storage
current_dataset = None
current_file_path = None
current_base_uri = None

# Global namespace registry (prefix -> namespace_uri)
global_namespaces = {}
namespace_conflicts = []  # List of conflict messages

def register_namespaces_from_graph(graph, source_description=""):
    """Register namespaces from a graph, detecting conflicts"""
    global global_namespaces, namespace_conflicts
    
    for prefix, namespace in graph.namespaces():
        prefix_str = str(prefix)
        namespace_str = str(namespace)
        
        if prefix_str in global_namespaces:
            if global_namespaces[prefix_str] != namespace_str:
                # Conflict detected!
                conflict_msg = f"Namespace conflict: prefix '{prefix_str}' maps to both '{global_namespaces[prefix_str]}' and '{namespace_str}' {source_description}"
                namespace_conflicts.append(conflict_msg)
                print(f"WARNING: {conflict_msg}", file=sys.stderr)
                # Keep the first definition
            # else: same prefix->namespace mapping, no problem
        else:
            # New prefix, register it
            global_namespaces[prefix_str] = namespace_str

def clear_namespace_registry():
    """Clear the global namespace registry (for new file loads)"""
    global global_namespaces, namespace_conflicts
    global_namespaces = {}
    namespace_conflicts = []

def get_global_namespaces():
    """Get the current global namespace registry"""
    return global_namespaces, namespace_conflicts

def clear_dataset():
    """Clear the current dataset and start fresh"""
    global current_dataset, current_file_path, current_base_uri
    current_dataset = None
    current_file_path = None
    current_base_uri = None
    clear_namespace_registry()
    print("DEBUG: Dataset cleared", file=sys.stderr)

def build_ontology_context_for_ai():
    """Build ontology context from the loaded dataset for AI"""
    global current_dataset, current_file_path, current_base_uri, global_namespaces
    
    if current_dataset is None:
        return None
    
    try:
        print("DEBUG: Starting ontology context build in main.py", file=sys.stderr)
        print(f"DEBUG: current_dataset = {current_dataset}", file=sys.stderr)
        # Serialize the entire dataset to TTL format by merging all graphs
        merged_graph = Graph()
        
        print("DEBUG: Merging graphs", file=sys.stderr)
        # Add all triples from all graphs in the dataset to the merged graph
        graph_count = 0
        triple_count = 0
        for graph in current_dataset.graphs():
            graph_count += 1
            for triple in graph:
                triple_count += 1
                merged_graph.add(triple)
                # Add progress logging for large datasets
                if triple_count % 10000 == 0:
                    print(f"DEBUG: Processed {triple_count} triples from {graph_count} graphs", file=sys.stderr)
        
        print(f"DEBUG: Merged {triple_count} triples from {graph_count} graphs", file=sys.stderr)
        
        # Copy namespaces to the merged graph
        if global_namespaces:
            for prefix, namespace in global_namespaces.items():
                merged_graph.bind(prefix, namespace)
        
        # Serialize to TTL format
        print("DEBUG: Serializing to TTL", file=sys.stderr)
        ontology_ttl = merged_graph.serialize(format='turtle')
        
        # Check if the serialized ontology is too large (> 50KB)
        if len(ontology_ttl) > 50000:
            print(f"Warning: Ontology TTL is {len(ontology_ttl)} bytes, falling back to summary", file=sys.stderr)
            # Fall back to summary statistics instead of full TTL
            return build_ontology_summary_for_ai()
        
        print(f"DEBUG: Ontology TTL built, size: {len(ontology_ttl)} bytes", file=sys.stderr)
        return ontology_ttl
        
    except Exception as e:
        print(f"ERROR building AI context: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return None

def build_ontology_summary_for_ai():
    """Build a summary of the ontology for AI when full TTL is too large"""
    global current_dataset, current_file_path, current_base_uri, global_namespaces
    
    if current_dataset is None:
        return None
    
    try:
        # Get basic stats
        main_graph = current_dataset.graph(URIRef(current_base_uri))
        triples_count = len(main_graph)
        
        # Count classes and properties across all graphs
        classes = set()
        object_properties = set()
        datatype_properties = set()
        
        for graph in current_dataset.graphs():
            graph_classes = set(graph.subjects(RDF.type, OWL.Class)) | set(graph.subjects(RDF.type, RDFS.Class))
            classes.update({cls for cls in graph_classes if not isinstance(cls, BNode)})
            
            graph_obj_props = set(graph.subjects(RDF.type, OWL.ObjectProperty))
            object_properties.update({prop for prop in graph_obj_props if not isinstance(prop, BNode)})
            
            graph_data_props = set(graph.subjects(RDF.type, OWL.DatatypeProperty))
            datatype_properties.update({prop for prop in graph_data_props if not isinstance(prop, BNode)})
        
        # Build summary
        summary = f"Ontology Summary:\n"
        summary += f"File: {current_file_path}\n"
        summary += f"Base URI: {current_base_uri}\n"
        summary += f"Classes: {len(classes)}\n"
        summary += f"Object Properties: {len(object_properties)}\n"
        summary += f"Datatype Properties: {len(datatype_properties)}\n"
        summary += f"Total Properties: {len(object_properties) + len(datatype_properties)}\n"
        summary += f"Triples in main graph: {triples_count}\n"
        summary += f"Total graphs in dataset: {len(list(current_dataset.graphs()))}\n"
        
        if global_namespaces:
            summary += f"\nNamespaces:\n"
            for prefix, uri in list(global_namespaces.items())[:10]:  # Limit to first 10
                summary += f"- {prefix}: {uri}\n"
        
        if classes:
            sample_classes = [str(cls) for cls in list(classes)[:10]]
            summary += f"\nSample Classes: {', '.join(sample_classes)}\n"
        
        if object_properties or datatype_properties:
            all_props = list(object_properties) + list(datatype_properties)
            sample_props = [str(prop) for prop in all_props[:10]]
            summary += f"\nSample Properties: {', '.join(sample_props)}\n"
        
        return summary
        
    except Exception as e:
        print(f"ERROR building AI summary: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return None

def scan_for_base_declaration(file_path, max_lines=500):
    """Scan file header for @base or @prefix : declarations"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for i, line in enumerate(f):
                if i > max_lines:
                    break
                
                line = line.strip()
                
                # Turtle @base declaration
                if line.startswith('@base'):
                    # @base <http://example.org/ontology#> .
                    match = re.search(r'@base\s+<([^>]+)>', line)
                    if match:
                        return match.group(1)
                
                # Turtle default prefix
                if line.startswith('@prefix :'):
                    # @prefix : <http://example.org/ontology#> .
                    match = re.search(r'@prefix\s*:\s*<([^>]+)>', line)
                    if match:
                        return match.group(1)
                        
                # SPARQL-style BASE
                if line.upper().startswith('BASE'):
                    match = re.search(r'BASE\s+<([^>]+)>', line, re.IGNORECASE)
                    if match:
                        return match.group(1)
                        
    except Exception as e:
        print(f"Warning: Could not scan file header: {e}", file=sys.stderr)
    
    return None

def find_base_uri_from_graph(graph):
    """Find base URI from parsed graph (fallback method)"""
    # Look for owl:Ontology (most reliable)
    ontologies = list(graph.subjects(RDF.type, OWL.Ontology))
    if ontologies:
        return str(ontologies[0])
    
    # Look for default namespace in prefixes  
    for prefix, namespace in graph.namespaces():
        if prefix == '' or prefix is None:
            return str(namespace)
    
    return None

def find_base_uri(file_path, graph=None):
    """Find base URI by checking @base first, then owl:Ontology"""
    
    # Step 1: Look for @base in file header (most authoritative)
    base_from_header = scan_for_base_declaration(file_path)
    if base_from_header:
        return base_from_header
    
    # Step 2: If no @base, look in parsed graph for owl:Ontology
    if graph:
        base_from_graph = find_base_uri_from_graph(graph)
        if base_from_graph:
            return base_from_graph
    
    return None

def load_into_dataset_with_base_detection(file_path, target_dataset=None):
    """Load file into dataset with proper base URI detection"""
    
    # 1. First scan header for @base (most authoritative)
    base_uri = scan_for_base_declaration(file_path)
    
    # 2. Use provided dataset or create new one
    if target_dataset is None:
        dataset = Dataset()
    else:
        dataset = target_dataset
    
    if base_uri:
        # We know the base URI, parse directly into correctly named graph
        final_graph = dataset.graph(URIRef(base_uri))
        try:
            # Clear existing graph if it exists (rewrite behavior)
            final_graph.remove((None, None, None))
            final_graph.parse(file_path)
        except Exception as e:
            raise
    else:
        # No @base found, need to parse first to find owl:Ontology
        # Use a temporary approach but minimize memory impact
        temp_name = URIRef(f"temp://{uuid.uuid4()}")
        
        try:
            temp_graph = dataset.graph(temp_name)
            temp_graph.parse(file_path)
            
            # Find base URI from parsed graph
            base_uri = find_base_uri_from_graph(temp_graph)
            
            # If still no base URI, use file-based fallback
            if not base_uri:
                base_uri = f"file://{os.path.abspath(file_path)}"
            
            # Move data to correctly named graph, clearing existing if present
            final_graph = dataset.graph(URIRef(base_uri))
            final_graph.remove((None, None, None))  # Clear existing graph
            for triple in temp_graph:
                final_graph.add(triple)
            
            dataset.remove_graph(temp_name)
            
        except Exception as e:
            raise
    
    return dataset, base_uri




def extract_ontology_uri_from_file(file_path):
    """Quick regex scan for owl:Ontology URI — avoids full parse for speed."""
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read(50000)
        # Turtle: <URI> a owl:Ontology  (full URI form)
        m = re.search(r'<([^>]+)>\s+(?:a\s+owl:Ontology|rdf:type\s+owl:Ontology)', content)
        if m:
            return m.group(1)
        # RDF/XML: <owl:Ontology rdf:about="URI"
        m = re.search(r'<owl:Ontology[^>]*rdf:about=["\']([^"\']+)["\']', content)
        if m:
            return m.group(1)
        # Turtle: <> a owl:Ontology  (relative URI — resolve against @base)
        if re.search(r'<>\s+(?:a\s+owl:Ontology|rdf:type\s+owl:Ontology)', content):
            base = scan_for_base_declaration(file_path)
            if base:
                return base.rstrip('/#')  # normalise trailing slash for lookup
    except Exception as e:
        print(f"Warning: could not extract ontology URI from {file_path}: {e}", file=sys.stderr)
    return None


def build_ontology_uri_map(temp_dir):
    """Scan all RDF files in temp_dir and return {ontology_uri → file_path}."""
    uri_map = {}
    rdf_extensions = {'.ttl', '.owl', '.rdf', '.n3', '.nt'}
    scanned = 0
    for root, dirs, files in os.walk(temp_dir):
        for fname in files:
            if os.path.splitext(fname)[1].lower() in rdf_extensions:
                fpath = os.path.join(root, fname)
                scanned += 1
                uri = extract_ontology_uri_from_file(fpath)
                if uri:
                    uri_map[uri] = fpath
    print(f"URI map: scanned {scanned} RDF files, built {len(uri_map)} entries", file=sys.stderr)
    for uri, path in list(uri_map.items())[:5]:
        print(f"  URI map sample: {uri} → {os.path.basename(path)}", file=sys.stderr)
    return uri_map


def find_entry_point(temp_dir):
    """Find core/ontology.ttl anywhere in the directory tree."""
    for root, dirs, files in os.walk(temp_dir):
        if os.path.basename(root).lower() == 'core' and 'ontology.ttl' in files:
            candidate = os.path.join(root, 'ontology.ttl')
            print(f"Entry point: {candidate}", file=sys.stderr)
            return candidate
    return None


def load_rdf_directory(temp_dir):
    """Load an ontology from an uploaded directory tree."""
    entry_file = find_entry_point(temp_dir)
    if entry_file is None:
        return {"error": "No entry point found — expected a directory named 'core' containing 'ontology.ttl'"}
    uri_map = build_ontology_uri_map(temp_dir)
    result = load_rdf_file(entry_file, uri_map=uri_map)
    result['uri_map_size'] = len(uri_map)
    result['uri_map_sample'] = list(uri_map.keys())[:10]
    result['entry_file'] = entry_file
    return result


def find_owl_imports(graph):
    """Find all owl:imports statements in the graph"""
    imports = []
    for subj, pred, obj in graph.triples((None, OWL.imports, None)):
        if not isinstance(obj, BNode):
            imports.append(str(obj))
    return imports

def resolve_relative_import_path(base_file_path, base_uri, import_uri):
    """Resolve relative import path for same-domain imports"""
    
    # Parse URIs to get components
    from urllib.parse import urlparse
    base_parsed = urlparse(base_uri)
    import_parsed = urlparse(import_uri)
    
    # Check if same domain
    if base_parsed.netloc != import_parsed.netloc or base_parsed.scheme != import_parsed.scheme:
        return None, f"Different domain: {base_parsed.netloc} vs {import_parsed.netloc}"
    
    # Get paths without leading slash
    base_path = base_parsed.path.strip('/')
    import_path = import_parsed.path.strip('/')
    
    # Find common prefix
    base_parts = base_path.split('/')
    import_parts = import_path.split('/')
    
    # Both URIs represent ontologies, so we compare their directory paths
    # Get the directory portion of each URI path (remove the last part which is the ontology name)
    base_dir_parts = base_parts[:-1] if base_parts else []
    import_dir_parts = import_parts[:-1] if import_parts else []
    import_name = import_parts[-1] if import_parts else ''
    
    # Find common prefix length between directories
    common_len = 0
    for i in range(min(len(base_dir_parts), len(import_dir_parts))):
        if base_dir_parts[i] == import_dir_parts[i]:
            common_len += 1
        else:
            break
    
    # Calculate relative path from base directory to import directory
    up_levels = len(base_dir_parts) - common_len
    relative_parts = ['..'] * up_levels
    
    # Go down to import directory, then add the import name
    relative_parts.extend(import_dir_parts[common_len:])
    relative_parts.append(import_name)
    
    relative_path = '/'.join(relative_parts)
    
    # Resolve against base file directory
    base_dir = os.path.dirname(base_file_path)
    resolved_path = os.path.normpath(os.path.join(base_dir, relative_path))
    
    return resolved_path, None

def fetch_rdf_from_uri(uri, timeout=30):
    """Fetch an RDF document from a URI via HTTP, returning (content, content_type, error).

    Tries Turtle first, then RDF/XML as fallback, following redirects.
    Returns (content_bytes, content_type_str, None) on success, or (None, None, error_str) on failure.
    """
    import requests

    accept = "text/turtle, application/rdf+xml;q=0.9, application/n-triples;q=0.8, */*;q=0.5"
    try:
        response = requests.get(uri, headers={"Accept": accept}, timeout=timeout,
                                allow_redirects=True)
        response.raise_for_status()
        content_type = response.headers.get("Content-Type", "").split(";")[0].strip()
        return response.content, content_type, None
    except requests.exceptions.Timeout:
        return None, None, f"Timeout after {timeout}s fetching {uri}"
    except requests.exceptions.ConnectionError as e:
        return None, None, f"Connection error fetching {uri}: {e}"
    except requests.exceptions.HTTPError as e:
        return None, None, f"HTTP {e.response.status_code} fetching {uri}"
    except Exception as e:
        return None, None, f"Error fetching {uri}: {e}"


def resolve_import_url_relative_to_fetch(fetch_url, base_ontology_uri, import_uri):
    """When FYN fails, try to resolve import_uri relative to fetch_url.

    The ontology at fetch_url declared base_ontology_uri as its identity, and
    import_uri is relative to that identity. We compute the path from
    base_ontology_uri's directory to import_uri, then apply it to fetch_url's
    directory. Returns a list of candidate URLs to try (with/without extensions).

    Example:
      fetch_url         = https://raw.github.com/.../ontology/AboutCDMC.ttl
      base_ontology_uri = https://spec.edmcouncil.org/cdmc/ontology/AboutCDMC
      import_uri        = https://spec.edmcouncil.org/cdmc/ontology/Classification/DataClassification
      → tries https://raw.github.com/.../ontology/Classification/DataClassification
               https://raw.github.com/.../ontology/Classification/DataClassification.ttl
               https://raw.github.com/.../ontology/Classification/DataClassification.rdf
    """
    from urllib.parse import urlparse, urljoin

    try:
        base_parsed  = urlparse(base_ontology_uri)
        import_parsed = urlparse(import_uri)

        # Only makes sense when both URIs share the same scheme+host
        if base_parsed.scheme != import_parsed.scheme or base_parsed.netloc != import_parsed.netloc:
            return []

        # Directory of the base ontology URI
        base_dir = base_parsed.path.rstrip('/').rsplit('/', 1)[0] + '/'

        # Path of the import relative to base_dir
        import_path = import_parsed.path
        if not import_path.startswith(base_dir):
            return []
        relative = import_path[len(base_dir):]

        # Apply relative path to fetch_url's directory
        fetch_dir = fetch_url.rstrip('/').rsplit('/', 1)[0] + '/'
        candidate_base = fetch_dir + relative

        return [candidate_base, candidate_base + '.ttl', candidate_base + '.rdf']
    except Exception:
        return []


def content_type_to_rdflib_format(content_type, url=None):
    """Map HTTP Content-Type to rdflib format string.

    Falls back to URL file extension when Content-Type is ambiguous (e.g.
    GitHub raw serving .ttl files as text/plain).
    """
    mapping = {
        "text/turtle": "turtle",
        "application/x-turtle": "turtle",
        "application/rdf+xml": "xml",
        "application/xml": "xml",
        "text/xml": "xml",
        "application/n-triples": "nt",
        "application/ld+json": "json-ld",
    }
    if content_type in mapping:
        return mapping[content_type]

    # Content-Type is ambiguous (text/plain, octet-stream, etc.) — try URL extension
    if url:
        lower = url.split("?")[0].lower()
        if lower.endswith(".ttl"):
            return "turtle"
        if lower.endswith(".rdf") or lower.endswith(".owl"):
            return "xml"
        if lower.endswith(".nt"):
            return "nt"
        if lower.endswith(".jsonld") or lower.endswith(".json"):
            return "json-ld"
        if lower.endswith(".n3"):
            return "n3"

    return "turtle"  # default guess


def load_imports_recursive(dataset, main_source, main_base_uri, loaded_uris=None, fetch_url=None, uri_map=None):
    """Recursively load imports for a dataset.

    main_source: file path (str) if loaded from disk, or None if loaded via HTTP.
    main_base_uri: the ontology URI used as the named graph identifier.
    fetch_url: the actual URL used to fetch main_base_uri (may differ from
               main_base_uri when loaded via a mirror like GitHub raw).
    uri_map: {ontology_uri → local_file_path} built from uploaded directory.

    Resolution order for each owl:imports URI:
      0. URI map lookup — local file whose owl:Ontology IRI matches (directory upload)
      1. Local file relative to main_source (if main_source is a file path)
      2. Follow Your Nose — fetch import_uri directly via HTTP
      3. If FYN fails and fetch_url is set — resolve import relative to fetch_url
         (handles mirrors like GitHub raw where FYN doesn't work)
    """

    if loaded_uris is None:
        loaded_uris = set()

    if main_base_uri in loaded_uris:
        return []

    loaded_uris.add(main_base_uri)

    main_graph = dataset.graph(URIRef(main_base_uri))
    imports = find_owl_imports(main_graph)

    import_results = []

    for import_uri in imports:
        import_info = {
            "import_uri": import_uri,
            "status": "pending",
            "resolution": None,
            "file_path": None,
            "fetch_url": None,
            "base_uri": None,
            "error": None,
            "nested_imports": []
        }

        try:
            if import_uri in loaded_uris:
                import_info["status"] = "already_loaded"
                import_info["base_uri"] = import_uri
                import_results.append(import_info)
                continue

            actual_file_path = None

            # --- Step 0: URI map lookup (directory upload) ---
            if uri_map:
                if import_uri in uri_map:
                    actual_file_path = uri_map[import_uri]
                    import_info["resolution"] = "uri_map"
                    print(f"URI map hit: {import_uri} → {os.path.basename(actual_file_path)}", file=sys.stderr)
                else:
                    print(f"URI map miss: {import_uri}", file=sys.stderr)

            # --- Step 1: Local file resolution ---
            if actual_file_path is None and main_source is not None:
                resolved_path, error = resolve_relative_import_path(main_source, main_base_uri, import_uri)
                if not error:
                    if os.path.exists(resolved_path):
                        actual_file_path = resolved_path
                    else:
                        for ext in ['.ttl', '.rdf']:
                            test_path = resolved_path + ext
                            if os.path.exists(test_path):
                                actual_file_path = test_path
                                break

            if actual_file_path is not None:
                # --- Load from local file ---
                if import_info["resolution"] is None:
                    import_info["resolution"] = "local_file"
                import_info["file_path"] = actual_file_path
                import_info["base_uri"] = import_uri

                import_graph = dataset.graph(URIRef(import_uri))
                import_graph.remove((None, None, None))
                import_graph.parse(actual_file_path)
                register_namespaces_from_graph(import_graph, f"(import: {actual_file_path})")

                import_info["status"] = "loaded"
                import_info["triples_count"] = len(import_graph)

                nested_imports = load_imports_recursive(
                    dataset, actual_file_path, import_uri, loaded_uris, uri_map=uri_map)
                import_info["nested_imports"] = nested_imports
                import_results.append(import_info)
                continue

            if not (import_uri.startswith("http://") or import_uri.startswith("https://")):
                import_info["status"] = "file_not_found"
                import_info["error"] = f"Not found locally and not an HTTP URI: {import_uri}"
                import_results.append(import_info)
                continue

            # --- Step 2: Follow Your Nose ---
            print(f"FYN: fetching {import_uri}", file=sys.stderr)
            content, content_type, fetch_error = fetch_rdf_from_uri(import_uri)

            # Treat HTML responses as FYN failure (server ignoring Accept header)
            if not fetch_error and content_type in ('text/html', 'application/xhtml+xml'):
                fetch_error = f"FYN returned HTML (server does not support content negotiation)"

            # --- Step 3: FYN failed — try relative URL from fetch_url ---
            actual_fetch_url = import_uri  # track where we actually got the content
            if fetch_error and fetch_url:
                candidates = resolve_import_url_relative_to_fetch(
                    fetch_url, main_base_uri, import_uri)
                for candidate in candidates:
                    print(f"FYN fallback: trying {candidate}", file=sys.stderr)
                    content, content_type, fetch_error = fetch_rdf_from_uri(candidate)
                    if not fetch_error:
                        actual_fetch_url = candidate
                        break

            if fetch_error:
                import_info["status"] = "fetch_failed"
                import_info["error"] = fetch_error
                import_results.append(import_info)
                continue

            rdf_format = content_type_to_rdflib_format(content_type, actual_fetch_url)
            import_graph = dataset.graph(URIRef(import_uri))
            import_graph.remove((None, None, None))
            import_graph.parse(data=content, format=rdf_format, publicID=import_uri)
            register_namespaces_from_graph(import_graph, f"(fetched: {actual_fetch_url})")

            import_info["status"] = "fetched"
            import_info["resolution"] = "url_heuristic" if actual_fetch_url != import_uri else "fyn"
            import_info["fetch_url"] = actual_fetch_url
            import_info["base_uri"] = import_uri
            import_info["triples_count"] = len(import_graph)

            nested_imports = load_imports_recursive(
                dataset, None, import_uri, loaded_uris, fetch_url=actual_fetch_url, uri_map=uri_map)
            import_info["nested_imports"] = nested_imports
            import_results.append(import_info)

        except Exception as e:
            import_info["status"] = "error"
            import_info["error"] = str(e)
            import_results.append(import_info)

    return import_results

def load_rdf_uri(uri):
    """Load an RDF document from a URI (HTTP/HTTPS) into the dataset, following imports via FYN."""
    global current_dataset, current_file_path, current_base_uri

    print(f"DEBUG: load_rdf_uri called with: {uri}", file=sys.stderr)

    try:
        content, content_type, fetch_error = fetch_rdf_from_uri(uri)
        if fetch_error:
            return {"error": fetch_error}

        if current_dataset is None:
            clear_namespace_registry()
            current_dataset = Dataset()

        rdf_format = content_type_to_rdflib_format(content_type, uri)
        main_graph = current_dataset.graph(URIRef(uri))
        main_graph.remove((None, None, None))
        main_graph.parse(data=content, format=rdf_format, publicID=uri)

        # Detect actual ontology URI from graph (may differ from request URI after redirects)
        ontology_uris = list(main_graph.subjects(RDF.type, OWL.Ontology))
        base_uri = str(ontology_uris[0]) if ontology_uris else uri

        # If the ontology declares a different URI, re-key the graph
        if base_uri != uri:
            target_graph = current_dataset.graph(URIRef(base_uri))
            target_graph.remove((None, None, None))
            for triple in main_graph:
                target_graph.add(triple)
            current_dataset.remove_graph(URIRef(uri))
            main_graph = target_graph

        register_namespaces_from_graph(main_graph, f"(fetched: {uri})")

        current_file_path = None   # no local file
        current_base_uri = base_uri

        print(f"DEBUG: Fetched {len(main_graph)} triples, base_uri={base_uri}", file=sys.stderr)

        # Recursively follow imports via FYN (main_source=None → always HTTP)
        import_results = load_imports_recursive(current_dataset, None, base_uri, fetch_url=uri)

        # Gather stats
        classes, object_properties, datatype_properties = set(), set(), set()
        for graph in current_dataset.graphs():
            classes.update(s for s in graph.subjects(RDF.type, OWL.Class) if not isinstance(s, BNode))
            classes.update(s for s in graph.subjects(RDF.type, RDFS.Class) if not isinstance(s, BNode))
            object_properties.update(s for s in graph.subjects(RDF.type, OWL.ObjectProperty) if not isinstance(s, BNode))
            datatype_properties.update(s for s in graph.subjects(RDF.type, OWL.DatatypeProperty) if not isinstance(s, BNode))

        total_graphs = len(list(current_dataset.graphs()))
        total_triples = sum(len(g) for g in current_dataset.graphs())

        class_hierarchy = build_class_hierarchy_from_dataset(current_dataset)

        return {
            "success": True,
            "file_path": uri,
            "base_uri": base_uri,
            "file_size": len(content),
            "triples_count": len(main_graph),
            "namespaces_count": len(global_namespaces),
            "namespaces": global_namespaces,
            "namespace_conflicts": namespace_conflicts,
            "classes_count": len(classes),
            "properties_count": len(object_properties) + len(datatype_properties),
            "object_properties_count": len(object_properties),
            "datatype_properties_count": len(datatype_properties),
            "classes": [str(c) for c in list(classes)[:10]],
            "properties": [str(p) for p in list(object_properties | datatype_properties)[:10]],
            "class_hierarchy": class_hierarchy,
            "imports": import_results,
            "imports_count": len(import_results),
            "loaded_graphs": [str(g.identifier) for g in current_dataset.graphs()],
            "total_graphs": total_graphs,
            "total_triples": total_triples,
        }

    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {"error": f"Failed to load RDF from URI: {str(e)}"}


def load_rdf_file(file_path, uri_map=None):
    """Load an RDF file into a dataset and return statistics"""
    global current_dataset, current_file_path, current_base_uri
    
    print(f"DEBUG: load_rdf_file called with: {file_path}", file=sys.stderr)

    # If given a URL, delegate to URI loader
    if file_path.startswith("http://") or file_path.startswith("https://"):
        return load_rdf_uri(file_path)

    try:
        if not os.path.exists(file_path):
            return {"error": "File does not exist"}
        
        # Initialize dataset if not exists, otherwise add to existing
        if current_dataset is None:
            print("DEBUG: Creating new dataset", file=sys.stderr)
            clear_namespace_registry()
            dataset = Dataset()
            current_dataset = dataset
        else:
            print("DEBUG: Adding to existing dataset", file=sys.stderr)
            dataset = current_dataset
        
        # Load into dataset with base URI detection
        dataset, base_uri = load_into_dataset_with_base_detection(file_path, dataset)
        
        # Update global references
        current_file_path = file_path
        current_base_uri = base_uri
        
        print(f"DEBUG: Dataset loaded successfully. current_dataset = {current_dataset}", file=sys.stderr)
        print(f"DEBUG: current_file_path = {current_file_path}", file=sys.stderr)
        print(f"DEBUG: current_base_uri = {current_base_uri}", file=sys.stderr)
        
        # Get the main graph for analysis (the specific named graph, not the dataset)
        main_graph = dataset.graph(URIRef(base_uri))
        
        # Register namespaces from the main graph
        register_namespaces_from_graph(main_graph, f"(main file: {file_path})")
        
        # For hierarchy building, we want to query the combined dataset
        # but for basic stats, we use the main graph
        
        # Collect basic statistics from the main graph
        triples_count = len(main_graph)
        
        # Count different types of nodes
        subjects = set(main_graph.subjects())
        predicates = set(main_graph.predicates())
        objects = set(main_graph.objects())
        
        # Look for ontology classes and properties in all graphs in the dataset
        classes = set()
        object_properties = set()
        datatype_properties = set()
        
        # Load imports recursively first so we have the full dataset
        print(f"Loading imports for {base_uri}...", file=sys.stderr)
        import_results = load_imports_recursive(dataset, file_path, base_uri, uri_map=uri_map)
        
        # Now count classes and properties from all graphs in the dataset
        for graph in dataset.graphs():
            # Collect classes (owl:Class and rdfs:Class)
            graph_classes = set(graph.subjects(RDF.type, OWL.Class)) | set(graph.subjects(RDF.type, RDFS.Class))
            classes.update({cls for cls in graph_classes if not isinstance(cls, BNode)})
            
            # Collect object properties
            graph_obj_props = set(graph.subjects(RDF.type, OWL.ObjectProperty))
            object_properties.update({prop for prop in graph_obj_props if not isinstance(prop, BNode)})
            
            # Collect datatype properties
            graph_data_props = set(graph.subjects(RDF.type, OWL.DatatypeProperty))
            datatype_properties.update({prop for prop in graph_data_props if not isinstance(prop, BNode)})
        
        # Combine all properties for backward compatibility
        properties = object_properties | datatype_properties
        
        # Count total graphs and triples in dataset
        total_graphs = len(list(dataset.graphs()))
        total_triples = sum(len(g) for g in dataset.graphs())
        print(f"Import loading complete. Dataset now contains {total_graphs} graphs with {total_triples} total triples.", file=sys.stderr)
        
        # After loading imports, build class hierarchy from the entire dataset
        class_hierarchy = build_class_hierarchy_from_dataset(dataset)
        
        # Count subclass relationships for debugging (direct parent-child relationships only)
        subclass_count = 0
        def count_all_relationships(node):
            count = len(node.get("children", []))
            for child in node.get("children", []):
                count += count_all_relationships(child)
            return count
        
        for root in class_hierarchy:
            subclass_count += count_all_relationships(root)
        
        file_stats = os.stat(file_path)
        
        return {
            "success": True,
            "file_path": file_path,
            "base_uri": base_uri,
            "file_size": file_stats.st_size,
            "triples_count": triples_count,
            "subjects_count": len(subjects),
            "predicates_count": len(predicates),
            "objects_count": len(objects),
            "namespaces_count": len(global_namespaces),
            "namespaces": global_namespaces,
            "namespace_conflicts": namespace_conflicts,
            "classes_count": len(classes),
            "properties_count": len(properties),
            "object_properties_count": len(object_properties),
            "datatype_properties_count": len(datatype_properties),
            "classes": [str(cls) for cls in list(classes)[:10]],  # First 10 classes
            "properties": [str(prop) for prop in list(properties)[:10]],  # First 10 properties
            "class_hierarchy": class_hierarchy,
            "subclass_relationships_count": subclass_count,
            "imports": import_results,
            "imports_count": len(import_results),
            "loaded_graphs": [str(g.identifier) for g in dataset.graphs()],
            "total_graphs": total_graphs,
            "total_triples": total_triples
        }
        
    except Exception as e:
        return {"error": f"Failed to load RDF file: {str(e)}"}

def get_graph_info():
    """Get information about the currently loaded dataset"""
    global current_dataset, current_file_path, current_base_uri
    
    if current_dataset is None:
        return {"error": "No dataset currently loaded"}
    
    main_graph = current_dataset.graph(URIRef(current_base_uri))
    
    return {
        "loaded": True,
        "file_path": current_file_path,
        "base_uri": current_base_uri,
        "triples_count": len(main_graph),
        "graphs_count": len(list(current_dataset.graphs()))
    }

def query_graph(sparql_query):
    """Execute a SPARQL query on the current dataset (merged graphs)"""
    global current_dataset, current_base_uri
    
    if current_dataset is None:
        return {"error": "No dataset currently loaded"}
    
    try:
        # Create merged graph from all graphs in dataset
        from rdflib import Graph
        merged_graph = Graph()
        
        # Add all triples from all graphs to merged graph
        for graph in current_dataset.graphs():
            for triple in graph:
                merged_graph.add(triple)
        
        # Copy namespaces to merged graph
        if hasattr(current_dataset, 'namespaces'):
            for prefix, namespace in current_dataset.namespaces():
                merged_graph.bind(prefix, namespace)
        
        # Execute query on merged graph
        results = merged_graph.query(sparql_query)
        
        # DESCRIBE or CONSTRUCT — result is a graph of triples
        if hasattr(results, 'type') and results.type in ('DESCRIBE', 'CONSTRUCT'):
            result_graph = Graph()
            for triple in results:
                result_graph.add(triple)
            # Bind all current ontology namespaces for readable Turtle output
            ns_dict, _ = get_global_namespaces()
            for prefix, ns_uri in ns_dict.items():
                result_graph.bind(prefix, ns_uri)
            turtle_str = result_graph.serialize(format='turtle')
            return {
                "success": True,
                "result_type": "graph",
                "turtle": turtle_str,
                "count": len(result_graph)
            }

        # SELECT
        result_list = []
        variables = []

        if hasattr(results, 'vars') and results.vars:
            variables = [str(var) for var in results.vars]
            for row in results:
                row_dict = {}
                for i, var in enumerate(variables):
                    value = row[i] if i < len(row) else None
                    row_dict[var] = str(value) if value is not None else None
                result_list.append(row_dict)
        else:
            # ASK query
            result_list = [str(row) for row in results]

        return {
            "success": True,
            "result_type": "table",
            "results": result_list,
            "variables": variables,
            "count": len(result_list)
        }
    except Exception as e:
        # Provide more detailed error reporting for SPARQL syntax errors
        error_msg = str(e)
        
        # Check if it's a SPARQL syntax error and provide more context
        if "ParseException" in error_msg or "syntax error" in error_msg.lower():
            return {"error": f"SPARQL Syntax Error: {error_msg}"}
        elif "rdflib.plugins.sparql" in error_msg:
            return {"error": f"SPARQL Error: {error_msg}"}
        else:
            return {"error": f"Query execution failed: {error_msg}"}

# No command-line interface - this is a library module for server.py
