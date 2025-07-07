#!/usr/bin/env python3
"""
Hierarchy building module for OntoBench - builds hierarchical tree structures from RDF data
"""

from rdflib import BNode, Literal
from rdflib.namespace import RDF, RDFS, OWL


def is_deprecated(dataset, resource):
    """Check if a resource is marked as deprecated (owl:deprecated "true")"""
    for graph in dataset.graphs():
        deprecated_values = list(graph.objects(resource, OWL.deprecated))
        for value in deprecated_values:
            if isinstance(value, Literal) and str(value).lower() == "true":
                return True
    return False

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


def get_annotations(dataset, resource_uri):
    """Get all annotation properties for a resource from all graphs in the dataset"""
    from rdflib import URIRef, Literal
    import html
    
    annotations = []
    
    # Ensure resource_uri is a URIRef for RDFLib operations
    if isinstance(resource_uri, str):
        resource_uri = URIRef(resource_uri)
    
    # Collect ALL properties from all graphs in the dataset - no filtering
    for s, p, o, _ in dataset.quads((resource_uri, None, None, None)):
        predicate_uri = str(p)
        
        # Only skip the core structural properties that define hierarchy relationships
        if predicate_uri in [str(RDF.type), str(RDFS.subClassOf), str(OWL.imports), str(RDFS.domain), str(RDFS.range)]:
            continue
            
        # Get predicate label - try to find it in the dataset first
        predicate_label = get_label_from_dataset(dataset, p)
        if not predicate_label:
            # Fall back to local name from the predicate URI
            if '#' in predicate_uri:
                predicate_label = predicate_uri.split('#')[-1]
            elif '/' in predicate_uri:
                predicate_label = predicate_uri.split('/')[-1]
            else:
                predicate_label = predicate_uri
        
        # Format the object value
        if isinstance(o, Literal):
            value = str(o)
            # Handle HTML entities like &apos;
            value = html.unescape(value)
            
            # Include datatype if it's not a simple string
            if o.datatype:
                datatype_uri = str(o.datatype)
                if datatype_uri != "http://www.w3.org/2001/XMLSchema#string":
                    # Get short form of datatype
                    if '#' in datatype_uri:
                        datatype = datatype_uri.split('#')[-1]
                    elif '/' in datatype_uri:
                        datatype = datatype_uri.split('/')[-1]  
                    else:
                        datatype = datatype_uri
                    value = f"{value} ({datatype})"
            
            # Include language tag if present
            if o.language:
                value = f"{value} @{o.language}"
                
        elif isinstance(o, BNode):
            continue  # Skip blank nodes for now
        else:
            # It's a URI reference
            value = str(o)
        
        annotations.append({
            "property": predicate_label,
            "property_uri": predicate_uri,
            "value": value,
            "is_uri": not isinstance(o, Literal)
        })
    
    # Sort annotations by property name for consistent display
    annotations.sort(key=lambda x: x["property"].lower())
    
    return annotations


def get_label_from_dataset(dataset, resource):
    """Get label for a resource from any graph in the dataset"""
    # Try rdfs:label first
    for _, _, label, _ in dataset.quads((resource, RDFS.label, None, None)):
        return str(label)
    
    # Fall back to local name extraction
    uri_str = str(resource)
    if '#' in uri_str:
        return uri_str.split('#')[-1]
    elif '/' in uri_str:
        return uri_str.split('/')[-1]
    else:
        return uri_str


def build_reverse_hierarchy_optimized(dataset, hierarchy, rel):
    """Optimized algorithm for reverse hierarchy (object_on_top=False)
    
    Uses SPARQL-style approach:
    1. Find roots using query equivalent to: SELECT ?root WHERE {?root rel ?something. FILTER NOT EXISTS {?something rel ?root}}
    2. Build tree recursively with visited tracking to avoid redundant work
    
    Args:
        dataset: RDF dataset containing graphs
        hierarchy: Pre-built hierarchy dict with all entities
        rel: Relationship predicate to use for hierarchy
    
    Returns:
        List of root entities with populated children
    """
    import sys
    
    # Step 1: Find root nodes using SPARQL-style logic
    # Root nodes are subjects of rel that are not objects of rel
    subjects_of_rel = set()
    objects_of_rel = set()
    
    for s, _, o, _ in dataset.quads((None, rel, None, None)):
        if not isinstance(s, BNode) and not isinstance(o, BNode):
            subjects_of_rel.add(str(s))
            objects_of_rel.add(str(o))
    
    # Roots are subjects that are not objects
    root_uris = subjects_of_rel - objects_of_rel
    
    # Step 2: Build tree with visited tracking
    visited_nodes = set()
    
    def build_tree_recursive(node_uri):
        """Recursively build tree for a node and its children"""
        if node_uri in visited_nodes:
            return  # Already processed this node
        
        visited_nodes.add(node_uri)
        
        if node_uri not in hierarchy:
            return  # Node not in our hierarchy dict
        
        # Find all children (objects where this node is the subject)
        children = []
        for s, _, o, _ in dataset.quads((None, rel, None, None)):
            if str(s) == node_uri and not isinstance(o, BNode):
                child_uri = str(o)
                if child_uri in hierarchy:
                    children.append(child_uri)
        
        # Add children to hierarchy and recurse
        for child_uri in children:
            if child_uri not in visited_nodes:
                # Add child to parent's children list
                existing_child_uris = {child["uri"] for child in hierarchy[node_uri]["children"]}
                if child_uri not in existing_child_uris:
                    hierarchy[node_uri]["children"].append(hierarchy[child_uri])
                
                # Recursively build tree for child
                build_tree_recursive(child_uri)
    
    # Step 3: Build tree for each root
    for root_uri in root_uris:
        if root_uri in hierarchy:
            build_tree_recursive(root_uri)
    
    # Step 4: Sort children alphabetically for each entity
    def sort_hierarchy(node):
        if node["children"]:
            node["children"].sort(key=lambda x: x["label"].lower())
            for child in node["children"]:
                sort_hierarchy(child)
    
    # Get root entities and sort them
    root_entities = [hierarchy[root_uri] for root_uri in root_uris if root_uri in hierarchy]
    root_entities.sort(key=lambda x: x["label"].lower())
    
    # Sort all children recursively
    for root in root_entities:
        sort_hierarchy(root)
    
    return root_entities


def build_hierarchy(dataset, types, rel, object_on_top=True):
    """Build a hierarchical tree structure from all graphs in dataset
    
    Args:
        dataset: RDF dataset containing graphs
        types: Array of RDF types to collect (e.g., [OWL.Class, RDFS.Class])
        rel: Relationship predicate to use for hierarchy (e.g., RDFS.subClassOf)
        object_on_top: If True, objects of rel are parents (default). If False, subjects are parents.
    """
    import sys
    
    # Collect entities and relationships from all graphs in the dataset
    all_entities = set()
    hierarchy = {}
    
    
    # First pass: collect all entities of specified types from the federated dataset
    for i, entity_type in enumerate(types):
        dataset_entities = {
            s for s, _, _, _ in dataset.quads((None, RDF.type, entity_type, None))
        }

        # Filter out blank nodes and deprecated entities
        non_blank_entities = {ent for ent in dataset_entities if not isinstance(ent, BNode)}
        non_deprecated_entities = {ent for ent in non_blank_entities if not is_deprecated(dataset, ent)}
        
        all_entities.update(non_deprecated_entities)
    
    
    
    # Build hierarchy entries for all entities
    for i, entity in enumerate(all_entities):
        if i % 50 == 0:  # Progress indicator every 50 entities
            pass
            
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
        
        # Get annotations for this entity
        annotations = get_annotations(dataset, entity)
        
        hierarchy[entity_str] = {
            "uri": entity_str,
            "label": label or entity_str.split('#')[-1].split('/')[-1],
            "children": [],
            "properties": properties,
            "annotations": annotations,
            "graph_source": graph_source or "unknown"
        }
    
        
    
    
    # Check if we should use optimized algorithm for reverse hierarchy
    if not object_on_top:
            return build_reverse_hierarchy_optimized(dataset, hierarchy, rel)
    
    # Traditional algorithm for object_on_top=True
    # Second pass: collect relationships from the entire dataset
    roots = set(all_entities)  # Start with all entities as potential roots
    
    for i, entity in enumerate(all_entities):
        if i % 50 == 0:  # Progress indicator every 50 entities
            pass
            
        entity_str = str(entity)
        
        # Look for the specified relationship in the entire dataset
        related_entities = [
            o for _, _, o, _ in dataset.quads((entity, rel, None, None))
        ]
        
        if related_entities:
            pass
        
        # Filter out owl:Thing and blank nodes
        meaningful_related = [r for r in related_entities if str(r) != str(OWL.Thing) and not isinstance(r, BNode)]
        
        if meaningful_related:
            # Traditional hierarchy: objects are parents of subjects
            roots.discard(entity)  # Remove from roots if it has parents
            for parent in meaningful_related:
                parent_str = str(parent)
                # Create parent entry if it doesn't exist
                if parent_str not in hierarchy:
                    from rdflib import URIRef
                    annotations = get_annotations(dataset, URIRef(parent_str))
                    hierarchy[parent_str] = {
                        "uri": parent_str,
                        "label": parent_str.split('#')[-1].split('/')[-1],
                        "children": [],
                        "properties": [],
                        "annotations": annotations,
                        "graph_source": "unknown"
                    }
                if entity_str in hierarchy:
                    # Avoid duplicates using URI comparison (much faster than object comparison)
                    existing_child_uris = {child["uri"] for child in hierarchy[parent_str]["children"]}
                    if entity_str not in existing_child_uris:
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
    return build_hierarchy(dataset, [OWL.Class, RDFS.Class], RDFS.subClassOf, object_on_top=True)


def build_import_hierarchy_from_dataset(dataset):
    """Build a hierarchical tree structure of ontology imports from all graphs in dataset"""
    import sys
    result = build_hierarchy(dataset, [OWL.Ontology], OWL.imports, object_on_top=False)
    return result