// js/ui/terminal-controller.js
// MYTHOS TERMINAL LOGIC v4.7
// Handles UI binding, Boot Sequence, and DOM Events.

import { InitialAgentManifest } from '../agents/initial-manifest.js';
import { AgentRuntime } from '../agents/agent-runtime.js';
import { ConferenceRoom } from '../comms/conference.js';
import { SimpleDB } from '../core/mythos-db.js';
import { NumMarkX } from '../memory/numark-x.js';

// Optional Load wrapper
let bindLorepackUI = () => {};

// STATE
const STATE = { 
    db: new SimpleDB(), 
    conference: null, 
    agents: {}, 
    key: localStorage.getItem('mythos_api_key') || '' 
};

// UI REFERENCES
const UI = {};

function initUIRefs() {
    UI.key = document.getElementById('api-key');
    UI.model = document.getElementById('model-select');
    UI.sel = document.getElementById('agent-select');
    UI.msgs = document.getElementById('messages-container');
    UI.input = document.getElementById('message-input');
    UI.btn = document.getElementById('send-button');
    UI.stat = document.getElementById('connection-status');
    UI.vec = document.getElementById('vector-count');
    UI.panelComms = document.getElementById('panel-comms');
    UI.panelForge = document.getElementById('panel-forge');
    UI.btnImport = document.getElementById('btnImport');
    UI.importInput = document.getElementById('importInput');
    UI.btnExport = document.getElementById('btnExport');
}

// --- BOOT SEQUENCE ---
export async function boot() {
    initUIRefs(); // Ensure refs are grabbed after DOM load
    
    if(STATE.key) UI.key.value = STATE.key;
    renderMsg('SYSTEM', 'Initializing Hybrid Lattice v4.7 (Modular)...', 'system');

    try {
        // 1. Dynamic Import for Lorepack
        try { 
            const m = await import('../ingestion/lorepack.js'); 
            bindLorepackUI = m.bindLorepackUI; 
            bindLorepackUI();
        } catch(e){ console.warn("Lorepack UI module not found."); }

        // 2. DB & Vectors
        await STATE.db.ready;
        const vectors = await STATE.db.getAll('vectors');
        if(UI.vec) UI.vec.textContent = `VECTORS: ${vectors.length}`;
        NumMarkX.initialize(vectors);

        // 3. Agent Hydration
        const selectedModel = UI.model.value;
        if (!InitialAgentManifest) throw new Error("Manifest Failed to Load");

        STATE.agents = {}; // Reset agents on reboot
        for(const meta of InitialAgentManifest) {
            const metaWithModel = { ...meta, default_model: selectedModel };
            STATE.agents[meta.id] = new AgentRuntime({ agentMeta: metaWithModel, db: STATE.db });
        }

        // 4. Conference Room
        STATE.conference = new ConferenceRoom({
            agents: STATE.agents,
            db: STATE.db,
            renderer: {
                agent: (id, txt) => renderMsg(id, txt, 'agent'),
                user: (txt) => { }, 
                error: (id, txt) => renderMsg(id, txt, 'error'),
                system: (txt) => renderMsg('SYSTEM', txt, 'system')
            }
        });

        populateRoster();
        UI.stat.textContent = '[ ONLINE ]';
        UI.stat.style.color = '#00ffaa';
        renderMsg('SYSTEM', `Hybrid Core Active. Engine: ${selectedModel}`, 'system');

        bindEvents(); // Attach listeners

    } catch(e) {
        console.error(e);
        renderMsg('SYSTEM', `Boot Error: ${e.message}`, 'error');
        UI.stat.textContent = '[ ERROR ]';
        UI.stat.style.color = 'red';
    }
}

// --- EVENT BINDING ---
function bindEvents() {
    // Import/Export
    UI.btnExport.onclick = handleExport;
    UI.btnImport.onclick = () => UI.importInput.click();
    UI.importInput.onchange = handleImport;

    // Chat
    UI.btn.onclick = handleSend;
    UI.input.onkeydown = (e) => { 
        if(e.key === 'Enter' && !e.shiftKey) { 
            e.preventDefault(); 
            UI.btn.click(); 
        } 
    };

    // Settings
    UI.key.onchange = (e) => localStorage.setItem('mythos_api_key', e.target.value.trim());
    
    // Reboot on Model Change (Remove old listener first if needed, but simple overwrite works here)
    UI.model.onchange = () => {
        renderMsg('SYSTEM', `Re-calibrating for ${UI.model.value}...`, 'system');
        boot(); 
    };

    // Agent Switch
    UI.sel.onchange = async () => {
        const targetId = UI.sel.value;
        const agentName = UI.sel.options[UI.sel.selectedIndex].text;
        UI.msgs.innerHTML = '';
        renderMsg('SYSTEM', `Locus: ${agentName}. Establishing Link...`, 'system');
        if (targetId !== 'ALL') {
             await STATE.conference.broadcast('SYSTEM', 'You have been activated. Briefly announce your presence.', { target: targetId });
        }
    };

    // Tabs
    document.getElementById('tab-comms').onclick = () => switchTab('comms');
    document.getElementById('tab-forge').onclick = () => switchTab('forge');
    document.getElementById('btn-purge').onclick = async () => { 
        if(confirm('NUKE DB?')) { 
            await STATE.db.clear('vectors'); 
            location.reload(); 
        } 
    };
}

// --- HANDLERS ---

async function handleExport() {
    const vectors = await STATE.db.getAll('vectors');
    const blob = new Blob([JSON.stringify(vectors, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mythos_corepack_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    renderMsg('SYSTEM', `Exported ${vectors.length} vectors.`, 'system');
}

async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            if (!Array.isArray(data)) throw new Error("Invalid format. Expected Array.");
            
            renderMsg('SYSTEM', `Importing ${data.length} vectors...`, 'system');
            for (const vec of data) {
                await STATE.db.set('vectors', vec);
            }
            
            const all = await STATE.db.getAll('vectors');
            NumMarkX.initialize(all);
            UI.vec.textContent = `VECTORS: ${all.length}`;
            renderMsg('SYSTEM', `Import Complete. Total: ${all.length}`, 'system');
            
        } catch (err) {
            renderMsg('SYSTEM', `Import Failed: ${err.message}`, 'error');
        }
    };
    reader.readAsText(file);
    UI.importInput.value = ''; 
}

async function handleSend() {
    const text = UI.input.value.trim();
    const key = UI.key.value.trim();
    const targetId = UI.sel.value; 
    const model = UI.model.value;

    if(!text) return;
    if(!key && !model.startsWith('onnx')) { alert('API Key Required for Cloud Models'); return; }

    if(key) localStorage.setItem('mythos_api_key', key);
    UI.input.value = '';
    
    renderMsg('USER', text, 'user');
    await STATE.conference.broadcast('USER', text, { target: targetId });
}

function switchTab(tab) {
    if(tab === 'comms') {
        UI.panelComms.classList.remove('d-none');
        UI.panelForge.classList.add('d-none');
        document.getElementById('tab-comms').classList.add('active');
        document.getElementById('tab-forge').classList.remove('active');
    } else {
        UI.panelForge.classList.remove('d-none');
        UI.panelComms.classList.add('d-none');
        document.getElementById('tab-forge').classList.add('active');
        document.getElementById('tab-comms').classList.remove('active');
    }
}

function populateRoster() {
    const lastVal = UI.sel.value;
    UI.sel.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = 'ALL';
    allOpt.textContent = 'CHORUS (All Agents)';
    UI.sel.appendChild(allOpt);

    InitialAgentManifest.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.handle;
        UI.sel.appendChild(opt);
    });
    
    // Restore selection or default to MERKOS
    if (lastVal && lastVal !== 'Loading...') {
            UI.sel.value = lastVal;
    } else if(STATE.agents['MERKOS']) {
            UI.sel.value = 'MERKOS';
    }
}

// --- RENDERER ---
function renderMsg(from, text, type) {
    const row = document.createElement('div');
    row.className = 'message-row';
    const bubble = document.createElement('div');
    bubble.className = `message ${type}`;
    
    let badge = '';
    if (type === 'agent') {
        const isLocal = UI.model.value.startsWith('onnx');
        const label = isLocal ? 'SILICON' : 'CLOUD';
        const cls = isLocal ? 'badge-local' : 'badge-cloud';
        badge = `<span class="${cls}">${label}</span> `;
    }
    bubble.innerHTML = `${badge}<strong>${from}:</strong> ${text}`;
    
    if (type !== 'system') {
        const toolbar = document.createElement('div');
        toolbar.className = 'msg-toolbar';
        
        // Copy
        const copyBtn = document.createElement('button');
        copyBtn.className = 'tool-btn';
        copyBtn.innerHTML = '📋 COPY';
        copyBtn.onclick = () => {
            const temp = document.createElement('div');
            temp.innerHTML = text;
            navigator.clipboard.writeText(`[${from}]: ${temp.innerText}`);
        };
        toolbar.appendChild(copyBtn);
        
        // Edit
        if (type === 'user') {
            const editBtn = document.createElement('button');
            editBtn.className = 'tool-btn';
            editBtn.innerHTML = '✏️ EDIT';
            editBtn.onclick = () => {
                const temp = document.createElement('div');
                temp.innerHTML = text;
                UI.input.value = temp.innerText;
                UI.input.focus();
            };
            toolbar.appendChild(editBtn);
        }
        bubble.appendChild(toolbar);
    }

    row.appendChild(bubble);
    UI.msgs.appendChild(row);
    UI.msgs.scrollTop = UI.msgs.scrollHeight;
}