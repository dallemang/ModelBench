/**
 * SPARQL Query module for OntoBench
 * Handles SPARQL query execution and result display
 */

// Run SPARQL query
async function runSparqlQuery() {
    console.log('runSparqlQuery called'); // Debug logging
    
    const queryInput = document.getElementById('sparql-query-input');
    const resultsDiv = document.getElementById('query-results');
    const statusDiv = document.getElementById('query-status');
    const runButton = document.getElementById('run-query-btn');
    
    console.log('Elements found:', {queryInput, resultsDiv, statusDiv, runButton}); // Debug logging
    
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
        
        console.log('Query response:', response); // Debug logging
        
        if (data && data.error) {
            showQueryStatus(`${data.error}`, 'error');
            resultsDiv.innerHTML = `<div style="padding: 20px; color: #dc3545; font-family: monospace; white-space: pre-wrap; line-height: 1.4;">${escapeHtml(data.error)}</div>`;
        } else if (data && data.success) {
            // Display results
            displayQueryResults(data, resultsDiv);
            showQueryStatus(`Query completed successfully. ${data.count || data.results?.length || 0} results.`, 'success');
            // Disable Fix button on successful query
            disableFixButton();
        } else {
            // Unexpected response format
            showQueryStatus(`Unexpected response format`, 'error');
            resultsDiv.innerHTML = `<div style="padding: 20px; color: #dc3545;">Unexpected response format. Check console for details.</div>`;
        }
        
    } catch (error) {
        console.error('SPARQL query failed:', error);
        
        // Extract detailed error message from HTTP error
        let errorMessage = error?.message || String(error) || 'Unknown error';
        
        // Check if it's an HTTP error with JSON detail
        if (errorMessage && errorMessage.includes && errorMessage.includes('HTTP error') && errorMessage.includes('{"detail":')) {
            try {
                // Extract the JSON part from the error message
                const jsonStart = errorMessage.indexOf('{"detail":');
                const jsonStr = errorMessage.substring(jsonStart);
                const errorData = JSON.parse(jsonStr);
                errorMessage = errorData.detail || errorMessage;
            } catch (parseError) {
                // If JSON parsing fails, use the original message
                console.warn('Could not parse error JSON:', parseError);
            }
        }
        
        showQueryStatus(errorMessage, 'error');
        resultsDiv.innerHTML = `<div style="padding: 20px; color: #dc3545; font-family: monospace; white-space: pre-wrap; line-height: 1.4;">${escapeHtml(errorMessage)}</div>`;
        
        // Enable Fix button and store error details
        lastFailedQuery = query;
        lastErrorMessage = errorMessage;
        enableFixButton();
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

// Track last query and error for AI fixing
let lastFailedQuery = null;
let lastErrorMessage = null;

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


// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Enable/disable Fix button
function enableFixButton() {
    const fixBtn = document.getElementById('fix-query-btn');
    if (fixBtn) {
        fixBtn.disabled = false;
        fixBtn.style.opacity = '1';
        fixBtn.style.cursor = 'pointer';
    }
}

function disableFixButton() {
    const fixBtn = document.getElementById('fix-query-btn');
    if (fixBtn) {
        fixBtn.disabled = true;
        fixBtn.style.opacity = '0.5';
        fixBtn.style.cursor = 'not-allowed';
    }
}

// Fix SPARQL query using AI
async function fixSparqlQuery() {
    if (!lastFailedQuery || !lastErrorMessage) {
        showQueryStatus('No failed query to fix', 'error');
        return;
    }
    
    const fixBtn = document.getElementById('fix-query-btn');
    const queryInput = document.getElementById('sparql-query-input');
    
    if (!fixBtn || !queryInput) return;
    
    // Disable fix button and show loading
    fixBtn.disabled = true;
    fixBtn.textContent = '🤖 Fixing...';
    fixBtn.style.opacity = '0.5';
    
    showQueryStatus('Asking AI to fix the query...', 'info');
    
    try {
        // Ensure we have the correct backend URL
        if (!window.API_BASE_URL) {
            // Try to detect the backend port if not already set
            const { invoke } = await import('@tauri-apps/api/core');
            try {
                const port = await invoke('get_backend_port');
                window.API_BASE_URL = `http://127.0.0.1:${port}`;
            } catch (e) {
                window.API_BASE_URL = 'http://127.0.0.1:8731'; // fallback
            }
        }
        const apiBaseUrl = window.API_BASE_URL;
        
        console.log('Using AI API base URL:', apiBaseUrl);
        
        // Create AI prompt
        const prompt = `The user tried to write a SPARQL query of this form: ${lastFailedQuery}. This resulted in an error message from the query processor: ${lastErrorMessage}. Please re-write the query to correct for this error. Enclose your new query inside of triple ticks.`;
        
        // Send to AI
        const response = await fetch(`${apiBaseUrl}/ai/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1000,
                temperature: 0.3  // Lower temperature for more precise code fixes
            })
        });
        
        if (!response.ok) {
            throw new Error(`AI request failed: ${response.status} ${response.statusText}`);
        }
        
        const aiResult = await response.json();
        
        if (aiResult.success && aiResult.content) {
            // Extract query from triple ticks
            const fixedQuery = extractQueryFromResponse(aiResult.content);
            
            if (fixedQuery) {
                // Populate the input field with fixed query
                queryInput.value = fixedQuery;
                showQueryStatus('AI suggested a fix! Review the updated query and run it.', 'success');
            } else {
                showQueryStatus('AI responded but no query found in triple ticks', 'error');
            }
        } else {
            throw new Error('AI did not return a successful response');
        }
        
    } catch (error) {
        console.error('AI fix failed:', error);
        showQueryStatus(`AI fix failed: ${error.message}`, 'error');
    } finally {
        // Re-enable fix button
        fixBtn.disabled = false;
        fixBtn.textContent = '🤖 Fix Query';
        fixBtn.style.opacity = '1';
    }
}

// Extract SPARQL query from AI response (looks for content between triple ticks)
function extractQueryFromResponse(content) {
    // Look for content between triple ticks
    const match = content.match(/```[\w]*\n?([\s\S]*?)\n?```/);
    if (match && match[1]) {
        return match[1].trim();
    }
    
    // Fallback: look for SELECT, ASK, CONSTRUCT, or DESCRIBE at start of lines
    const lines = content.split('\n');
    let queryLines = [];
    let inQuery = false;
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (/^(SELECT|ASK|CONSTRUCT|DESCRIBE|PREFIX)/i.test(trimmedLine)) {
            inQuery = true;
            queryLines = [line];
        } else if (inQuery && trimmedLine) {
            queryLines.push(line);
        } else if (inQuery && !trimmedLine) {
            // Empty line might end the query
            break;
        }
    }
    
    return queryLines.length > 0 ? queryLines.join('\n').trim() : null;
}

// Update clearQuery to disable fix button
function clearQuery() {
    const queryInput = document.getElementById('sparql-query-input');
    const resultsDiv = document.getElementById('query-results');
    const statusDiv = document.getElementById('query-status');
    
    if (queryInput) queryInput.value = '';
    if (resultsDiv) {
        resultsDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: #666; font-style: italic;">No query results yet. Enter a SPARQL query and click "Run Query" to see results.</div>';
    }
    if (statusDiv) statusDiv.style.display = 'none';
    
    // Clear error tracking and disable fix button
    lastFailedQuery = null;
    lastErrorMessage = null;
    disableFixButton();
}

// Export functions for global access
window.runSparqlQuery = runSparqlQuery;
window.clearQuery = clearQuery;
window.fixSparqlQuery = fixSparqlQuery;