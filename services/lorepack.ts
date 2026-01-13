// File: services/lorepack.ts
// LOREPACK™ v3.7.0 :: SOVEREIGN KERNEL (TypeScript Port)
// - GraphMAGRAG Lite Enabled (Vectors + Edges)
// - Fixes IDB Version to 10
// - Full Import/Export/Chat fidelity
// © 2026 MYTHOS. All Rights Reserved.
import { GoogleGenAI, Type } from "@google/genai";

const DB_NAME = 'mythos_vault';
const DB_VERSION = 10;

class SimpleDB {
  db: IDBDatabase | null = null;
  public ready: Promise<void>;

  constructor() {
    this.ready = this._init();
  }

  _init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;

        // Vectors Store
        if (!db.objectStoreNames.contains('vectors')) {
          const store = db.createObjectStore('vectors', { keyPath: 'id' });
          store.createIndex('agentId', 'agentId', { unique: false });
          store.createIndex('numMarkId', 'numMarkId', { unique: false });
        } else {
          const store = req.transaction!.objectStore('vectors');
          if (!store.indexNames.contains('agentId')) store.createIndex('agentId', 'agentId', { unique: false });
          if (!store.indexNames.contains('numMarkId')) store.createIndex('numMarkId', 'numMarkId', { unique: false });
        }

        // Edges Store (Graph)
        if (!db.objectStoreNames.contains('edges')) {
          const edgeStore = db.createObjectStore('edges', { keyPath: 'id' });
          edgeStore.createIndex('sourceId', 'sourceId', { unique: false });
          edgeStore.createIndex('agentId', 'agentId', { unique: false });
          edgeStore.createIndex('type', 'type', { unique: false });
        }
      };

      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  async put(storeName: string, value: any): Promise<void> {
    await this.ready;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(storeName, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(storeName).put(value);
    });
  }

  async bulkPut(storeName: string, values: any[]): Promise<void> {
    await this.ready;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      for (const v of values) store.put(v);
    });
  }

  async getAll(storeName: string): Promise<any[]> {
    await this.ready;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async count(storeName: string): Promise<number> {
    await this.ready;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async nuke(): Promise<void> {
    if (this.db) {
        this.db.close();
        this.db = null;
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => {
        resolve();
      };
      req.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
      req.onblocked = (event) => {
        console.warn("Database deletion is blocked. Please close other tabs running this application.");
        alert("Database deletion is blocked. Please close all other tabs with this application open to proceed.");
        // Do not resolve here. This allows the request to wait for other connections to close.
      };
    });
  }
}

function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    ma += x * x;
    mb += y * y;
  }
  const denom = Math.sqrt(ma) * Math.sqrt(mb);
  return denom ? dot / denom : 0;
}

export class Lorepack {
  private db: SimpleDB;
  private apiKeys: string[] = [];
  private keyIndex = 0;

  constructor() {
    this.db = new SimpleDB();
  }

  async ready() {
    await this.db.ready;
  }

  setApiKeys(keys: string[]) {
    this.apiKeys = (keys || []).map(k => (k || '').trim()).filter(Boolean);
  }

  _getKey(): string {
    if (!this.apiKeys.length) throw new Error('API Keys Missing.');
    const k = this.apiKeys[this.keyIndex];
    this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
    return k;
  }

  genSigil(t: string): string {
    return (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
  }

  chunk(text: string, maxChars = 2000): string[] {
    const raw = (text || '')
      .replace(/\r/g, '')
      .replace(/([.?!])\s+(?=[A-Z0-9@])/g, '$1|')
      .split('|')
      .map(s => s.trim())
      .filter(Boolean);

    const out = [];
    let buf = '';
    for (const s of raw) {
      if (!buf) {
        buf = s;
        continue;
      }
      if ((buf.length + 1 + s.length) > maxChars) {
        out.push(buf);
        buf = s;
      } else {
        buf += ' ' + s;
      }
    }
    if (buf) out.push(buf);
    return out;
  }

  async getStats(): Promise<{ totalNodes: number, totalEdges: number }> {
    const totalNodes = await this.db.count('vectors');
    const totalEdges = await this.db.count('edges');
    return { totalNodes, totalEdges };
  }

  async getNodes(agentId?: string): Promise<any[]> {
    const all = await this.db.getAll('vectors');
    if (!agentId || agentId === 'OPERATOR') return all;
    const aid = agentId.toUpperCase();
    return all.filter(n => (n.agentId || '').toUpperCase() === aid);
  }

  // --- EMBEDDINGS ---
  async embedBatch(texts: string[], keyOverride: string | null = null): Promise<number[][]> {
    const key = keyOverride || this._getKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${encodeURIComponent(key)}`;
    const body = {
      requests: texts.map(t => ({
        model: 'models/text-embedding-004',
        content: { parts: [{ text: t }] }
      }))
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error?.message || `Embed failed (${res.status})`);
    return (json.embeddings || []).map((e: any) => e.values);
  }

  // --- INGESTION ---
  async ingestBatches(batches: any[], opts: any = {}): Promise<{ ingested: number }> {
    const agentId = (opts.agentId || '').trim().toUpperCase();
    if (!agentId) throw new Error('Agent ID required.');
    const agentHandle = (opts.agentHandle || '').trim();
    const batchSize = Math.max(5, Math.min(200, parseInt(opts.batchSize || 60, 10)));
    const threadsPerKey = Math.max(1, Math.min(50, parseInt(opts.threadsPerKey || 3, 10)));
    const signal = opts.signal || null;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

    if (!this.apiKeys.length) throw new Error('API Keys Missing.');
    if (!Array.isArray(batches) || !batches.length) return { ingested: 0 };

    const concurrency = this.apiKeys.length * threadsPerKey;
    let processed = 0, written = 0;
    const inFlight: Set<Promise<void>> = new Set();

    const runOne = async (chunkGroup: any[]) => {
      if (signal?.aborted) throw new Error('Aborted');
      const key = this._getKey();
      const texts = chunkGroup.map(x => x.text);
      const vectors = await this.embedBatch(texts, key);
      const nowISO = new Date().toISOString();
      const nodes = chunkGroup.map((x, i) => ({
        id: crypto.randomUUID(),
        agentId,
        agentHandle,
        text: x.text,
        vector: vectors[i],
        numMarkId: this.genSigil(x.text),
        metadata: {
          source: x.source || 'UNKNOWN',
          timestamp: nowISO,
          locus: `MYTHOS.LORE.${agentId}`,
          ...(x.extraMeta || {})
        }
      }));

      await this.db.bulkPut('vectors', nodes);
      written += nodes.length;
      processed += chunkGroup.length;
      if (onProgress) onProgress({ processed, written, total: batches.length });
    };

    const groups = [];
    for (let i = 0; i < batches.length; i += batchSize) {
      groups.push(batches.slice(i, i + batchSize));
    }

    let idx = 0;
    while (idx < groups.length) {
      if (signal?.aborted) throw new Error('Aborted');
      while (inFlight.size < concurrency && idx < groups.length) {
        const g = groups[idx++];
        const p = runOne(g).catch((e) => { throw e; }).finally(() => inFlight.delete(p));
        inFlight.add(p);
      }
      if (inFlight.size) await Promise.race(Array.from(inFlight));
    }
    await Promise.all(Array.from(inFlight));
    return { ingested: written };
  }

  // --- GRAPH GENERATION (NEW - CONCURRENT) ---
  async buildGraphLite(agentId: string, opts: { onProgress: (curr: number, total: number, created: number) => void, threadsPerKey: number }): Promise<number> {
    const { onProgress, threadsPerKey } = opts;
    const nodes = await this.getNodes(agentId);
    if (!nodes.length) return 0;
    
    let createdEdges = 0;
    let processedNodes = 0;
    const totalNodes = nodes.length;

    const concurrency = this.apiKeys.length * (threadsPerKey || 3);
    const inFlight: Set<Promise<void>> = new Set();
    
    const runOneNode = async (node: any): Promise<number> => {
        const prompt = `From the following text, extract up to 5 key relationships between entities (people, places, concepts). Present them as a JSON array of triplets, where each triplet has a subject 's', a relation 'r', and an object 'o'. If no clear relationships are found, return an empty array.

CONTEXT:
${node.text}
`;
        const systemInstruction = "You are a Relationship Extractor. Output strictly JSON. Do not use markdown. Your output must be an array of objects, even if it's empty.";
        try {
          const key = this._getKey();
          const ai = new GoogleGenAI({ apiKey: key });

          const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
              systemInstruction: systemInstruction,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    s: { type: Type.STRING, description: "The subject of the relationship." },
                    r: { type: Type.STRING, description: "The relationship between subject and object." },
                    o: { type: Type.STRING, description: "The object of the relationship." }
                  },
                  required: ["s", "r", "o"]
                }
              }
            }
          });
          
          const textResponse = response.text;
          if (!textResponse) return 0;

          const triplets = JSON.parse(textResponse);
          
          if (Array.isArray(triplets) && triplets.length > 0) {
            const edges = triplets.map(t => ({
              id: crypto.randomUUID(),
              type: 'edge',
              agentId: (agentId || 'UNKNOWN').toUpperCase(),
              sourceId: node.id,
              s: t.s,
              r: t.r,
              o: t.o,
              timestamp: new Date().toISOString()
            }));
            await this.db.bulkPut('edges', edges);
            return edges.length;
          }
        } catch (e: any) { 
          console.warn(`[GraphBuild] Failed to extract relationships for a node. Error: ${e.message}`);
        }
        return 0;
    };

    let nodeIndex = 0;
    const processQueue = async () => {
        while (nodeIndex < totalNodes) {
            if (inFlight.size >= concurrency) {
                await Promise.race(Array.from(inFlight));
                continue;
            }
            const nodeToProcess = nodes[nodeIndex++];
            const p = runOneNode(nodeToProcess).then(newEdges => {
                createdEdges += newEdges;
            }).catch(err => {
                console.error(`[GraphBuild] Error processing node ${nodeToProcess.id}:`, err);
            }).finally(() => {
                processedNodes++;
                if (onProgress) {
                    onProgress(processedNodes, totalNodes, createdEdges);
                }
                inFlight.delete(p);
            });
            inFlight.add(p);
        }
    };
    
    await processQueue();
    await Promise.all(Array.from(inFlight));

    return createdEdges;
  }


  // --- EXPORT ---
  async *yieldExportBatches(agentId: string, batch = 1000): AsyncGenerator<any[]> {
    // Vectors
    const nodes = await this.getNodes(agentId);
    for (let i = 0; i < nodes.length; i += batch) {
      yield nodes.slice(i, i + batch).map(o => ({
        v: 2,
        type: 'vector',
        a: o.agentId,
        h: o.agentHandle || '',
        t: o.text,
        vec: o.vector,
        m: o.numMarkId,
        d: o.metadata || {}
      }));
    }
    // Edges
    const allEdges = await this.db.getAll('edges');
    const agentEdges = allEdges.filter(e => (e.agentId || '').toUpperCase() === (agentId || '').toUpperCase());
    for (let i = 0; i < agentEdges.length; i += batch) {
      yield agentEdges.slice(i, i + batch).map(e => ({
        v: 2,
        type: 'edge',
        id: e.id,
        aid: e.agentId,
        src: e.sourceId,
        s: e.s,
        r: e.r,
        o: e.o
      }));
    }
  }

  // --- IMPORT ---
  async import(fileOrBlob: File, onProgress: (p: {processed: number}) => void): Promise<{ success: boolean, nodesImported: number }> {
    const fileName = fileOrBlob?.name || '';
    let stream: ReadableStream<any> = fileOrBlob.stream();
    if (fileName.endsWith('.gz')) stream = stream.pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();

    let buffer = '';
    let count = 0;
    let batch: any[] = [];
    const BATCH_WRITE = 1000;

    const writeBatch = async () => {
      if (!batch.length) return;
      const vectors: any[] = [];
      const edges: any[] = [];

      for (const n of batch) {
        if (n.type === 'edge') {
           edges.push({
            id: n.id || crypto.randomUUID(),
            type: 'edge',
            agentId: n.aid || n.a, 
            sourceId: n.src,
            s: n.s,
            r: n.r,
            o: n.o,
            timestamp: new Date().toISOString()
           });
        } else {
           const vNode = (n.v === 2) 
             ? {
                 id: crypto.randomUUID(),
                 agentId: n.a,
                 agentHandle: n.h || '',
                 text: n.t,
                 vector: n.vec,
                 numMarkId: n.m,
                 metadata: n.d || {}
               }
             : { ...n, id: n.id || crypto.randomUUID() };
           vectors.push(vNode);
        }
      }

      if (vectors.length) await this.db.bulkPut('vectors', vectors);
      if (edges.length) await this.db.bulkPut('edges', edges);
      
      count += batch.length;
      batch = [];
      if (onProgress) onProgress({ processed: count });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try { batch.push(JSON.parse(s)); } catch(e) {}
        if (batch.length >= BATCH_WRITE) await writeBatch();
      }
    }
    if (buffer.trim()) {
       try { batch.push(JSON.parse(buffer.trim())); } catch(e){}
    }
    await writeBatch();
    return { success: true, nodesImported: count };
  }

  // --- CHAT ---
  async chat(userQuery: string, agentId: string | null, systemPrompt?: string, model = 'gemini-3-flash-preview', topK = 6, threshold = 0.45): Promise<{ response: string, derivation: string, source: string }> {
    const pool = await this.getNodes(agentId || undefined);
    if (!pool.length) return { response: 'Vault empty.', derivation: 'EMPTY_VAULT', source: 'NULL' };

    const qVec = (await this.embedBatch([userQuery]))[0];
    const scored = pool.map(n => ({ n, s: cosine(qVec, n.vector) })).sort((a, b) => b.s - a.s).slice(0, topK);
    const best = scored[0]?.s || 0;
    const contextNodes = best >= threshold ? scored : [];
    
    const context = contextNodes.map(x => `--- [SOURCE: ${x.n.metadata?.source || 'UNKNOWN'} | ${(x.s * 100).toFixed(1)}%] ---\n${x.n.text}`).join('\n\n');
    const derivation = contextNodes.length ? `COSINE_TOPK(${topK})` : `NO_CONTEXT`;

    const key = this._getKey();
    const ai = new GoogleGenAI({ apiKey: key });

    const response = await ai.models.generateContent({
      model: model,
      contents: `CONTEXT:\n${context}\n\nUSER:\n${userQuery}`,
      config: {
        systemInstruction: systemPrompt || '',
      }
    });

    return { response: response.text || '(no reply)', derivation, source: 'RAG' };
  }

  async nuke() { return this.db.nuke(); }
}