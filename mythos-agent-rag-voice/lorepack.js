// LOREPACK™ v1.0 :: Standalone Module
// © 2026 MYTHOS, All Rights Reserved

const DB_NAME = 'mythos_vault';
const DB_VERSION = 8;
const INGEST_STATE_KEY = 'current_ingest';

/**
 * A simple wrapper around IndexedDB.
 */
class SimpleDB {
    constructor() {
        this.db = null;
        this.ready = this.init();
    }

    init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('vectors')) {
                    const store = db.createObjectStore('vectors', { keyPath: 'id' });
                    store.createIndex('agentId', 'agentId', { unique: false });
                }
                if (!db.objectStoreNames.contains('ingest_state')) {
                    db.createObjectStore('ingest_state', { keyPath: 'id' });
                }
            };
            req.onsuccess = () => {
                this.db = req.result;
                console.log("Database connection established.");
                resolve();
            };
            req.onerror = (e) => {
                console.error("DB Error:", e.target.error);
                reject(e.target.error);
            };
        });
    }

    async put(store, data) { await this.ready; return this._tx(store, 'readwrite', s => s.put(data)); }
    async get(store, id) { await this.ready; return this._tx(store, 'readonly', s => s.get(id)); }
    async getAll(store) { await this.ready; return this._tx(store, 'readonly', s => s.getAll()); }
    async delete(store, id) { await this.ready; return this._tx(store, 'readwrite', s => s.delete(id)); }
    async clear(store) { await this.ready; return this._tx(store, 'readwrite', s => s.clear()); }

    _tx(storeName, mode, callback) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, mode);
            const req = callback(tx.objectStore(storeName));
            tx.oncomplete = () => resolve(req?.result);
            tx.onerror = () => reject(tx.error);
        });
    }
}

/**
 * Core LOREPACK module for ingesting source material and exporting vectorized lore.
 */
export class Lorepack {
    constructor(apiKeys) {
        if (!apiKeys || apiKeys.length === 0) {
            throw new Error("API Keys are required for Lorepack module.");
        }
        this.apiKeys = apiKeys;
        this.currentKeyIndex = 0; // For round-robin selection of API keys for embedding
        this.db = new SimpleDB();
        this.ingestStatus = 'idle'; // idle, running, paused, aborted
    }

    async _geminiApiCall(endpoint, payload, model) {
        if (this.apiKeys.length === 0) {
            throw new Error("No Gemini API keys are set.");
        }

        if (endpoint === 'embed') {
            const key = this.apiKeys[this.currentKeyIndex];
            this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;

            if (!key) throw new Error("No API key available for embedding.");

            let url;
            let finalBody;

            if (Array.isArray(payload.text)) {
                // Batch embedding for multiple texts
                url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${key}`;
                finalBody = {
                    requests: payload.text.map(txt => ({
                        model: "models/text-embedding-004",
                        content: { parts: [{ text: txt }] },
                        taskType: payload.type // e.g., 'RETRIEVAL_DOCUMENT'
                    }))
                };
            } else {
                // Single text embedding
                url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`;
                finalBody = {
                    model: 'models/text-embedding-004',
                    content: { parts: [{ text: payload.text }] },
                    taskType: payload.type
                };
            }

            const res = await fetch(url, { method: 'POST', body: JSON.stringify(finalBody) });
            const data = await res.json();
            if (!res.ok) {
                console.error(`Embed API Error (Key ${key.substring(0, 5)}...):`, data);
                throw new Error(`Embed API Error: ${data.error ? data.error.message : res.statusText}`);
            }
            if (Array.isArray(payload.text)) {
                if (!data.embeddings) throw new Error("Batch Embedding failed: No embeddings returned.");
            } else {
                if (!data.embedding) throw new Error("Embedding failed: No vector returned.");
            }
            return data;
        } else if (endpoint === 'generate') {
            const systemInstructionText = payload.systemInstruction || ""; // Assuming systemInstruction is in payload

            const fetchPromises = this.apiKeys.map(async (key, index) => {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
                const body = {
                    contents: [{ parts: [{ text: payload.prompt }] }],
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
                    ],
                    ...(systemInstructionText && { systemInstruction: { parts: [{ text: systemInstructionText }] } })
                };

                const res = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
                const data = await res.json();

                if (!res.ok) {
                    console.error(`Generate API Error (Key ${key.substring(0, 5)}...):`, data);
                    throw new Error(`API Key ${index + 1} failed: ${data.error ? data.error.message : res.statusText}`);
                }
                
                if (data.candidates && data.candidates.length > 0) {
                    return data;
                } else if (data.promptFeedback) {
                    console.warn(`Safety Block Triggered for Key ${index + 1}:`, data.promptFeedback);
                    throw new Error(`API Key ${index + 1} (Safety Block): ${JSON.stringify(data.promptFeedback)}`);
                }
                throw new Error(`API Key ${index + 1}: Empty response received from API.`);
            });

            try {
                const result = await Promise.any(fetchPromises);
                return result;
            } catch (aggregateError) {
                const errors = aggregateError.errors.map(e => e.message).join('\n');
                throw new Error(`All generate API calls failed:\n${errors}`);
            }
        } else {
            throw new Error(`Unknown API endpoint: ${endpoint}`);
        }
    }

    _semanticChunk(text) {
        const chunks = [];
        const sentenceRegex = /(?<=[.?!])\s+/;
        let buffer = "";
        text.split(sentenceRegex).forEach(sent => {
            if (buffer.length + sent.length > 1000) { chunks.push(buffer); buffer = sent; }
            else { buffer += (buffer ? " " : "") + sent; }
        });
        if (buffer) chunks.push(buffer);
        return chunks;
    }
    
    _genSigil(text) {
        return (text||"").toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
    }

    async _getTextFromFile(file) {
        if (file.type === 'application/pdf') {
            if (typeof pdfjsLib === 'undefined') {
                throw new Error('pdf.js library is not loaded. Please include it in your HTML.');
            }
            const reader = new FileReader();
            return new Promise((resolve, reject) => {
                reader.onload = async (event) => {
                    try {
                        const pdf = await pdfjsLib.getDocument(event.target.result).promise;
                        let text = '';
                        for (let i = 1; i <= pdf.numPages; i++) {
                            const page = await pdf.getPage(i);
                            const content = await page.getTextContent();
                            text += content.items.map(item => item.str).join(' ') + '\n';
                        }
                        resolve(text);
                    } catch (e) {
                        reject(new Error(`PDF parsing failed: ${e.message}`));
                    }
                };
                reader.onerror = () => reject(new Error('Failed to read file for PDF parsing.'));
                reader.readAsArrayBuffer(file);
            });
        }
        // Default to plain text for other file types
        return file.text();
    }

    async _processBatches(chunks, agentId, startIndex, onProgress) {
        this.ingestStatus = 'running';
        const totalChunks = chunks.length;
        const BATCH_SIZE = 20;
        let processedCount = startIndex;
        let totalBatchTime = 0;
        let batchesProcessed = 0;

        try {
            for (let i = startIndex; i < totalChunks; i += BATCH_SIZE) {
                if (this.ingestStatus !== 'running') {
                    onProgress({ state: this.ingestStatus.toUpperCase(), processed: processedCount, total: totalChunks });
                    return { success: false, message: `Ingestion ${this.ingestStatus}.` };
                }

                const batchStartTime = Date.now();
                const batch = chunks.slice(i, i + BATCH_SIZE);
                
                const embedResponse = await this._geminiApiCall('embed', { 
                    text: batch.map(b => b.text), // Pass an array of texts for batch embedding
                    type: 'RETRIEVAL_DOCUMENT' 
                });

                if (!embedResponse.embeddings) throw new Error("API did not return embeddings for batch.");

                for (let j = 0; j < batch.length; j++) {
                    if (!embedResponse.embeddings[j]) continue;
                    await this.db.put('vectors', {
                        id: crypto.randomUUID(),
                        agentId,
                        text: batch[j].text,
                        vector: embedResponse.embeddings[j].values,
                        numMarkId: this._genSigil(batch[j].text),
                        metadata: { source: batch[j].source, timestamp: new Date().toISOString(), locus: `Z:\\MYTHOS>LORE>${agentId}` }
                    });
                }

                processedCount += batch.length;
                
                const batchEndTime = Date.now();
                const batchDuration = (batchEndTime - batchStartTime) / 1000;
                totalBatchTime += batchDuration;
                batchesProcessed++;
                const avgBatchTime = totalBatchTime / batchesProcessed;
                const remainingChunks = totalChunks - processedCount;
                const remainingBatches = Math.ceil(remainingChunks / BATCH_SIZE);
                const etaSeconds = Math.round(remainingBatches * avgBatchTime);

                await this.db.put('ingest_state', { id: INGEST_STATE_KEY, chunks, agentId, nextIndex: processedCount });
                onProgress({ state: 'EMBEDDING', processed: processedCount, total: totalChunks, etaSeconds });
            }

            await this.db.delete('ingest_state', INGEST_STATE_KEY);
            this.ingestStatus = 'idle';
            onProgress({ state: 'COMPLETE', processed: processedCount, total: totalChunks, etaSeconds: 0 });
            return { success: true, nodesAdded: processedCount };

        } catch (error) {
            console.error("Ingestion Error:", error);
            this.ingestStatus = 'idle';
            onProgress({ state: 'ERROR', error: error.message, etaSeconds: 0 });
            return { success: false, error: error.message };
        }
    }

    async ingest(fileQueue, agentId, onProgress = () => {}) {
        if (!agentId) throw new Error("Agent ID is required for ingestion.");
        if (fileQueue.length === 0) throw new Error("No files to ingest.");
        
        await this.db.delete('ingest_state', INGEST_STATE_KEY);
        onProgress({ state: 'CHUNKING', processed: 0, total: fileQueue.length });

        let allChunks = [];
        for (const file of fileQueue) {
            try {
                const text = await this._getTextFromFile(file);
                const chunks = this._semanticChunk(text);
                chunks.forEach(c => allChunks.push({ text: c, source: file.name }));
            } catch (e) {
                onProgress({ state: 'ERROR', error: `Failed to process file ${file.name}: ${e.message}`, etaSeconds: 0 });
                return { success: false, error: e.message };
            }
        }
        
        const initialState = { id: INGEST_STATE_KEY, chunks: allChunks, agentId, nextIndex: 0 };
        await this.db.put('ingest_state', initialState);
        
        onProgress({ state: 'EMBEDDING', processed: 0, total: allChunks.length });
        return this._processBatches(allChunks, agentId, 0, onProgress);
    }
    
    async checkForResume() {
        const savedState = await this.db.get('ingest_state', INGEST_STATE_KEY);
        return savedState || null;
    }

    async resumeIngest(onProgress = () => {}) {
        const state = await this.checkForResume();
        if (!state || !state.chunks || !state.agentId) {
            throw new Error("No incomplete ingestion found to resume.");
        }
        
        onProgress({ state: 'RESUMING', processed: state.nextIndex, total: state.chunks.length });
        return this._processBatches(state.chunks, state.agentId, state.nextIndex, onProgress);
    }
    
    pauseIngest() {
        this.ingestStatus = 'paused';
    }

    async abortIngest() {
        this.ingestStatus = 'aborted';
        await this.db.delete('ingest_state', INGEST_STATE_KEY);
        console.log("Ingestion aborted and saved state cleared.");
    }


    async export(agentId) {
        if (!agentId) throw new Error("Agent ID is required for export.");

        const all = await this.db.getAll('vectors');
        const nodes = all.filter(v => v.agentId === agentId);

        if (nodes.length === 0) {
            throw new Error(`No lore found for agent ${agentId}.`);
        }
        
        return {
            agentId,
            nodes,
            count: nodes.length,
            timestamp: new Date().toISOString()
        };
    }

    async nuke() {
        await this.db.clear('vectors');
        await this.db.delete('ingest_state', INGEST_STATE_KEY);
        console.warn("Database has been cleared.");
        return { success: true, message: "Vault vaporized."};
    }
    
    async getStats() {
        const all = await this.db.getAll('vectors');
        const statsByAgent = all.reduce((acc, node) => {
            acc[node.agentId] = (acc[node.agentId] || 0) + 1;
            return acc;
        }, {});
        return {
            totalNodes: all.length,
            agents: statsByAgent
        };
    }

    async import({ agentId, nodes }, onProgress = () => {}) {
        if (!nodes || !Array.isArray(nodes)) {
            throw new Error("Invalid import data: 'nodes' array is missing or not an array.");
        }
        if (!agentId) {
            throw new Error("Invalid import data: 'agentId' is missing.");
        }

        let nodesImported = 0;
        const totalNodes = nodes.length;

        for (let i = 0; i < totalNodes; i++) {
            const node = nodes[i];
            // Ensure agentId is correctly set on the node, even if already present
            node.agentId = agentId; 
            if (node.id && node.text && node.vector) {
                await this.db.put('vectors', node);
                nodesImported++;
            }
            // Report progress
            onProgress({ processed: i + 1, total: totalNodes }); 
        }
        return { success: true, nodesImported: nodesImported };
    }

    async getNodes(agentId) {
        if (!agentId) throw new Error("Agent ID is required to get nodes.");
        const all = await this.db.getAll('vectors');
        return all.filter(v => v.agentId === agentId);
    }
}