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

# Global dataset storage
current_dataset = None
current_file_path = None
current_base_uri = None

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
    
    # 2. Create dataset and parse into temp graph first
    dataset = Dataset()
    temp_name = URIRef(f"temp://{uuid.uuid4()}")
    
    try:
        # Parse into the specific named graph, not the dataset
        temp_graph = dataset.graph(temp_name)
        temp_graph.parse(file_path)
    except Exception as e:
        raise
    
    # 3. If no @base found, look in parsed graph for owl:Ontology
    if not base_uri:
        base_uri = find_base_uri_from_graph(temp_graph)
    
    # 4. If still no base URI, use file-based fallback
    if not base_uri:
        base_uri = f"file://{os.path.abspath(file_path)}"
    
    # 5. Move data to correctly named graph
    final_graph = dataset.graph(URIRef(base_uri))
    for triple in temp_graph:
        final_graph.add(triple)
    
    dataset.remove_graph(temp_name)
    
    return dataset, base_uri

def get_class_properties(graph, class_uri):
    """Get all properties that have the given class as their domain"""
    properties = []
    
    # Find all properties where this class is the domain
    for prop in graph.subjects(RDFS.domain, URIRef(class_uri)):
        prop_info = {
            "uri": str(prop),
            "label": get_label(graph, prop),
            "ranges": []
        }
        
        # Get all ranges for this property, excluding blank nodes
        ranges = list(graph.objects(prop, RDFS.range))
        for range_class in ranges:
            if not isinstance(range_class, BNode):
                prop_info["ranges"].append({
                    "uri": str(range_class),
                    "label": get_label(graph, range_class)
                })
        
        properties.append(prop_info)
    
    return properties

def build_debug_tree(hierarchy):
    """Build a simple tree structure for debugging display"""
    result = []
    
    def process_node(node, level=0):
        indent = "  " * level
        children_info = []
        for child in node.get("children", []):
            children_info.extend(process_node(child, level + 1))
        
        node_info = f"{indent}{node['label']}"
        if node.get("children"):
            node_info += f" ({len(node['children'])} children)"
        
        return [node_info] + children_info
    
    for root in hierarchy:
        result.extend(process_node(root))
    
    return result

def build_hierarchy(dataset, types, rel):
    """Build a hierarchical tree structure from all graphs in dataset
    
    Args:
        dataset: RDF dataset containing graphs
        types: Array of RDF types to collect (e.g., [OWL.Class, RDFS.Class])
        rel: Relationship predicate to use for hierarchy (e.g., RDFS.subClassOf)
    """
    # Collect entities and relationships from all graphs in the dataset
    all_entities = set()
    hierarchy = {}
    
    # First pass: collect all entities of specified types from all graphs
    for graph in dataset.graphs():
        for entity_type in types:
            graph_entities = set(graph.subjects(RDF.type, entity_type))
            all_entities.update({ent for ent in graph_entities if not isinstance(ent, BNode)})
    
    # Build hierarchy entries for all entities
    for entity in all_entities:
        entity_str = str(entity)
        # Find the best label and identify source graph
        label = None
        properties = []
        graph_source = None
        
        for graph in dataset.graphs():
            # Check if this entity is defined in this graph
            entity_defined = False
            for entity_type in types:
                if (entity, RDF.type, entity_type) in graph:
                    entity_defined = True
                    break
            
            if entity_defined:
                if graph_source is None:
                    graph_source = str(graph.identifier)
                if label is None:
                    label = get_label(graph, entity)
            # Collect properties from all graphs (only for classes)
            if OWL.Class in types or RDFS.Class in types:
                properties.extend(get_class_properties(graph, entity_str))
        
        hierarchy[entity_str] = {
            "uri": entity_str,
            "label": label or entity_str.split('#')[-1].split('/')[-1],
            "children": [],
            "properties": properties,
            "graph_source": graph_source or "unknown"
        }
        
    
    # Second pass: collect relationships from all graphs
    roots = set(all_entities)  # Start with all entities as potential roots
    
    for graph in dataset.graphs():
        for entity in all_entities:
            entity_str = str(entity)
            # Look for the specified relationship in this graph
            parents = list(graph.objects(entity, rel))
            
            # Filter out owl:Thing and blank nodes as parents
            meaningful_parents = [p for p in parents if str(p) != str(OWL.Thing) and not isinstance(p, BNode)]
            
            if meaningful_parents:
                roots.discard(entity)  # Remove from roots if it has parents
                for parent in meaningful_parents:
                    parent_str = str(parent)
                    if parent_str in hierarchy and entity_str in hierarchy:
                        # Avoid duplicates
                        if hierarchy[entity_str] not in hierarchy[parent_str]["children"]:
                            hierarchy[parent_str]["children"].append(hierarchy[entity_str])
    
    # Sort children alphabetically for each entity
    def sort_hierarchy(node):
        if node["children"]:
            node["children"].sort(key=lambda x: x["label"].lower())
            for child in node["children"]:
                sort_hierarchy(child)
    
    # Get root entities and sort them
    root_entities = [hierarchy[str(root)] for root in roots if str(root) in hierarchy]
    root_entities.sort(key=lambda x: x["label"].lower())
    
    # Sort all children recursively
    for root in root_entities:
        sort_hierarchy(root)
    
    return root_entities

def build_class_hierarchy_from_dataset(dataset):
    """Build a hierarchical tree structure of classes from all graphs in dataset"""
    return build_hierarchy(dataset, [OWL.Class, RDFS.Class], RDFS.subClassOf)


def get_label(graph, resource):
    """Get the label for a resource, falling back to local name"""
    # Try rdfs:label first
    labels = list(graph.objects(resource, RDFS.label))
    if labels:
        return str(labels[0])
    
    # Fall back to local name from URI
    uri_str = str(resource)
    if '#' in uri_str:
        return uri_str.split('#')[-1]
    elif '/' in uri_str:
        return uri_str.split('/')[-1]
    else:
        return uri_str

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
                print(f"  ⚠ Import already loaded: {import_uri}", file=sys.stderr)
                import_results.append(import_info)
                continue
            
            # Parse into dataset
            import_graph = dataset.graph(URIRef(import_base_uri))
            import_graph.parse(actual_file_path)
            
            import_info["status"] = "loaded"
            import_info["triples_count"] = len(import_graph)
            
            print(f"  ✓ Loaded import: {import_uri} ({import_info['triples_count']} triples) from {actual_file_path}", file=sys.stderr)
            
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
        
        # Load into dataset with base URI detection
        dataset, base_uri = load_into_dataset_with_base_detection(file_path)
        
        # Store globally for persistence
        current_dataset = dataset
        current_file_path = file_path
        current_base_uri = base_uri
        
        # Get the main graph for analysis (the specific named graph, not the dataset)
        main_graph = dataset.graph(URIRef(base_uri))
        
        
        # For hierarchy building, we want to query the combined dataset
        # but for basic stats, we use the main graph
        
        # Collect basic statistics from the main graph
        triples_count = len(main_graph)
        
        # Count different types of nodes
        subjects = set(main_graph.subjects())
        predicates = set(main_graph.predicates())
        objects = set(main_graph.objects())
        
        # Count namespaces
        namespaces = dict(main_graph.namespaces())
        
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
            "namespaces_count": len(namespaces),
            "namespaces": {str(prefix): str(namespace) for prefix, namespace in namespaces.items()},
            "classes_count": len(classes),
            "properties_count": len(properties),
            "object_properties_count": len(object_properties),
            "datatype_properties_count": len(datatype_properties),
            "classes": [str(cls) for cls in list(classes)[:10]],  # First 10 classes
            "properties": [str(prop) for prop in list(properties)[:10]],  # First 10 properties
            "class_hierarchy": class_hierarchy,
            "subclass_relationships_count": subclass_count,
            "hierarchy_debug": {
                "root_classes": [{"label": root["label"], "children_count": len(root.get("children", []))} for root in class_hierarchy],
                "full_hierarchy_tree": build_debug_tree(class_hierarchy)
            },
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
