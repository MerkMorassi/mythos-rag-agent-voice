import { GraphEdge, GraphNode, VectorRecord } from '../types';
import { bulkPutGraphEdges, bulkPutGraphNodes, deleteGraphByAgent } from './db';

// LOREPACK™ v1.1 :: Standalone Module (Corrected & Integrated)
// © 2026 MYTHOS, All Rights Reserved

const DB_NAME = 'mythos_vault';
const DB_VERSION = 8;
const GENERATION_MODEL = 'gemini-1.5-flash';
const LOREPACK_GRAPH_LABEL = 'CONCEPT';
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'you',
    'are', 'was', 'were', 'but', 'not', 'its', 'their', 'they', 'them', 'his',
    'her', 'she', 'him', 'our', 'out', 'about', 'over', 'under', 'then', 'than',
    'when', 'where', 'what', 'which', 'who', 'why', 'how', 'a', 'an', 'of', 'to',
    'in', 'on', 'at', 'as', 'it', 'be', 'by', 'or', 'if', 'is'
]);

export interface LorepackNode extends VectorRecord {
    numMarkId?: string;
    metadata: {
        source: string;
        timestamp: string;
    };
}

export interface LorepackStats {
    totalNodes: number;
    agents: string[];
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        magA += vecA[i] * vecA[i];
        magB += vecB[i] * vecB[i];
    }
    const mag = Math.sqrt(magA) * Math.sqrt(magB);
    return mag === 0 ? 0 : dot / mag;
}

class SimpleDB {
    private db: IDBDatabase | null = null;
    private ready: Promise<void>;

    constructor() {
        this.ready = this.init();
    }

    private init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = (e.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains('vectors')) {
                    const store = db.createObjectStore('vectors', { keyPath: 'id' });
                    store.createIndex('agentId', 'agentId', { unique: false });
                }
            };
            req.onsuccess = () => {
                this.db = req.result;
                resolve();
            };
            req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
        });
    }

    async put(storeName: string, data: any): Promise<void> {
        await this.ready;
        if (!this.db) throw new Error("Database not initialized");
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(data);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject((e.target as IDBRequest).error);
        });
    }

    async getAll(storeName: string): Promise<any[]> {
        await this.ready;
        if (!this.db) throw new Error("Database not initialized");
        return new Promise((resolve, reject) => {
            const req = this.db!.transaction(storeName, 'readonly').objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject((e.target as IDBRequest).error);
        });
    }

    async clear(storeName: string): Promise<void> {
        await this.ready;
        if (!this.db) throw new Error("Database not initialized");
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject((e.target as IDBRequest).error);
        });
    }

    get rawDb(): IDBDatabase | null {
        return this.db;
    }
}

const cyrb53 = (str: string, seed = 0): number => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

const NumMarkX_GenSigil = (text: string): string => {
    if (!text) return 'void';
    const hash = cyrb53(text).toString(16);
    const prefix = text.substring(0, 10).toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${prefix}-${hash}`;
};

const tokenize = (text: string, tokenLimit = 200): string[] => {
    const tokens = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length > 2 && !STOP_WORDS.has(token));
    if (tokens.length <= tokenLimit) return tokens;
    return tokens.slice(0, tokenLimit);
};

const gzipText = async (content: string): Promise<Blob> => {
    if (!('CompressionStream' in window)) {
        throw new Error("CompressionStream is not supported in this browser.");
    }
    const stream = new Blob([content]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).blob();
};

const ungzipText = async (file: File): Promise<string> => {
    if (!('DecompressionStream' in window)) {
        throw new Error("DecompressionStream is not supported in this browser.");
    }
    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
};

const parseLorepackText = (text: string): { nodes: any[]; agentId: string | null } => {
    let nodes: any[] = [];
    let agentId: string | null = null;
    try {
        const data = JSON.parse(text);
        if (data.schema === 'MYTHOS.LOREPACK.v1' && Array.isArray(data.sacred_archive)) {
            nodes = data.sacred_archive;
            agentId = data.agentId || data.header?.agentId || null;
        } else if (Array.isArray(data)) {
            nodes = data;
        } else {
            nodes = [data];
        }
    } catch (e) {
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const node = JSON.parse(line);
                    if (node && node.vector && node.text) {
                        nodes.push(node);
                        if (!agentId && node.agent) agentId = node.agent;
                    }
                } catch (lineErr) {
                    console.warn("Skipping malformed JSONL line:", lineErr);
                }
            }
        }
    }

    return { nodes, agentId };
};

const buildGraphLiteFromNodes = (nodes: any[], agentId: string, maxKeywords: number, minTermCount: number) => {
    const graphNodes = new Map<string, GraphNode>();
    const graphEdges: GraphEdge[] = [];
    const termCountsBySource = new Map<string, Map<string, number>>();

    nodes.forEach(node => {
        const sourceLabel = node.source || node.metadata?.source || 'Unknown Source';
        const sourceId = `source:${agentId}:${sourceLabel}`;
        if (!termCountsBySource.has(sourceId)) {
            termCountsBySource.set(sourceId, new Map());
        }
        const termCounts = termCountsBySource.get(sourceId)!;
        tokenize(node.text || '').forEach(token => {
            termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
        });
    });

    termCountsBySource.forEach((termCounts, sourceId) => {
        const sourceLabel = sourceId.replace(`source:${agentId}:`, '');
        graphNodes.set(sourceId, {
            id: sourceId,
            name: sourceLabel,
            label: 'SOURCE',
            description: `Source file ${sourceLabel}`,
            agentId
        });

        const topTerms = [...termCounts.entries()]
            .filter(([, count]) => count >= minTermCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, maxKeywords)
            .map(([term]) => term);

        topTerms.forEach(term => {
            const keywordId = `concept:${agentId}:${term}`;
            if (!graphNodes.has(keywordId)) {
                graphNodes.set(keywordId, {
                    id: keywordId,
                    name: term,
                    label: LOREPACK_GRAPH_LABEL,
                    description: 'Extracted concept keyword.',
                    agentId
                });
            }
            graphEdges.push({
                source: sourceId,
                target: keywordId,
                label: 'MENTIONS',
                agentId
            });
        });
    });

    return { nodes: [...graphNodes.values()], edges: graphEdges };
};

export class Lorepack {
    private db = new SimpleDB();
    private apiKeys: string[] = [];
    private currentKeyIndex = 0;
    private abortController: AbortController | null = null;

    setApiKeys(keys: string[]) {
        this.apiKeys = keys.filter(k => k && k.trim().length > 0);
    }

    private _getKey(): string {
        if (this.apiKeys.length === 0) throw new Error("No API Keys provided.");
        const key = this.apiKeys[this.currentKeyIndex];
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        return key;
    }

    private async _geminiApiCall(action: string, payload: any, model = GENERATION_MODEL) {
        const key = this._getKey();
        let endpointUrl: string, body: any;

        if (action === 'generateContent') {
            endpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
            body = {
                contents: [{ parts: [{ text: payload.prompt }] }],
                ...(payload.systemInstruction && { systemInstruction: { parts: [{ text: payload.systemInstruction }] } })
            };
        } else if (action === 'batchEmbedContents') {
            endpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${key}`;
            body = {
                requests: payload.texts.map((t: string) => ({ model: "models/text-embedding-004", content: { parts: [{ text: t }] } }))
            };
        } else if (action === 'embedContent') {
             endpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`;
             body = {
                model: 'models/text-embedding-004',
                content: { parts: [{ text: payload.text }] }
            };
        } else {
            throw new Error(`Unknown API action: ${action}`);
        }

        const res = await fetch(endpointUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: this.abortController?.signal
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
            throw new Error(`API Error: ${err.error?.message || res.statusText}`);
        }
        return res.json();
    }
    
    chunkText(text: string, maxChunkSize = 1000): string[] {
        const sentenceRegex = /(?<=[.?!])\s+/;
        const sentences = text.split(sentenceRegex);
        const chunks: string[] = [];
        let buffer = "";
        for (const sentence of sentences) {
            if ((buffer.length + sentence.length) <= maxChunkSize) {
                buffer += (buffer ? " " : "") + sentence;
            } else {
                if (buffer) chunks.push(buffer);
                buffer = sentence;
            }
        }
        if (buffer) chunks.push(buffer);
        return chunks;
    }

    async ingest(files: File[], agentId: string, onProgress?: (p: {processed: number, total: number}) => void) {
        this.abortController = new AbortController();
        let allTasks: { text: string, source: string, sigil: string }[] = [];
        for (const file of files) {
            const text = await file.text();
            const chunks = this.chunkText(text);
            chunks.forEach(chunk => allTasks.push({ text: chunk, source: file.name, sigil: NumMarkX_GenSigil(chunk) }));
        }

        const totalVectors = allTasks.length;
        if (totalVectors === 0) {
            throw new Error("No content found to ingest.");
        }
        let processedCount = 0;
        const BATCH_SIZE = 50;
        
        for (let i = 0; i < allTasks.length; i += BATCH_SIZE) {
            if (this.abortController.signal.aborted) throw new Error("Ingestion Aborted.");
            const batch = allTasks.slice(i, i + BATCH_SIZE);
            const batchTexts = batch.map(t => t.text);
            try {
                const data = await this._geminiApiCall('batchEmbedContents', { texts: batchTexts });
                if (!Array.isArray(data.embeddings) || data.embeddings.length !== batch.length) {
                    throw new Error("Invalid API response for batch embeddings.");
                }
                for (let j = 0; j < batch.length; j++) {
                    if (!data.embeddings[j]?.values) {
                        throw new Error("Embedding response missing vector data.");
                    }
                    await this.db.put('vectors', {
                        id: crypto.randomUUID(),
                        agent: agentId.toUpperCase(),
                        text: batch[j].text,
                        vector: data.embeddings[j].values,
                        numMarkId: batch[j].sigil,
                        timestamp: Date.now(),
                        source: batch[j].source,
                        metadata: { source: batch[j].source, timestamp: new Date().toISOString() }
                    });
                }
                processedCount += batch.length;
                if (onProgress) onProgress({ processed: processedCount, total: totalVectors });
            } catch (err) {
                console.error("Batch Failed:", err);
                throw err;
            }
        }
        if (onProgress) onProgress({ processed: totalVectors, total: totalVectors });
        return processedCount;
    }

    async chat(userQuery: string, agentId: string | null, customSystemPrompt?: string) {
        const allNodes = await this.db.getAll('vectors');
        const candidates = agentId ? allNodes.filter(v => v.agent === agentId) : allNodes;
        let context = "";
        let derivation = "General Knowledge";
        let source = "System";

        if (candidates.length > 0) {
            const queryEmbData = await this._geminiApiCall('embedContent', { text: userQuery });
            const queryVec = queryEmbData.embedding?.values ?? queryEmbData.embeddings?.[0]?.values;
            if (!queryVec) {
                throw new Error("Embedding response missing vector data.");
            }
            
            const scored = candidates.map(doc => ({
                ...doc,
                score: cosineSimilarity(queryVec, doc.vector)
            })).sort((a, b) => b.score - a.score).slice(0, 5);

            if (scored.length > 0 && scored[0].score > 0.45) {
                 context = scored.map(s => `[SOURCE: ${s.source || 'Unknown'}]\n${s.text}`).join('\n\n');
                 derivation = `Derived from ${scored.length} nodes (Top match: ${(scored[0].score * 100).toFixed(1)}%)`;
                 source = scored[0].source || "Archive";
            }
        }

        const defaultSystemInstruction = "You are a neutral, factual AI assistant. Your task is to answer the user's query based *only* on the provided context. If the context does not contain the answer, state that the information is not available in the provided documents.";
        const systemInstruction = customSystemPrompt || defaultSystemInstruction;
        const modelPrompt = `CONTEXT:\n${context || 'No context available.'}\n\nUSER QUERY: ${userQuery}\n\nRESPONSE:`;

        const genData = await this._geminiApiCall('generateContent', { prompt: modelPrompt, systemInstruction });

        if (!genData.candidates || genData.candidates.length === 0) {
            throw new Error("Model returned no response.");
        }

        return {
            response: genData.candidates[0].content.parts[0].text,
            derivation,
            source
        };
    }

    async nuke() { await this.db.clear('vectors'); }
    
    async getStats(): Promise<LorepackStats> { 
        const all = await this.db.getAll('vectors');
        return {
            totalNodes: all.length,
            agents: [...new Set(all.map(v => v.agent))] as string[]
        };
    }

    async export(agentId?: string): Promise<{ nodes: any[], count: number }> { 
        const all = await this.db.getAll('vectors');
        const nodes = agentId ? all.filter(v => v.agent === agentId) : all;
        return { nodes, count: nodes.length };
    }

    async exportGzip(agentId: string) {
        const { nodes, count } = await this.export(agentId);
        if (count === 0) throw new Error("No nodes found to export.");
        const content = nodes.map(n => JSON.stringify(n)).join('\n');
        const blob = await gzipText(content);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `MYTHOS.LORE.${agentId.toUpperCase()}.jsonl.gz`;
        a.click();
        URL.revokeObjectURL(url);
        return count;
    }

    async import(fileOrData: File | any, onProgress?: (p: {processed: number, total: number}) => void) {
        let nodes: any[] = [];
        let agentId: string | null = null;

        if (fileOrData instanceof File) {
            const text = await fileOrData.text();
            try {
                const data = JSON.parse(text);
                if (data.schema === 'MYTHOS.LOREPACK.v1' && Array.isArray(data.sacred_archive)) {
                    nodes = data.sacred_archive;
                    agentId = data.agentId;
                } else if (Array.isArray(data)) {
                    nodes = data;
                } else {
                    nodes = [data]; 
                }
            } catch (e) {
                console.log("JSON Parse failed, attempting JSONL stream parsing...");
                const lines = text.split(/\r?\n/);
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const node = JSON.parse(line);
                            if (node && node.vector && node.text) {
                                nodes.push(node);
                                if (!agentId && node.agent) agentId = node.agent;
                            }
                        } catch (lineErr) {
                            console.warn("Skipping malformed JSONL line:", lineErr);
                        }
                    }
                }
            }
        } else {
            nodes = Array.isArray(fileOrData) ? fileOrData : 
                   (fileOrData.sacred_archive ? fileOrData.sacred_archive : [fileOrData]);
            agentId = fileOrData.agentId || (nodes[0] ? nodes[0].agent : null);
        }

        if (nodes.length === 0) throw new Error("No valid nodes found in import.");

        let imported = 0;
        const total = nodes.length;
        const rawDb = this.db.rawDb;
        if (!rawDb) throw new Error("Database not ready");

        const tx = rawDb.transaction('vectors', 'readwrite');
        const store = tx.objectStore('vectors');
        const updateEvery = Math.max(1, Math.floor(total / 100));

        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject((e.target as IDBRequest).error);

            nodes.forEach(node => {
                if (!node.id) node.id = crypto.randomUUID();
                store.put(node);
                imported++;
                if (onProgress && (imported % updateEvery === 0 || imported === total)) {
                    onProgress({ processed: imported, total: total });
                }
            });
        });

        return { success: true, nodesImported: imported, agentId };
    }

    async importGzip(file: File, onProgress?: (p: {processed: number, total: number}) => void) {
        const text = await ungzipText(file);
        const { nodes } = parseLorepackText(text);
        return this.import(nodes, onProgress);
    }

    async exportLorepackWithGraph(file: File, maxKeywords = 4, minTermCount = 2) {
        const text = file.name.endsWith('.gz') ? await ungzipText(file) : await file.text();
        const { nodes, agentId } = parseLorepackText(text);
        if (nodes.length === 0) throw new Error("No valid nodes found in import.");
        const resolvedAgentId = agentId || nodes[0]?.agent || 'UNKNOWN';
        const graph = buildGraphLiteFromNodes(nodes, resolvedAgentId, maxKeywords, minTermCount);
        const payload = {
            schema: 'MYTHOS.LOREPACK.v1',
            agentId: resolvedAgentId,
            sacred_archive: nodes,
            graph
        };
        const json = JSON.stringify(payload, null, 2);
        let blob: Blob;
        let fileName = `MYTHOS.LORE.${resolvedAgentId.toUpperCase()}.lorepack.json`;
        try {
            blob = await gzipText(json);
            fileName = `${fileName}.gz`;
        } catch (e) {
            blob = new Blob([json], { type: 'application/json' });
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        return { nodes: nodes.length, graphNodes: graph.nodes.length, graphEdges: graph.edges.length };
    }

    async buildGraphLite(agentId: string, maxKeywords = 4, minTermCount = 2) {
        if (!agentId) throw new Error("Agent ID is required to build a graph.");
        const all = await this.db.getAll('vectors');
        const nodes = all.filter(v => v.agent === agentId);
        if (nodes.length === 0) throw new Error("No nodes available to build graph.");

        const graph = buildGraphLiteFromNodes(nodes, agentId, maxKeywords, minTermCount);

        await deleteGraphByAgent(agentId);
        await bulkPutGraphNodes(graph.nodes);
        await bulkPutGraphEdges(graph.edges);

        return { nodes: graph.nodes.length, edges: graph.edges.length };
    }

    async getNodes(agentId: string) {
        if (!agentId) throw new Error("Agent ID is required to get nodes.");
        const all = await this.db.getAll('vectors');
        if (agentId === 'OPERATOR') return all;
        return all.filter(v => v.agent === agentId);
    }
}
