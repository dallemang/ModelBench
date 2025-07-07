/**
 * SPARQL Query module for OntoBench
 * Handles SPARQL query execution and result display
 */

// Run SPARQL query
async function runSparqlQuery() {
    const queryInput = document.getElementById('sparql-query-input');
    const resultsDiv = document.getElementById('query-results');
    const statusDiv = document.getElementById('query-status');
    const runButton = document.getElementById('run-query-btn');
    
    if (!queryInput || !resultsDiv || !statusDiv) {
        console.error('Query UI elements not found');
        return;
    }
    
    const query = queryInput.value.trim();
    if (!query) {
        showQueryStatus('Please enter a SPARQL query', 'error');
        return;
    }
    
    // Disable run button and show loading
    runButton.disabled = true;
    runButton.textContent = '⏳ Running...';
    showQueryStatus('Executing query...', 'info');
    
    try {
        // Import Tauri API
        const { invoke } = await import('@tauri-apps/api/core');
        
        // Execute query through Tauri backend
        const response = await invoke('query_graph', { sparqlQuery: query });
        
        // Tauri wraps the response in a 'data' property
        const data = response.data || response;
        
        if (data.error) {
            showQueryStatus(`Query Error: ${data.error}`, 'error');
            resultsDiv.innerHTML = '<div style="padding: 20px; color: #dc3545;">Query failed. See error message above.</div>';
        } else {
            // Display results
            displayQueryResults(data, resultsDiv);
            showQueryStatus(`Query completed successfully. ${data.count || data.results?.length || 0} results.`, 'success');
        }
        
    } catch (error) {
        console.error('SPARQL query failed:', error);
        showQueryStatus(`Error: ${error.message}`, 'error');
        resultsDiv.innerHTML = '<div style="padding: 20px; color: #dc3545;">Query execution failed.</div>';
    } finally {
        // Re-enable run button
        runButton.disabled = false;
        runButton.textContent = '▶ Run Query';
    }
}

// Display query results in table format
function displayQueryResults(data, container) {
    if (!data.results || data.results.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No results found.</div>';
        return;
    }
    
    const results = data.results;
    const variables = data.variables || [];
    
    // Calculate initial column widths
    const columnWidths = calculateColumnWidths(variables, results);
    
    // Create table
    let tableHtml = '<table class="query-results-table" id="query-results-table">';
    
    // Header row with resizers
    if (variables.length > 0) {
        tableHtml += '<thead><tr>';
        variables.forEach((variable, index) => {
            const width = columnWidths[index];
            tableHtml += `<th style="width: ${width}px;" data-column="${index}">
                ${escapeHtml(variable)}
                ${index < variables.length - 1 ? '<div class="column-resizer" data-column="' + index + '"></div>' : ''}
            </th>`;
        });
        tableHtml += '</tr></thead>';
    }
    
    // Data rows
    tableHtml += '<tbody>';
    results.forEach(row => {
        tableHtml += '<tr>';
        variables.forEach(variable => {
            const value = row[variable] || '';
            tableHtml += `<td>${formatResultValue(value)}</td>`;
        });
        tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';
    
    container.innerHTML = tableHtml;
    
    // Add column resizing functionality
    setupColumnResizing();
}

// Calculate initial column widths based on content
function calculateColumnWidths(variables, results) {
    const minWidth = 100;
    const maxWidth = 300;
    const containerWidth = document.getElementById('query-results')?.clientWidth || 800;
    
    // Calculate content-based widths
    const widths = variables.map((variable, colIndex) => {
        // Start with header width
        let maxContentWidth = variable.length * 8 + 30; // Rough character width estimation
        
        // Check first few rows for content width
        const sampleRows = results.slice(0, 10);
        sampleRows.forEach(row => {
            const value = row[variable] || '';
            const valueStr = String(value);
            // Estimate width needed (characters * average char width + padding)
            const estimatedWidth = Math.min(valueStr.length * 7 + 24, maxWidth);
            maxContentWidth = Math.max(maxContentWidth, estimatedWidth);
        });
        
        return Math.max(minWidth, Math.min(maxWidth, maxContentWidth));
    });
    
    // Adjust if total width exceeds container
    const totalWidth = widths.reduce((sum, w) => sum + w, 0);
    if (totalWidth > containerWidth - 20) {
        const scale = (containerWidth - 20) / totalWidth;
        return widths.map(w => Math.max(minWidth, w * scale));
    }
    
    return widths;
}

// Global resize state to prevent conflicts
let currentResizer = null;

// Setup column resizing functionality
function setupColumnResizing() {
    const table = document.getElementById('query-results-table');
    if (!table) return;
    
    // Clean up any existing global listeners
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', handleResizeEnd);
    
    const resizers = table.querySelectorAll('.column-resizer');
    
    resizers.forEach(resizer => {
        const columnIndex = parseInt(resizer.dataset.column);
        
        resizer.addEventListener('mousedown', (e) => {
            if (currentResizer) return; // Prevent multiple simultaneous resizes
            
            currentResizer = {
                element: resizer,
                startX: e.clientX,
                startWidth: resizer.parentElement.offsetWidth,
                columnIndex: columnIndex
            };
            
            resizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            
            // Add global listeners
            document.addEventListener('mousemove', handleResize);
            document.addEventListener('mouseup', handleResizeEnd);
            
            e.preventDefault();
            e.stopPropagation();
        });
    });
}

function handleResize(e) {
    if (!currentResizer) return;
    
    const deltaX = e.clientX - currentResizer.startX;
    const newWidth = Math.max(80, Math.min(500, currentResizer.startWidth + deltaX));
    
    // Only update the header column width
    const th = currentResizer.element.parentElement;
    th.style.width = newWidth + 'px';
}

function handleResizeEnd() {
    if (!currentResizer) return;
    
    currentResizer.element.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    // Remove global listeners
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', handleResizeEnd);
    
    currentResizer = null;
}

// Format individual result values
function formatResultValue(value) {
    if (!value) return '<em style="color: #999;">null</em>';
    
    const escaped = escapeHtml(String(value));
    
    // If it looks like a URI, make it a bit more readable
    if (escaped.startsWith('http://') || escaped.startsWith('https://')) {
        // Extract local name for display, but show full URI in title
        let displayName = escaped;
        if (escaped.includes('#')) {
            displayName = escaped.split('#').pop();
        } else if (escaped.includes('/')) {
            displayName = escaped.split('/').pop();
        }
        
        return `<span title="${escaped}" style="font-family: monospace; color: #0066cc;">${displayName}</span>`;
    }
    
    return `<span style="font-family: monospace;">${escaped}</span>`;
}

// Show query status message
function showQueryStatus(message, type) {
    const statusDiv = document.getElementById('query-status');
    if (!statusDiv) return;
    
    statusDiv.textContent = message;
    statusDiv.className = `query-status-${type}`;
    statusDiv.style.display = 'block';
    
    // Auto-hide success messages after 3 seconds
    if (type === 'success') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }
}

// Clear query input
function clearQuery() {
    const queryInput = document.getElementById('sparql-query-input');
    const resultsDiv = document.getElementById('query-results');
    const statusDiv = document.getElementById('query-status');
    
    if (queryInput) queryInput.value = '';
    if (resultsDiv) {
        resultsDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: #666; font-style: italic;">No query results yet. Enter a SPARQL query and click "Run Query" to see results.</div>';
    }
    if (statusDiv) statusDiv.style.display = 'none';
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Export functions for global access
window.runSparqlQuery = runSparqlQuery;
window.clearQuery = clearQuery;