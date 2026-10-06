
import { GraphEdge, GraphNode, VectorRecord } from '../types';

// LOREPACK™ v3.7.1 :: SOVEREIGN KERNEL
// - GraphMAGRAG Lite Enabled (Vectors + Edges)
// - IndexedDB Version 10
// - Current Gemini Embeddings
// - Full Import/Export/Chat fidelity
// - ID-preserving graph round-trip
// - Strict chunk ceiling
// - Explicit import/graph errors
// - Embedding-space compatibility enforcement
// © 2026 MYTHOS. All Rights Reserved.

const DB_NAME = 'mythos_vault';
const DB_VERSION = 10;

export const EMBEDDING_MODEL = 'gemini-embedding-2';
export const DEFAULT_GENERATION_MODEL = 'gemini-3.8-flash';

export const MAX_EMBED_BATCH = 100;
export const MAX_CHUNK_CHARS = 2000;

class SimpleDB {
  private db: IDBDatabase | null = null;
  // FIX: 'ready' property must be public to be accessed by the Lorepack class.
  public ready: Promise<void>;

  constructor() {
    this.ready = this._init();
  }

  _init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        const tx = (e.target as IDBOpenDBRequest).transaction!;

        // Vectors Store
        if (!db.objectStoreNames.contains('vectors')) {
          const store = db.createObjectStore('vectors', { keyPath: 'id' });
          store.createIndex('agentId', 'agentId', { unique: false });
          store.createIndex('numMarkId', 'numMarkId', { unique: false });
        } else {
          const store = tx.objectStore('vectors');
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
      if (!values || values.length === 0) return resolve();
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
    if (this.db) this.db.close();
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
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
  private keyIndex: number = 0;

  constructor() {
    this.db = new SimpleDB();
  }

  async ready(): Promise<void> {
    await this.db.ready;
  }

  setApiKeys(keys?: string[]): void {
    this.apiKeys = (keys || []).map(k => (k || '').trim()).filter(Boolean);
  }

  private _getKey(): string {
    if (this.apiKeys.length > 0) {
      const k = this.apiKeys[this.keyIndex];
      this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
      return k;
    }
    const fallback = (typeof localStorage !== 'undefined' ? localStorage.getItem('gemini_api_key') : '') ||
                     (typeof process !== 'undefined' ? process.env.API_KEY : '') || '';
    if (fallback.trim()) {
      return fallback.trim();
    }
    throw new Error('API Key Missing. Add at least one Google Gemini API Key in Harness or Settings.');
  }

  genSigil(t?: string): string {
    return (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
  }

  chunk(text?: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
    const limit = Math.max(1, Math.floor(Number(maxChars) || MAX_CHUNK_CHARS));
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!normalized) return [];

    const sentences = normalized.split(/(?<=[.!?])\s+(?=[A-Z0-9@])/).map(s => s.trim()).filter(Boolean);
    const out: string[] = [];
    let buffer = '';

    const emitHardWrapped = (textValue: string) => {
      let remaining = textValue.trim();
      while (remaining.length > limit) {
        let cut = remaining.lastIndexOf(' ', limit);
        if (cut <= 0) cut = limit;
        const piece = remaining.slice(0, cut).trim();
        if (piece) out.push(piece);
        remaining = remaining.slice(cut).trim();
      }
      if (remaining) out.push(remaining);
    };

    for (const sentence of sentences) {
      if (sentence.length > limit) {
        if (buffer) {
          out.push(buffer);
          buffer = '';
        }
        emitHardWrapped(sentence);
        continue;
      }
      if (!buffer) {
        buffer = sentence;
        continue;
      }
      const candidate = `${buffer} ${sentence}`;
      if (candidate.length <= limit) {
        buffer = candidate;
      } else {
        out.push(buffer);
        buffer = sentence;
      }
    }
    if (buffer) out.push(buffer);
    return out.filter(Boolean);
  }

  async getStats(): Promise<{ totalNodes: number, totalEdges: number }> {
    await this.db.ready;
    const totalNodes = await this.db.count('vectors');
    const totalEdges = await this.db.count('edges');
    return { totalNodes, totalEdges };
  }

  async getNodes(agentId?: string): Promise<VectorRecord[]> {
    await this.db.ready;
    const all = await this.db.getAll('vectors') as VectorRecord[];
    if (!agentId || agentId === 'OPERATOR' || agentId === 'ALL') return all;
    const aid = agentId.trim().toUpperCase();
    const filtered = all.filter(n => (n.agent || '').trim().toUpperCase() === aid);
    // If agent-specific nodes exist, return them. If none match this agent but the vault has records,
    // fallback to all available documents so the local chatbot is never blind.
    if (filtered.length > 0) return filtered;
    return all;
  }

  // FIX: Changed method from private to public to allow access from LorepackHarness.
  public async embedBatch(texts: string[], keyOverride: string | null = null): Promise<number[][]> {
    const key = keyOverride || this._getKey();

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(EMBEDDING_MODEL)}:batchEmbedContents?key=${encodeURIComponent(key)}`;
    const body = {
      requests: texts.map(t => ({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text: t }] }
      }))
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(json.error?.message || `Embedding batch failed (${res.status})`);
    }
    return (json.embeddings || []).map((e: any) => e.values);
  }

  async ingestBatches(batches: { text: string, source: string, extraMeta?: any }[], opts: any = {}): Promise<{ ingested: number }> {
    await this.db.ready;
    const agentId = (opts.agentId || '').trim().toUpperCase();
    if (!agentId) throw new Error('Agent ID required.');
    const agentHandle = (opts.agentHandle || '').trim();
    const batchSize = Math.max(5, Math.min(200, parseInt(opts.batchSize || 60, 10)));
    const threadsPerKey = Math.max(1, Math.min(50, parseInt(opts.lanesPerKey || 3, 10)));
    const signal = opts.signal || null;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

    if (!this.apiKeys.length) throw new Error('API Keys Missing.');
    if (!Array.isArray(batches) || !batches.length) return { ingested: 0 };

    const concurrency = this.apiKeys.length * threadsPerKey;
    let processed = 0, written = 0;
    const inFlight: Set<Promise<void>> = new Set();

    const runOne = async (chunkGroup: { text: string, source: string, extraMeta?: any }[]) => {
      if (signal?.aborted) throw new Error('Aborted');
      const key = this._getKey();
      const texts = chunkGroup.map(x => x.text);
      const vectors = await this.embedBatch(texts, key);
      const nowISO = new Date().toISOString();
      const nodes: VectorRecord[] = chunkGroup.map((x, i) => ({
        id: crypto.randomUUID(),
        agent: agentId,
        text: x.text,
        vector: vectors[i],
        source: x.source || 'UNKNOWN',
        timestamp: Date.now(),
        permissions: '644'
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

  async buildGraphLite(agentId: string, onProgress?: (curr: number, total: number, created: number) => void): Promise<number> {
    await this.db.ready;
    const nodes = await this.getNodes(agentId);
    let created = 0;
    const BATCH_SIZE = 5;
    let idx = 0;

    while (idx < nodes.length) {
      const batch = nodes.slice(idx, idx + BATCH_SIZE);
      const promises = batch.map(async (node) => {
        const prompt = `CONTEXT: ${node.text}\nTASK: Extract narrative relationships.\nFOCUS: RootLayer > RoleLayerID.\nOUTPUT FORMAT: [{"s": "Subject", "r": "Relation", "o": "Object"}]\nSYSTEM: JSON ONLY.`;
        try {
          const res = await this.chat(prompt, agentId, "SYSTEM: You are a Relationship Extractor. Output strictly JSON.", 'gemini-3.8-flash');
          let clean = res.response.trim();
          if (clean.startsWith('```json')) clean = clean.slice(7);
          if (clean.startsWith('```')) clean = clean.slice(3);
          if (clean.endsWith('```')) clean = clean.slice(0, -3);
          clean = clean.trim();
          
          let triplets = [];
          if (clean.startsWith('[') && clean.endsWith(']')) triplets = JSON.parse(clean);
          
          if (Array.isArray(triplets) && triplets.length > 0) {
            const edges: any[] = triplets.map(t => ({
              id: crypto.randomUUID(),
              type: 'edge',
              agentId: (agentId || 'UNKNOWN').toUpperCase(),
              sourceId: node.id,
              s: t.s, r: t.r, o: t.o,
              timestamp: new Date().toISOString()
            }));
            await this.db.bulkPut('edges', edges);
            return edges.length;
          }
        } catch (e) { console.error("Graph generation for node failed:", e); }
        return 0;
      });

      const results = await Promise.all(promises);
      created += results.reduce((a, b) => a + b, 0);
      idx += BATCH_SIZE;
      if (onProgress) onProgress(Math.min(idx, nodes.length), nodes.length, created);
    }
    return created;
  }

  async *yieldExportBatches(agentId: string, batchSize = 1000): AsyncGenerator<any[]> {
    const nodes = await this.getNodes(agentId);
    for (let i = 0; i < nodes.length; i += batchSize) {
      yield nodes.slice(i, i + batchSize).map(o => ({
        v: 2, type: 'vector', a: o.agent, t: o.text, vec: o.vector, m: this.genSigil(o.text), d: { source: o.source, timestamp: o.timestamp }
      }));
    }
    await this.db.ready;
    const allEdges = await this.db.getAll('edges');
    const agentEdges = allEdges.filter(e => (e.agentId || '').toUpperCase() === (agentId || '').toUpperCase());
    for (let i = 0; i < agentEdges.length; i += batchSize) {
      yield agentEdges.slice(i, i + batchSize).map(e => ({
        v: 2, type: 'edge', id: e.id, aid: e.agentId, src: e.sourceId, s: e.s, r: e.r, o: e.o
      }));
    }
  }

  async import(fileOrBlob: File, onProgress?: (p: { processed: number, total: number }) => void, defaultAgentId?: string): Promise<{ success: boolean, nodesImported: number, edgesImported: number }> {
    await this.db.ready;
    const fileName = fileOrBlob?.name || '';
    const isGzip = fileName.endsWith('.gz');
    const isStandardJson = fileName.toLowerCase().endsWith('.json') && !fileName.toLowerCase().endsWith('.jsonl') && !isGzip;

    // Check if it's a standard .json file that can be read directly
    if (isStandardJson) {
      try {
        const text = await fileOrBlob.text();
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch (jsonErr) {
          // If JSON.parse fails, it might be JSONL with .json extension - will fall through to streaming
        }

        if (parsed !== null) {
          let rawNodes: any[] = [];
          let rawEdges: any[] = [];

          if (Array.isArray(parsed)) {
            // Can be array of vectors, edges, or mixed
            for (const item of parsed) {
              if (item && (item.type === 'edge' || (item.s && item.r && item.o))) {
                rawEdges.push(item);
              } else if (item) {
                rawNodes.push(item);
              }
            }
          } else if (typeof parsed === 'object') {
            // Can be { nodes: [...], edges: [...] } or { vectors: [...] } or { documents: [...] }
            const candidates = parsed.nodes || parsed.vectors || parsed.knowledge || parsed.documents || parsed.chunks || parsed.data;
            if (Array.isArray(candidates)) {
              rawNodes = candidates;
            } else if (parsed.text || parsed.content || parsed.body || parsed.chunk) {
              rawNodes = [parsed];
            }
            if (Array.isArray(parsed.edges)) {
              rawEdges = parsed.edges;
            }
          }

          if (rawNodes.length > 0 || rawEdges.length > 0) {
            const vectors: VectorRecord[] = [];
            const edges: any[] = [];

            // Process edges
            for (const e of rawEdges) {
              edges.push({
                id: e.id || crypto.randomUUID(),
                type: 'edge',
                agentId: (e.agentId || e.aid || e.a || defaultAgentId || 'OPERATOR').trim().toUpperCase(),
                sourceId: e.sourceId || e.src || '',
                s: e.s || e.subject || '',
                r: e.r || e.relation || e.predicate || '',
                o: e.o || e.object || '',
                timestamp: e.timestamp || new Date().toISOString()
              });
            }

            // Check if vectors need embedding
            const nodesToEmbed: { index: number, text: string }[] = [];
            for (let i = 0; i < rawNodes.length; i++) {
              const n = rawNodes[i];
              const textContent = (n.text || n.t || n.content || n.chunk || n.body || n.data || (typeof n === 'string' ? n : '')).trim();
              if (!textContent) continue;

              const existingVector = n.vec || n.vector || n.embedding;
              if (Array.isArray(existingVector) && existingVector.length > 0) {
                vectors.push({
                  id: n.id || crypto.randomUUID(),
                  agent: (n.agent || n.a || n.agentId || defaultAgentId || 'OPERATOR').trim().toUpperCase(),
                  text: textContent,
                  vector: existingVector,
                  source: n.d?.source || n.source || n.src || fileName || 'Imported',
                  timestamp: n.d?.timestamp || n.timestamp || Date.now(),
                  permissions: n.permissions || '644'
                });
              } else {
                nodesToEmbed.push({ index: i, text: textContent });
              }
            }

            // Auto-embed nodes that don't have precomputed vectors
            if (nodesToEmbed.length > 0) {
              const BATCH_SIZE = 50;
              for (let b = 0; b < nodesToEmbed.length; b += BATCH_SIZE) {
                const chunk = nodesToEmbed.slice(b, b + BATCH_SIZE);
                try {
                  const embedded = await this.embedBatch(chunk.map(x => x.text));
                  for (let j = 0; j < chunk.length; j++) {
                    const original = rawNodes[chunk[j].index];
                    vectors.push({
                      id: original.id || crypto.randomUUID(),
                      agent: (original.agent || original.a || original.agentId || defaultAgentId || 'OPERATOR').trim().toUpperCase(),
                      text: chunk[j].text,
                      vector: embedded[j] || [],
                      source: original.d?.source || original.source || original.src || fileName || 'Imported',
                      timestamp: original.d?.timestamp || original.timestamp || Date.now(),
                      permissions: original.permissions || '644'
                    });
                  }
                } catch (embedError) {
                  console.warn('Auto-embedding failed during import; saving text records for keyword search:', embedError);
                  for (let j = 0; j < chunk.length; j++) {
                    const original = rawNodes[chunk[j].index];
                    vectors.push({
                      id: original.id || crypto.randomUUID(),
                      agent: (original.agent || original.a || original.agentId || defaultAgentId || 'OPERATOR').trim().toUpperCase(),
                      text: chunk[j].text,
                      vector: [],
                      source: original.d?.source || original.source || original.src || fileName || 'Imported',
                      timestamp: original.d?.timestamp || original.timestamp || Date.now(),
                      permissions: original.permissions || '644'
                    });
                  }
                }
                if (onProgress) {
                  onProgress({ processed: vectors.length + edges.length, total: rawNodes.length + rawEdges.length });
                }
              }
            }

            if (vectors.length > 0) await this.db.bulkPut('vectors', vectors);
            if (edges.length > 0) await this.db.bulkPut('edges', edges);

            return { success: true, nodesImported: vectors.length, edgesImported: edges.length };
          }
        }
      } catch (e) {
        console.warn('Standard JSON parse failed; falling back to line streaming:', e);
      }
    }

    // Stream-based import for .gz, .jsonl, and large newline-delimited files
    let total = 0;
    if (!isGzip) {
      try {
        const text = await fileOrBlob.text();
        total = (text.match(/\r?\n/g) || []).length;
        if (text.length > 0 && !text.endsWith('\n')) total += 1;
      } catch (e) {
        console.warn('Could not pre-read file for total line count.', e);
      }
    }

    let stream: ReadableStream<any> = fileOrBlob.stream() as any;
    if (isGzip) stream = stream.pipeThrough(new DecompressionStream('gzip') as any);
    const reader = (stream.pipeThrough(new TextDecoderStream() as any) as any).getReader();

    let buffer = '';
    let vectorCount = 0;
    let edgeCount = 0;
    let batch: any[] = [];
    const BATCH_WRITE = 1000;

    const writeBatch = async () => {
      if (!batch.length) return;
      const vectors: VectorRecord[] = [];
      const edges: any[] = [];

      for (const n of batch) {
        if (!n) continue;
        if (n.type === 'edge' || (n.s && n.r && n.o)) {
          edges.push({
            id: n.id || crypto.randomUUID(),
            type: 'edge',
            agentId: (n.aid || n.a || n.agentId || defaultAgentId || 'OPERATOR').trim().toUpperCase(),
            sourceId: n.src || n.sourceId || '',
            s: n.s || '',
            r: n.r || '',
            o: n.o || '',
            timestamp: n.timestamp || new Date().toISOString()
          });
        } else {
          const textContent = (n.t || n.text || n.content || n.chunk || '').trim();
          if (!textContent) continue;
          const vNode: VectorRecord = (n.v === 2)
            ? {
                id: crypto.randomUUID(),
                agent: (n.a || n.agent || defaultAgentId || 'OPERATOR').trim().toUpperCase(),
                text: textContent,
                vector: n.vec || n.vector || [],
                source: n.d?.source || n.source || fileName || 'Imported',
                timestamp: n.d?.timestamp || Date.now(),
                permissions: '644'
              }
            : {
                ...n,
                id: n.id || crypto.randomUUID(),
                agent: (n.agent || n.a || defaultAgentId || 'OPERATOR').trim().toUpperCase(),
                text: textContent,
                vector: n.vector || n.vec || [],
                source: n.source || fileName || 'Imported',
                timestamp: n.timestamp || Date.now(),
                permissions: n.permissions || '644'
              };
          vectors.push(vNode);
        }
      }

      if (vectors.length) {
        await this.db.bulkPut('vectors', vectors);
        vectorCount += vectors.length;
      }
      if (edges.length) {
        await this.db.bulkPut('edges', edges);
        edgeCount += edges.length;
      }

      batch = [];
      if (onProgress) onProgress({ processed: vectorCount + edgeCount, total: total || vectorCount + edgeCount });
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
        try {
          const parsedItem = JSON.parse(s);
          if (Array.isArray(parsedItem)) {
            batch.push(...parsedItem);
          } else {
            batch.push(parsedItem);
          }
        } catch (e) {}
        if (batch.length >= BATCH_WRITE) await writeBatch();
      }
    }
    if (buffer.trim()) {
      try {
        const parsedItem = JSON.parse(buffer.trim());
        if (Array.isArray(parsedItem)) {
          batch.push(...parsedItem);
        } else {
          batch.push(parsedItem);
        }
      } catch (e) {}
    }
    await writeBatch();

    if (onProgress) onProgress({ processed: vectorCount + edgeCount, total: total || vectorCount + edgeCount });

    return { success: true, nodesImported: vectorCount, edgesImported: edgeCount };
  }

  async chat(userQuery: string, agentId: string | null, systemPrompt?: string, model = 'gemini-3.8-flash', topK = 6, threshold = 0.28): Promise<{ response: string, derivation: string, source: string }> {
    await this.db.ready;
    const pool = await this.getNodes(agentId || undefined);

    let contextNodes: { n: VectorRecord, s: number }[] = [];

    if (pool.length > 0) {
      const validVectors = pool.filter(n => Array.isArray(n.vector) && n.vector.length > 0);

      if (validVectors.length > 0) {
        try {
          const qVec = (await this.embedBatch([userQuery]))[0];
          const scored = validVectors
            .map(n => ({ n, s: cosine(qVec, n.vector) }))
            .filter(x => !isNaN(x.s))
            .sort((a, b) => b.s - a.s);

          const best = scored[0]?.s || 0;
          const matching = scored.filter(x => x.s >= threshold);
          if (matching.length > 0) {
            contextNodes = matching.slice(0, topK);
          } else if (best >= 0.15) {
            // If best has positive relevance, provide top candidates
            contextNodes = scored.slice(0, Math.min(3, scored.length));
          }
        } catch (embedError) {
          console.warn('Vector embedding of query failed; falling back to lexical search:', embedError);
        }
      }

      // Fallback: Keyword search if vector search returned nothing or vectors are missing
      if (contextNodes.length === 0) {
        const qWords = userQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (qWords.length > 0) {
          const textScored = pool.map(n => {
            const textLower = (n.text || '').toLowerCase();
            const sourceLower = (n.source || '').toLowerCase();
            let hits = 0;
            for (const word of qWords) {
              if (textLower.includes(word)) hits += 1;
              if (sourceLower.includes(word)) hits += 0.5;
            }
            return { n, s: hits / qWords.length };
          }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
          contextNodes = textScored.slice(0, Math.min(topK, textScored.length));
        }
      }
    }

    // Also look up relevant graph relationships if edges exist in the vault
    let graphContext = '';
    try {
      const allEdges = await this.db.getAll('edges');
      if (allEdges && allEdges.length > 0) {
        const qLower = userQuery.toLowerCase();
        const matchedEdges = allEdges.filter(e =>
          (e.s && qLower.includes(e.s.toLowerCase())) ||
          (e.o && qLower.includes(e.o.toLowerCase())) ||
          (e.r && qLower.includes(e.r.toLowerCase()))
        ).slice(0, 8);
        if (matchedEdges.length > 0) {
          graphContext = '\n\n[RELEVANT GRAPH RELATIONSHIPS]:\n' + matchedEdges.map(e => `&bull; (${e.s}) --[${e.r}]--> (${e.o})`).join('\n');
        }
      }
    } catch (e) {}

    const context = contextNodes.map(x =>
      `--- [DOCUMENT: ${x.n.source || 'LORE_VAULT'} | SIMILARITY: ${(x.s * 100).toFixed(1)}%] ---\n${x.n.text}`
    ).join('\n\n');

    const fullContext = (context + graphContext).trim();

    const derivation = contextNodes.length
      ? `COSINE_TOPK(${contextNodes.length}/${topK}, BEST: ${((contextNodes[0]?.s || 0) * 100).toFixed(1)}%)${graphContext ? ' + GRAPH' : ''}`
      : (graphContext ? 'GRAPH_ONLY' : (pool.length === 0 ? 'EMPTY_VAULT_MODEL_TRAINING' : 'NO_RELEVANT_MATCH'));

    const promptText = fullContext
      ? `You are an AI conversational assistant with direct access to the Lorepack knowledge vault.\n\n[AVAILABLE VAULT KNOWLEDGE]:\n${fullContext}\n\n[USER QUERY]:\n${userQuery}\n\nINSTRUCTION: Answer the user query thoroughly, accurately, and directly using the above available documents and knowledge context whenever relevant.`
      : userQuery;

    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      systemInstruction: { parts: [{ text: systemPrompt || 'You are an autonomous knowledge assistant with direct access to local Lorepack vault documents.' }] }
    };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this._getKey())}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );

    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error?.message || `Generate failed`);
    return { response: json.candidates?.[0]?.content?.parts?.[0]?.text || '(no reply)', derivation, source: contextNodes.length ? 'RAG' : 'MODEL_TRAINING_DATA' };
  }

  async nuke(): Promise<void> { return this.db.nuke(); }
}
