// chat-room.js - MYTHOS CHAT ROOM CONTROLLER v1.1.1 (FIXED)

import { ChatPackMulti } from './js/chatpack-multi.js';

// --- Initialization ---
const IDs = {
    agentList: 'agent-list',
    messagesContainer: 'messages-container',
    sendBtn: 'send-btn',
    msgInput: 'message-input',
    apiKey: 'apiKey'
};

const CP = new ChatPackMulti({ dom: true });

let selectedAgent = null;

// --- UTILITY ---
const $ = (id) => document.getElementById(id);

// --- CHAT HISTORY LOGIC (Unchanged) ---

function getMessageHTML() {
    const container = $(IDs.messagesContainer);
    if (!container) return [];
    
    // Collect all message divs, excluding the first initial "System Log Ready" message
    return Array.from(container.children).slice(1).map(el => el.outerHTML);
}

function loadMessagesForAgent() {
    const container = $(IDs.messagesContainer);
    if (!container || !selectedAgent) return;

    container.innerHTML = `<div class="msg sys">> System Log Ready.</div>`; // Start with the header
    
    const history = CP.loadHistory(selectedAgent.id);
    
    if (history && history.length) { // Fixed robustness check
        history.forEach(html => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            if (tempDiv.firstChild) {
                 container.appendChild(tempDiv.firstChild); 
            }
        });
        container.scrollTop = container.scrollHeight;
    }
}

function appendMessage({ author = 'SYSTEM', text = '', type = 'system' } = {}) {
    const messagesContainer = $(IDs.messagesContainer);
    if (!messagesContainer) return;

    const typeMap = { system: 'sys', error: 'err', ok: 'ok', bot: 'bot', user: 'user' };
    const cssClass = typeMap[type] || 'sys';

    const wrapper = document.createElement('div');
    wrapper.className = `msg ${cssClass}`;

    const safeText = String(text); 
    
    if (cssClass === 'bot') {
        // Protocol Tagging: Agent reply with UID
        wrapper.textContent = `${author}: ${safeText}`; 
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
}

// --- AGENT LIST LOGIC (Unchanged) ---

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
        // Save history before switching
        CP.saveHistory(selectedAgent.id, getMessageHTML()); 
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

// --- CORE QUERY LOGIC (FIXED) ---

async function sendMessage() {
    const sendBtn = $(IDs.sendBtn);
    const msgInput = $(IDs.msgInput);
    const apiKeyEl = $(IDs.apiKey);

    const message = msgInput.value.trim();
    const apiKey = apiKeyEl.value;
    
    // We target only the currently selected agent
    const targetAgents = selectedAgent ? [selectedAgent.id] : []; 
    
    if (!message || targetAgents.length === 0 || !apiKey) return;

    // 1. Display user message
    appendMessage({ author: 'HITL', text: message, type: 'user' });
    msgInput.value = '';
    sendBtn.disabled = true;

    try {
        appendMessage({ author: 'SYSTEM', text: `Initiating context retrieval and generation for ${targetAgents.length} agents...`, type: 'system' });
        
        // CRITICAL FIX: The function name has been corrected to the unified CP.query
        const results = await CP.query(message, apiKey, targetAgents); 

        // 3. Render Results
        results.forEach(res => {
            const author = res.agentId || 'ORCHESTRATOR';
            if (res.error) {
                appendMessage({ author, text: `RCI/Generation Error: ${res.error}`, type: 'error' });
            } else {
                
                let replyText = res.reply;
                
                // Extract the clean text from the JSON wrapper (robust version)
                try {
                    const parsedReply = JSON.parse(res.reply);
                    replyText = parsedReply.response || parsedReply.BARBELO_RESPONSE || parsedReply.text || parsedReply.content || res.reply;
                    
                    if (typeof replyText !== 'string') {
                         replyText = JSON.stringify(replyText);
                    }
                    
                } catch (e) {
                    replyText = res.reply;
                }
                
                appendMessage({ author, text: replyText, type: 'bot' });
            }
        });

    } catch (err) {
        console.error("Agent Query Failure:", err);
        appendMessage({ author: 'SYSTEM', text: `FATAL NETWORK/PROCESSING FAILURE: ${err.message}`, type: 'error' });
    } finally {
        sendBtn.disabled = false;
        msgInput.focus();
    }
}

// --- INITIALIZATION (Unchanged) ---

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
    
    // Note: The click/keydown handlers call sendMessage, which was the source of the error.
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    if (msgInput) {
        msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // Load agents and select the last active one
    try {
        await renderAgentList();
        const agents = await CP.listAgents();

        if (agents.length > 0) {
            const lastSelectedId = localStorage.getItem('lastSelectedAgentId');
            
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
        CP.saveHistory(selectedAgent.id, getMessageHTML());
        localStorage.setItem('lastSelectedAgentId', selectedAgent.id);
    }
});