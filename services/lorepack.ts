
import { GraphEdge, GraphNode, VectorRecord } from '../types';

// LOREPACK™ v3.7.0 :: SOVEREIGN KERNEL (TypeScript Port)
// - GraphMAGRAG Lite Enabled (Vectors + Edges)
// - Fixes IDB Version to 10
// - Full Import/Export/Chat fidelity
// © 2026 MYTHOS. All Rights Reserved.

const DB_NAME = 'mythos_vault';
const DB_VERSION = 10;

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
    if (!this.apiKeys.length) throw new Error('API Keys Missing.');
    const k = this.apiKeys[this.keyIndex];
    this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
    return k;
  }

  genSigil(t?: string): string {
    return (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
  }

  chunk(text?: string, maxChars: number = 2000): string[] {
    const raw = (text || '')
      .replace(/\r/g, '')
      .replace(/([.?!])\s+(?=[A-Z0-9@])/g, '$1|')
      .split('|')
      .map(s => s.trim())
      .filter(Boolean);

    const out: string[] = [];
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
    await this.db.ready;
    const totalNodes = await this.db.count('vectors');
    const totalEdges = await this.db.count('edges');
    return { totalNodes, totalEdges };
  }

  async getNodes(agentId?: string): Promise<VectorRecord[]> {
    await this.db.ready;
    const all = await this.db.getAll('vectors') as VectorRecord[];
    if (!agentId || agentId === 'OPERATOR') return all;
    const aid = agentId.toUpperCase();
    return all.filter(n => (n.agent || '').toUpperCase() === aid);
  }

  // FIX: Changed method from private to public to allow access from LorepackHarness.
  public async embedBatch(texts: string[], keyOverride: string | null = null): Promise<number[][]> {
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
          const res = await this.chat(prompt, agentId, "SYSTEM: You are a Relationship Extractor. Output strictly JSON.", 'gemini-2.5-flash');
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

  async import(fileOrBlob: File, onProgress?: (p: { processed: number, total: number }) => void): Promise<{ success: boolean, nodesImported: number }> {
    await this.db.ready;
    const fileName = fileOrBlob?.name || '';
    
    let total = 0;
    if (!fileName.endsWith('.gz')) {
        try {
            const text = await fileOrBlob.text();
            total = (text.match(/\r?\n/g) || []).length;
            if (text.length > 0 && !text.endsWith('\n')) total += 1;
        } catch (e) {
            console.warn("Could not pre-read file for total line count.", e);
        }
    }

    let stream: ReadableStream<Uint8Array> = fileOrBlob.stream();
    if (fileName.endsWith('.gz')) stream = stream.pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();

    let buffer = '';
    let count = 0;
    let batch: any[] = [];
    const BATCH_WRITE = 1000;

    const writeBatch = async () => {
      if (!batch.length) return;
      const vectors: VectorRecord[] = [];
      const edges: any[] = [];

      for (const n of batch) {
        if (n.type === 'edge') {
           edges.push({ id: n.id || crypto.randomUUID(), type: 'edge', agentId: n.aid || n.a, sourceId: n.src, s: n.s, r: n.r, o: n.o, timestamp: new Date().toISOString() });
        } else {
           const vNode: VectorRecord = (n.v === 2) 
             ? { id: crypto.randomUUID(), agent: n.a, text: n.t, vector: n.vec, source: n.d?.source || 'Imported', timestamp: n.d?.timestamp || Date.now() }
             : { ...n, id: n.id || crypto.randomUUID() };
           vectors.push(vNode);
        }
      }

      if (vectors.length) await this.db.bulkPut('vectors', vectors);
      if (edges.length) await this.db.bulkPut('edges', edges);
      
      count += batch.length;
      batch = [];
      if (onProgress) onProgress({ processed: count, total });
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

    if (onProgress) onProgress({ processed: count, total });

    return { success: true, nodesImported: count };
  }

  async chat(userQuery: string, agentId: string | null, systemPrompt?: string, model = 'gemini-2.5-flash', topK = 6, threshold = 0.45): Promise<{ response: string, derivation: string, source: string }> {
    await this.db.ready;
    const pool = await this.getNodes(agentId || undefined);
    if (!pool.length) return { response: 'Vault empty.', derivation: 'EMPTY_VAULT', source: 'NULL' };

    const qVec = (await this.embedBatch([userQuery]))[0];
    const scored = pool.map(n => ({ n, s: cosine(qVec, n.vector) })).sort((a, b) => b.s - a.s).slice(0, topK);
    const best = scored[0]?.s || 0;
    const contextNodes = best >= threshold ? scored : [];
    
    const context = contextNodes.map(x => `--- [SOURCE: ${x.n.source || 'UNKNOWN'} | ${(x.s * 100).toFixed(1)}%] ---\n${x.n.text}`).join('\n\n');
    const derivation = contextNodes.length ? `COSINE_TOPK(${topK})` : `NO_CONTEXT`;

    const payload = {
      contents: [{ parts: [{ text: `CONTEXT:\n${context}\n\nUSER:\n${userQuery}` }] }],
      systemInstruction: { parts: [{ text: systemPrompt || '' }] }
    };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this._getKey())}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );

    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error?.message || `Generate failed`);
    return { response: json.candidates?.[0]?.content?.parts?.[0]?.text || '(no reply)', derivation, source: 'RAG' };
  }

  async nuke(): Promise<void> { return this.db.nuke(); }
}
