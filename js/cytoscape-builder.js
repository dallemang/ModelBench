/**
 * Builds Cytoscape graph data from class hierarchy
 */

import { calculateHierarchicalLayout } from './layout.js';

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
    // Avoid pure red (0-20 degrees) - skip to red-orange instead
    let adjustedHue = hue;
    if (hue >= 0 && hue <= 20) {
      adjustedHue = 25; // Red-orange instead of red
    }
    
    // Generate pale HSL colors with high lightness for better readability
    const rootSaturation = 60;     // More saturated for roots (reduced from 80)
    const descendantSaturation = 45; // Less saturated for descendants (reduced from 60)
    const orphanedSaturation = 30;   // Even less for orphaned nodes (reduced from 40)
    const lightness = 75;           // Much lighter for pale colors (increased from 50)
    
    return {
      root: `hsl(${adjustedHue}, ${rootSaturation}%, ${lightness}%)`,
      descendant: `hsl(${adjustedHue}, ${descendantSaturation}%, ${lightness}%)`,
      orphaned: `hsl(${adjustedHue}, ${orphanedSaturation}%, ${lightness}%)`
    };
  });
}

/**
 * Group nodes by graph source for color assignment
 * @param {Array} hierarchy - Array of root nodes
 * @returns {Object} Map of graph sources to color schemes
 */
function assignColorsToGraphs(hierarchy) {
  // Collect unique graph sources
  const graphSources = new Set();
  
  function collectGraphSources(node) {
    if (node.graph_source) {
      graphSources.add(node.graph_source);
    }
    if (node.children) {
      node.children.forEach(child => collectGraphSources(child));
    }
  }
  
  hierarchy.forEach(root => collectGraphSources(root));
  
  // Generate color schemes
  const graphSourcesList = Array.from(graphSources);
  const colorSchemes = generateColorSchemes(graphSourcesList.length);
  
  // Create mapping
  const colorMap = {};
  graphSourcesList.forEach((source, index) => {
    colorMap[source] = colorSchemes[index] || { root: '#28A745', descendant: '#4A90E2', orphaned: '#D8A7CA' };
  });
  
  return colorMap;
}

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
  
  // Generate color schemes for different graphs
  const graphColorMap = assignColorsToGraphs(hierarchy);
  
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
    
    // Add class node with custom position and color scheme
    const position = layoutPositions[node.uri] || { x: 0, y: 0 };
    const nodeCategory = categorizeNode(node.uri, rootNodeUris, descendantOfRootUris);
    const graphSource = node.graph_source || 'unknown';
    const colorScheme = graphColorMap[graphSource] || { root: '#28A745', descendant: '#4A90E2', orphaned: '#D8A7CA' };
    
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