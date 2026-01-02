// js/lorepack.js - LOREPACK INGESTION CONTROLLER v3.2 (MAGRAG Client)

import { SimpleDB } from './core/mythos-db.js';
// Note: apiCall is not explicitly used here, but is kept for future utility
// import { apiCall } from './core.js'; 

const DB = new SimpleDB();
let agentCache = null;
let currentAgent = null;
let loreManifest = []; // Stores the temporary nodes before export

// Global interface object exposed to lorepack.html
window.LOREPACK = {
    loadAgentByHandle,
    saveKey,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    ingestLoreFile,
    exportLorePack,
    purgeAllVectors,
    removeFile
};

// --- UTILS ---
const $ = (id) => document.getElementById(id);
const log = (msg, type = 'sys') => {
    const logEl = $('systemLog');
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    const line = document.createElement('div');
    line.textContent = `[${time}] ${msg}`;
    line.className = type === 'err' ? 'error-log' : type === 'ok' ? 'ok-log' : '';
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
};

// --- INIT/KEY MANAGEMENT ---
function saveKey(key) {
    localStorage.setItem('geminiApiKey', key);
    if (key && key.length > 10) {
        $('apiStatus').textContent = '[ KEY ACTIVE ]';
        $('apiStatus').className = 'status-tag status-ok';
    } else {
        $('apiStatus').textContent = '[ KEY MISSING ]';
        $('apiStatus').className = 'status-tag status-err';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const storedKey = localStorage.getItem('geminiApiKey');
    if (storedKey) {
        $('apiKey').value = storedKey;
        saveKey(storedKey);
    }
    log("LOREPACK v3.2 Controller Ready.");
    
    // Cache all agents once for lookup efficiency
    await DB.ready;
    agentCache = await DB.getAll('agents');
});

// --- AGENT INTERFACE ---
async function loadAgentByHandle() {
    const handle = $('agentHandle').value.trim().toUpperCase();
    if (!handle || !agentCache) {
        log("Enter a valid Agent HANDLE and ensure agents are loaded.", 'err');
        return;
    }

    currentAgent = agentCache.find(a => a.handle === handle);
    if (!currentAgent) {
        log(`Agent HANDLE '${handle}' not found in Identity Registry.`, 'err');
        $('agentStatus').textContent = 'AGENT NOT FOUND';
        $('agentStatus').style.color = 'var(--error-color)';
        return;
    }

    $('agentStatus').textContent = `LOADED: ${currentAgent.handle} (Port: ${currentAgent.port})`;
    $('agentStatus').style.color = 'var(--accent-color)';
    log(`Identity loaded for ${currentAgent.handle}. Ready for ingestion.`);
    
    // Placeholder until server provides vector count
    $('vectorCount').textContent = 'SYNC PENDING'; 
}

// --- DRAG AND DROP HANDLERS ---
function handleDragOver(e) { e.preventDefault(); $('dropZone').classList.add('dragover'); }
function handleDragLeave(e) { $('dropZone').classList.remove('dragover'); }
function handleDrop(e) {
    e.preventDefault(); 
    $('dropZone').classList.remove('dragover'); 
    ingestLoreFile(e.dataTransfer.files);
}

// --- FILE PARSING AND MANIFEST ---
async function ingestLoreFile(files) {
    if (!currentAgent) {
        log("ERROR: Load a TARGET IDENTITY first.", 'err');
        return;
    }
    if (!files.length) return;
    
    log(`Received ${files.length} files for ingestion.`);

    for (const file of files) {
        if (file.type !== 'text/plain' && !file.name.endsWith('.txt')) {
             log(`Skipping file ${file.name}: Only .txt files supported.`, 'err');
             continue;
        }

        try {
            const content = await file.text();
            
            // MAGRAG SCHEMATIZATION: Simple paragraph split for nodes
            const textNodes = content.split(/\n\s*\n/).filter(t => t.trim().length > 50);

            textNodes.forEach((text, index) => {
                const node = {
                    id: `${currentAgent.id}-${file.name.replace(/\.txt$/, '').substring(0, 5)}-${index}`,
                    text: text.trim(),
                    source_ref: file.name,
                    author_id: currentAgent.handle,
                    nummark: null 
                };
                loreManifest.push(node);
            });
            
            log(`Parsed ${textNodes.length} nodes from ${file.name}.`);

        } catch (e) {
            log(`Error reading file ${file.name}: ${e.message}`, 'err');
        }
    }
    updateManifestUI();
}

function removeFile(nodeId) {
    loreManifest = loreManifest.filter(node => node.id !== nodeId);
    updateManifestUI();
    log(`Node ${nodeId} removed from manifest.`);
}

function updateManifestUI() {
    const manifestEl = $('fileManifest');
    manifestEl.innerHTML = '';
    
    if (loreManifest.length === 0) {
        manifestEl.innerHTML = '<li style="padding:10px; color:#666;">Manifest is empty. Drop files to begin.</li>';
        $('vectorCount').textContent = 0;
        return;
    }
    
    loreManifest.forEach(node => {
        const li = document.createElement('li');
        li.className = 'file-item';
        const display = node.source_ref.substring(0, 30) + ' | ' + node.text.substring(0, 80) + '...';
        li.innerHTML = `
            <span>${display}</span>
            <button class="delete-btn" onclick="window.LOREPACK.removeFile('${node.id}')">X</button>
        `;
        manifestEl.appendChild(li);
    });
    
    $('vectorCount').textContent = loreManifest.length;
}


// --- CORE EXPORT/INGESTION PROTOCOL ---
async function exportLorePack() {
    if (!currentAgent) {
        log("ERROR: Load a TARGET IDENTITY first.", 'err');
        return;
    }
    if (loreManifest.length === 0) {
        log("ERROR: Manifest is empty. Ingest files first.", 'err');
        return;
    }
    log(`Initiating LorePack Ingestion to Hypervisor (Port 4000)...`);
    $('ingestStatus').style.display = 'block';

    try {
        const url = `http://localhost:4000/lorepack/ingest/${currentAgent.id}`;
        
        // This is the MAGRAG-compliant array of nodes being sent
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                nodes: loreManifest
            }),
        });
        
        const data = await response.json();

        if (response.ok) {
            log(`LorePack Ingestion Successful: ${data.count} nodes stored.`, 'ok');
            loreManifest = []; // Clear local manifest on successful commit
            updateManifestUI();
        } else {
            log(`SERVER ERROR: ${data.error || 'Unknown Ingestion Failure'}`, 'err');
        }

    } catch (e) {
        log(`NETWORK ERROR: Could not connect to Hypervisor: ${e.message}`, 'err');
    } finally {
        $('ingestStatus').style.display = 'none';
    }
}

async function purgeAllVectors() {
    // This requires a new server endpoint (e.g., /lorepack/purge/:agentId)
    log("PURGE VECTORS: Server endpoint not yet implemented. Manual deletion required.", 'err');
}