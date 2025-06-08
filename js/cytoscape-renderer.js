/**
 * Handles Cytoscape rendering and styling
 */

import { buildCytoscapeData } from './cytoscape-builder.js';
import { buildCytoscapeDataWithRings } from './cytoscape-ring-builder.js';

// Global Cytoscape instance
let cytoscapeInstance = null;

/**
 * Create and configure Cytoscape instance
 * @param {Array} hierarchy - Class hierarchy data
 * @param {string} layoutType - Layout type: 'traditional' or 'rings'
 * @returns {Object} Cytoscape instance or null if failed
 */
export function createClassDiagram(hierarchy, layoutType = 'rings') {
  console.log('createClassDiagram called with hierarchy:', hierarchy.length, 'nodes');
  
  const container = document.getElementById('cytoscape-container');
  
  if (!container) {
    console.error('Cytoscape container not found!');
    return null;
  }
  
  // Check if Cytoscape library is loaded
  if (typeof cytoscape === 'undefined') {
    console.error('Cytoscape library not loaded!');
    return null;
  }
  
  // Clear existing instance
  if (cytoscapeInstance) {
    console.log('Destroying existing cytoscape instance');
    cytoscapeInstance.destroy();
    cytoscapeInstance = null;
    console.log('Instance set to null after destroy');
  }
  
  // Choose the appropriate builder based on layout type
  let graphData;
  if (layoutType === 'rings') {
    graphData = buildCytoscapeDataWithRings(hierarchy);
    console.log('Building cytoscape with ring layout:', graphData.nodes.length, 'nodes and', graphData.edges.length, 'edges');
    if (graphData.graphNodes) {
      console.log('Ring layout organized', Object.keys(graphData.graphNodes).length, 'graphs:', Object.keys(graphData.graphNodes));
    }
  } else {
    graphData = buildCytoscapeData(hierarchy);
    console.log('Building cytoscape with traditional layout:', graphData.nodes.length, 'nodes and', graphData.edges.length, 'edges');
  }
  
  const { nodes, edges } = graphData;
  
  try {
    cytoscapeInstance = cytoscape({
      container: container,
      elements: [...nodes, ...edges],
      style: getCytoscapeStyle(nodes),
      layout: {
        name: 'preset',
        animate: true,
        animationDuration: 1000
      },
      wheelSensitivity: 0.1,
      minZoom: 0.1,
      maxZoom: 3
    });
  } catch (error) {
    console.error('Error creating cytoscape instance:', error);
    cytoscapeInstance = null;
    return null;
  }
  
  // Fit to container after layout
  cytoscapeInstance.ready(() => {
    setTimeout(() => {
      cytoscapeInstance.fit();
      cytoscapeInstance.center();
    }, 100);
  });
  
  
  return cytoscapeInstance;
}

/**
 * Get the current Cytoscape instance
 * @returns {Object|null} Current Cytoscape instance
 */
export function getCytoscapeInstance() {
  console.log('getCytoscapeInstance called, returning:', !!cytoscapeInstance);
  return cytoscapeInstance;
}

/**
 * Reset diagram layout to original positions
 */
export function resetDiagramLayout() {
  if (cytoscapeInstance) {
    cytoscapeInstance.layout({
      name: 'preset',
      animate: true,
      animationDuration: 1000
    }).run();
  }
}

/**
 * Fit diagram to screen with slight zoom reduction
 */
export function fitDiagram() {
  if (cytoscapeInstance) {
    cytoscapeInstance.fit();
    cytoscapeInstance.center();
    
    // Reduce zoom by 10% to make it smaller
    const currentZoom = cytoscapeInstance.zoom();
    cytoscapeInstance.zoom(currentZoom * 0.9);
    cytoscapeInstance.center();
  }
}

/**
 * Get Cytoscape styling configuration with dynamic colors
 * @param {Array} nodes - Array of node objects with color scheme data
 * @returns {Array} Cytoscape style array
 */
function getCytoscapeStyle(nodes = []) {
  const styles = [];
  
  // Collect unique color schemes from nodes
  const colorSchemes = new Map();
  nodes.forEach(node => {
    if (node.data.color_scheme && node.data.graph_source) {
      colorSchemes.set(node.data.graph_source, node.data.color_scheme);
    }
  });
  
  // Generate specific selectors for each graph's color scheme
  colorSchemes.forEach((scheme, graphSource) => {
    // Root nodes for this graph
    styles.push({
      selector: `node[type="class"][category="root"][graph_source="${graphSource}"]`,
      style: {
        'background-color': scheme.root,
        'color': 'white',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': '80px',
        'height': '80px',
        'shape': 'ellipse',
        'border-width': '3px',
        'border-color': darkenColor(scheme.root),
        'text-outline-width': '1px',
        'text-outline-color': darkenColor(scheme.root)
      }
    });
    
    // Descendant nodes for this graph
    styles.push({
      selector: `node[type="class"][category="descendant"][graph_source="${graphSource}"]`,
      style: {
        'background-color': scheme.descendant,
        'color': 'white',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': '80px',
        'height': '80px',
        'shape': 'ellipse',
        'border-width': '2px',
        'border-color': darkenColor(scheme.descendant),
        'text-outline-width': '1px',
        'text-outline-color': darkenColor(scheme.descendant)
      }
    });
    
    // Orphaned nodes for this graph
    styles.push({
      selector: `node[type="class"][category="orphaned"][graph_source="${graphSource}"]`,
      style: {
        'background-color': scheme.orphaned,
        'color': 'white',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': '80px',
        'height': '80px',
        'shape': 'ellipse',
        'border-width': '2px',
        'border-color': darkenColor(scheme.orphaned),
        'text-outline-width': '1px',
        'text-outline-color': darkenColor(scheme.orphaned)
      }
    });
  });
  
  // Fallback styles for nodes without color schemes (traditional layout)
  // Note: Cytoscape doesn't support :not([attribute]) syntax, so we use a general fallback
  styles.push(
    {
      selector: 'node[type="class"][category="root"]',
      style: {
        'background-color': function(ele) {
          const scheme = ele.data('color_scheme');
          const graphSource = ele.data('graph_source');
          const color = scheme ? scheme.root : '#28A745';
          console.log(`Root node ${ele.data('label')} from ${graphSource} using color:`, color);
          return color;
        },
        'border-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? darkenColor(scheme.root) : '#1E7E34';
        },
        'text-outline-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? darkenColor(scheme.root) : '#1E7E34';
        },
        'color': 'white',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': '80px',
        'height': '80px',
        'shape': 'ellipse',
        'border-width': '3px',
        'text-outline-width': '1px'
      }
    },
    {
      selector: 'node[type="class"][category="descendant"]',
      style: {
        'background-color': function(ele) {
          const scheme = ele.data('color_scheme');
          const graphSource = ele.data('graph_source');
          const color = scheme ? scheme.descendant : '#4A90E2';
          console.log(`Descendant node ${ele.data('label')} from ${graphSource} using color:`, color);
          return color;
        },
        'border-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? darkenColor(scheme.descendant) : '#2E5A87';
        },
        'text-outline-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? darkenColor(scheme.descendant) : '#2E5A87';
        },
        'color': 'white',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': '80px',
        'height': '80px',
        'shape': 'ellipse',
        'border-width': '2px',
        'text-outline-width': '1px'
      }
    },
    {
      selector: 'node[type="class"][category="orphaned"]',
      style: {
        'background-color': function(ele) {
          const scheme = ele.data('color_scheme');
          const graphSource = ele.data('graph_source');
          const color = scheme ? scheme.orphaned : '#D8A7CA';
          console.log(`Orphaned node ${ele.data('label')} from ${graphSource} using color:`, color);
          return color;
        },
        'border-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? darkenColor(scheme.orphaned) : '#B85C91';
        },
        'text-outline-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? darkenColor(scheme.orphaned) : '#B85C91';
        },
        'color': 'white',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': '80px',
        'height': '80px',
        'shape': 'ellipse',
        'border-width': '2px',
        'text-outline-width': '1px'
      }
    }
  );
  
  // Add edge styles
  styles.push(
    // Subclass edges (dotted lines)
    {
      selector: 'edge[type="subclass"]',
      style: {
        'width': 2,
        'line-color': '#333',
        'line-style': 'dashed',
        'target-arrow-color': '#333',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'arrow-scale': 1.2,
        'line-dash-pattern': [6, 3],
        'line-dash-offset': 0
      }
    },
    // Property edges (solid lines with labels)
    {
      selector: 'edge[type="property"]',
      style: {
        'width': 2,
        'line-color': '#E74C3C',
        'target-arrow-color': '#E74C3C',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'arrow-scale': 1.2,
        'label': 'data(label)',
        'font-size': '10px',
        'text-rotation': 'autorotate',
        'text-margin-y': -10,
        'color': '#E74C3C',
        'text-outline-width': 1,
        'text-outline-color': 'white'
      }
    }
  );
  
  return styles;
}

/**
 * Darken a color for borders and outlines
 * @param {string} color - CSS color string
 * @returns {string} Darkened color
 */
function darkenColor(color) {
  // Simple darkening by reducing lightness in HSL
  if (color.startsWith('hsl(')) {
    return color.replace(/(\d+)%\)$/, (match, lightness) => {
      const newLightness = Math.max(20, parseInt(lightness) - 20);
      return `${newLightness}%)`;
    });
  }
  // Fallback for non-HSL colors
  return color;
}
