// js/ingestion/lorepack.js
// MYTHOS INGESTION ENGINE v3.0 (Modular)
// Exports logic for both UI (Forge) and Agent Runtime (Auto-Ingest)

import { SimpleDB } from '../core/mythos-db.js';
const db = new SimpleDB();

/**
 * Ingests a raw string of text into the Vector Database.
 * @param {Object} params - { agentId, text, source, apiKey }
 */
export async function ingestLoreText({ agentId, text, source, apiKey }) {
    if (!apiKey) throw new Error("API Key required for ingestion.");
    
    // 1. Get Embedding
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content: { parts: [{ text: text }] }
        })
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'Embedding Failed');
    }

    const data = await response.json();
    const vector = data.embedding.values;

    // 2. Store in DB
    await db.ready;
    const node = {
        id: crypto.randomUUID(),
        agentId: agentId.toUpperCase(),
        text: text,
        vector: vector,
        meta: { source: source, timestamp: Date.now() }
    };

    await db.put('vectors', node);
    return node;
}

/**
 * Handles the UI interactions for the Forge tab.
 * Call this from your main HTML script.
 */
export function bindLorepackUI() {
    const els = {
        fileInput: document.getElementById('forgeFileInput'),
        agentId: document.getElementById('forgeAgentId'),
        ingestBtn: document.getElementById('btnIngest'),
        exportBtn: document.getElementById('btnExport'),
        newBtn: document.getElementById('btnNew'),
        progress: document.getElementById('ingestBar'),
        stats: document.getElementById('ingestStats'),
        queue: document.getElementById('forgeQueue'),
        concurrency: document.getElementById('concurrency')
    };

    // If UI elements aren't present (e.g. simplified chat view), abort binding
    if (!els.fileInput || !els.ingestBtn) return;

    // --- State ---
    let queue = [];

    // --- Events ---
    if (els.newBtn) {
        els.newBtn.addEventListener('click', () => {
            els.agentId.value = '';
            els.fileInput.value = '';
            queue = [];
            els.queue.textContent = '0 files staged';
        });
    }

    els.fileInput.addEventListener('change', () => {
        queue = Array.from(els.fileInput.files);
        els.queue.textContent = `${queue.length} files staged`;
    });

    els.ingestBtn.addEventListener('click', async () => {
        const apiKey = localStorage.getItem('mythos_api_key');
        const targetId = els.agentId.value.trim().toUpperCase();
        
        if (!apiKey) return alert("API Key Required");
        if (!targetId) return alert("Target Agent ID Required");
        if (queue.length === 0) return alert("No files selected");

        els.ingestBtn.disabled = true;
        els.ingestBtn.textContent = "FORGING...";
        document.getElementById('forgeProgress').classList.remove('d-none');

        let processed = 0;
        let totalChunks = 0;
        
        try {
            // 1. Read & Chunk
            let chunks = [];
            for (const file of queue) {
                const text = await file.text();
                // Simple sentence/paragraph splitter
                const fileChunks = text.split(/(?<=[.?!])\s+(?=[A-Z])/).filter(c => c.length > 20);
                fileChunks.forEach(c => chunks.push({ text: c, source: file.name }));
            }
            totalChunks = chunks.length;

            // 2. Process Pool
            const concurrency = parseInt(els.concurrency.value) || 3;
            const pool = [];
            
            const processNext = async () => {
                if (chunks.length === 0) return;
                const task = chunks.shift();
                
                try {
                    await ingestLoreText({
                        agentId: targetId,
                        text: task.text,
                        source: task.source,
                        apiKey: apiKey
                    });
                    processed++;
                    
                    // Update UI
                    const pct = Math.round((processed / totalChunks) * 100);
                    els.progress.value = pct;
                    els.stats.textContent = `${processed} / ${totalChunks} Shards`;
                    
                } catch (e) {
                    console.warn("Ingest Error:", e);
                }
                
                if (chunks.length > 0) await processNext();
            };

            // Start Threads
            for (let i = 0; i < concurrency; i++) pool.push(processNext());
            await Promise.all(pool);

            alert(`Ingestion Complete. ${processed} vectors added to ${targetId}.`);

        } catch (e) {
            alert(`Critical Failure: ${e.message}`);
        } finally {
            els.ingestBtn.disabled = false;
            els.ingestBtn.textContent = "IGNITE FORGE";
            queue = [];
            els.queue.textContent = "0 files queued";
            els.fileInput.value = '';
        }
    });

    els.exportBtn.addEventListener('click', async () => {
        const targetId = els.agentId.value.trim().toUpperCase();
        await db.ready;
        const all = await db.getAll('vectors');
        const mine = all.filter(v => v.agentId === targetId);

        if (mine.length === 0) return alert(`No memory found for ${targetId}`);

        const blob = new Blob([JSON.stringify({
            schema: "MYTHOS.COREPACK.v1",
            agentId: targetId,
            nodes: mine
        }, null, 2)], { type: 'application/json' });

        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${targetId}.COREPACK.json`;
        a.click();
    });
}