#!/usr/bin/env python3
"""
HTTP Server Backend for OntoBench - stateful RDF management using FastAPI
"""

import sys
import json
import os
import re
import uuid
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from rdflib import Graph, Dataset, URIRef, Literal, BNode
from rdflib.namespace import RDF, RDFS, OWL

# Import existing functions from main.py
from main import (
    scan_for_base_declaration,
    find_base_uri_from_graph,
    find_base_uri,
    load_into_dataset_with_base_detection,
    get_class_properties,
    build_class_hierarchy_from_dataset,
    build_import_hierarchy_from_dataset,
    get_label,
    find_owl_imports,
    resolve_relative_import_path,
    load_imports_recursive
)

# Global dataset storage (persistent across requests)
current_dataset = None
current_file_path = None
current_base_uri = None

app = FastAPI()

# Request models
class LoadRdfRequest(BaseModel):
    file_path: str

class QueryRequest(BaseModel):
    sparql_query: str

class AddTripleRequest(BaseModel):
    subject: str
    predicate: str
    object: str

@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "dataset_loaded": current_dataset is not None}

@app.post("/load_rdf")
def load_rdf_file_endpoint(request: LoadRdfRequest):
    """Load an RDF file into the dataset"""
    global current_dataset, current_file_path, current_base_uri
    
    try:
        file_path = request.file_path
        
        if not os.path.exists(file_path):
            raise HTTPException(status_code=400, detail="File does not exist")
        
        # Load into dataset with base URI detection
        dataset, base_uri = load_into_dataset_with_base_detection(file_path)
        
        # Store globally for persistence
        current_dataset = dataset
        current_file_path = file_path
        current_base_uri = base_uri
        
        # Get the main graph for analysis
        main_graph = dataset.graph(URIRef(base_uri))
        
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
        
        # Build class hierarchy from the entire dataset
        class_hierarchy = build_class_hierarchy_from_dataset(dataset)
        
        # Count subclass relationships
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
            "classes": [str(cls) for cls in list(classes)[:10]],
            "properties": [str(prop) for prop in list(properties)[:10]],
            "class_hierarchy": class_hierarchy,
            "subclass_relationships_count": subclass_count,
            "imports": import_results,
            "imports_count": len(import_results),
            "loaded_graphs": [str(g.identifier) for g in dataset.graphs()],
            "total_graphs": total_graphs,
            "total_triples": total_triples
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load RDF file: {str(e)}")

@app.get("/graph_info")
def get_graph_info():
    """Get information about the currently loaded dataset"""
    global current_dataset, current_file_path, current_base_uri
    
    if current_dataset is None:
        raise HTTPException(status_code=400, detail="No dataset currently loaded")
    
    main_graph = current_dataset.graph(URIRef(current_base_uri))
    
    return {
        "loaded": True,
        "file_path": current_file_path,
        "base_uri": current_base_uri,
        "triples_count": len(main_graph),
        "graphs_count": len(list(current_dataset.graphs()))
    }

@app.post("/query")
def query_graph(request: QueryRequest):
    """Execute a SPARQL query on the current dataset"""
    global current_dataset, current_base_uri
    
    if current_dataset is None:
        raise HTTPException(status_code=400, detail="No dataset currently loaded")
    
    try:
        # Query the main graph by default
        main_graph = current_dataset.graph(URIRef(current_base_uri))
        results = main_graph.query(request.sparql_query)
        return {
            "success": True,
            "results": [str(row) for row in results]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")

@app.post("/add_triple")
def add_triple(request: AddTripleRequest):
    """Add a triple to the dataset"""
    global current_dataset
    
    if current_dataset is None:
        raise HTTPException(status_code=400, detail="No dataset currently loaded")
    
    try:
        # Find which graph the subject is defined in
        subject_graph_uri = None
        subject_uriref = URIRef(request.subject)
        
        for graph in current_dataset.graphs():
            # Look for where the subject is defined (has any rdf:type)
            if (subject_uriref, RDF.type, None) in graph:
                subject_graph_uri = graph.identifier
                break
        
        if subject_graph_uri is None:
            raise HTTPException(status_code=400, detail=f"Subject {request.subject} not found in any graph")
        
        # Add the triple to the subject's graph
        subject_graph = current_dataset.graph(subject_graph_uri)
        predicate_uriref = URIRef(request.predicate)
        object_uriref = URIRef(request.object)
        
        # Add the triple: subject predicate object
        subject_graph.add((subject_uriref, predicate_uriref, object_uriref))
        
        return {
            "success": True,
            "subject": request.subject,
            "predicate": request.predicate,
            "object": request.object,
            "graph_uri": str(subject_graph_uri)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add triple: {str(e)}")

@app.get("/hierarchy")
def get_current_hierarchy():
    """Get the current class hierarchy from the dataset"""
    global current_dataset
    
    if current_dataset is None:
        raise HTTPException(status_code=400, detail="No dataset currently loaded")
    
    try:
        # Build and return the current hierarchy
        current_hierarchy = build_class_hierarchy_from_dataset(current_dataset)
        
        return {
            "success": True,
            "hierarchy": current_hierarchy
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get hierarchy: {str(e)}")

@app.get("/import_hierarchy")
def get_current_import_hierarchy():
    """Get the current import hierarchy from the dataset"""
    global current_dataset
    
    if current_dataset is None:
        raise HTTPException(status_code=400, detail="No dataset currently loaded")
    
    try:
        # Build and return the current import hierarchy
        current_import_hierarchy = build_import_hierarchy_from_dataset(current_dataset)
        
        return {
            "success": True,
            "hierarchy": current_import_hierarchy
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get import hierarchy: {str(e)}")

@app.get("/resolve_import_path")
def resolve_import_path_endpoint(base_file_path: str, base_uri: str, import_uri: str):
    """Resolve relative import path using the three parameters"""
    try:
        resolved_path, error = resolve_relative_import_path(base_file_path, base_uri, import_uri)
        
        if error:
            return {
                "success": False,
                "error": error,
                "resolved_path": None
            }
        
        return {
            "success": True,
            "resolved_path": resolved_path,
            "error": None
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to resolve import path: {str(e)}")

@app.get("/dump")
def dump_dataset():
    """Return the entire dataset as TriG format for browser viewing"""
    global current_dataset
    
    if current_dataset is None:
        raise HTTPException(status_code=400, detail="No dataset currently loaded")
    
    try:
        # Serialize the entire dataset to TriG format
        trig_content = current_dataset.serialize(format='trig')
        
        # Return as plain text with proper content type
        return PlainTextResponse(
            content=trig_content, 
            media_type="text/plain",
            headers={"Content-Disposition": "inline; filename=dataset.trig"}
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to dump dataset: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    
    # Get port from command line argument or use default
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
    
    print(f"Starting OntoBench HTTP server on port {port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")