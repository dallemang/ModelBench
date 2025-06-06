/**
 * UI interaction handlers and controls
 */

import { getCytoscapeInstance, resetDiagramLayout, fitDiagram } from './cytoscape-renderer.js';

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
    
    const cytoscapeInstance = getCytoscapeInstance();
    if (cytoscapeInstance) {
      setTimeout(() => {
        cytoscapeInstance.resize();
        fitDiagram();
      }, 300);
    }
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
  
  const cytoscapeInstance = getCytoscapeInstance();
  if (cytoscapeInstance) {
    console.log('Cytoscape Nodes:', cytoscapeInstance.nodes().map(n => ({ id: n.id(), data: n.data() })));
    console.log('Cytoscape Edges:', cytoscapeInstance.edges().map(e => ({ id: e.id(), data: e.data(), source: e.source().id(), target: e.target().id() })));
  } else {
    console.log('No Cytoscape instance found');
  }
  console.log('=== END DEBUG INFO ===');
}