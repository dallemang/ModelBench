#!/usr/bin/env python3
"""
Hierarchy building module for OntoBench - builds hierarchical tree structures from RDF data
"""

from rdflib import BNode
from rdflib.namespace import RDF, RDFS, OWL


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


def get_class_properties(graph, class_uri):
    """Get all properties that have the given class as their domain"""
    from rdflib import URIRef
    properties = []
    
    # Ensure class_uri is a URIRef for RDFLib operations
    if isinstance(class_uri, str):
        class_uri = URIRef(class_uri)
    
    # Find all properties where this class is the domain
    for prop in graph.subjects(RDFS.domain, class_uri):
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


def build_hierarchy(dataset, types, rel, object_on_top=True):
    """Build a hierarchical tree structure from all graphs in dataset
    
    Args:
        dataset: RDF dataset containing graphs
        types: Array of RDF types to collect (e.g., [OWL.Class, RDFS.Class])
        rel: Relationship predicate to use for hierarchy (e.g., RDFS.subClassOf)
        object_on_top: If True, objects of rel are parents (default). If False, subjects are parents.
    """
    # Collect entities and relationships from all graphs in the dataset
    all_entities = set()
    hierarchy = {}
    
    # First pass: collect all entities of specified types from the federated dataset
    for entity_type in types:
        dataset_entities = {
            s for s, _, _, _ in dataset.quads((None, RDF.type, entity_type, None))
        }

        all_entities.update({ent for ent in dataset_entities if not isinstance(ent, BNode)})
    
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
        
    
    # Second pass: collect relationships from the entire dataset
    roots = set(all_entities)  # Start with all entities as potential roots
    
    for entity in all_entities:
        entity_str = str(entity)
        
        # Look for the specified relationship in the entire dataset
        related_entities = [
            o for _, _, o, _ in dataset.quads((entity, rel, None, None))
        ]
        
        # Filter out owl:Thing and blank nodes
        meaningful_related = [r for r in related_entities if str(r) != str(OWL.Thing) and not isinstance(r, BNode)]
        
        if meaningful_related:
            if object_on_top:
                # Traditional hierarchy: objects are parents of subjects
                roots.discard(entity)  # Remove from roots if it has parents
                for parent in meaningful_related:
                    parent_str = str(parent)
                    # Create parent entry if it doesn't exist
                    if parent_str not in hierarchy:
                        hierarchy[parent_str] = {
                            "uri": parent_str,
                            "label": parent_str.split('#')[-1].split('/')[-1],
                            "children": [],
                            "properties": [],
                            "graph_source": "unknown"
                        }
                    if entity_str in hierarchy:
                        # Avoid duplicates
                        if hierarchy[entity_str] not in hierarchy[parent_str]["children"]:
                            hierarchy[parent_str]["children"].append(hierarchy[entity_str])
            else:
                # Reverse hierarchy: subjects are parents of objects
                for child in meaningful_related:
                    child_str = str(child)
                    roots.discard(child)  # Remove children from roots
                    # Create child entry if it doesn't exist
                    if child_str not in hierarchy:
                        hierarchy[child_str] = {
                            "uri": child_str,
                            "label": child_str.split('#')[-1].split('/')[-1],
                            "children": [],
                            "properties": [],
                            "graph_source": "unknown"
                        }
                    if entity_str in hierarchy:
                        # Avoid duplicates
                        if hierarchy[child_str] not in hierarchy[entity_str]["children"]:
                            hierarchy[entity_str]["children"].append(hierarchy[child_str])
    
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
    return build_hierarchy(dataset, [OWL.Class, RDFS.Class], RDFS.subClassOf, object_on_top=True)


def build_import_hierarchy_from_dataset(dataset):
    """Build a hierarchical tree structure of ontology imports from all graphs in dataset"""
    return build_hierarchy(dataset, [OWL.Ontology], OWL.imports, object_on_top=False)