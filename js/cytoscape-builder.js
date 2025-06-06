/**
 * Builds Cytoscape graph data from class hierarchy
 */

import { calculateHierarchicalLayout } from './layout.js';

/**
 * Build Cytoscape graph data from class hierarchy
 * @param {Array} hierarchy - Array of root class nodes
 * @returns {Object} Object containing nodes and edges arrays for Cytoscape
 */
export function buildCytoscapeData(hierarchy) {
  const nodes = [];
  const edges = [];
  const processedClasses = new Set();
  
  // Track which nodes are roots
  const rootNodeUris = new Set(hierarchy.map(root => root.uri));
  
  // Track which nodes are descendants of roots (subclass* of roots)
  const descendantOfRootUris = new Set();
  
  function markDescendants(node) {
    descendantOfRootUris.add(node.uri);
    if (node.children) {
      node.children.forEach(child => markDescendants(child));
    }
  }
  
  // Mark all descendants of all roots
  hierarchy.forEach(root => markDescendants(root));
  
  // Calculate custom layout positions
  const layoutPositions = calculateHierarchicalLayout(hierarchy);
  
  // Recursively process hierarchy to collect all classes
  function processNode(node) {
    // Always process children first, regardless of whether this node was already processed
    // Add subclass edges (dotted lines)
    if (node.children && node.children.length > 0) {
      node.children.forEach(child => {
        const edgeId = `subclass_${child.uri}_${node.uri}`;
        edges.push({
          data: {
            id: edgeId,
            source: child.uri,
            target: node.uri,
            type: 'subclass',
            label: 'subClassOf'
          }
        });
        processNode(child);
      });
    }
    
    // Only add the node itself if not already processed
    if (processedClasses.has(node.uri)) {
      return;
    }
    processedClasses.add(node.uri);
    
    // Add class node with custom position
    const position = layoutPositions[node.uri] || { x: 0, y: 0 };
    const nodeCategory = categorizeNode(node.uri, rootNodeUris, descendantOfRootUris);
    
    nodes.push({
      data: {
        id: node.uri,
        label: node.label,
        type: 'class',
        category: nodeCategory
      },
      position: position
    });
    
    // Add property edges (solid lines)
    if (node.properties && node.properties.length > 0) {
      node.properties.forEach(prop => {
        prop.ranges.forEach(range => {
          edges.push({
            data: {
              id: `property_${node.uri}_${range.uri}_${prop.uri}`,
              source: node.uri,
              target: range.uri,
              type: 'property',
              label: prop.label,
              propertyUri: prop.uri
            }
          });
          
          // Ensure range class is included as a node if not already processed
          if (!processedClasses.has(range.uri)) {
            const position = layoutPositions[range.uri] || { x: Math.random() * 400 - 200, y: Math.random() * 200 + 300 };
            const nodeCategory = categorizeNode(range.uri, rootNodeUris, descendantOfRootUris);
            
            nodes.push({
              data: {
                id: range.uri,
                label: range.label,
                type: 'class',
                category: nodeCategory
              },
              position: position
            });
            processedClasses.add(range.uri);
          }
        });
      });
    }
  }
  
  // Process all root nodes
  hierarchy.forEach(processNode);
  
  return { nodes, edges };
}

/**
 * Categorize a node based on its relationship to the hierarchy
 * @param {string} nodeUri - URI of the node to categorize
 * @param {Set} rootNodeUris - Set of root node URIs
 * @param {Set} descendantOfRootUris - Set of descendant node URIs
 * @returns {string} Node category: 'root', 'descendant', or 'orphaned'
 */
function categorizeNode(nodeUri, rootNodeUris, descendantOfRootUris) {
  if (rootNodeUris.has(nodeUri)) {
    return 'root';
  } else if (descendantOfRootUris.has(nodeUri)) {
    return 'descendant';
  } else {
    return 'orphaned';
  }
}