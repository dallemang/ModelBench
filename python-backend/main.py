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

def build_class_hierarchy(graph):
    """Build a hierarchical tree structure of classes using rdfs:subClassOf"""
    # Find all classes, excluding blank nodes
    all_classes = set(graph.subjects(RDF.type, OWL.Class)) | set(graph.subjects(RDF.type, RDFS.Class))
    classes = {cls for cls in all_classes if not isinstance(cls, BNode)}
    
    # Build parent-child relationships
    hierarchy = {}
    roots = set()
    
    for cls in classes:
        cls_str = str(cls)
        hierarchy[cls_str] = {
            "uri": cls_str,
            "label": get_label(graph, cls),
            "children": [],
            "properties": get_class_properties(graph, cls_str)
        }
    
    # Find subclass relationships
    for cls in classes:
        cls_str = str(cls)
        # Look for rdfs:subClassOf relationships
        parents = list(graph.objects(cls, RDFS.subClassOf))
        
        # Filter out owl:Thing and blank nodes as parents
        meaningful_parents = [p for p in parents if str(p) != str(OWL.Thing) and not isinstance(p, BNode)]
        
        if meaningful_parents:
            for parent in meaningful_parents:
                parent_str = str(parent)
                if parent_str in hierarchy:
                    hierarchy[parent_str]["children"].append(hierarchy[cls_str])
        else:
            # No meaningful parent found (only owl:Thing or no parents), this is a root class
            roots.add(cls_str)
    
    # Sort children alphabetically for each class
    def sort_hierarchy(node):
        if node["children"]:
            node["children"].sort(key=lambda x: x["label"].lower())
            for child in node["children"]:
                sort_hierarchy(child)
    
    # Get root classes and sort them
    root_classes = [hierarchy[root] for root in roots if root in hierarchy]
    root_classes.sort(key=lambda x: x["label"].lower())
    
    # Sort all children recursively
    for root in root_classes:
        sort_hierarchy(root)
    
    return root_classes

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
        
        # Look for ontology classes and properties in the main graph
        classes = set(main_graph.subjects(RDF.type, OWL.Class)) | set(main_graph.subjects(RDF.type, RDFS.Class))
        properties = set(main_graph.subjects(RDF.type, OWL.ObjectProperty)) | \
                    set(main_graph.subjects(RDF.type, OWL.DatatypeProperty)) | \
                    set(main_graph.subjects(RDF.type, RDF.Property))
        
        # Build class hierarchy from the main graph (for now - will use dataset later for imports)
        class_hierarchy = build_class_hierarchy(main_graph)
        
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
            "classes": [str(cls) for cls in list(classes)[:10]],  # First 10 classes
            "properties": [str(prop) for prop in list(properties)[:10]],  # First 10 properties
            "class_hierarchy": class_hierarchy,
            "subclass_relationships_count": subclass_count,
            "hierarchy_debug": {
                "root_classes": [{"label": root["label"], "children_count": len(root.get("children", []))} for root in class_hierarchy],
                "full_hierarchy_tree": build_debug_tree(class_hierarchy)
            }
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