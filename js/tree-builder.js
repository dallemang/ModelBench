/**
 * Tree view functionality for class hierarchy
 */

import { assignColorsToGraphs, getNodeColor } from './color-utils.js';

// Global state (will be managed by main.js)
let classData = {};
let namespaces = {};
let currentGraphColorMap = {};
let currentRootNodeUris = new Set();
let currentDescendantOfRootUris = new Set();

/**
 * Set global state for tree operations
 * @param {Object} newClassData - Class data object
 * @param {Object} newNamespaces - Namespaces object
 */
export function setTreeState(newClassData, newNamespaces) {
  classData = newClassData;
  namespaces = newNamespaces;
}

/**
 * Get current class data
 * @returns {Object} Current class data
 */
export function getClassData() {
  return classData;
}

/**
 * Get current namespaces
 * @returns {Object} Current namespaces
 */
export function getNamespaces() {
  return namespaces;
}

/**
 * Build tree HTML from hierarchy data
 * @param {Array} nodes - Array of hierarchy nodes
 * @param {Object} graphColorMap - Required pre-calculated color mapping
 * @param {string} selectionType - Type of selection ('class' or 'ontology')
 * @returns {string} HTML string for the tree
 */
export function buildTreeHtml(nodes, graphColorMap, selectionType = 'class', rootNodeUris = null, descendantOfRootUris = null) {
  if (!nodes || nodes.length === 0) return '';
  
  // Color map should ALWAYS be provided - no fallback calculation
  if (!graphColorMap) {
    throw new Error('buildTreeHtml: graphColorMap must be provided');
  }
  
  currentGraphColorMap = graphColorMap;
  
  // Track which nodes are roots vs descendants (only for top-level call)
  if (rootNodeUris === null || descendantOfRootUris === null) {
    currentRootNodeUris = new Set(nodes.map(root => root.uri));
    currentDescendantOfRootUris = new Set();
    
    function markDescendants(node) {
      currentDescendantOfRootUris.add(node.uri);
      if (node.children) {
        node.children.forEach(child => markDescendants(child));
      }
    }
    
    nodes.forEach(root => markDescendants(root));
  } else {
    // Use the passed-in sets for recursive calls
    currentRootNodeUris = rootNodeUris;
    currentDescendantOfRootUris = descendantOfRootUris;
  }
  
  return nodes.map(node => {
    // Store class data globally for later retrieval
    classData[node.uri] = node;
    
    const hasChildren = node.children && node.children.length > 0;
    const toggleSymbol = hasChildren ? '▶' : '•';
    const childrenHtml = hasChildren ? buildTreeHtml(node.children, currentGraphColorMap, selectionType, currentRootNodeUris, currentDescendantOfRootUris) : '';
    
    // Get the appropriate text color for this node
    const textColor = getNodeColor(node, currentGraphColorMap, currentRootNodeUris, currentDescendantOfRootUris, true, "HIERARCHY");
    
    // Determine which selection function to use
    const clickFunction = selectionType === 'ontology' ? 'selectOntology' : 'selectClass';
    
    return `
      <div class="tree-node">
        <span class="tree-toggle" onclick="toggleNode(this)">${toggleSymbol}</span>
        <span class="tree-label" title="${node.uri}" onclick="${clickFunction}('${node.uri}')" style="color: ${textColor}; font-weight: bold;">${node.label}</span>
        ${hasChildren ? `<div class="tree-children collapsed">${childrenHtml}</div>` : ''}
      </div>
    `;
  }).join('');
}

/**
 * Select a class and show its details
 * @param {string} classUri - URI of the class to select
 */
export function selectClass(classUri) {
  // Remove selection from all labels
  document.querySelectorAll('.tree-label').forEach(label => {
    label.classList.remove('selected');
  });
  
  // Add selection to clicked label
  const clickedLabel = document.querySelector(`[onclick="selectClass('${classUri}')"]`);
  if (clickedLabel) {
    clickedLabel.classList.add('selected');
  }
  
  // Show class details
  showClassDetails(classData[classUri]);
}

export function selectOntology(ontologyUri) {
  // Remove selection from all labels
  document.querySelectorAll('.tree-label').forEach(label => {
    label.classList.remove('selected');
  });
  
  // Add selection to clicked label
  const clickedLabel = document.querySelector(`[onclick="selectOntology('${ontologyUri}')"]`);
  if (clickedLabel) {
    clickedLabel.classList.add('selected');
  }
  
  // Show ontology details
  showOntologyDetails(classData[ontologyUri]);
}

/**
 * Toggle tree node expansion
 * @param {Element} toggleElement - The toggle element that was clicked
 */
export function toggleNode(toggleElement) {
  const childrenElement = toggleElement.parentElement.querySelector('.tree-children');
  if (childrenElement) {
    const isCollapsed = childrenElement.classList.contains('collapsed');
    
    if (isCollapsed) {
      childrenElement.classList.remove('collapsed');
      toggleElement.textContent = '▼';
    } else {
      childrenElement.classList.add('collapsed');
      toggleElement.textContent = '▶';
    }
  }
}

/**
 * Display class details in the right panel
 * @param {Object} classInfo - Class information object
 */
export function showClassDetails(classInfo) {
  const detailsContainer = document.getElementById('class-details');
  
  if (!classInfo) {
    detailsContainer.innerHTML = `
      <div class="no-selection">
        <p>Class not found</p>
      </div>
    `;
    return;
  }
  
  // Build properties form
  let propertiesHtml = '';
  if (classInfo.properties && classInfo.properties.length > 0) {
    propertiesHtml = classInfo.properties.map(prop => {
      const rangeValues = prop.ranges.length > 0 
        ? prop.ranges.map(range => range.label).join(', ')
        : 'No range specified';
      
      const propQname = uriToQname(prop.uri);
      
      return `
        <div class="form-group">
          <label>${prop.label} <span class="property-qname" style="font-size: 11px; color: #666; margin-left: 8px;" title="${prop.uri}">${propQname}</span></label>
          <div class="property-values ${prop.ranges.length === 0 ? 'empty' : ''}">${rangeValues}</div>
        </div>
      `;
    }).join('');
  } else {
    propertiesHtml = `
      <div class="form-group">
        <div class="property-values empty">No properties found with this class as domain</div>
      </div>
    `;
  }
  
  const classQname = uriToQname(classInfo.uri);
  
  detailsContainer.innerHTML = `
    <div class="class-form active">
      <h2 title="${classInfo.uri}">${classInfo.label}</h2>
      <div class="class-info">
        <p><strong>QName:</strong> <code style="word-break: break-all;" title="${classInfo.uri}">${classQname}</code></p>
        <h3>Properties</h3>
        ${propertiesHtml}
      </div>
    </div>
  `;
}

export function showOntologyDetails(ontologyInfo) {
  const detailsContainer = document.getElementById('ontology-details');
  
  if (!ontologyInfo) {
    detailsContainer.innerHTML = `
      <div class="no-selection">
        <p>Ontology not found</p>
      </div>
    `;
    return;
  }
  
  const ontologyQname = uriToQname(ontologyInfo.uri);
  
  // Show basic ontology information
  detailsContainer.innerHTML = `
    <div class="class-form active">
      <h2 title="${ontologyInfo.uri}">${ontologyInfo.label}</h2>
      <div class="class-info">
        <p><strong>QName:</strong> <code style="word-break: break-all;" title="${ontologyInfo.uri}">${ontologyQname}</code></p>
        <p><strong>Graph Source:</strong> <code>${ontologyInfo.graph_source}</code></p>
        ${ontologyInfo.children && ontologyInfo.children.length > 0 ? `
          <h3>Imports (${ontologyInfo.children.length})</h3>
          <div class="property-values">
            ${ontologyInfo.children.map(child => `<div>${child.label} (${child.uri})</div>`).join('')}
          </div>
        ` : '<p><em>No imports found</em></p>'}
      </div>
    </div>
  `;
}

/**
 * Convert URI to qname if possible
 * @param {string} uri - URI to convert
 * @returns {string} QName or original URI
 */
function uriToQname(uri) {
  for (const [prefix, namespace] of Object.entries(namespaces)) {
    if (uri.startsWith(namespace)) {
      const localName = uri.substring(namespace.length);
      return prefix ? `${prefix}:${localName}` : localName;
    }
  }
  return uri; // Return full URI if no matching namespace
}