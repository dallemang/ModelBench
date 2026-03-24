/**
 * Builds Cytoscape graph data using ring-based layout for multiple graphs
 */

import { calculateRingMatrixLayout, groupNodesByGraph } from './ring-layout.js';
import { repositionOrphansNearConnections } from './layout.js';
import { assignColorsToGraphs, categorizeNode, getNodeColor } from './color-utils.js';

/**
 * Build Cytoscape graph data using ring layout for multiple graphs
 * @param {Array} hierarchy - Array of root class nodes with graph_source info
 * @returns {Object} Object containing nodes and edges arrays for Cytoscape
 */
export function buildCytoscapeDataWithRings(hierarchy) {
  const nodes = [];
  const edges = [];
  const processedClasses = new Set();
  
  // Track which nodes are roots
  const rootNodeUris = new Set(hierarchy.map(root => root.uri));
  
  // Track which nodes are descendants of roots
  const descendantOfRootUris = new Set();
  
  function markDescendants(node) {
    descendantOfRootUris.add(node.uri);
    if (node.children) {
      node.children.forEach(child => markDescendants(child));
    }
  }
  
  // Mark all descendants of all roots
  hierarchy.forEach(root => markDescendants(root));
  
  // Group nodes by their source graph
  const graphNodes = groupNodesByGraph(hierarchy);
  
  // Generate color schemes for each graph using shared utility
  const graphColorMap = assignColorsToGraphs(hierarchy);
  
  // Calculate ring matrix layout positions
  let layoutPositions = calculateRingMatrixLayout(hierarchy, graphNodes);
  
  // Track which nodes have had their properties processed (separate from node creation)
  const propertiesProcessed = new Set();

  // Recursively process hierarchy to collect all classes
  function processNode(node) {
    // Process children first and add subclass edges
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

    // Add the node itself if not already added
    if (!processedClasses.has(node.uri)) {
      processedClasses.add(node.uri);

      // Add class node with ring layout position and color scheme
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
    }

    // Always process properties when encountered in the hierarchy tree,
    // even if the node was already added (e.g. as a range of another property).
    // This ensures property edges are created for nodes that were first seen as ranges.
    if (propertiesProcessed.has(node.uri)) return;
    propertiesProcessed.add(node.uri);

    // Add property edges (solid lines) — skip datatype/XSD ranges
    const DATATYPE_NS = ['http://www.w3.org/2001/XMLSchema#',
                         'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
                         'http://www.w3.org/2000/01/rdf-schema#'];
    if (node.properties && node.properties.length > 0) {
      node.properties.forEach(prop => {
        prop.ranges.forEach(range => {
          if (DATATYPE_NS.some(ns => range.uri.startsWith(ns))) return;
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
            // Try to find position from layout, otherwise place near properties
            const position = layoutPositions[range.uri] || { 
              x: Math.random() * 400 - 200, 
              y: Math.random() * 200 + 500 
            };
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
  
  // Diagnostic: find edges with missing endpoints or duplicate IDs
  const nodeIds = new Set(nodes.map(n => n.data.id));
  const edgeIds = new Map();
  edges.forEach(e => {
    if (!nodeIds.has(e.data.source)) {
      console.warn(`[edge-check] Edge "${e.data.label || e.data.type}" (${e.data.id}) has missing SOURCE node: ${e.data.source}`);
    }
    if (!nodeIds.has(e.data.target)) {
      console.warn(`[edge-check] Edge "${e.data.label || e.data.type}" (${e.data.id}) has missing TARGET node: ${e.data.target}`);
    }
    if (edgeIds.has(e.data.id)) {
      console.warn(`[edge-check] DUPLICATE edge ID: "${e.data.id}" — label="${e.data.label}" vs earlier label="${edgeIds.get(e.data.id)}"`);
    }
    edgeIds.set(e.data.id, e.data.label || e.data.type);
  });

  // Check for edges involving "Class" specifically
  edges.forEach(e => {
    const srcLabel = nodes.find(n => n.data.id === e.data.source)?.data.label;
    const tgtLabel = nodes.find(n => n.data.id === e.data.target)?.data.label;
    if (srcLabel === 'Class' || tgtLabel === 'Class') {
      console.log(`[edge-check] Edge involving "Class": ${srcLabel} --[${e.data.label || e.data.type}]--> ${tgtLabel} (id: ${e.data.id})`);
    }
  });

  return { nodes, edges, graphNodes, graphColorMap };
}


