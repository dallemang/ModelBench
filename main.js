import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { createClassDiagram } from './js/cytoscape-renderer.js';
import { switchTab, resetLayout, fitToScreen, debugDiagramData } from './js/ui-controls.js';
import { buildTreeHtml, selectClass, toggleNode, setTreeState, getClassData, getNamespaces } from './js/tree-builder.js';

// Function to handle file loading
// extra
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
              <strong>Base URI:</strong> ${response.base_uri}<br>
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
          
          // Store namespaces and update tree state
          const namespaces = response.namespaces || {};
          setTreeState({}, namespaces);
          
          // Populate Class Hierarchy tab (main view)
          const hierarchyTree = document.getElementById('hierarchy-tree');
          
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
            // Create deep copy for diagram to avoid corruption from tree building
            const hierarchyCopy = JSON.parse(JSON.stringify(response.class_hierarchy));
            createClassDiagram(hierarchyCopy);
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

// Make functions globally available for HTML onclick handlers
window.loadFile = loadFile;
window.toggleNode = toggleNode;
window.switchTab = switchTab;
window.selectClass = selectClass;
window.resetDiagramLayout = resetLayout;
window.fitDiagram = fitToScreen;
window.debugDiagramData = debugDiagramData;

// Expose state functions for debugging
window.getClassData = getClassData;
window.getNamespaces = getNamespaces;

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  console.log('Tauri app initialized');
});

// Enable hot module replacement for development
if (import.meta.hot) {
  // Force full reload when any of our modules change
  import.meta.hot.accept('./js/cytoscape-renderer.js', () => {
    console.log('Cytoscape renderer module updated - reloading');
    window.location.reload();
  });
  import.meta.hot.accept('./js/ui-controls.js', () => {
    console.log('UI controls module updated - reloading');
    window.location.reload();
  });
  import.meta.hot.accept('./js/tree-builder.js', () => {
    console.log('Tree builder module updated - reloading');
    window.location.reload();
  });
  import.meta.hot.accept('./js/layout.js', () => {
    console.log('Layout module updated - reloading');
    window.location.reload();
  });
  import.meta.hot.accept('./js/cytoscape-builder.js', () => {
    console.log('Cytoscape builder module updated - reloading');
    window.location.reload();
  });
}
