/**
 * Shared color utilities for coordinating colors across hierarchy and diagram
 */

/**
 * Generate distinct color schemes for multiple graphs
 * @param {number} numGraphs - Number of graphs to generate colors for
 * @returns {Array} Array of color scheme objects
 */
export function generateColorSchemes(numGraphs) {
  // Use golden angle (~137.5°) to distribute hues maximally apart,
  // even for small numbers of graphs where even spacing can cluster.
  const goldenAngle = 137.508;
  const baseHues = [];
  for (let i = 0; i < numGraphs; i++) {
    baseHues.push((i * goldenAngle) % 360);
  }

  return baseHues.map(hue => {
    // Avoid pure red (0-20 degrees) - skip to red-orange instead
    let adjustedHue = hue;
    if (hue >= 0 && hue <= 20) {
      adjustedHue = 25; // Red-orange instead of red
    }

    // High saturation + moderate lightness for vivid, distinctive colors
    const rootSaturation = 70;
    const descendantSaturation = 55;
    const orphanedSaturation = 35;
    const rootLightness = 65;
    const descendantLightness = 72;
    const orphanedLightness = 78;

    return {
      root: `hsl(${adjustedHue}, ${rootSaturation}%, ${rootLightness}%)`,
      descendant: `hsl(${adjustedHue}, ${descendantSaturation}%, ${descendantLightness}%)`,
      orphaned: `hsl(${adjustedHue}, ${orphanedSaturation}%, ${orphanedLightness}%)`,
      // Darker versions for text (better contrast)
      rootText: `hsl(${adjustedHue}, ${rootSaturation + 20}%, ${rootLightness - 35}%)`,
      descendantText: `hsl(${adjustedHue}, ${descendantSaturation + 20}%, ${descendantLightness - 35}%)`,
      orphanedText: `hsl(${adjustedHue}, ${orphanedSaturation + 20}%, ${orphanedLightness - 35}%)`
    };
  });
}

/**
 * Group nodes by graph source and assign color schemes
 * @param {Array} hierarchy - Array of root nodes
 * @returns {Object} Map of graph sources to color schemes
 */
export function assignColorsToGraphs(hierarchy) {
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
    colorMap[source] = colorSchemes[index] || { 
      root: '#28A745', 
      descendant: '#4A90E2', 
      orphaned: '#D8A7CA',
      rootText: '#1E7E34',
      descendantText: '#2E5A87', 
      orphanedText: '#B85C91'
    };
  });
  
  return colorMap;
}

/**
 * Categorize a node based on its relationship to the hierarchy
 * @param {string} nodeUri - URI of the node to categorize
 * @param {Set} rootNodeUris - Set of root node URIs
 * @param {Set} descendantOfRootUris - Set of descendant node URIs
 * @returns {string} Node category: 'root', 'descendant', or 'orphaned'
 */
export function categorizeNode(nodeUri, rootNodeUris, descendantOfRootUris) {
  if (rootNodeUris.has(nodeUri)) {
    return 'root';
  } else if (descendantOfRootUris.has(nodeUri)) {
    return 'descendant';
  } else {
    return 'orphaned';
  }
}

/**
 * Get color for a specific node
 * @param {Object} node - Node object with uri, graph_source
 * @param {Object} graphColorMap - Map of graph sources to color schemes
 * @param {Set} rootNodeUris - Set of root node URIs
 * @param {Set} descendantOfRootUris - Set of descendant node URIs
 * @param {boolean} forText - Whether to get text color (darker) or background color
 * @param {string} context - Context for tracing (e.g., "DIAGRAM", "HIERARCHY")
 * @returns {string} CSS color string
 */
export function getNodeColor(node, graphColorMap, rootNodeUris, descendantOfRootUris, forText = false, context = "UNKNOWN") {
  const category = categorizeNode(node.uri, rootNodeUris, descendantOfRootUris);
  const graphSource = node.graph_source || 'unknown';
  const colorScheme = graphColorMap[graphSource];
  
  let color;
  if (!colorScheme) {
    // Fallback colors
    const fallbackColors = {
      root: forText ? '#1E7E34' : '#28A745',
      descendant: forText ? '#2E5A87' : '#4A90E2', 
      orphaned: forText ? '#B85C91' : '#D8A7CA'
    };
    color = fallbackColors[category];
  } else {
    if (forText) {
      color = colorScheme[category + 'Text'];
    } else {
      color = colorScheme[category];
    }
  }
  
  return color;
}