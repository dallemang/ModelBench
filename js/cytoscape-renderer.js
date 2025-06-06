/**
 * Handles Cytoscape rendering and styling
 */

import { buildCytoscapeData } from './cytoscape-builder.js';

// Global Cytoscape instance
let cytoscapeInstance = null;

/**
 * Create and configure Cytoscape instance
 * @param {Array} hierarchy - Class hierarchy data
 * @returns {Object} Cytoscape instance or null if failed
 */
export function createClassDiagram(hierarchy) {
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
  
  const { nodes, edges } = buildCytoscapeData(hierarchy);
  console.log('Building cytoscape with', nodes.length, 'nodes and', edges.length, 'edges');
  
  try {
    cytoscapeInstance = cytoscape({
      container: container,
      elements: [...nodes, ...edges],
      style: getCytoscapeStyle(),
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
 * Get Cytoscape styling configuration
 * @returns {Array} Cytoscape style array
 */
function getCytoscapeStyle() {
  return [
    // Root class nodes (green bubbles)
    {
      selector: 'node[type="class"][category="root"]',
      style: {
        'background-color': '#28A745',
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
        'border-color': '#1E7E34',
        'text-outline-width': '1px',
        'text-outline-color': '#1E7E34'
      }
    },
    // Descendant class nodes (blue bubbles)
    {
      selector: 'node[type="class"][category="descendant"]',
      style: {
        'background-color': '#4A90E2',
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
        'border-color': '#2E5A87',
        'text-outline-width': '1px',
        'text-outline-color': '#2E5A87'
      }
    },
    // Orphaned class nodes (dusty pink bubbles)
    {
      selector: 'node[type="class"][category="orphaned"]',
      style: {
        'background-color': '#D8A7CA',
        'color': 'black',
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
        'border-color': '#B85C91',
        'text-outline-width': '1px',
        'text-outline-color': '#B85C91'
      }
    },
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
  ];
}
