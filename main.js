import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

// Function to handle file loading
async function loadFile() {
  try {
    const selected = await open({
      title: 'Select an RDF file',
      multiple: false,
      filters: [{
        name: 'RDF Files',
        extensions: ['ttl', 'rdf', 'owl', 'n3', 'nt']
      }, {
        name: 'Turtle Files',
        extensions: ['ttl']
      }, {
        name: 'All Files',
        extensions: ['*']
      }]
    });

    if (selected) {
      // Show loading message in log
      const graphStats = document.getElementById('graph-stats');
      
      graphStats.innerHTML = `<p>Loading: ${selected}...</p>`;
      document.getElementById('tab-container').style.display = 'block';
      switchTab('log');
      
      try {
        // Call Python backend to load RDF file
        const response = await invoke('call_python_backend', {
          command: 'load_rdf',
          args: [selected]
        });
        
        console.log('Python response:', response);
        
        if (response.error) {
          // Show error in log tab
          graphStats.innerHTML = `
            <div style="color: #dc3545; padding: 15px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; margin-bottom: 15px;">
              <strong>Error loading file:</strong> ${selected}<br>
              <strong>Error:</strong> ${response.error}
            </div>
          `;
        } else if (response.success) {
          // Show tab container
          document.getElementById('tab-container').style.display = 'block';
          
          // Populate Log tab with file info and detailed stats
          const graphStats = document.getElementById('graph-stats');
          graphStats.innerHTML = `
            <div style="padding: 15px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; margin-bottom: 15px; color: #155724;">
              <strong>✓ Successfully loaded:</strong> ${selected}<br>
              <strong>Triples loaded:</strong> ${response.triples_count}
            </div>
            
            <h3>Graph Statistics</h3>
            <div class="stats-grid">
              <div><strong>Triples:</strong> ${response.triples_count}</div>
              <div><strong>Subjects:</strong> ${response.subjects_count}</div>
              <div><strong>Predicates:</strong> ${response.predicates_count}</div>
              <div><strong>Objects:</strong> ${response.objects_count}</div>
              <div><strong>Classes:</strong> ${response.classes_count}</div>
              <div><strong>Properties:</strong> ${response.properties_count}</div>
              <div><strong>Namespaces:</strong> ${response.namespaces_count}</div>
              <div><strong>File Size:</strong> ${(response.file_size / 1024).toFixed(1)} KB</div>
            </div>
            ${response.namespaces_count > 0 ? `
              <h4>Namespaces</h4>
              <div class="namespaces">
                ${Object.entries(response.namespaces).map(([prefix, uri]) => 
                  `<div><code>${prefix || '(default)'}</code>: ${uri}</div>`
                ).join('')}
              </div>
            ` : ''}
            ${response.classes && response.classes.length > 0 ? `
              <h4>Sample Classes</h4>
              <div class="classes">
                ${response.classes.map(cls => `<div><code>${cls}</code></div>`).join('')}
              </div>
            ` : ''}
            ${response.properties && response.properties.length > 0 ? `
              <h4>Sample Properties</h4>
              <div class="properties">
                ${response.properties.map(prop => `<div><code>${prop}</code></div>`).join('')}
              </div>
            ` : ''}
            
            ${response.hierarchy_debug ? `
              <h4>Hierarchy Debug Info</h4>
              <div style="background: #fff3cd; padding: 10px; border-radius: 4px; margin: 10px 0;">
                <strong>Subclass relationships found:</strong> ${response.subclass_relationships_count}<br>
                <strong>Full hierarchy tree:</strong>
                <pre style="font-family: monospace; font-size: 12px; margin: 10px 0; white-space: pre;">${response.hierarchy_debug.full_hierarchy_tree.join('\n')}</pre>
              </div>
            ` : ''}
            
            <h4>Raw Response</h4>
            <pre style="background: #f8f9fa; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px;">${JSON.stringify(response, null, 2)}</pre>
          `;
          
          // Populate Class Hierarchy tab (main view)
          const hierarchyTree = document.getElementById('hierarchy-tree');
          
          // Clear previous class data and store namespaces
          classData = {};
          namespaces = response.namespaces || {};
          
          if (response.class_hierarchy && response.class_hierarchy.length > 0) {
            hierarchyTree.innerHTML = buildTreeHtml(response.class_hierarchy);
          } else {
            hierarchyTree.innerHTML = `
              <p style="color: #666; font-style: italic;">No class hierarchy found in this RDF file.</p>
              <p style="color: #666; font-size: 14px;">This might be because:</p>
              <ul style="color: #666; font-size: 14px; margin-left: 20px;">
                <li>The file contains no OWL/RDFS class definitions</li>
                <li>Classes are not linked with rdfs:subClassOf relationships</li>
                <li>The file contains only instance data</li>
              </ul>
            `;
          }
          
          // Reset class details panel
          document.getElementById('class-details').innerHTML = `
            <div class="no-selection">
              <p>Select a class from the hierarchy to view its details</p>
            </div>
          `;
          
          // Create class diagram (use deep copy to avoid interference from tree building)
          if (response.class_hierarchy && response.class_hierarchy.length > 0) {
            console.log('Raw response.class_hierarchy from Python:', response.class_hierarchy);
            console.log('First root class children:', response.class_hierarchy.find(c => c.children?.length > 0));
            
            // Create deep copy for diagram to avoid corruption from tree building
            const hierarchyCopy = JSON.parse(JSON.stringify(response.class_hierarchy));
            console.log('Using hierarchy copy for diagram');
            createClassDiagram(hierarchyCopy);
          } else {
            console.log('No class hierarchy found for diagram');
          }
          
          // Ensure we start on the hierarchy tab
          switchTab('hierarchy');
        }
        
      } catch (error) {
        console.error('Error calling Python backend:', error);
        graphStats.innerHTML = `
          <div style="color: #dc3545; padding: 15px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; margin-bottom: 15px;">
            <strong>Backend Error:</strong> ${error}
          </div>
        `;
        document.getElementById('tab-container').style.display = 'block';
        switchTab('log');
      }
    }
  } catch (error) {
    console.error('Error selecting file:', error);
  }
}

// Global variables
let classData = {};
let cytoscapeInstance = null;
let namespaces = {};

// Function to build tree HTML from hierarchy data
function buildTreeHtml(nodes) {
  if (!nodes || nodes.length === 0) return '';
  
  return nodes.map(node => {
    // Store class data globally for later retrieval
    classData[node.uri] = node;
    
    const hasChildren = node.children && node.children.length > 0;
    const toggleSymbol = hasChildren ? '▶' : '•';
    const childrenHtml = hasChildren ? buildTreeHtml(node.children) : '';
    
    return `
      <div class="tree-node">
        <span class="tree-toggle" onclick="toggleNode(this)">${toggleSymbol}</span>
        <span class="tree-label" title="${node.uri}" onclick="selectClass('${node.uri}')">${node.label}</span>
        ${hasChildren ? `<div class="tree-children collapsed">${childrenHtml}</div>` : ''}
      </div>
    `;
  }).join('');
}

// Function to select a class and show its details
function selectClass(classUri) {
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

// Function to convert URI to qname if possible
function uriToQname(uri) {
  for (const [prefix, namespace] of Object.entries(namespaces)) {
    if (uri.startsWith(namespace)) {
      const localName = uri.substring(namespace.length);
      return prefix ? `${prefix}:${localName}` : localName;
    }
  }
  return uri; // Return full URI if no matching namespace
}

// Function to display class details in the right panel
function showClassDetails(classInfo) {
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
          <label>${prop.label}</label>
          <div class="property-qname" style="font-size: 11px; color: #666; margin-bottom: 3px;" title="${prop.uri}">${propQname}</div>
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

// Function to toggle tree node expansion
function toggleNode(toggleElement) {
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

// Function to calculate custom hierarchical layout positions
function calculateHierarchicalLayout(hierarchy) {
  const layout = {};
  const nodeWidth = 100;     // Width of a node (for spacing calculations)
  const minSpacing = 150;    // Minimum distance between adjacent roots
  
  // Calculate minimum radius needed to prevent root overlap
  // Circumference needed = numRoots * minSpacing
  // Radius = Circumference / (2 * π)
  const minRadius = (hierarchy.length * minSpacing) / (2 * Math.PI);
  const circleRadius = Math.max(120, minRadius); // At least 120px radius
  
  const centerX = 0;         // Center of the circle
  const centerY = 0;         // Center of the circle
  
  // Calculate positions for each root around the circle
  const angleStep = (2 * Math.PI) / hierarchy.length;
  
  hierarchy.forEach((rootNode, index) => {
    // Calculate root position on the circle
    const angle = index * angleStep - (Math.PI / 2); // Start at top (subtract π/2)
    const rootX = centerX + circleRadius * Math.cos(angle);
    const rootY = centerY + circleRadius * Math.sin(angle);
    
    // Calculate tree layout with root at this position
    const treeLayout = calculateTreeLayout(rootNode, rootX, rootY, angle);
    Object.assign(layout, treeLayout);
  });
  
  
  return layout;
}

// Function to calculate layout for a single tree
function calculateTreeLayout(rootNode, rootX, rootY, angle) {
  const positions = {};
  const nodeWidth = 150;
  const layerHeight = 120;
  
  // Calculate direction vector - trees grow AWAY from center (outward)
  const directionX = Math.cos(angle); // Away from center
  const directionY = Math.sin(angle); // Away from center
  
  // Calculate perpendicular vector for horizontal spreading of children
  const perpX = -directionY; // Perpendicular to direction
  const perpY = directionX;
  
  // First pass: calculate subtree widths (how much horizontal space each subtree needs)
  function calculateSubtreeWidth(node) {
    if (!node.children || node.children.length === 0) {
      return 1; // Leaf node takes one unit width
    }
    
    // Sum up the widths of all children subtrees
    const childrenWidth = node.children.reduce((total, child) => {
      return total + calculateSubtreeWidth(child);
    }, 0);
    
    return Math.max(1, childrenWidth); // At least one unit width, or sum of children
  }
  
  // Second pass: assign positions based on subtree widths
  function assignPositions(node, centerX, centerY, level, availableWidth) {
    // Position this node at its center
    positions[node.uri] = { x: centerX, y: centerY };
    
    if (node.children && node.children.length > 0) {
      // Calculate positions for children
      const childLevel = level + 1;
      const childCenterX = centerX + directionX * layerHeight;
      const childCenterY = centerY + directionY * layerHeight;
      
      // Calculate total width needed for all children
      const totalChildWidth = node.children.reduce((total, child) => {
        return total + calculateSubtreeWidth(child);
      }, 0);
      
      // Start position for children (leftmost)
      const startOffset = (totalChildWidth - 1) * nodeWidth / 2;
      let currentOffset = -startOffset;
      
      node.children.forEach(child => {
        const childSubtreeWidth = calculateSubtreeWidth(child);
        const childOffset = currentOffset + (childSubtreeWidth - 1) * nodeWidth / 2;
        
        const childX = childCenterX + perpX * childOffset;
        const childY = childCenterY + perpY * childOffset;
        
        assignPositions(child, childX, childY, childLevel, childSubtreeWidth);
        
        currentOffset += childSubtreeWidth * nodeWidth;
      });
    }
  }
  
  // Start positioning from the root
  const rootSubtreeWidth = calculateSubtreeWidth(rootNode);
  assignPositions(rootNode, rootX, rootY, 0, rootSubtreeWidth);
  
  return positions;
}

// Function to build Cytoscape graph data from class hierarchy
function buildCytoscapeData(hierarchy) {
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
    
    // Add class node with custom position
    const position = layoutPositions[node.uri] || { x: 0, y: 0 };
    const isRoot = rootNodeUris.has(node.uri);
    const isDescendant = descendantOfRootUris.has(node.uri);
    
    let nodeCategory;
    if (isRoot) {
      nodeCategory = 'root';
    } else if (isDescendant) {
      nodeCategory = 'descendant';
    } else {
      nodeCategory = 'orphaned';
    }
    
    nodes.push({
      data: {
        id: node.uri,
        label: node.label,
        type: 'class',
        category: nodeCategory
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
            const isRoot = rootNodeUris.has(range.uri);
            const isDescendant = descendantOfRootUris.has(range.uri);
            
            let nodeCategory;
            if (isRoot) {
              nodeCategory = 'root';
            } else if (isDescendant) {
              nodeCategory = 'descendant';
            } else {
              nodeCategory = 'orphaned';
            }
            
            nodes.push({
              data: {
                id: range.uri,
                label: range.label,
                type: 'class',
                category: nodeCategory
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

// Function to create and configure Cytoscape instance
function createClassDiagram(hierarchy) {
  const container = document.getElementById('cytoscape-container');
  
  if (!container) {
    console.error('Cytoscape container not found!');
    return;
  }
  
  // Check if Cytoscape library is loaded
  if (typeof cytoscape === 'undefined') {
    console.error('Cytoscape library not loaded!');
    return;
  }
  
  // Clear existing instance
  if (cytoscapeInstance) {
    cytoscapeInstance.destroy();
  }
  
  const { nodes, edges } = buildCytoscapeData(hierarchy);
  
  cytoscapeInstance = cytoscape({
    container: container,
    elements: [...nodes, ...edges],
    style: [
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
    ],
    layout: {
      name: 'preset',
      animate: true,
      animationDuration: 1000
    },
    wheelSensitivity: 0.1,
    minZoom: 0.1,
    maxZoom: 3
  });
  
  // Fit to container after layout
  cytoscapeInstance.ready(() => {
    setTimeout(() => {
      cytoscapeInstance.fit();
      cytoscapeInstance.center();
    }, 100);
  });
}

// Function to reset diagram layout
function resetDiagramLayout() {
  if (cytoscapeInstance) {
    cytoscapeInstance.layout({
      name: 'preset',
      animate: true,
      animationDuration: 1000
    }).run();
  }
}

// Function to fit diagram to screen
function fitDiagram() {
  if (cytoscapeInstance) {
    cytoscapeInstance.fit();
    cytoscapeInstance.center();
    
    // Reduce zoom by 10% to make it smaller
    const currentZoom = cytoscapeInstance.zoom();
    cytoscapeInstance.zoom(currentZoom * 0.9);
    cytoscapeInstance.center();
  }
}

// Function to switch between tabs
function switchTab(tabName) {
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
    
    if (cytoscapeInstance) {
      setTimeout(() => {
        cytoscapeInstance.resize();
        fitDiagram();
      }, 300);
    }
  }
}

// Function to debug diagram data
function debugDiagramData() {
  console.log('=== DIAGRAM DEBUG INFO ===');
  console.log('Class Data:', classData);
  console.log('Namespaces:', namespaces);
  
  if (cytoscapeInstance) {
    console.log('Cytoscape Nodes:', cytoscapeInstance.nodes().map(n => ({ id: n.id(), data: n.data() })));
    console.log('Cytoscape Edges:', cytoscapeInstance.edges().map(e => ({ id: e.id(), data: e.data(), source: e.source().id(), target: e.target().id() })));
  } else {
    console.log('No Cytoscape instance found');
  }
  console.log('=== END DEBUG INFO ===');
}

// Make functions globally available
window.loadFile = loadFile;
window.toggleNode = toggleNode;
window.switchTab = switchTab;
window.selectClass = selectClass;
window.resetDiagramLayout = resetDiagramLayout;
window.fitDiagram = fitDiagram;
window.debugDiagramData = debugDiagramData;

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  console.log('Tauri app initialized');
});