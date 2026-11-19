/**
 * Tree view functionality for class hierarchy
 */

import { assignColorsToGraphs, getNodeColor } from './color-utils.js';
import { apiGet } from './api.js';

// Global state (will be managed by main.js)
let classData = {};
let namespaces = {};
let currentGraphColorMap = {};
let currentRootNodeUris = new Set();
let currentDescendantOfRootUris = new Set();

// Navigation within the details panel (class -> instance -> linked resource ...)
let navStack = [];      // previous views, most recent last: { type: 'class' | 'resource', uri }
let currentView = null; // the view currently shown in the details panel

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
 * Count total number of classes in hierarchy tree (recursive)
 * @param {Array} nodes - Array of hierarchy nodes
 * @returns {number} Total class count
 */
// Returns { total, defined, external }
export function countClasses(nodes) {
  if (!nodes || nodes.length === 0) return { total: 0, defined: 0, external: 0 };

  let defined = 0, external = 0;
  for (const node of nodes) {
    if (node.is_inferred) external++; else defined++;
    if (node.children && node.children.length > 0) {
      const child = countClasses(node.children);
      defined += child.defined;
      external += child.external;
    }
  }
  return { total: defined + external, defined, external };
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
    
    // Apply special styling for inferred (external) classes
    const inferredStyle = node.is_inferred ? 'font-style: italic; opacity: 0.7;' : '';
    const inferredTitle = node.is_inferred ? `${node.uri} (external/inferred class)` : node.uri;
    
    return `
      <div class="tree-node">
        <span class="tree-toggle" onclick="toggleNode(this)">${toggleSymbol}</span>
        <span class="tree-label" title="${inferredTitle}" onclick="${clickFunction}('${node.uri}')" style="color: ${textColor}; font-weight: bold; ${inferredStyle}">${node.label}</span>
        ${hasChildren ? `<div class="tree-children collapsed">${childrenHtml}</div>` : ''}
      </div>
    `;
  }).join('');
}

/**
 * Select a class and show its details
 * @param {string} classUri - URI of the class to select
 */
export function selectClass(classUri, fromNav = false) {
  // A click in the tree (or anywhere outside panel navigation) starts a fresh path
  if (!fromNav) navStack = [];
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
              return `<a href="#" onclick="openClassFromDetails(${jsArg(range.uri)}); return false;" style="color: #007bff; text-decoration: none;" title="Click to navigate to ${range.uri}">${range.label}</a>`;
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
  currentView = { type: 'class', uri: classInfo.uri };
  
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
      ${backBarHtml()}
      <h2 title="${classInfo.uri}">${classInfo.label}</h2>
      <div class="class-info">
        <p><strong>QName:</strong> <code style="word-break: break-all; font-size: 11px;" title="${classInfo.uri}">${classQname}</code></p>
        <h3>Properties</h3>
        ${propertiesHtml}
        ${annotationsHtml}
        <h3>Instances</h3>
        <div id="class-instances" data-class-uri="${escapeHtml(classInfo.uri)}">
          <div class="property-values empty">Loading instances...</div>
        </div>
      </div>
    </div>
  `;

  loadClassInstancesPage(classInfo.uri, 0);
}

const INSTANCES_PAGE_SIZE = 25;

/**
 * Load one page of a class's instances into the "Instances" section of the class details panel.
 * Ignores the response if the user has selected a different class in the meantime.
 * @param {string} classUri - URI of the class
 * @param {number} offset - Index of the first instance to show
 */
export async function loadClassInstancesPage(classUri, offset) {
  const container = document.getElementById('class-instances');
  if (!container || container.dataset.classUri !== classUri) return;

  let data;
  try {
    data = await apiGet(`/class_instances?uri=${encodeURIComponent(classUri)}&offset=${offset}&limit=${INSTANCES_PAGE_SIZE}`);
  } catch (error) {
    if (container.isConnected && container.dataset.classUri === classUri) {
      container.innerHTML = `<div class="property-values empty">Could not load instances: ${escapeHtml(String(error.message || error))}</div>`;
    }
    return;
  }

  // The panel may have moved on to another class while we were waiting
  if (!container.isConnected || container.dataset.classUri !== classUri) return;

  const blankNote = data.blank_node_count > 0
    ? `<div style="font-size: 11px; color: #666; margin-top: 6px;">Plus ${data.blank_node_count.toLocaleString()} blank-node instance${data.blank_node_count === 1 ? '' : 's'} (not listed)</div>`
    : '';

  if (data.total === 0) {
    container.innerHTML = `<div class="property-values empty">No instances of this class in the loaded data</div>${blankNote}`;
    return;
  }

  const first = data.offset + 1;
  const last = data.offset + data.instances.length;
  const hasPrev = data.offset > 0;
  const hasNext = last < data.total;
  const uriArg = JSON.stringify(classUri).replace(/"/g, '&quot;');

  const rows = data.instances.map(inst => {
    const qname = uriToQname(inst.uri);
    const label = `<a href="#" onclick="openResource(${jsArg(inst.uri)}); return false;" style="color: #007bff; text-decoration: none;">${escapeHtml(inst.label)}</a>`;
    const qnameHtml = qname !== inst.label
      ? ` <span style="font-size: 11px; color: #666; margin-left: 8px;">${escapeHtml(qname)}</span>`
      : '';
    return `<li style="padding: 3px 0; word-break: break-all;" title="${escapeHtml(inst.uri)}">${label}${qnameHtml}</li>`;
  }).join('');

  const pager = data.total > data.limit ? `
    <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
      <button ${hasPrev ? '' : 'disabled'} onclick="loadClassInstancesPage(${uriArg}, ${Math.max(0, data.offset - data.limit)})">&laquo; Prev</button>
      <span style="font-size: 12px; color: #444;">${first.toLocaleString()}&ndash;${last.toLocaleString()} of ${data.total.toLocaleString()}</span>
      <button ${hasNext ? '' : 'disabled'} onclick="loadClassInstancesPage(${uriArg}, ${data.offset + data.limit})">Next &raquo;</button>
    </div>` : `<div style="font-size: 12px; color: #444; margin-top: 6px;">${data.total.toLocaleString()} instance${data.total === 1 ? '' : 's'}</div>`;

  container.innerHTML = `
    <ul style="list-style: none; padding: 8px 12px; margin: 0; background: #f8f9fa; border-radius: 4px; border-left: 3px solid #007bff;">${rows}</ul>
    ${pager}
    ${blankNote}
  `;
}

/**
 * Quote a value for use as a JavaScript argument inside an HTML onclick attribute.
 */
function jsArg(value) {
  return JSON.stringify(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function backBarHtml() {
  if (navStack.length === 0) return '';
  const prev = navStack[navStack.length - 1];
  const prevLabel = prev.type === 'class' && classData[prev.uri] ? classData[prev.uri].label : uriToQname(prev.uri);
  return `<div style="margin-bottom: 10px;"><button onclick="navigateBack()" title="${escapeHtml(prev.uri)}">&larr; Back to ${escapeHtml(prevLabel)}</button></div>`;
}

/**
 * Open a class from a link inside the details panel, remembering where we came from.
 */
export function openClassFromDetails(classUri) {
  if (currentView) navStack.push(currentView);
  selectClass(classUri, true);
}

/**
 * Open a resource (instance or any linked URI) from a link inside the details panel.
 */
export function openResource(resourceUri) {
  if (currentView) navStack.push(currentView);
  showResourceDetails(resourceUri);
}

/**
 * Return to the previous view in the details panel.
 */
export function navigateBack() {
  const prev = navStack.pop();
  if (!prev) return;
  if (prev.type === 'class') {
    selectClass(prev.uri, true);
  } else {
    showResourceDetails(prev.uri);
  }
}

/**
 * Render one RDF term from the /resource endpoint.
 * URIs that are known classes open the class view; other URIs open the resource view.
 */
function renderTerm(term, depth = 0) {
  if (term.kind === 'literal') {
    let tag = '';
    if (term.lang) {
      tag = `<span style="font-size: 11px; color: #666; margin-left: 6px;">@${escapeHtml(term.lang)}</span>`;
    } else if (term.datatype && !term.datatype.endsWith('#string')) {
      tag = `<span style="font-size: 11px; color: #666; margin-left: 6px;">${escapeHtml(uriToQname(term.datatype))}</span>`;
    }
    return `<span style="white-space: pre-wrap;">${escapeHtml(term.value)}</span>${tag}`;
  }
  if (term.kind === 'bnode') {
    if (!term.properties || term.properties.length === 0 || depth > 0) {
      return `<span style="color: #666; font-style: italic;">[blank node]</span>`;
    }
    const rows = term.properties.map(prop => `
      <div style="margin: 2px 0;">
        <span style="color: #444;" title="${escapeHtml(prop.predicate)}">${escapeHtml(prop.predicate_label)}:</span>
        ${prop.values.map(v => renderTerm(v, depth + 1)).join(', ')}
      </div>`).join('');
    return `<div style="margin: 4px 0 4px 4px; padding: 4px 8px; border-left: 2px solid #ccc;">${rows}</div>`;
  }
  // URI
  const qname = uriToQname(term.value);
  const isClass = !!classData[term.value];
  const handler = isClass ? 'openClassFromDetails' : 'openResource';
  const qnameHtml = qname !== term.label
    ? ` <span style="font-size: 11px; color: #666; margin-left: 6px;">${escapeHtml(qname)}</span>`
    : '';
  const external = /^https?:/.test(term.value)
    ? ` <a href="${escapeHtml(term.value)}" target="_blank" rel="noopener" title="Open ${escapeHtml(term.value)} in a new tab" style="text-decoration: none; font-size: 11px; color: #888;">&#8599;</a>`
    : '';
  return `<a href="#" onclick="${handler}(${jsArg(term.value)}); return false;" title="${escapeHtml(term.value)}" style="color: #007bff; text-decoration: none;">${escapeHtml(term.label)}</a>${qnameHtml}${external}`;
}

/**
 * Show a resource (typically an instance) in the details panel: types, properties, incoming links.
 * @param {string} resourceUri - URI of the resource
 */
export async function showResourceDetails(resourceUri) {
  const detailsContainer = document.getElementById('class-details');
  currentView = { type: 'resource', uri: resourceUri };
  detailsContainer.innerHTML = `
    <div class="class-form active">
      ${backBarHtml()}
      <h2 title="${escapeHtml(resourceUri)}">${escapeHtml(uriToQname(resourceUri))}</h2>
      <div class="property-values empty">Loading...</div>
    </div>`;

  let data;
  try {
    data = await apiGet(`/resource?uri=${encodeURIComponent(resourceUri)}`);
  } catch (error) {
    if (currentView && currentView.uri === resourceUri) {
      detailsContainer.querySelector('.property-values').textContent = `Could not load resource: ${error.message || error}`;
    }
    return;
  }
  // The user may have navigated elsewhere while we were waiting
  if (!currentView || currentView.type !== 'resource' || currentView.uri !== resourceUri) return;

  const valueBox = inner => `<div class="annotation-values" style="margin-left: 20px; padding: 8px; background: #f8f9fa; border-radius: 4px; border-left: 3px solid #007bff;">${inner}</div>`;

  const typesHtml = data.types.length
    ? valueBox(data.types.map(t => `<div style="margin-bottom: 3px;">${renderTerm(t)}</div>`).join(''))
    : `<div class="property-values empty">No rdf:type in the loaded data</div>`;

  const propsHtml = data.properties.length
    ? data.properties.map(prop => {
        const more = prop.total > prop.values.length
          ? `<div style="font-size: 11px; color: #666; margin-top: 4px;">&hellip; and ${(prop.total - prop.values.length).toLocaleString()} more (use the SPARQL tab to see all)</div>`
          : '';
        return `
          <div class="annotation-group" style="margin-bottom: 12px;">
            <div class="annotation-property" style="font-weight: bold; margin-bottom: 4px;" title="${escapeHtml(prop.predicate)}">
              ${escapeHtml(prop.predicate_label)} <span style="font-size: 11px; color: #666; font-weight: normal; margin-left: 6px;">${escapeHtml(uriToQname(prop.predicate))}</span>
            </div>
            ${valueBox(prop.values.map(v => `<div style="margin-bottom: 3px;">${renderTerm(v)}</div>`).join('') + more)}
          </div>`;
      }).join('')
    : `<div class="property-values empty">No statements about this resource in the loaded data</div>`;

  const incomingMore = data.incoming_total > data.incoming.length
    ? `<div style="font-size: 11px; color: #666; margin-top: 4px;">Showing ${data.incoming.length} of ${data.incoming_total.toLocaleString()} (use the SPARQL tab to see all)</div>`
    : '';
  const incomingHtml = data.incoming_total
    ? valueBox(data.incoming.map(link => `
        <div style="margin-bottom: 3px;">${renderTerm(link.subject, 1)}
          <span style="font-size: 11px; color: #666; margin-left: 6px;" title="${escapeHtml(link.predicate)}">${escapeHtml(link.predicate_label)}</span>
        </div>`).join('') + incomingMore)
    : `<div class="property-values empty">Nothing in the loaded data points to this resource</div>`;

  const qname = uriToQname(resourceUri);
  detailsContainer.innerHTML = `
    <div class="class-form active">
      ${backBarHtml()}
      <h2 title="${escapeHtml(resourceUri)}">${escapeHtml(data.label)}</h2>
      <div style="margin-bottom: 10px;"><button onclick="openInExplorer(${jsArg(resourceUri)})">Open in Explorer</button></div>
      <div class="class-info">
        <p><strong>${qname !== resourceUri ? 'QName' : 'URI'}:</strong> <code style="word-break: break-all; font-size: 11px;" title="${escapeHtml(resourceUri)}">${escapeHtml(qname)}</code></p>
        <h3>Types</h3>
        ${typesHtml}
        <h3>Properties</h3>
        ${propsHtml}
        <h3>Referenced by</h3>
        ${incomingHtml}
      </div>
    </div>`;
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