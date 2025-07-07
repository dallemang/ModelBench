/**
 * AI Interface module for OntoBench
 * Handles AI provider configuration and chat interface
 */

let currentAIConfig = null;
let currentProvidersStatus = null;
let chatMessages = [];

// Function to detect the current Python backend port
async function detectBackendPort() {
    try {
        // Get the backend port directly from Tauri using the proper import
        const { invoke } = await import('@tauri-apps/api/core');
        const port = await invoke('get_backend_port');
        
        window.API_BASE_URL = `http://127.0.0.1:${port}`;
        console.log(`AI interface got backend port ${port} from Tauri`);
        return;
    } catch (e) {
        console.warn('Failed to get backend port from Tauri:', e);
        
        // Fallback: try a few common ports quickly
        const fallbackPorts = [8731, 62886, 62041, 61918];
        for (const port of fallbackPorts) {
            try {
                const response = await fetch(`http://127.0.0.1:${port}/health`);
                if (response.ok) {
                    window.API_BASE_URL = `http://127.0.0.1:${port}`;
                    console.log(`AI interface detected backend on fallback port ${port}`);
                    return;
                }
            } catch (e) {
                // Try next port
            }
        }
        
        console.warn('AI interface could not detect backend port, using default');
        window.API_BASE_URL = 'http://127.0.0.1:8731'; // fallback
    }
}

// Initialize AI interface
async function initAI() {
    try {
        // Detect backend port before making AI calls
        await detectBackendPort();
        await loadAIConfig();
        await loadProvidersStatus();
        setupAIEventListeners();
        console.log('AI interface initialized');
    } catch (error) {
        console.error('Failed to initialize AI interface:', error);
        showAIMessage('system', 'Failed to initialize AI interface. Please check if the Python backend is running.');
    }
}

// Setup event listeners
function setupAIEventListeners() {
    const providerSelect = document.getElementById('ai-provider-select');
    const modelSelect = document.getElementById('ai-model-select');
    const chatInput = document.getElementById('ai-chat-input');
    
    if (providerSelect) {
        providerSelect.addEventListener('change', onProviderChange);
    }
    
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendAIMessage();
            }
        });
    }
}

// Load AI configuration
async function loadAIConfig() {
    try {
        // For now, we'll use a default configuration since we don't have persistent config loading via Tauri yet
        // This should be updated to use Tauri invoke to get config from Python backend
        currentAIConfig = {
            active_provider: "ollama",
            providers: {
                ollama: {
                    base_url: "http://localhost:11434",
                    model: "phi3.5:latest",
                    enabled: true
                },
                openai: {
                    api_key: "",
                    model: "gpt-3.5-turbo",
                    base_url: "https://api.openai.com/v1",
                    enabled: false
                },
                claude: {
                    api_key: "",
                    model: "claude-3-sonnet-20240229",
                    base_url: "https://api.anthropic.com/v1",
                    enabled: false
                }
            }
        };
        updateAIConfigUI();
    } catch (error) {
        console.error('Failed to load AI config:', error);
        throw error;
    }
}

// Load providers status
async function loadProvidersStatus() {
    try {
        const response = await fetch(`${window.API_BASE_URL}/ai/providers`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        currentProvidersStatus = await response.json();
        updateProvidersStatusUI();
        updateModelOptions();
    } catch (error) {
        console.error('Failed to load providers status:', error);
        // Fallback for when AI not available
        currentProvidersStatus = {
            active_provider: "ollama",
            providers: {
                ollama: { available: false, enabled: true, models: [] },
                openai: { available: false, enabled: false, models: [] },
                claude: { available: false, enabled: false, models: [] }
            }
        };
        updateProvidersStatusUI();
        updateModelOptions();
    }
}

// Update AI configuration UI
function updateAIConfigUI() {
    if (!currentAIConfig) return;
    
    const providerSelect = document.getElementById('ai-provider-select');
    if (providerSelect) {
        providerSelect.value = currentAIConfig.active_provider;
    }
    
    updateProviderConfigPanel();
}

// Update provider configuration panel
function updateProviderConfigPanel() {
    const configPanel = document.getElementById('ai-provider-config');
    if (!configPanel || !currentAIConfig) return;
    
    const activeProvider = currentAIConfig.active_provider;
    const providerConfig = currentAIConfig.providers[activeProvider];
    
    if (!providerConfig) return;
    
    let configHTML = `<h4>${activeProvider.charAt(0).toUpperCase() + activeProvider.slice(1)} Configuration</h4>`;
    
    // Generate configuration fields based on provider type
    if (activeProvider === 'ollama') {
        configHTML += `
            <div class="form-group">
                <label>Base URL:</label>
                <input type="text" id="ai-config-base_url" value="${providerConfig.base_url || ''}" style="width: 100%; padding: 6px;">
            </div>
        `;
    } else if (activeProvider === 'openai' || activeProvider === 'claude') {
        configHTML += `
            <div class="form-group">
                <label>API Key:</label>
                <input type="password" id="ai-config-api_key" value="${providerConfig.api_key || ''}" style="width: 100%; padding: 6px;" placeholder="Enter your API key">
            </div>
            <div class="form-group">
                <label>Base URL (optional):</label>
                <input type="text" id="ai-config-base_url" value="${providerConfig.base_url || ''}" style="width: 100%; padding: 6px;">
            </div>
        `;
    }
    
    configHTML += `
        <div class="form-group">
            <label>
                <input type="checkbox" id="ai-config-enabled" ${providerConfig.enabled ? 'checked' : ''}> 
                Enable this provider
            </label>
        </div>
    `;
    
    configPanel.innerHTML = configHTML;
}

// Update providers status UI
function updateProvidersStatusUI() {
    const statusContainer = document.getElementById('ai-providers-status');
    if (!statusContainer || !currentProvidersStatus) return;
    
    let statusHTML = '';
    
    for (const [providerName, status] of Object.entries(currentProvidersStatus.providers)) {
        let statusClass = 'unavailable';
        let statusText = 'Unavailable';
        
        if (!status.enabled) {
            statusClass = 'disabled';
            statusText = 'Disabled';
        } else if (status.available) {
            statusClass = 'available';
            statusText = 'Available';
        }
        
        statusHTML += `
            <div class="ai-provider-status">
                <div class="status-indicator ${statusClass}"></div>
                <strong>${providerName.charAt(0).toUpperCase() + providerName.slice(1)}</strong>: ${statusText}
                ${status.model ? ` (${status.model})` : ''}
                ${status.error ? ` - ${status.error}` : ''}
            </div>
        `;
    }
    
    statusContainer.innerHTML = statusHTML;
}

// Update model options
function updateModelOptions() {
    const modelSelect = document.getElementById('ai-model-select');
    if (!modelSelect || !currentProvidersStatus || !currentAIConfig) return;
    
    const activeProvider = currentAIConfig.active_provider;
    const providerStatus = currentProvidersStatus.providers[activeProvider];
    
    modelSelect.innerHTML = '';
    
    if (providerStatus && providerStatus.models && providerStatus.models.length > 0) {
        providerStatus.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            if (model === providerStatus.model) {
                option.selected = true;
            }
            modelSelect.appendChild(option);
        });
    } else {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No models available';
        modelSelect.appendChild(option);
    }
}

// Handle provider change
async function onProviderChange() {
    const providerSelect = document.getElementById('ai-provider-select');
    if (!providerSelect) return;
    
    const newProvider = providerSelect.value;
    
    // Update active provider in config
    if (currentAIConfig) {
        currentAIConfig.active_provider = newProvider;
        updateProviderConfigPanel();
        updateModelOptions();
    }
}

// Save AI configuration
async function saveAIConfig() {
    try {
        const providerSelect = document.getElementById('ai-provider-select');
        const modelSelect = document.getElementById('ai-model-select');
        
        if (!providerSelect || !currentAIConfig) return;
        
        const activeProvider = providerSelect.value;
        const selectedModel = modelSelect.value;
        
        // Collect configuration from form fields
        const updates = {
            active_provider: activeProvider,
            providers: {}
        };
        
        // Get provider-specific configuration
        const providerConfig = {};
        
        const enabledCheckbox = document.getElementById('ai-config-enabled');
        if (enabledCheckbox) {
            providerConfig.enabled = enabledCheckbox.checked;
        }
        
        const baseUrlInput = document.getElementById('ai-config-base_url');
        if (baseUrlInput) {
            providerConfig.base_url = baseUrlInput.value;
        }
        
        const apiKeyInput = document.getElementById('ai-config-api_key');
        if (apiKeyInput && apiKeyInput.value) {
            providerConfig.api_key = apiKeyInput.value;
        }
        
        if (selectedModel) {
            providerConfig.model = selectedModel;
        }
        
        updates.providers[activeProvider] = providerConfig;
        
        // Send update to backend HTTP API
        const response = await fetch(`${window.API_BASE_URL}/ai/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updates)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            showAIMessage('system', 'Configuration saved successfully!');
            // Update local config
            currentAIConfig.active_provider = activeProvider;
            Object.assign(currentAIConfig.providers[activeProvider], providerConfig);
            await loadProvidersStatus();
        } else {
            throw new Error(result.error || 'Failed to save configuration');
        }
        
    } catch (error) {
        console.error('Failed to save AI config:', error);
        showAIMessage('system', `Failed to save configuration: ${error.message}`);
    }
}

// Send AI message
async function sendAIMessage() {
    const chatInput = document.getElementById('ai-chat-input');
    
    if (!chatInput || !chatInput.value.trim()) return;
    
    const userMessage = chatInput.value.trim();
    chatInput.value = '';
    
    // Add user message to chat
    showAIMessage('user', userMessage);
    
    try {
        // Prepare messages - the Python backend will automatically add ontology context
        const messages = [];
        
        // Add conversation history (last 10 messages)
        const recentMessages = chatMessages.slice(-10);
        messages.push(...recentMessages);
        
        // Add current user message
        messages.push({ role: 'user', content: userMessage });
        
        // Send to AI via HTTP API
        const response = await fetch(`${window.API_BASE_URL}/ai/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: messages,
                max_tokens: 1000,
                temperature: 0.7
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            showAIMessage('assistant', result.content);
            
            // Add to conversation history
            chatMessages.push({ role: 'user', content: userMessage });
            chatMessages.push({ role: 'assistant', content: result.content });
            
            // Keep only last 20 messages
            if (chatMessages.length > 20) {
                chatMessages = chatMessages.slice(-20);
            }
        } else {
            throw new Error(result.error || 'AI response was not successful');
        }
        
    } catch (error) {
        console.error('Failed to send AI message:', error);
        showAIMessage('system', `Error: ${error.message}`);
    }
}

// Build ontology context for AI
function buildOntologyContext() {
    if (!window.graphStats) return null;
    
    const stats = window.graphStats;
    
    let context = `You are helping analyze an RDF ontology with the following characteristics:\n\n`;
    context += `File: ${stats.file_path || 'Unknown'}\n`;
    context += `Base URI: ${stats.base_uri || 'Unknown'}\n`;
    context += `Classes: ${stats.classes_count || 0}\n`;
    context += `Properties: ${stats.properties_count || 0}\n`;
    context += `Triples: ${stats.triples_count || 0}\n`;
    
    if (stats.namespaces && Object.keys(stats.namespaces).length > 0) {
        context += `\nNamespaces:\n`;
        for (const [prefix, uri] of Object.entries(stats.namespaces)) {
            context += `- ${prefix}: ${uri}\n`;
        }
    }
    
    if (stats.classes && stats.classes.length > 0) {
        context += `\nSample Classes: ${stats.classes.slice(0, 5).join(', ')}\n`;
    }
    
    if (stats.properties && stats.properties.length > 0) {
        context += `\nSample Properties: ${stats.properties.slice(0, 5).join(', ')}\n`;
    }
    
    context += `\nPlease provide helpful analysis and insights about this ontology based on the user's questions.`;
    
    return context;
}

// Show AI message in chat
// Format code blocks in AI responses
function formatCodeBlocks(content) {
    // Replace ```language\ncode\n``` blocks with formatted HTML
    return content.replace(/```(\w+)?\n([\s\S]*?)\n?```/g, (match, language, code) => {
        const lang = language || 'text';
        const formattedCode = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        
        return `<div class="code-block">
            <div class="code-header">${lang.toUpperCase()}</div>
            <pre><code class="language-${lang}">${formattedCode}</code></pre>
        </div>`;
    });
}

function showAIMessage(role, content) {
    const messagesContainer = document.getElementById('ai-chat-messages');
    if (!messagesContainer) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `ai-message ${role}`;
    
    if (role === 'assistant') {
        // Format code blocks for assistant responses
        const formattedContent = formatCodeBlocks(content);
        messageDiv.innerHTML = formattedContent;
    } else {
        // Plain text for user and system messages
        messageDiv.textContent = content;
    }
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Export functions for global access
window.initAI = initAI;
window.saveAIConfig = saveAIConfig;
window.sendAIMessage = sendAIMessage;