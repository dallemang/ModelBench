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
  
  // Add interaction handlers for editing
  addEditingHandlers(cytoscapeInstance);
  
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
        'color': 'black',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': '120px',
        'height': '40px',
        'shape': 'rectangle',
        'border-width': '3px',
        'border-color': darkenColor(scheme.root),
        'text-outline-width': '0px',
        'text-outline-color': darkenColor(scheme.root)
      }
    });
    
    // Descendant nodes for this graph
    styles.push({
      selector: `node[type="class"][category="descendant"][graph_source="${graphSource}"]`,
      style: {
        'background-color': scheme.descendant,
        'color': 'black',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': '120px',
        'height': '40px',
        'shape': 'rectangle',
        'border-width': '2px',
        'border-color': darkenColor(scheme.descendant),
        'text-outline-width': '0px',
        'text-outline-color': darkenColor(scheme.descendant)
      }
    });
    
    // Orphaned nodes for this graph
    styles.push({
      selector: `node[type="class"][category="orphaned"][graph_source="${graphSource}"]`,
      style: {
        'background-color': scheme.orphaned,
        'color': 'black',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': '120px',
        'height': '40px',
        'shape': 'rectangle',
        'border-width': '2px',
        'border-color': darkenColor(scheme.orphaned),
        'text-outline-width': '0px',
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
          return scheme ? scheme.root : '#28A745';
        },
        'border-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? darkenColor(scheme.root) : '#1E7E34';
        },
        'text-outline-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? darkenColor(scheme.root) : '#1E7E34';
        },
        'color': 'black',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': '120px',
        'height': '40px',
        'shape': 'rectangle',
        'border-width': '3px',
        'text-outline-width': '0px'
      }
    },
    {
      selector: 'node[type="class"][category="descendant"]',
      style: {
        'background-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? scheme.descendant : '#4A90E2';
        },
        'border-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? darkenColor(scheme.descendant) : '#2E5A87';
        },
        'text-outline-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? darkenColor(scheme.descendant) : '#2E5A87';
        },
        'color': 'black',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': '120px',
        'height': '40px',
        'shape': 'rectangle',
        'border-width': '2px',
        'text-outline-width': '0px'
      }
    },
    {
      selector: 'node[type="class"][category="orphaned"]',
      style: {
        'background-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? scheme.orphaned : '#D8A7CA';
        },
        'border-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? darkenColor(scheme.orphaned) : '#B85C91';
        },
        'text-outline-color': function(ele) {
          const scheme = ele.data('color_scheme');
          return scheme ? darkenColor(scheme.orphaned) : '#B85C91';
        },
        'color': 'black',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': '120px',
        'height': '40px',
        'shape': 'rectangle',
        'border-width': '2px',
        'text-outline-width': '0px'
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
        'line-color': '#333333',
        'target-arrow-color': '#333333',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'arrow-scale': 1.2,
        'label': 'data(label)',
        'font-size': '15px',
        'text-rotation': 'autorotate',
        'text-margin-y': -10,
        'color': '#333333',
        'text-outline-width': 0,
        'text-outline-color': 'transparent'
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

/**
 * Add editing handlers for creating subclass relationships
 * @param {Object} cy - Cytoscape instance
 */
function addEditingHandlers(cy) {
  let tempEdge = null;
  let sourceNode = null;
  const handles = new Map(); // Store handles for each node
  
  // Create handles for all nodes initially
  function createHandles() {
    cy.nodes('[type="class"]').forEach(node => {
      const handle = document.createElement('div');
      handle.style.position = 'absolute';
      handle.style.width = '8px';
      handle.style.height = '8px';
      handle.style.backgroundColor = '#FF6B6B';
      handle.style.border = '1px solid #FF4757';
      handle.style.borderRadius = '50%';
      handle.style.cursor = 'crosshair';
      handle.style.zIndex = '1000';
      handle.style.pointerEvents = 'all';
      handle.title = 'Drag to create subClassOf relationship';
      
      // Position handle just outside the right edge of the node
      const renderedPosition = node.renderedPosition();
      handle.style.left = (renderedPosition.x + 65) + 'px'; // Just outside node boundary
      handle.style.top = (renderedPosition.y - 4) + 'px';   // Center vertically
      
      document.getElementById('cytoscape-container').appendChild(handle);
      handles.set(node.id(), handle);
      
      // Handle drag start
      handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation(); // Prevent node drag
        sourceNode = node;
        
        console.log('Handle clicked, starting drag from:', node.data('label'));
        
        // Disable node dragging temporarily
        cy.autoungrabify(true);
        
        // Create a temporary target node at the handle position first
        const nodePosition = node.position();
        const tempTarget = cy.add({
          group: 'nodes',
          data: { id: 'temp-mouse-target' },
          position: { x: nodePosition.x + 100, y: nodePosition.y }, // Start slightly offset
          style: {
            'opacity': 0,
            'width': 1,
            'height': 1
          }
        });
        
        // Create temporary edge for visual feedback
        tempEdge = cy.add({
          group: 'edges',
          data: {
            id: 'temp-edge',
            source: node.id(),
            target: 'temp-mouse-target',
            type: 'temp-subclass'
          }
        });
        
        console.log('Temporary edge created:', tempEdge.id());
        
        // Add temporary edge style
        tempEdge.style({
          'line-color': '#FF6B6B',
          'target-arrow-color': '#FF6B6B',
          'target-arrow-shape': 'triangle',
          'line-style': 'dashed',
          'width': 3,
          'opacity': 0.7
        });
        
        console.log('Temporary edge styled');
        
        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', handleDrop);
      });
    });
  }
  
  // Update handle positions
  function updateHandlePositions() {
    handles.forEach((handle, nodeId) => {
      const node = cy.getElementById(nodeId);
      if (node.length > 0) {
        const renderedPosition = node.renderedPosition();
        handle.style.left = (renderedPosition.x + 65) + 'px';
        handle.style.top = (renderedPosition.y - 4) + 'px';
      }
    });
  }
  
  // Create initial handles
  createHandles();
  
  function handleDrag(e) {
    console.log('Handle drag event');
    if (tempEdge && sourceNode) {
      console.log('Processing drag with temp edge');
      const container = document.getElementById('cytoscape-container');
      const containerRect = container.getBoundingClientRect();
      const cyPosition = {
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top
      };
      
      // Convert screen coordinates to cytoscape model coordinates
      const pan = cy.pan();
      const zoom = cy.zoom();
      const modelX = (cyPosition.x - pan.x) / zoom;
      const modelY = (cyPosition.y - pan.y) / zoom;
      console.log('Mouse position:', cyPosition, 'Model position:', {x: modelX, y: modelY});
      
      // Find if we're over a target node (excluding temporary nodes)
      const targetNode = cy.nodes('[type="class"]').filter(node => {
        if (node.id() === sourceNode.id() || node.id() === 'temp-mouse-target') {
          return false; // Exclude source node and temp target
        }
        
        const renderedPos = node.renderedPosition();
        const nodeWidth = 120;
        const nodeHeight = 40;
        
        return cyPosition.x >= renderedPos.x - nodeWidth/2 &&
               cyPosition.x <= renderedPos.x + nodeWidth/2 &&
               cyPosition.y >= renderedPos.y - nodeHeight/2 &&
               cyPosition.y <= renderedPos.y + nodeHeight/2;
      });
      
      if (targetNode.length > 0 && targetNode[0].id() !== sourceNode.id()) {
        console.log('Over target node:', targetNode[0].data('label'));
        // Update temp edge target to the actual node
        tempEdge.move({ target: targetNode[0].id() });
        tempEdge.style('line-color', '#4ECDC4'); // Green when over valid target
        tempEdge.style('target-arrow-color', '#4ECDC4');
      } else {
        console.log('Over empty space, creating mouse target');
        // Create or update temporary target node at mouse position
        let mouseTarget = cy.getElementById('temp-mouse-target');
        if (mouseTarget.length === 0) {
          mouseTarget = cy.add({
            group: 'nodes',
            data: { id: 'temp-mouse-target' },
            position: { x: modelX, y: modelY },
            style: {
              'opacity': 0,
              'width': 1,
              'height': 1
            }
          });
          console.log('Created mouse target node');
        } else {
          mouseTarget.position({ x: modelX, y: modelY });
          console.log('Updated mouse target position');
        }
        
        tempEdge.move({ target: 'temp-mouse-target' });
        tempEdge.style('line-color', '#FF6B6B'); // Red when invalid
        tempEdge.style('target-arrow-color', '#FF6B6B');
      }
    } else {
      console.log('No temp edge or source node');
    }
  }
  
  function handleDrop(e) {
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', handleDrop);
    
    if (tempEdge && sourceNode) {
      const container = document.getElementById('cytoscape-container');
      const containerRect = container.getBoundingClientRect();
      const cyPosition = {
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top
      };
      
      // Find target node
      const targetNode = cy.nodes().filter(node => {
        const renderedPos = node.renderedPosition();
        const nodeWidth = 120;
        const nodeHeight = 40;
        
        return cyPosition.x >= renderedPos.x - nodeWidth/2 &&
               cyPosition.x <= renderedPos.x + nodeWidth/2 &&
               cyPosition.y >= renderedPos.y - nodeHeight/2 &&
               cyPosition.y <= renderedPos.y + nodeHeight/2;
      });
      
      if (targetNode.length > 0 && targetNode[0].id() !== sourceNode.id()) {
        // Create permanent subclass edge
        const edgeId = `subclass_${sourceNode.id()}_${targetNode[0].id()}`;
        
        // Check if edge already exists
        const existingEdge = cy.getElementById(edgeId);
        if (existingEdge.length === 0) {
          cy.add({
            group: 'edges',
            data: {
              id: edgeId,
              source: sourceNode.id(),
              target: targetNode[0].id(),
              type: 'subclass',
              label: 'subClassOf'
            }
          });
          
          console.log(`Created subclass relationship: ${sourceNode.data('label')} subClassOf ${targetNode[0].data('label')}`);
        }
      }
      
      // Clean up temporary elements
      tempEdge.remove();
      tempEdge = null;
      sourceNode = null;
      
      // Remove temporary mouse target node
      const mouseTarget = cy.getElementById('temp-mouse-target');
      if (mouseTarget.length > 0) {
        mouseTarget.remove();
      }
    }
    
    // Re-enable node dragging
    cy.autoungrabify(false);
  }
  
  // Update handle positions when nodes move or zoom changes
  cy.on('position zoom pan', function() {
    updateHandlePositions();
  });
}
