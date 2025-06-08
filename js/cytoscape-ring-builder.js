/**
 * Builds Cytoscape graph data using ring-based layout for multiple graphs
 */

import { calculateRingMatrixLayout, groupNodesByGraph } from './ring-layout.js';

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
  
  // Generate color schemes for each graph
  const graphUris = Object.keys(graphNodes);
  console.log('Ring layout: Found graph URIs:', graphUris);
  const colorSchemes = generateColorSchemes(graphUris.length);
  console.log('Ring layout: Generated color schemes:', colorSchemes);
  const graphColorMap = {};
  graphUris.forEach((uri, index) => {
    graphColorMap[uri] = colorSchemes[index];
  });
  console.log('Ring layout: Graph color map:', graphColorMap);
  
  // Calculate ring matrix layout positions
  const layoutPositions = calculateRingMatrixLayout(hierarchy, graphNodes);
  
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
    
    // Only add the node itself if not already processed
    if (processedClasses.has(node.uri)) {
      return;
    }
    processedClasses.add(node.uri);
    
    // Add class node with ring layout position and color scheme
    const position = layoutPositions[node.uri] || { x: 0, y: 0 };
    const nodeCategory = categorizeNode(node.uri, rootNodeUris, descendantOfRootUris);
    const graphSource = node.graph_source || 'unknown';
    console.log(`Node ${node.label} has graph_source: ${graphSource}`);
    const colorScheme = graphColorMap[graphSource] || { root: '#28A745', descendant: '#4A90E2', orphaned: '#D8A7CA' };
    console.log(`Using color scheme for ${graphSource}:`, colorScheme);
    
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
    
    // Add property edges (solid lines) - these will be added after all nodes are positioned
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
  
  return { nodes, edges, graphNodes, graphColorMap };
}

/**
 * Generate distinct color schemes for multiple graphs
 * @param {number} numGraphs - Number of graphs to generate colors for
 * @returns {Array} Array of color scheme objects
 */
function generateColorSchemes(numGraphs) {
  // Base colors distributed around the color wheel for maximum distinction
  const baseHues = [];
  for (let i = 0; i < numGraphs; i++) {
    baseHues.push((i * 360) / numGraphs);
  }
  
  return baseHues.map(hue => {
    // Generate HSL colors with different saturations for root vs descendant
    const rootSaturation = 80;     // More saturated for roots
    const descendantSaturation = 60; // Less saturated for descendants
    const orphanedSaturation = 40;   // Even less for orphaned nodes
    const lightness = 50;           // Consistent lightness
    
    return {
      root: `hsl(${hue}, ${rootSaturation}%, ${lightness}%)`,
      descendant: `hsl(${hue}, ${descendantSaturation}%, ${lightness}%)`,
      orphaned: `hsl(${hue}, ${orphanedSaturation}%, ${lightness}%)`
    };
  });
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