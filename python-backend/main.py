#!/usr/bin/env python3
"""
RDF Backend for OntoBench - loads and manages RDF graphs using rdflib
"""

import sys
import json
import os
from rdflib import Graph, URIRef, Literal, BNode
from rdflib.namespace import RDF, RDFS, OWL

# Global graph storage
current_graph = None
current_file_path = None

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
    """Load an RDF file into a graph and return statistics"""
    global current_graph, current_file_path
    
    try:
        if not os.path.exists(file_path):
            return {"error": "File does not exist"}
        
        # Create new graph
        graph = Graph()
        
        # Try to parse the file - rdflib will auto-detect format
        graph.parse(file_path)
        
        # Store globally for persistence
        current_graph = graph
        current_file_path = file_path
        
        # Collect basic statistics
        triples_count = len(graph)
        
        # Count different types of nodes
        subjects = set(graph.subjects())
        predicates = set(graph.predicates())
        objects = set(graph.objects())
        
        # Count namespaces
        namespaces = dict(graph.namespaces())
        
        # Look for ontology classes and properties
        classes = set(graph.subjects(RDF.type, OWL.Class)) | set(graph.subjects(RDF.type, RDFS.Class))
        properties = set(graph.subjects(RDF.type, OWL.ObjectProperty)) | \
                    set(graph.subjects(RDF.type, OWL.DatatypeProperty)) | \
                    set(graph.subjects(RDF.type, RDF.Property))
        
        # Build class hierarchy
        class_hierarchy = build_class_hierarchy(graph)
        
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
    """Get information about the currently loaded graph"""
    global current_graph, current_file_path
    
    if current_graph is None:
        return {"error": "No graph currently loaded"}
    
    return {
        "loaded": True,
        "file_path": current_file_path,
        "triples_count": len(current_graph)
    }

def query_graph(sparql_query):
    """Execute a SPARQL query on the current graph"""
    global current_graph
    
    if current_graph is None:
        return {"error": "No graph currently loaded"}
    
    try:
        results = current_graph.query(sparql_query)
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