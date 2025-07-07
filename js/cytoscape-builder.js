/**
 * Builds Cytoscape graph data from class hierarchy
 */

import { calculateHierarchicalLayout, repositionOrphansNearConnections } from './layout.js';
import { assignColorsToGraphs, categorizeNode, getNodeColor } from './color-utils.js';


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
  
  const graphColorMap = window.currentGraphColorMap || assignColorsToGraphs(hierarchy);
  
  // Calculate custom layout positions
  let layoutPositions = calculateHierarchicalLayout(hierarchy);
  
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
    
    // Add class node with custom position and color scheme
    const position = layoutPositions[node.uri] || { x: 0, y: 0 };
    const nodeCategory = categorizeNode(node.uri, rootNodeUris, descendantOfRootUris);
    const graphSource = node.graph_source || 'unknown';
    const colorScheme = graphColorMap[graphSource] || { root: '#28A745', descendant: '#4A90E2', orphaned: '#D8A7CA' };
    
    // Get the actual color that will be used (for tracing)
    const nodeColor = getNodeColor(node, graphColorMap, rootNodeUris, descendantOfRootUris, false, "DIAGRAM");
    
    nodes.push({
      data: {
        id: node.uri,
        label: node.label,
        type: 'class',
        category: nodeCategory,
        graph_source: graphSource,
        color_scheme: colorScheme
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
            
            // Only use 'property_range' as graph_source if this node isn't in the main hierarchy
            // Check if this range URI exists in our hierarchy data
            let isInMainHierarchy = false;
            let hierarchyGraphSource = 'property_range';
            let hierarchyColorScheme = { root: '#6C757D', descendant: '#6C757D', orphaned: '#6C757D' };
            
            function findInHierarchy(node) {
              if (node.uri === range.uri) {
                isInMainHierarchy = true;
                hierarchyGraphSource = node.graph_source || 'unknown';
                hierarchyColorScheme = graphColorMap[hierarchyGraphSource] || hierarchyColorScheme;
                return true;
              }
              if (node.children) {
                return node.children.some(child => findInHierarchy(child));
              }
              return false;
            }
            
            hierarchy.forEach(root => findInHierarchy(root));
            
            nodes.push({
              data: {
                id: range.uri,
                label: range.label,
                type: 'class',
                category: nodeCategory,
                graph_source: hierarchyGraphSource,
                color_scheme: hierarchyColorScheme
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
  
  // Post-process: reposition orphans near their connected nodes
  layoutPositions = repositionOrphansNearConnections(layoutPositions, edges, nodes);
  
  // Update node positions with the repositioned layout
  nodes.forEach(node => {
    const newPosition = layoutPositions[node.data.id];
    if (newPosition) {
      node.position = newPosition;
    }
  });
  
  return { nodes, edges, graphColorMap };
}

