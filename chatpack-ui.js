// js/chatpack-ui.js - MYTHOS CHATPACK UI CONTROLLER v2.0 (File Ingestion + Export)

import { ChatPackMulti } from './chatpack-multi.js';

// --- Initialization ---
const IDs = {
    agentList: 'agent-list',
    messagesContainer: 'messages-container',
    sendBtn: 'send-button',
    msgInput: 'message-input',
    apiKey: 'apiKey',
    fileInput: 'file-input',
    exportConversationBtn: 'exportConversationBtn',
    exportMemoryBtn: 'exportMemoryBtn',
    ingestedFileCount: 'ingestedFileCount',
    agentHandleDisplay: 'agentHandleDisplay',
    vectorCount: 'vectorCount'
};

const CP = new ChatPackMulti({ dom: true });

let selectedAgent = null;
let conversationHistory = []; // In-memory history for robustness
let ingestedFiles = []; // Track ingested files
// --- UTILITY ---
const $ = (id) => document.getElementById(id);

// --- CHAT HISTORY LOGIC ---

function getMessageHTML() {
    const container = $(IDs.messagesContainer);
    return conversationHistory; // Return the structured history array
}

function loadMessagesForAgent() {
    const container = $(IDs.messagesContainer);
    if (!container || !selectedAgent) return;

    container.innerHTML = `<div class="msg sys">> System Log Ready.</div>`; 
    
    const history = CP.loadHistory(selectedAgent.id);
    
    // CRITICAL FIX: Robustness check on history array
    if (history && history.length) { 
        history.forEach(html => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            if (tempDiv.firstChild) {
                 // Append to maintain the visual bottom-to-top history flow based on CSS
                container.appendChild(tempDiv.firstChild); 
            }
        });
        container.scrollTop = container.scrollHeight;
    }
}

function appendMessage({ author = 'SYSTEM', text = '', type = 'system', id = null } = {}) {
    const messagesContainer = $(IDs.messagesContainer);
    if (!messagesContainer) return;

    const messageId = id || `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const typeMap = { system: 'sys', error: 'err', ok: 'ok', bot: 'bot', user: 'user', thinking: 'sys' };
    const cssClass = typeMap[type] || 'sys';

    const wrapper = document.createElement('div');
    wrapper.className = `msg ${cssClass}`;
    wrapper.id = messageId;

    const safeText = String(text); 
    
    if (type === 'thinking') {
        wrapper.innerHTML = `> ${author}: <span class="thinking-indicator">${safeText}</span>`;
    } else if (cssClass === 'bot') {
        // CRITICAL FIX: Precede agent response with UID/Author Tag
        // We use textContent first for safety, then set innerHTML to render line breaks
        wrapper.textContent = `${author}: ${safeText}`; 
        
        // Convert newlines and apply strong tag to the UID prefix
        wrapper.innerHTML = wrapper.innerHTML.replace(/\n/g, '<br>').replace(new RegExp(`^${author}:`), `<strong>${author}:</strong>`);

    } else if (cssClass === 'user') {
        // User input is tagged as the operator's proxy name
        wrapper.innerHTML = `<div class="msg-content"><strong>HITL:</strong> ${safeText}</div>`;
    } else {
        // System messages
        wrapper.textContent = `> ${author}: ${safeText}`;
    }
    
    messagesContainer.appendChild(wrapper);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Save history only for user and bot messages
    if (cssClass === 'user' || cssClass === 'bot') {
        CP.saveHistory(selectedAgent.id, getMessageHTML());
    }

    return messageId;
}

function removeMessage(id) {
    if (!id) return;
    const messageElement = $(id);
    if (messageElement) {
        messageElement.remove();
    }
}

function escapeHtml(unsafe) {
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- AGENT LIST LOGIC ---

async function renderAgentList() {
    const agentListContainer = $(IDs.agentList);
    if (!agentListContainer) return;
    
    agentListContainer.innerHTML = '';
    
    const agents = await CP.listAgents();
    
    // Sort alphabetically by handle
    agents.sort((a, b) => a.handle.localeCompare(b.handle));

    agents.forEach(agent => {
        const div = document.createElement('div');
        div.className = 'agent-item';
        div.dataset.id = agent.id;
        div.innerHTML = `
            <div><strong>${agent.handle}</strong></div>
            <span>Port: ${agent.port}</span>
        `;
        div.addEventListener('click', () => selectAgent(agent));
        agentListContainer.appendChild(div);
    });
}

function selectAgent(agent) {
    if (selectedAgent && selectedAgent.id !== agent.id) {
        // Save history from the in-memory array before switching
        CP.saveHistory(selectedAgent.id, conversationHistory); 
        // Remove 'selected' class from old agent
        const oldItem = $(IDs.agentList)?.querySelector(`[data-id="${selectedAgent.id}"]`);
        if (oldItem) oldItem.classList.remove('selected');
    }

    selectedAgent = agent;
    
    // Add 'selected' class to new agent
    const newItem = $(IDs.agentList)?.querySelector(`[data-id="${agent.id}"]`);
    if (newItem) newItem.classList.add('selected');

    // Enable send button
    const sendBtn = $(IDs.sendBtn);
    if (sendBtn) sendBtn.disabled = false;
    
    // Load history for new agent
    loadMessagesForAgent();
    
    // Set the active agent in the CP instance
    CP.setActiveAgent(agent.id);
    
    // Persist the selection
    localStorage.setItem('lastSelectedAgentId', agent.id);
    
    // Update the port display in the main chat window header
    const commOutputHeader = document.querySelector('.comm-output-header');
    if (commOutputHeader) {
        commOutputHeader.textContent = `CONNECTED // ${agent.handle} (Port: ${agent.port})`;
    }
}

// --- CORE QUERY LOGIC ---

async function doSend() {
    const sendBtn = $(IDs.sendBtn);
    const msgInput = $(IDs.msgInput);
    const apiKeyEl = $(IDs.apiKey);

    const prompt = msgInput.value.trim();
    const apiKey = apiKeyEl.value;
    
    if (!prompt || !selectedAgent || !apiKey) return;

    // 1. Display user message
    appendMessage({ author: 'HITL', text: prompt, type: 'user' });
    msgInput.value = '';
    sendBtn.disabled = true;

    const thinkingId = appendMessage({
        author: selectedAgent.handle,
        text: 'is thinking...',
        type: 'thinking'
    });

    try {
        // 2. Call the RAG and Generation pipeline
        const results = await CP.query(prompt, apiKey, [selectedAgent.id]);

        removeMessage(thinkingId);

        // 3. Render Results
        results.forEach(res => {
            const author = res.agentId || 'ORCHESTRATOR';
            if (res.error) {
                appendMessage({ author, text: `Error: ${res.error}`, type: 'error' });
            } else {
                
                let replyText = res.reply;
                
                // CRITICAL FIX: Extract the clean text from the JSON wrapper here.
                try {
                    const parsedReply = JSON.parse(res.reply);
                    
                    // Look for common reply keys (response, BARBELO_RESPONSE, text, content)
                    replyText = parsedReply.response || parsedReply.BARBELO_RESPONSE || parsedReply.text || parsedReply.content || res.reply;
                    
                    // Fallback to stringify if the reply is still an object/array (unexpected but safe)
                    if (typeof replyText !== 'string') {
                         replyText = JSON.stringify(replyText);
                    }
                    
                } catch (e) {
                    // Not JSON, use the raw reply text
                    replyText = res.reply;
                }
                
                appendMessage({ author, text: replyText, type: 'bot' });
            }
        });

    } catch (err) {
        console.error("Agent Query Failure:", err);
        removeMessage(thinkingId);
        appendMessage({ author: 'SYSTEM', text: `NETWORK/PROCESSING FAILURE: ${err.message}`, type: 'error' });
    } finally {
        sendBtn.disabled = false;
        msgInput.focus();
    }
}

// --- FILE INGESTION LOGIC ---

async function handleFileIngestion(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const apiKeyEl = $(IDs.apiKey);
    const apiKey = apiKeyEl?.value;

    if (!apiKey) {
        appendMessage({ text: 'ERROR: API Key required for file ingestion.', type: 'error' });
        return;
    }

    if (!selectedAgent) {
        appendMessage({ text: 'ERROR: Please select an agent first.', type: 'error' });
        return;
    }

    appendMessage({ text: `Processing ${files.length} file(s)...`, type: 'system' });

    for (const file of files) {
        try {
            const fileName = file.name;
            const fileExt = fileName.split('.').pop().toLowerCase();

            appendMessage({ text: `Reading: ${fileName}`, type: 'system' });

            if (fileExt === 'json') {
                // Handle JSON LorePack
                const content = await file.text();
                const lorepack = JSON.parse(content);
                
                // Validate lorepack structure
                if (!lorepack.nodes || !Array.isArray(lorepack.nodes)) {
                    throw new Error('Invalid LorePack format: missing nodes array');
                }

                appendMessage({ text: `Ingesting ${lorepack.nodes.length} nodes from ${fileName}...`, type: 'system' });

                // Send to orchestrator for ingestion
                const response = await fetch(`http://localhost:4000/lorepack/ingest/${selectedAgent.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nodes: lorepack.nodes,
                        apiKey: apiKey
                    })
                });

                const result = await response.json();

                if (response.ok) {
                    appendMessage({ text: `✓ ${fileName}: ${result.count} nodes ingested successfully`, type: 'ok' });
                    ingestedFiles.push({ name: fileName, type: 'lorepack', nodeCount: result.count });
                } else {
                    throw new Error(result.error || 'Ingestion failed');
                }

            } else if (fileExt === 'txt' || fileExt === 'md') {
                // Handle text/markdown files
                const content = await file.text();
                
                // Split content into chunks (paragraphs or sections)
                const chunks = content
                    .split(/\n\n+/)
                    .filter(chunk => chunk.trim().length > 50) // Min 50 chars
                    .map(chunk => chunk.trim());

                if (chunks.length === 0) {
                    throw new Error('No valid content found in file');
                }

                appendMessage({ text: `Processing ${chunks.length} text chunks from ${fileName}...`, type: 'system' });

                // Create nodes from chunks
                const nodes = chunks.map((text, index) => ({
                    text: text,
                    metadata: {
                        source: fileName,
                        type: fileExt,
                        chunk_index: index,
                        timestamp: new Date().toISOString()
                    }
                }));

                // Send to orchestrator for ingestion
                const response = await fetch(`http://localhost:4000/lorepack/ingest/${selectedAgent.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nodes: nodes,
                        apiKey: apiKey
                    })
                });

                const result = await response.json();

                if (response.ok) {
                    appendMessage({ text: `✓ ${fileName}: ${result.count} chunks ingested successfully`, type: 'ok' });
                    ingestedFiles.push({ name: fileName, type: fileExt, nodeCount: result.count });
                } else {
                    throw new Error(result.error || 'Ingestion failed');
                }

            } else {
                throw new Error(`Unsupported file type: .${fileExt}`);
            }

        } catch (error) {
            console.error(`File ingestion error (${file.name}):`, error);
            appendMessage({ text: `✗ ${file.name}: ${error.message}`, type: 'error' });
        }
    }

    // Update file count display
    const fileCountEl = $(IDs.ingestedFileCount);
    if (fileCountEl) {
        fileCountEl.textContent = ingestedFiles.length;
    }

    // Update vector count (approximate)
    const totalNodes = ingestedFiles.reduce((sum, f) => sum + (f.nodeCount || 0), 0);
    const vectorCountEl = $(IDs.vectorCount);
    if (vectorCountEl) {
        vectorCountEl.textContent = totalNodes;
    }

    appendMessage({ text: 'File ingestion complete.', type: 'ok' });

    // Clear file input
    event.target.value = '';
}

// --- EXPORT LOGIC ---

function exportConversation() {
    if (!selectedAgent) {
        appendMessage({ text: 'ERROR: No agent selected.', type: 'error' });
        return;
    }

    const history = CP.loadHistory(selectedAgent.id);
    
    const exportData = {
        agent: {
            id: selectedAgent.id,
            handle: selectedAgent.handle,
            port: selectedAgent.port
        },
        exportDate: new Date().toISOString(),
        messageCount: history.length,
        messages: history
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation_${selectedAgent.id}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    appendMessage({ text: `✓ Conversation exported: ${history.length} messages`, type: 'ok' });
}

async function exportMemoryNodes() {
    if (!selectedAgent) {
        appendMessage({ text: 'ERROR: No agent selected.', type: 'error' });
        return;
    }

    try {
        // Try to fetch from vector store
        const response = await fetch('vector_store.json');
        
        if (!response.ok) {
            throw new Error('Vector store not found');
        }

        const vectorStore = await response.json();
        const agentVectors = vectorStore[selectedAgent.id] || [];

        if (agentVectors.length === 0) {
            appendMessage({ text: 'No memory nodes found for this agent.', type: 'error' });
            return;
        }

        const exportData = {
            agent: {
                id: selectedAgent.id,
                handle: selectedAgent.handle
            },
            exportDate: new Date().toISOString(),
            nodeCount: agentVectors.length,
            nodes: agentVectors.map(node => ({
                text: node.text,
                metadata: node.metadata,
                timestamp: node.timestamp,
                num_mark_hdr: node.num_mark_hdr,
                num_mark_sig: node.num_mark_sig
            }))
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `memory_${selectedAgent.id}_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        appendMessage({ text: `✓ Memory exported: ${agentVectors.length} nodes`, type: 'ok' });

    } catch (error) {
        console.error('Memory export error:', error);
        appendMessage({ text: `ERROR: ${error.message}`, type: 'error' });
    }
}

// --- INITIALIZATION ---

window.addEventListener('DOMContentLoaded', async () => {
    // API Key persistence
    const apiKeyEl = $(IDs.apiKey);
    const storedKey = localStorage.getItem('geminiApiKey');
    if (storedKey && apiKeyEl) {
        apiKeyEl.value = storedKey;
    }
    if (apiKeyEl) {
        apiKeyEl.addEventListener('change', (e) => {
            localStorage.setItem('geminiApiKey', e.target.value);
        });
    }

    // Event listeners
    const sendBtn = $(IDs.sendBtn);
    const msgInput = $(IDs.msgInput);
    const fileInput = $(IDs.fileInput);
    const exportConvBtn = $(IDs.exportConversationBtn);
    const exportMemBtn = $(IDs.exportMemoryBtn);
    
    if (sendBtn) sendBtn.addEventListener('click', doSend);
    if (msgInput) {
        msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                doSend();
            }
        });
    }
    
    // File ingestion
    if (fileInput) {
        fileInput.addEventListener('change', handleFileIngestion);
    }
    
    // Export buttons
    if (exportConvBtn) {
        exportConvBtn.addEventListener('click', exportConversation);
    }
    if (exportMemBtn) {
        exportMemBtn.addEventListener('click', exportMemoryNodes);
    }

    // Load agents and select the last active one
    // We use a try/catch here to handle IndexedDB errors during startup gracefully
    try {
        await renderAgentList();
        const agents = await CP.listAgents();

        if (agents.length > 0) {
            const lastSelectedId = localStorage.getItem('lastSelectedAgentId');
            
            // Find the agent, prioritizing the last selected, then BARBELO, then the first one
            const initialAgent = agents.find(a => a.id === lastSelectedId) || 
                                agents.find(a => a.id === 'BARBELO') || 
                                agents[0];
            
            if (initialAgent) {
                selectAgent(initialAgent);
            } else {
                appendMessage({ text: 'Please select an agent from the list.', type: 'system' });
            }
        } else {
            appendMessage({ text: 'CRITICAL ERROR: No agents found. Run Identity Hydration Protocol.', type: 'error' });
        }
    } catch (e) {
         console.error("Initialization Error:", e);
         appendMessage({ text: `FATAL STARTUP ERROR: ${e.message}. Check DB/Identity Sync.`, type: 'error' });
    }
});

// Save the current agent's history before unloading
window.addEventListener('beforeunload', () => {
    if (selectedAgent) {
        CP.saveHistory(selectedAgent.id, conversationHistory);
        localStorage.setItem('lastSelectedAgentId', selectedAgent.id);
    }
});