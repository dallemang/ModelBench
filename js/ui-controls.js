/**
 * UI interaction handlers and controls
 */

import { getCytoscapeInstance, resetDiagramLayout, fitDiagram, createClassDiagram } from './cytoscape-renderer.js';

/**
 * Switch between tabs
 * @param {string} tabName - Name of the tab to switch to
 */
export function switchTab(tabName) {
  
  // Remove active class from all tab buttons and panes
  document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.remove('active');
    pane.classList.remove('diagram-active');
  });
  
  // Remove diagram-active class from tab-content
  document.querySelector('.tab-content').classList.remove('diagram-active');
  
  // Add active class to clicked tab button and corresponding pane
  document.querySelector(`button[onclick="switchTab('${tabName}')"]`).classList.add('active');
  const activePane = document.getElementById(`tab-${tabName}`);
  activePane.classList.add('active');
  
  // If switching to diagram tab, make it full size
  if (tabName === 'diagram') {
    activePane.classList.add('diagram-active');
    document.querySelector('.tab-content').classList.add('diagram-active');
    
    // If diagram hasn't been created yet, create it now that the container is visible
    if (window.pendingDiagramData) {
      const layoutType = getCurrentLayoutType();
      createClassDiagram(window.pendingDiagramData, layoutType);
      window.pendingDiagramData = null;
      setTimeout(() => fitDiagram(), 200);
    } else {
      const cytoscapeInstance = getCytoscapeInstance();
      if (cytoscapeInstance) {
        cytoscapeInstance.resize();
        setTimeout(() => fitDiagram(), 200);
      }
    }
  }
  
  // If switching to AI tab, initialize AI interface
  if (tabName === 'ai' && window.initAI && !window.aiInitialized) {
    setTimeout(() => {
      window.initAI();
      window.aiInitialized = true;
    }, 100);
  }
}

/**
 * Reset diagram layout - wrapper for the renderer function
 */
export function resetLayout() {
  resetDiagramLayout();
}

/**
 * Fit diagram to screen - wrapper for the renderer function  
 */
export function fitToScreen() {
  fitDiagram();
}

/**
 * Debug diagram data - logs current state to console
 */
export function debugDiagramData() {
  console.log('=== DIAGRAM DEBUG INFO ===');
  
  // Get global state from main module
  const classData = window.getClassData ? window.getClassData() : {};
  const namespaces = window.getNamespaces ? window.getNamespaces() : {};
  
  console.log('Class Data:', classData);
  console.log('Namespaces:', namespaces);
  console.log('Current Layout Type:', window.currentLayoutType || 'rings');
  
  const cytoscapeInstance = getCytoscapeInstance();
  if (cytoscapeInstance) {
    console.log('Cytoscape Nodes:', cytoscapeInstance.nodes().map(n => ({ id: n.id(), data: n.data() })));
    console.log('Cytoscape Edges:', cytoscapeInstance.edges().map(e => ({ id: e.id(), data: e.data(), source: e.source().id(), target: e.target().id() })));
  } else {
    console.log('No Cytoscape instance found');
  }
  console.log('=== END DEBUG INFO ===');
}

// Global state for layout type
let currentLayoutType = 'rings';
let currentHierarchyData = null;

/**
 * Set layout type from the dropdown
 * @param {string} layoutType - 'rings', 'traditional', or 'topdown'
 */
export function setLayoutType(layoutType) {
  currentLayoutType = layoutType;
  window.currentLayoutType = currentLayoutType;

  if (currentHierarchyData) {
    createClassDiagram(currentHierarchyData, currentLayoutType);
    setTimeout(() => fitDiagram(), 500);
  }
}

/**
 * Store hierarchy data for layout switching
 * @param {Array} hierarchyData - The hierarchy data
 * @param {string} [type] - 'import' to skip storing (import hierarchy should not affect diagram toggle)
 */
export function setHierarchyData(hierarchyData, type) {
  if (type === 'import') return;
  currentHierarchyData = hierarchyData;
}

/**
 * Get current layout type
 * @returns {string} Current layout type
 */
export function getCurrentLayoutType() {
  return currentLayoutType;
}