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

def scan_for_base_declaration(file_path, max_lines=50):
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

def load_into_dataset_with_base_detection(file_path):
    """Load file into dataset with proper base URI detection"""
    
    # 1. First scan header for @base (most authoritative)
    base_uri = scan_for_base_declaration(file_path)
    
    # 2. Create dataset
    dataset = Dataset()
    
    if base_uri:
        # We know the base URI, parse directly into correctly named graph
        final_graph = dataset.graph(URIRef(base_uri))
        try:
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
            
            # Move data to correctly named graph
            final_graph = dataset.graph(URIRef(base_uri))
            for triple in temp_graph:
                final_graph.add(triple)
            
            dataset.remove_graph(temp_name)
            
        except Exception as e:
            raise
    
    return dataset, base_uri




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

def load_imports_recursive(dataset, main_file_path, main_base_uri, loaded_uris=None):
    """Recursively load imports for a dataset"""
    
    if loaded_uris is None:
        loaded_uris = set()
    
    # Avoid infinite loops
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
            "file_path": None,
            "base_uri": None,
            "error": None,
            "nested_imports": []
        }
        
        try:
            # Resolve relative path
            resolved_path, error = resolve_relative_import_path(main_file_path, main_base_uri, import_uri)
            
            if error:
                import_info["status"] = "skipped"
                import_info["error"] = error
                import_results.append(import_info)
                continue
            
            # Check if file exists, trying common extensions if needed
            actual_file_path = resolved_path
            if not os.path.exists(resolved_path):
                # Try common RDF file extensions
                extensions_to_try = ['.ttl', '.rdf']
                found = False
                for ext in extensions_to_try:
                    test_path = resolved_path + ext
                    if os.path.exists(test_path):
                        actual_file_path = test_path
                        found = True
                        break
                
                if not found:
                    import_info["status"] = "file_not_found"
                    import_info["error"] = f"File not found: {resolved_path} (tried extensions: {', '.join(extensions_to_try)})"
                    import_results.append(import_info)
                    continue
            
            # Load the import file
            import_info["file_path"] = actual_file_path
            
            # For now, assume the import URI is the base URI (as stated in requirements)
            import_base_uri = import_uri
            import_info["base_uri"] = import_base_uri
            
            # Check if already loaded
            if import_base_uri in loaded_uris:
                import_info["status"] = "already_loaded"
                import_results.append(import_info)
                continue
            
            # Parse into dataset
            import_graph = dataset.graph(URIRef(import_base_uri))
            import_graph.parse(actual_file_path)
            
            # Register namespaces from the imported graph
            register_namespaces_from_graph(import_graph, f"(import: {actual_file_path})")
            
            import_info["status"] = "loaded"
            import_info["triples_count"] = len(import_graph)
            
            
            # Recursively load nested imports
            nested_imports = load_imports_recursive(dataset, actual_file_path, import_base_uri, loaded_uris)
            import_info["nested_imports"] = nested_imports
            
            import_results.append(import_info)
            
        except Exception as e:
            import_info["status"] = "error"
            import_info["error"] = str(e)
            import_results.append(import_info)
    
    return import_results

def load_rdf_file(file_path):
    """Load an RDF file into a dataset and return statistics"""
    global current_dataset, current_file_path, current_base_uri
    
    try:
        if not os.path.exists(file_path):
            return {"error": "File does not exist"}
        
        # Clear namespace registry for new file load
        clear_namespace_registry()
        
        # Load into dataset with base URI detection
        dataset, base_uri = load_into_dataset_with_base_detection(file_path)
        
        # Store globally for persistence
        current_dataset = dataset
        current_file_path = file_path
        current_base_uri = base_uri
        
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
        import_results = load_imports_recursive(dataset, file_path, base_uri)
        
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
    """Execute a SPARQL query on the current dataset"""
    global current_dataset, current_base_uri
    
    if current_dataset is None:
        return {"error": "No dataset currently loaded"}
    
    try:
        # Query the main graph by default
        main_graph = current_dataset.graph(URIRef(current_base_uri))
        results = main_graph.query(sparql_query)
        return {
            "success": True,
            "results": [str(row) for row in results]
        }
    except Exception as e:
        return {"error": f"Query failed: {str(e)}"}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command provided"}))
        return
    
    command = sys.argv[1]
    
    if command == "load_rdf" and len(sys.argv) > 2:
        file_path = sys.argv[2]
        result = load_rdf_file(file_path)
        print(json.dumps(result))
    elif command == "graph_info":
        result = get_graph_info()
        print(json.dumps(result))
    elif command == "query" and len(sys.argv) > 2:
        query = sys.argv[2]
        result = query_graph(query)
        print(json.dumps(result))
    else:
        print(json.dumps({"error": "Unknown command or missing parameters"}))

if __name__ == "__main__":
    main()
