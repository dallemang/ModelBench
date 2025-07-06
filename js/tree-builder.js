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
  console.log(`🎯 DEBUG: selectClass called with URI: ${classUri}`);
  
  // Remove selection from all labels
  document.querySelectorAll('.tree-label').forEach(label => {
    label.classList.remove('selected');
  });
  
  // Add selection to clicked label
  const clickedLabel = document.querySelector(`[onclick="selectClass('${classUri}')"]`);
  console.log(`🔍 DEBUG: Found clickedLabel:`, clickedLabel);
  
  if (clickedLabel) {
    console.log(`✅ DEBUG: Label found, text: "${clickedLabel.textContent}"`);
    console.log(`📍 DEBUG: Label position before expansion:`, clickedLabel.getBoundingClientRect());
    console.log(`👁️ DEBUG: Label visible before expansion:`, isElementVisible(clickedLabel));
    
    clickedLabel.classList.add('selected');
    
    // Ensure parent nodes are expanded to make the target visible
    console.log(`📂 DEBUG: Starting expansion process...`);
    const expansionCount = expandPathToNode(clickedLabel);
    console.log(`📂 DEBUG: Expanded ${expansionCount} nodes`);
    
    // Use a timeout to ensure DOM is updated after expansion
    setTimeout(() => {
      console.log(`⏱️ DEBUG: After 50ms delay - checking visibility...`);
      console.log(`📍 DEBUG: Label position after expansion:`, clickedLabel.getBoundingClientRect());
      console.log(`👁️ DEBUG: Label visible after expansion:`, isElementVisible(clickedLabel));
      
      // Always scroll to ensure visibility, using a more reliable method
      const hierarchyTree = document.getElementById('hierarchy-tree');
      if (hierarchyTree && clickedLabel) {
        console.log(`🌳 DEBUG: Hierarchy tree bounds:`, hierarchyTree.getBoundingClientRect());
        
        // Use scrollIntoView with better options
        console.log(`🎯 DEBUG: Attempting smooth scroll...`);
        clickedLabel.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        });
        
        // Fallback: if smooth doesn't work, try immediate scroll
        setTimeout(() => {
          const labelRect = clickedLabel.getBoundingClientRect();
          const containerRect = hierarchyTree.getBoundingClientRect();
          
          console.log(`🔍 DEBUG: Final position check - Label:`, labelRect);
          console.log(`🔍 DEBUG: Final position check - Container:`, containerRect);
          
          const isAboveView = labelRect.top < containerRect.top;
          const isBelowView = labelRect.bottom > containerRect.bottom;
          console.log(`📊 DEBUG: isAboveView: ${isAboveView}, isBelowView: ${isBelowView}`);
          
          if (isAboveView || isBelowView) {
            console.log(`🔧 DEBUG: Still not visible, forcing auto scroll...`);
            // Force scroll if still not visible
            clickedLabel.scrollIntoView({
              behavior: 'auto',
              block: 'center'
            });
          } else {
            console.log(`✅ DEBUG: Element is now visible!`);
          }
        }, 100);
      }
    }, 50);
  } else {
    console.log(`❌ DEBUG: No label found for URI: ${classUri}`);
    console.log(`🔍 DEBUG: Available onclick selectors:`, 
      Array.from(document.querySelectorAll('[onclick*="selectClass"]')).map(el => el.getAttribute('onclick')));
  }
  
  // Show class details
  showClassDetails(classData[classUri]);
}

/**
 * Check if an element is visible (not hidden by collapsed parents)
 */
function isElementVisible(element) {
  let current = element;
  while (current && current !== document.getElementById('hierarchy-tree')) {
    if (current.classList && current.classList.contains('collapsed')) {
      return false;
    }
    if (window.getComputedStyle(current).display === 'none') {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

/**
 * Expand all parent nodes to make a target node visible
 * @param {Element} targetLabel - The label element to make visible
 * @returns {number} Number of nodes expanded
 */
function expandPathToNode(targetLabel) {
  let currentElement = targetLabel;
  let expansionCount = 0;
  const expandedNodes = [];
  
  console.log(`🔍 DEBUG: Starting expandPathToNode for:`, targetLabel);
  
  // Walk up the DOM tree to find collapsed parent nodes
  while (currentElement && currentElement !== document.getElementById('hierarchy-tree')) {
    console.log(`🚶 DEBUG: Checking element:`, currentElement.tagName, currentElement.className);
    
    // Check if this element is inside a collapsed tree-children
    if (currentElement.classList && currentElement.classList.contains('tree-children') && 
        currentElement.classList.contains('collapsed')) {
      
      console.log(`📁 DEBUG: Found collapsed tree-children:`, currentElement);
      
      // Find the corresponding toggle button - need to look in the parent tree-node
      const treeNode = currentElement.parentElement;
      console.log(`🌳 DEBUG: Tree node container:`, treeNode);
      
      if (treeNode && treeNode.classList.contains('tree-node')) {
        const toggleButton = treeNode.querySelector('.tree-toggle');
        console.log(`🔘 DEBUG: Toggle button:`, toggleButton, toggleButton?.textContent);
        
        if (toggleButton && toggleButton.textContent === '▶') {
          console.log(`🔓 DEBUG: Expanding node...`);
          // Expand this node
          currentElement.classList.remove('collapsed');
          toggleButton.textContent = '▼';
          expansionCount++;
          const labelElement = treeNode.querySelector('.tree-label');
          expandedNodes.push(labelElement?.textContent || 'unknown');
          console.log(`✅ DEBUG: Expanded node #${expansionCount}: ${expandedNodes[expandedNodes.length - 1]}`);
        } else {
          console.log(`⚠️ DEBUG: Toggle button not expandable or missing`);
        }
      } else {
        console.log(`❌ DEBUG: No tree-node container found for collapsed tree-children`);
      }
    }
    currentElement = currentElement.parentElement;
  }
  
  console.log(`📊 DEBUG: Expansion complete. Total expanded: ${expansionCount}`);
  console.log(`📋 DEBUG: Expanded nodes: [${expandedNodes.join(', ')}]`);
  
  return expansionCount;
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
        ? prop.ranges.map(range => {
            // Check if this range is a class that exists in our class data
            const isClickableClass = classData[range.uri];
            if (isClickableClass) {
              return `<a href="#" onclick="selectClass('${range.uri}'); return false;" style="color: #007bff; text-decoration: none;" title="Click to navigate to ${range.uri}">${range.label}</a>`;
            } else {
              return range.label;
            }
          }).join(', ')
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
  
  // Build annotations HTML
  let annotationsHtml = '';
  if (classInfo.annotations && classInfo.annotations.length > 0) {
    // Group annotations by property
    const groupedAnnotations = {};
    classInfo.annotations.forEach(annotation => {
      if (!groupedAnnotations[annotation.property]) {
        groupedAnnotations[annotation.property] = [];
      }
      groupedAnnotations[annotation.property].push(annotation);
    });
    
    annotationsHtml = `
      <h3>Annotations</h3>
      <div class="annotations-section">
        ${Object.entries(groupedAnnotations)
          .sort(([propA], [propB]) => {
            const priorityA = getAnnotationPriority(propA);
            const priorityB = getAnnotationPriority(propB);
            if (priorityA !== priorityB) {
              return priorityA - priorityB;
            }
            return propA.toLowerCase().localeCompare(propB.toLowerCase());
          })
          .map(([property, annotations]) => {
          const valuesHtml = annotations.map((annotation, index) => {
            const value = annotation.is_uri ? 
              `<a href="${annotation.value}" target="_blank" style="color: #007bff; text-decoration: none;">${annotation.value}</a>` :
              `<span>${escapeHtml(annotation.value)}</span>`;
            const separator = annotations.length > 1 && index < annotations.length - 1 ? 
              `<hr style="margin: 8px 0; border: none; border-top: 1px solid #ddd;">` : '';
            return `<div style="margin-bottom: 5px;">${value}</div>${separator}`;
          }).join('');
          
          return `
            <div class="annotation-group" style="margin-bottom: 15px;">
              <div class="annotation-property" style="font-weight: bold; margin-bottom: 5px;" title="${annotations[0].property_uri}">${property}:</div>
              <div class="annotation-values" style="margin-left: 20px; padding: 8px; background: #f8f9fa; border-radius: 4px; border-left: 3px solid #007bff;">
                ${valuesHtml}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
  
  detailsContainer.innerHTML = `
    <div class="class-form active">
      <h2 title="${classInfo.uri}">${classInfo.label}</h2>
      <div class="class-info">
        <p><strong>QName:</strong> <code style="word-break: break-all; font-size: 11px;" title="${classInfo.uri}">${classQname}</code></p>
        <h3>Properties</h3>
        ${propertiesHtml}
        ${annotationsHtml}
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
  
  // Build annotations HTML
  let annotationsHtml = '';
  if (ontologyInfo.annotations && ontologyInfo.annotations.length > 0) {
    // Group annotations by property
    const groupedAnnotations = {};
    ontologyInfo.annotations.forEach(annotation => {
      if (!groupedAnnotations[annotation.property]) {
        groupedAnnotations[annotation.property] = [];
      }
      groupedAnnotations[annotation.property].push(annotation);
    });
    
    annotationsHtml = `
      <h3>Annotations</h3>
      <div class="annotations-section">
        ${Object.entries(groupedAnnotations)
          .sort(([propA], [propB]) => {
            const priorityA = getAnnotationPriority(propA);
            const priorityB = getAnnotationPriority(propB);
            if (priorityA !== priorityB) {
              return priorityA - priorityB;
            }
            return propA.toLowerCase().localeCompare(propB.toLowerCase());
          })
          .map(([property, annotations]) => {
          const valuesHtml = annotations.map((annotation, index) => {
            const value = annotation.is_uri ? 
              `<a href="${annotation.value}" target="_blank" style="color: #007bff; text-decoration: none;">${annotation.value}</a>` :
              `<span>${escapeHtml(annotation.value)}</span>`;
            const separator = annotations.length > 1 && index < annotations.length - 1 ? 
              `<hr style="margin: 8px 0; border: none; border-top: 1px solid #ddd;">` : '';
            return `<div style="margin-bottom: 5px;">${value}</div>${separator}`;
          }).join('');
          
          return `
            <div class="annotation-group" style="margin-bottom: 15px;">
              <div class="annotation-property" style="font-weight: bold; margin-bottom: 5px;" title="${annotations[0].property_uri}">${property}:</div>
              <div class="annotation-values" style="margin-left: 20px; padding: 8px; background: #f8f9fa; border-radius: 4px; border-left: 3px solid #007bff;">
                ${valuesHtml}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
  
  // Show basic ontology information
  detailsContainer.innerHTML = `
    <div class="class-form active">
      <h2 title="${ontologyInfo.uri}">${ontologyInfo.label}</h2>
      <div class="class-info">
        <p><strong>QName:</strong> <code style="word-break: break-all; font-size: 11px;" title="${ontologyInfo.uri}">${ontologyQname}</code></p>
        ${ontologyInfo.children && ontologyInfo.children.length > 0 ? `
          <h3>Imports (${ontologyInfo.children.length})</h3>
          <div class="property-values">
            ${ontologyInfo.children.map(child => `<div>${child.label} (${child.uri})</div>`).join('')}
          </div>
        ` : '<p><em>No imports found</em></p>'}
        ${annotationsHtml}
      </div>
    </div>
  `;
}

/**
 * Get priority for annotation property (lower number = higher priority)
 * @param {string} property - Property name
 * @returns {number} Priority number
 */
function getAnnotationPriority(property) {
  const propertyLower = property.toLowerCase();
  
  // High priority: labels, titles
  if (propertyLower.includes('label') || propertyLower.includes('title')) {
    return 1;
  }
  
  // Medium-high priority: comments, definitions
  if (propertyLower.includes('comment') || propertyLower.includes('definition') || propertyLower.includes('description')) {
    return 2;
  }
  
  // Low priority: copyright, license
  if (propertyLower.includes('copyright') || propertyLower.includes('license') || propertyLower.includes('rights')) {
    return 9;
  }
  
  // Default medium priority for everything else
  return 5;
}

/**
 * Escape HTML entities in text
 * @param {string} text - Text to escape
 * @returns {string} HTML-escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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