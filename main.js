import { apiGet, apiPost, apiUpload, BACKEND } from './js/api.js';
import { createClassDiagram, resetViewportState } from './js/cytoscape-renderer.js';
import { switchTab, resetLayout, fitToScreen, debugDiagramData, setLayoutType, setHierarchyData, getCurrentLayoutType, toggleDark } from './js/ui-controls.js';
import { buildTreeHtml, selectClass, selectOntology, toggleNode, setTreeState, getClassData, getNamespaces, countClasses } from './js/tree-builder.js';
import { assignColorsToGraphs } from './js/color-utils.js';

// Helper function to render import details recursively
function renderImportDetails(imports, level = 0) {
  if (!imports || imports.length === 0) return '';
  
  const indent = '  '.repeat(level);
  return imports.map(imp => `
    <div style="margin: 5px 0; margin-left: ${level * 20}px; padding: 8px; background: white; border-radius: 3px; border-left: 4px solid ${
      imp.status === 'loaded' ? '#28a745' :
      imp.status === 'fetched' ? '#6f42c1' :
      imp.status === 'already_loaded' ? '#17a2b8' :
      imp.status === 'skipped' ? '#ffc107' :
      imp.status === 'file_not_found' ? '#fd7e14' : '#dc3545'
    };">
      <strong>${imp.import_uri}</strong>
      <span style="color: ${
        imp.status === 'loaded' ? '#28a745' :
        imp.status === 'fetched' ? '#6f42c1' :
        imp.status === 'already_loaded' ? '#17a2b8' :
        imp.status === 'skipped' ? '#856404' :
        imp.status === 'file_not_found' ? '#fd7e14' : '#721c24'
      }; font-weight: bold;">[${imp.status.toUpperCase().replace('_', ' ')}]</span>
      ${imp.file_path ? `<br><small>File: ${imp.file_path}</small>` : ''}
      ${imp.fetch_url ? `<br><small>Fetched from: ${imp.fetch_url}</small>` : ''}
      ${imp.triples_count ? `<br><small>Triples: ${imp.triples_count}</small>` : ''}
      ${imp.error ? `<br><small style="color: #dc3545;">Error: ${imp.error}</small>` : ''}
      ${imp.nested_imports && imp.nested_imports.length > 0 ? `
        <div style="margin-top: 10px;">
          <small><strong>Nested imports (${imp.nested_imports.length}):</strong></small>
          ${renderImportDetails(imp.nested_imports, level + 1)}
        </div>
      ` : ''}
    </div>
  `).join('');
}

// Function to flatten import_results recursively for table display
function flattenImportResults(imports) {
  if (!imports || imports.length === 0) return [];
  
  let flattened = [];
  
  for (const imp of imports) {
    // Only include loaded, skipped, and error statuses
    if (['loaded', 'fetched', 'skipped', 'error', 'fetch_failed', 'file_not_found'].includes(imp.status)) {
      flattened.push({
        import_uri: imp.import_uri,
        status: imp.status,
        file_path: imp.file_path || '',
        error: imp.error || '',
        triples_count: imp.triples_count || 0
      });
    }
    
    // Recursively add nested imports
    if (imp.nested_imports && imp.nested_imports.length > 0) {
      flattened = flattened.concat(flattenImportResults(imp.nested_imports));
    }
  }
  
  return flattened;
}

// Function to build imports table HTML
function buildImportsTable(importResults) {
  if (!importResults || importResults.length === 0) {
    return `
      <div style="padding: 20px; text-align: center; color: #666; font-style: italic;">
        No import data available. Load an ontology to see its imports.
      </div>
    `;
  }
  
  const flatImports = flattenImportResults(importResults);
  
  if (flatImports.length === 0) {
    return `
      <div style="padding: 20px; text-align: center; color: #666; font-style: italic;">
        No imports found in the loaded ontology.
      </div>
    `;
  }
  
  const resolutionLabel = {
    uri_map: { text: 'URI map', color: '#155724', bg: '#d4edda' },
    local_file: { text: 'local file', color: '#004085', bg: '#cce5ff' },
    fyn: { text: 'FYN', color: '#6f42c1', bg: '#e8d5ff' },
    url_heuristic: { text: 'URL heuristic', color: '#856404', bg: '#fff3cd' },
  };

  const tableRows = flatImports.map(imp => {
    const isError = imp.status === 'error' || imp.status === 'fetch_failed';
    const uriStyle = isError ? 'color: #dc3545; font-weight: bold;' : '';
    const tooltip = isError && imp.error ? `title="${imp.error}"` : '';
    const res = imp.resolution && resolutionLabel[imp.resolution];
    const resCell = res
      ? `<span style="font-size:11px; padding:1px 5px; border-radius:3px; background:${res.bg}; color:${res.color};">${res.text}</span>`
      : (imp.status === 'fetch_failed' ? `<span style="font-size:11px; color:#dc3545;">failed</span>` : '');

    return `
      <tr>
        <td class="uri-cell" style="${uriStyle}" ${tooltip}>
          ${imp.import_uri}
        </td>
        <td style="text-align:center;">${resCell}</td>
        <td class="file-path-cell">${imp.file_path || imp.fetch_url || ''}</td>
        <td style="text-align: center;">${imp.triples_count > 0 ? imp.triples_count : ''}</td>
      </tr>
    `;
  }).join('');

  return `
    <table class="imports-table">
      <thead>
        <tr>
          <th>Ontology URI</th>
          <th>Via</th>
          <th>Source</th>
          <th>Triples</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

// API base URL will be set by AI interface initialization
// DO NOT set a hardcoded value here as it overrides port detection

// Function to detect the current Python backend port
async function detectBackendPort() {
  try {
    // Try to get graph info which will trigger the backend to start if needed
    const result = await apiGet('/graph_info');
    // If successful, we can try to detect the actual port by checking network requests
    // For now, we'll use a default approach
    
    // Check if we can reach different ports by trying health endpoints
    const ports = [8731, 62041, 61918]; // Common ports
    
    for (const port of ports) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) {
          window.API_BASE_URL = `http://127.0.0.1:${port}`;
          console.log(`Detected backend on port ${port}`);
          return;
        }
      } catch (e) {
        // Port not available, try next
      }
    }
  } catch (error) {
    console.warn('Could not detect backend port, using default');
  }
}

// Function to handle file loading
// extra
async function handleLoadResponse(response, source) {
  const graphStats = document.getElementById('graph-stats');
  if (response.error) {
    graphStats.innerHTML = `
      <div style="color: #dc3545; padding: 15px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; margin-bottom: 15px;">
        <strong>Error loading:</strong> ${source}<br>
        <strong>Error:</strong> ${response.error}
      </div>
    `;
    return;
  }
  if (!response.success) return;

  document.getElementById('tab-container').style.display = 'block';

  graphStats.innerHTML = `
    <div style="padding: 15px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; margin-bottom: 15px; color: #155724;">
      <strong>✓ Successfully loaded:</strong> ${source}<br>
      <strong>Base URI:</strong> ${response.base_uri}<br>
      <strong>Main file triples:</strong> ${response.triples_count}<br>
      ${response.total_graphs && response.total_triples ? `<strong>Total dataset:</strong> ${response.total_graphs} graphs, ${response.total_triples} triples` : ''}
      ${response.uri_map_size != null ? `<br><strong>URI map:</strong> ${response.uri_map_size} entries indexed from uploaded directory${response.entry_file ? ` | entry: ${response.entry_file.split(/[\\/]/).pop()}` : ''}` : ''}
    </div>

    <h3>Graph Statistics</h3>
    <div class="stats-grid">
      <div><strong>Triples:</strong> ${response.triples_count}</div>
      <div><strong>Subjects:</strong> ${response.subjects_count}</div>
      <div><strong>Predicates:</strong> ${response.predicates_count}</div>
      <div><strong>Objects:</strong> ${response.objects_count}</div>
      <div><strong>Classes:</strong> ${response.classes_count}</div>
      <div><strong>Object Properties:</strong> ${response.object_properties_count}</div>
      <div><strong>Datatype Properties:</strong> ${response.datatype_properties_count}</div>
      <div><strong>Total Properties:</strong> ${response.properties_count}</div>
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
    ${response.namespace_conflicts && response.namespace_conflicts.length > 0 ? `
      <h4 style="color: #dc3545;">⚠ Namespace Conflicts</h4>
      <div style="background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; padding: 10px; margin: 10px 0;">
        ${response.namespace_conflicts.map(conflict =>
          `<div style="color: #721c24; margin: 5px 0; font-family: monospace; font-size: 13px;"><strong>WARNING:</strong> ${conflict}</div>`
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
    ${response.imports && response.imports.length > 0 ? `
      <h4>Imports (${response.imports_count})</h4>
      <div style="background: #e7f3ff; padding: 10px; border-radius: 4px; margin: 10px 0;">
        <strong>Loaded Graphs:</strong> ${response.loaded_graphs ? response.loaded_graphs.length : 0}<br>
        ${response.loaded_graphs ? `
          <div style="margin: 10px 0;">
            ${response.loaded_graphs.map(graph => `<div><code>${graph}</code></div>`).join('')}
          </div>
        ` : ''}
        <strong>Import Details:</strong>
        <div style="margin: 10px 0;">
          ${renderImportDetails(response.imports)}
        </div>
      </div>
    ` : ''}

    <h4>Raw Response</h4>
    <pre style="background: #f8f9fa; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px;">${JSON.stringify(response, null, 2)}</pre>
  `;

  setTreeState({}, response.namespaces || {});

  const importsTableContainer = document.getElementById('imports-table-container');
  if (importsTableContainer) {
    importsTableContainer.innerHTML = buildImportsTable(response.imports);
  }

  await buildHierarchyFromBackend();

  try {
    await buildImportHierarchyFromBackend();
  } catch (error) {
    console.error('Import hierarchy failed, but continuing:', error);
  }

  switchTab('hierarchy');
}

async function loadDirectory() {
  let input = document.getElementById('rdf-dir-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'rdf-dir-input';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('multiple', '');
    input.style.position = 'fixed';
    input.style.top = '-9999px';
    input.style.left = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);
  }

  input.onchange = async () => {
    const files = Array.from(input.files);
    input.value = '';
    if (files.length === 0) return;

    const dirName = files[0].webkitRelativePath.split('/')[0];
    resetViewportState();
    const graphStats = document.getElementById('graph-stats');
    graphStats.innerHTML = `<p>Uploading directory: ${dirName} (${files.length} files)...</p>`;
    document.getElementById('tab-container').style.display = 'block';
    switchTab('log');

    try {
      const form = new FormData();
      for (const file of files) {
        form.append('files', file);
        form.append('paths', file.webkitRelativePath);
      }
      const res = await fetch(BACKEND + '/upload_directory', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({ error: res.statusText }));
      if (!res.ok) throw new Error(data.detail || data.error || res.statusText);
      await handleLoadResponse(data, dirName);
    } catch (error) {
      graphStats.innerHTML = `
        <div style="color: #dc3545; padding: 15px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; margin-bottom: 15px;">
          <strong>Backend Error:</strong> ${error}
        </div>
      `;
      document.getElementById('tab-container').style.display = 'block';
      switchTab('log');
    }
  };

  input.click();
}

async function loadFile() {
  // Trigger hidden file input
  let input = document.getElementById('rdf-file-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'rdf-file-input';
    input.accept = '.ttl,.rdf,.owl,.n3,.nt';
    input.style.display = 'none';
    document.body.appendChild(input);
  }

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    input.value = '';

    resetViewportState();
    const graphStats = document.getElementById('graph-stats');
    graphStats.innerHTML = `<p>Loading: ${file.name}...</p>`;
    document.getElementById('tab-container').style.display = 'block';
    switchTab('log');

    try {
      const response = await apiUpload('/upload_rdf', file);
      await handleLoadResponse(response, file.name);
    } catch (error) {
      graphStats.innerHTML = `
        <div style="color: #dc3545; padding: 15px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; margin-bottom: 15px;">
          <strong>Backend Error:</strong> ${error}
        </div>
      `;
      document.getElementById('tab-container').style.display = 'block';
      switchTab('log');
    }
  };

  input.click();
}

// Function to close/clear the dataset
async function closeDataset() {
  try {
    // Call the backend to clear the dataset
    const response = await apiPost('/clear_dataset', {});
    
    console.log('Clear dataset response:', response);
    
    if (response.success) {
      // Clear the UI state
      resetViewportState();
      
      // Hide tab container
      document.getElementById('tab-container').style.display = 'none';
      
      // Clear all tab content
      document.getElementById('hierarchy-tree').innerHTML = '';
      document.getElementById('import-hierarchy-tree').innerHTML = '';
      document.getElementById('class-details').innerHTML = `
        <div class="no-selection">
          <p>Select a class from the hierarchy to view its details</p>
        </div>
      `;
      document.getElementById('ontology-details').innerHTML = `
        <div class="no-selection">
          <p>Select an ontology from the hierarchy to view its details</p>
        </div>
      `;
      document.getElementById('graph-stats').innerHTML = '';
      
      // Clear imports table
      const importsTableContainer = document.getElementById('imports-table-container');
      if (importsTableContainer) {
        importsTableContainer.innerHTML = buildImportsTable(null);
      }
      
      // Clear cytoscape container
      const cytoscapeContainer = document.getElementById('cytoscape-container');
      if (cytoscapeContainer) {
        cytoscapeContainer.innerHTML = '';
      }
      
      // Reset tree state
      setTreeState({}, {});
      
      console.log('Dataset closed and UI cleared');
    } else {
      console.error('Failed to clear dataset:', response.error || 'Unknown error');
      alert('Failed to close dataset: ' + (response.error || 'Unknown error'));
    }
    
  } catch (error) {
    console.error('Error closing dataset:', error);
    alert('Error closing dataset: ' + error);
  }
}

async function loadFromUrl() {
  const uri = prompt('Enter the URI of an RDF ontology to load:');
  if (!uri || !uri.trim()) return;
  const trimmed = uri.trim();

  resetViewportState();
  const graphStats = document.getElementById('graph-stats');
  graphStats.innerHTML = `<p>Fetching: ${trimmed}...</p>`;
  document.getElementById('tab-container').style.display = 'block';
  switchTab('log');

  try {
    const response = await apiPost('/load_rdf', { file_path: trimmed });
    await handleLoadResponse(response, trimmed);
  } catch (error) {
    graphStats.innerHTML = `
      <div style="color: #dc3545; padding: 15px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; margin-bottom: 15px;">
        <strong>Error loading URI:</strong> ${trimmed}<br>
        <strong>Error:</strong> ${error}
      </div>
    `;
  }
}

// Group all top-level external/inferred nodes under a single synthetic [EXTERNAL] root
function groupExternalClasses(hierarchy) {
  const defined = hierarchy.filter(n => !n.is_inferred);
  const external = hierarchy.filter(n => n.is_inferred);
  if (external.length === 0) return hierarchy;

  const externalRoot = {
    uri: 'urn:ontobench:external-root',
    label: '[EXTERNAL]',
    is_inferred: false,
    children: external,
    properties: [],
    annotations: [],
    graph_source: 'synthetic'
  };
  return [...defined, externalRoot];
}

// Navigate to a class: switch to hierarchy tab then select it
function navigateToClass(uri) {
  switchTab('hierarchy');
  // Small delay so the tab is visible before selectClass tries to scroll
  setTimeout(() => selectClass(uri), 50);
}

// Search classes by label or URI fragment, return up to 15 matches.
// Ranking: exact label match > label starts-with > label contains > URI contains
function searchClasses(query) {
  const data = getClassData();
  const q = query.toLowerCase();
  const results = [];
  for (const cls of Object.values(data)) {
    const label = cls.label.toLowerCase();
    const uri = cls.uri.toLowerCase();
    if (label === q)                      results.push({ cls, rank: 0 });
    else if (label.startsWith(q))         results.push({ cls, rank: 1 });
    else if (label.includes(q))           results.push({ cls, rank: 2 });
    else if (uri.includes(q))             results.push({ cls, rank: 3 });
  }
  results.sort((a, b) => a.rank - b.rank || a.cls.label.localeCompare(b.cls.label));
  return results.slice(0, 15).map(r => r.cls);
}

// Handle search input in the hierarchy tab
function onClassSearch(query) {
  const resultsDiv = document.getElementById('class-search-results');
  if (!resultsDiv) return;

  if (!query.trim()) {
    resultsDiv.style.display = 'none';
    resultsDiv.innerHTML = '';
    return;
  }

  const matches = searchClasses(query);
  if (matches.length === 0) {
    resultsDiv.style.display = 'none';
    return;
  }

  resultsDiv.innerHTML = '';
  matches.forEach(cls => {
    const div = document.createElement('div');
    div.style.cssText = 'padding: 6px 10px; cursor: pointer; border-bottom: 1px solid #eee;';
    div.onmouseover = () => div.style.background = '#f0f7ff';
    div.onmouseout = () => div.style.background = '';
    const label = document.createElement('strong');
    label.textContent = cls.label;
    const uri = document.createElement('span');
    uri.textContent = ' ' + cls.uri;
    uri.style.cssText = 'font-size: 11px; color: #888; font-family: monospace;';
    div.appendChild(label);
    div.appendChild(uri);
    div.onclick = () => {
      document.getElementById('class-search-input').value = '';
      resultsDiv.style.display = 'none';
      navigateToClass(cls.uri);
    };
    resultsDiv.appendChild(div);
  });
  resultsDiv.style.display = 'block';
}

let helpLoaded = false;

async function showHelp() {
  const overlay = document.getElementById('help-modal-overlay');
  const body = document.getElementById('help-modal-body');
  overlay.style.display = 'block';

  if (!helpLoaded) {
    try {
      const res = await fetch('/HELP.md');
      if (!res.ok) throw new Error(res.statusText);
      const markdown = await res.text();
      body.innerHTML = marked.parse(markdown);
      helpLoaded = true;
    } catch (error) {
      body.innerHTML = `<p style="color: #dc3545;">Could not load help content: ${error}</p>`;
    }
  }
}

function closeHelp() {
  document.getElementById('help-modal-overlay').style.display = 'none';
}

// Make functions globally available for HTML onclick handlers
window.loadFile = loadFile;
window.loadDirectory = loadDirectory;
window.loadFromUrl = loadFromUrl;
window.closeDataset = closeDataset;
window.showHelp = showHelp;
window.closeHelp = closeHelp;
window.toggleNode = toggleNode;
window.switchTab = switchTab;
window.selectClass = selectClass;
window.selectOntology = selectOntology;
window.resetDiagramLayout = resetLayout;
window.fitDiagram = fitToScreen;
window.debugDiagramData = debugDiagramData;
window.toggleDarkMode = toggleDark;
window.setLayoutType = setLayoutType;
window.navigateToClass = navigateToClass;
window.getClassData = getClassData;
window.onClassSearch = onClassSearch;

// Expose state functions for debugging
window.getClassData = getClassData;
window.getNamespaces = getNamespaces;

// Initialize the app
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Tauri app initialized');
  // Detect backend port for AI interface
  await detectBackendPort();
});

// Function to build hierarchy and diagram from backend
async function buildHierarchyFromBackend() {
  try {
    console.log('Building hierarchy from backend...');
    
    // Query the backend for current hierarchy
    const response = await apiGet('/hierarchy');
    
    if (response.success && response.hierarchy) {
      console.log('Got hierarchy from backend:', response.hierarchy.length, 'root nodes');
      
      if (response.hierarchy.length > 0) {
        const graphColorMap = assignColorsToGraphs(response.hierarchy);
        
        window.currentGraphColorMap = graphColorMap;
        
        // Count total classes and update the title (before grouping, so counts are accurate)
        const { total, defined, external } = countClasses(response.hierarchy);
        const hierarchyTitle = document.querySelector('#tab-hierarchy h3');
        if (hierarchyTitle) {
          hierarchyTitle.textContent = external > 0
            ? `Class Hierarchy (${total} classes: ${defined} defined, ${external} external)`
            : `Class Hierarchy (${total} classes)`;
        }

        // Group all top-level external/inferred nodes under a single [EXTERNAL] mock root
        const displayHierarchy = groupExternalClasses(response.hierarchy);

        const hierarchyTree = document.getElementById('hierarchy-tree');
        hierarchyTree.innerHTML = buildTreeHtml(displayHierarchy, graphColorMap);
        
        document.getElementById('class-details').innerHTML = `
          <div class="no-selection">
            <p>Select a class from the hierarchy to view its details</p>
          </div>
        `;
        
        const hierarchyCopy = JSON.parse(JSON.stringify(response.hierarchy));
        
        setHierarchyData(hierarchyCopy);

        // Defer diagram creation until the diagram tab is shown,
        // so Cytoscape gets a properly-sized container.
        window.pendingDiagramData = hierarchyCopy;
      } else {
        const hierarchyTree = document.getElementById('hierarchy-tree');
        hierarchyTree.innerHTML = `
          <p style="color: #666; font-style: italic;">No class hierarchy found.</p>
          <p style="color: #666; font-size: 14px;">This might be because:</p>
          <ul style="color: #666; font-size: 14px; margin-left: 20px;">
            <li>The file contains no OWL/RDFS class definitions</li>
            <li>Classes are not linked with rdfs:subClassOf relationships</li>
            <li>The file contains only instance data</li>
          </ul>
        `;
      }
      
    } else {
      console.error('Failed to get hierarchy from backend:', response.error);
      
      // Show error in hierarchy tab
      const hierarchyTree = document.getElementById('hierarchy-tree');
      hierarchyTree.innerHTML = `
        <div style="color: #dc3545; padding: 15px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px;">
          <strong>Error loading hierarchy:</strong> ${response.error || 'Unknown error'}
        </div>
      `;
    }
    
  } catch (error) {
    console.error('Error building hierarchy from backend:', error);
    
    // Show error in hierarchy tab
    const hierarchyTree = document.getElementById('hierarchy-tree');
    hierarchyTree.innerHTML = `
      <div style="color: #dc3545; padding: 15px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px;">
        <strong>Backend Error:</strong> ${error}
      </div>
    `;
  }
}

async function buildImportHierarchyFromBackend() {
  try {
    
    // Add loading indicator
    const importHierarchyTree = document.getElementById('import-hierarchy-tree');
    importHierarchyTree.innerHTML = '<p>⏳ Loading import hierarchy...</p>';
    
    const startTime = Date.now();
    
    // Add a timeout to the backend call
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Backend timeout after 30 seconds')), 30000);
    });
    
    // Race the actual call against the timeout
    const response = await Promise.race([
      apiGet('/import_hierarchy'),
      timeoutPromise
    ]);
    
    const endTime = Date.now();
    
    
    if (response && response.success && response.hierarchy) {
      
      if (response.hierarchy.length > 0) {
        const graphColorMap = assignColorsToGraphs(response.hierarchy);
        
        const treeHtml = buildTreeHtml(response.hierarchy, graphColorMap, 'ontology');
        
        importHierarchyTree.innerHTML = treeHtml;
        
        document.getElementById('ontology-details').innerHTML = `
          <div class="no-selection">
            <p>Select an ontology from the hierarchy to view its details</p>
          </div>
        `;
        
        setHierarchyData(response.hierarchy, 'import');
      } else {
        importHierarchyTree.innerHTML = '<p>No import relationships found in the loaded ontologies.</p>';
        
        document.getElementById('ontology-details').innerHTML = `
          <div class="no-selection">
            <p>No import hierarchy available</p>
          </div>
        `;
      }
    } else {
      console.error('❌ DEBUG: Invalid response from backend');
      console.error('📦 DEBUG: Full response object:', response);
      console.error('🔍 DEBUG: response.success:', response?.success);
      console.error('🔍 DEBUG: response.hierarchy:', response?.hierarchy);
      console.error('🔍 DEBUG: response.error:', response?.error);
      
      importHierarchyTree.innerHTML = `
        <div style="color: #dc3545; padding: 10px; background: #f8d7da; border-radius: 4px;">
          <strong>Failed to load import hierarchy</strong><br>
          <small>Error: ${response?.error || 'Unknown error'}</small><br>
          <small>Response: ${JSON.stringify(response, null, 2)}</small>
        </div>
      `;
    }
  } catch (error) {
    console.error('💥 DEBUG: Exception in buildImportHierarchyFromBackend:', error);
    console.error('💥 DEBUG: Error stack:', error.stack);
    
    const importHierarchyTree = document.getElementById('import-hierarchy-tree');
    importHierarchyTree.innerHTML = `
      <div style="color: #dc3545; padding: 10px; background: #f8d7da; border-radius: 4px;">
        <strong>Exception loading import hierarchy</strong><br>
        <small>Error: ${error.message}</small><br>
        <small>Check console for details</small>
      </div>
    `;
  }
}

// Make the functions globally available
window.buildHierarchyFromBackend = buildHierarchyFromBackend;
window.buildImportHierarchyFromBackend = buildImportHierarchyFromBackend;

// Initialize AI interface on page load
document.addEventListener('DOMContentLoaded', async () => {
  if (window.initAI) {
    try {
      await window.initAI();
      console.log('AI interface initialized successfully');
    } catch (error) {
      console.error('Failed to initialize AI interface:', error);
    }
  }
});

// Enable hot module replacement for development
if (import.meta.hot) {
  // Force full reload when any of our modules change
  import.meta.hot.accept('./js/cytoscape-renderer.js', () => {
    console.log('HMR: Cytoscape renderer module updated - reloading');
    window.location.reload();
  });
  import.meta.hot.accept('./js/ui-controls.js', () => {
    console.log('HMR: UI controls module updated - reloading');
    window.location.reload();
  });
  import.meta.hot.accept('./js/tree-builder.js', () => {
    console.log('HMR: Tree builder module updated - reloading');
    window.location.reload();
  });
  import.meta.hot.accept('./js/layout.js', () => {
    console.log('HMR: Layout module updated - reloading');
    window.location.reload();
  });
  import.meta.hot.accept('./js/cytoscape-builder.js', () => {
    console.log('HMR: Cytoscape builder module updated - reloading');
    window.location.reload();
  });
}
