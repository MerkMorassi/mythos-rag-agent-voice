
import { 
    KnowledgeDoc, 
    GraphNode, 
    GraphEdge, 
    ChatSession, 
    LogMessage, 
    AgentConfig, 
    MediaAsset, 
    LorePack, 
    CanonBlock,
    WorkingMemory,
    DEFAULT_MODEL_CONFIG 
} from '../types';

export interface SavedPrompt {
    id: string;
    agentId: string;
    name: string;
    content: string;
}

const DB_NAME = 'MythOS_DB';
const DB_VERSION = 5;

// Stores
export const DOC_STORE = 'documents';
export const GRAPH_NODE_STORE = 'graph_nodes';
export const GRAPH_EDGE_STORE = 'graph_edges';
export const CHAT_SESSION_STORE = 'chat_sessions';
export const ACTIVE_CHAT_STORE = 'active_chats';
export const AGENT_CONFIG_STORE = 'agent_configs';
export const SETTINGS_STORE = 'settings';
export const MEDIA_STORE = 'media_assets';
export const LORE_PACK_STORE = 'lore_packs';
export const PROMPT_STORE = 'saved_prompts';
export const CANON_STORE = 'canon_blocks';
export const HOLODECK_STORE = 'holodeck';

let dbInstance: IDBDatabase | null = null;

// --- MEMORY OPTIMIZATION: LRU VECTOR CACHE ---
class VectorLRUCache {
    private cache: Map<string, number[]>;
    private limit: number;

    constructor(limit: number) {
        this.cache = new Map();
        this.limit = limit;
    }

    get(id: string): number[] | undefined {
        if (!this.cache.has(id)) return undefined;
        // Refresh item (move to end)
        const val = this.cache.get(id)!;
        this.cache.delete(id);
        this.cache.set(id, val);
        return val;
    }

    put(id: string, vector: number[]) {
        if (this.cache.has(id)) {
            this.cache.delete(id);
        } else if (this.cache.size >= this.limit) {
            // Evict oldest (first)
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(id, vector);
    }
}

// Keep ~5000 vectors in memory (approx 15-20MB for 768-dim float arrays)
const vectorCache = new VectorLRUCache(5000);

export const initDB = (): Promise<IDBDatabase> => {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error("IndexedDB error:", event);
            reject("Database error");
        };

        request.onsuccess = (event) => {
            dbInstance = (event.target as IDBOpenDBRequest).result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            
            const createStore = (name: string, keyPath: string = 'id', indices: string[] = []) => {
                if (!db.objectStoreNames.contains(name)) {
                    const store = db.createObjectStore(name, { keyPath });
                    indices.forEach(idx => store.createIndex(idx, idx, { unique: false }));
                }
            };

            createStore(DOC_STORE, 'id', ['agentId']);
            createStore(GRAPH_NODE_STORE, 'id', ['agentId']);
            createStore(GRAPH_EDGE_STORE, 'id', ['source', 'target']);
            createStore(CHAT_SESSION_STORE, 'id');
            createStore(ACTIVE_CHAT_STORE, 'id');
            createStore(AGENT_CONFIG_STORE, 'agentId');
            createStore(SETTINGS_STORE, 'id');
            createStore(MEDIA_STORE, 'id', ['agentId']);
            createStore(LORE_PACK_STORE, 'id'); 
            createStore(PROMPT_STORE, 'id', ['agentId']);
            createStore(CANON_STORE, 'id');
            createStore(HOLODECK_STORE, 'id');
        };
    });
};

// --- HELPER GENERIC FUNCTIONS ---
const getAll = async <T>(storeName: string): Promise<T[]> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([storeName], 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => resolve([]);
    });
};

const getByIndex = async <T>(storeName: string, indexName: string, value: string): Promise<T[]> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([storeName], 'readonly');
        const idx = tx.objectStore(storeName).index(indexName);
        const req = idx.getAll(value);
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => resolve([]);
    });
};

const putItem = async <T>(storeName: string, item: T): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const req = tx.objectStore(storeName).put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

const deleteItem = async (storeName: string, id: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const req = tx.objectStore(storeName).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

// --- DOCUMENTS (KNOWLEDGE BASE) ---

export const addDocument = (doc: KnowledgeDoc) => putItem(DOC_STORE, doc);
export const deleteDocument = (id: string) => deleteItem(DOC_STORE, id);
export const getDocumentsByAgentId = (agentId: string) => getByIndex<KnowledgeDoc>(DOC_STORE, 'agentId', agentId);
export const getAllDocuments = () => getAll<KnowledgeDoc>(DOC_STORE);

export const bulkAddDocuments = async (docs: KnowledgeDoc[]) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction([DOC_STORE], 'readwrite');
        const store = tx.objectStore(DOC_STORE);
        docs.forEach(doc => store.put(doc));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const deleteDocumentsByAgentId = async (agentId: string) => {
    const docs = await getDocumentsByAgentId(agentId);
    const db = await initDB();
    const tx = db.transaction([DOC_STORE], 'readwrite');
    const store = tx.objectStore(DOC_STORE);
    docs.forEach(d => store.delete(d.id));
    return new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
    });
};

export const getDocumentCountByAgentId = async (agentId: string): Promise<number> => {
    const docs = await getDocumentsByAgentId(agentId);
    return docs.length;
};

export const updateDocumentPermissions = async (id: string, permissions: string) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction([DOC_STORE], 'readwrite');
        const store = tx.objectStore(DOC_STORE);
        const req = store.get(id);
        req.onsuccess = () => {
            const doc = req.result as KnowledgeDoc;
            if (doc) {
                doc.permissions = permissions;
                store.put(doc);
                resolve();
            } else {
                reject("Document not found");
            }
        };
        req.onerror = () => reject(req.error);
    });
};


// --- VECTOR SEARCH ---

function cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const ensureVectorIndex = async () => { /* No-op for IndexedDB */ };

/**
 * Streaming Search with LRU Cache to prevent OOM
 */
export const searchDocuments = async (query: string, embedding?: number[], agentId?: string): Promise<KnowledgeDoc[]> => {
    const db = await initDB();
    const transaction = db.transaction([DOC_STORE], 'readonly');
    const store = transaction.objectStore(DOC_STORE);
    
    // We maintain a limited buffer of top candidates to avoid array bloat
    let candidates: { doc: KnowledgeDoc, score: number }[] = [];
    const MAX_BUFFER_SIZE = 200; // Trim when we exceed this
    const TARGET_SIZE = 100;

    return new Promise((resolve, reject) => {
        const request = agentId 
            ? store.index('agentId').openCursor(IDBKeyRange.only(agentId)) 
            : store.openCursor();

        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
            
            if (cursor) {
                const doc = cursor.value as KnowledgeDoc;
                
                // 1. Text Match Score (Keyword Boost)
                let score = 0;
                if (doc.content.toLowerCase().includes(query.toLowerCase())) {
                    score += 0.15;
                }
                
                // 2. Vector Match Score (Cosine Similarity)
                if (embedding) {
                    // Check LRU Cache first
                    let vec = vectorCache.get(doc.id);
                    
                    if (!vec && doc.embedding) {
                        vec = doc.embedding;
                        // Cache for next time
                        vectorCache.put(doc.id, vec);
                    }
                    
                    if (vec) {
                        const sim = cosineSimilarity(embedding, vec);
                        score += sim;
                    }
                }
                
                // 3. Selection Threshold
                if (score > 0.01) { 
                    candidates.push({ doc, score });
                    
                    // Memory Safety: Periodic Truncation
                    if (candidates.length > MAX_BUFFER_SIZE) {
                        candidates.sort((a, b) => b.score - a.score);
                        candidates = candidates.slice(0, TARGET_SIZE);
                    }
                }

                cursor.continue(); // Stream next
            } else {
                // DONE
                candidates.sort((a, b) => b.score - a.score);
                resolve(candidates.slice(0, 10).map(r => r.doc));
            }
        };
        
        request.onerror = () => reject(request.error);
    });
};

// --- GRAPH DB ---

export const saveGraphNode = (node: GraphNode) => putItem(GRAPH_NODE_STORE, node);
export const getAllGraphNodes = () => getAll<GraphNode>(GRAPH_NODE_STORE);
export const getGraphNodesByAgent = (agentId: string) => getByIndex<GraphNode>(GRAPH_NODE_STORE, 'agentId', agentId);

export const saveGraphEdge = (edge: GraphEdge) => putItem(GRAPH_EDGE_STORE, edge);
export const getGraphEdges = () => getAll<GraphEdge>(GRAPH_EDGE_STORE);

export const getGraphContext = async (query: string, embedding?: number[], agentId?: string): Promise<string> => {
    // 1. Find nodes that match the query
    const nodes = await getAllGraphNodes();
    const relevantNodes = nodes.filter(n => 
        (agentId ? n.agentId === agentId : true) && 
        (n.name.toLowerCase().includes(query.toLowerCase()) || n.label.toLowerCase().includes(query.toLowerCase()))
    );
    
    if (relevantNodes.length === 0) return "";
    
    // 2. Find connected edges
    const edges = await getGraphEdges();
    const nodeIds = new Set(relevantNodes.map(n => n.id));
    
    const relevantEdges = edges.filter(e => nodeIds.has(e.source) || nodeIds.has(e.target));
    
    // 3. Format context
    let context = "ENTITIES:\n";
    relevantNodes.slice(0, 10).forEach(n => context += `- ${n.name} (${n.label}): ${n.description}\n`);
    context += "\nRELATIONSHIPS:\n";
    relevantEdges.slice(0, 15).forEach(e => {
        const s = nodes.find(n => n.id === e.source)?.name || e.source;
        const t = nodes.find(n => n.id === e.target)?.name || e.target;
        context += `- ${s} [${e.relation}] ${t}\n`;
    });
    
    return context;
};

// --- CHAT HISTORY ---

export const saveChatSession = (session: ChatSession) => putItem(CHAT_SESSION_STORE, session);
export const getAllChatSessions = () => getAll<ChatSession>(CHAT_SESSION_STORE);
export const deleteChatSession = (id: string) => deleteItem(CHAT_SESSION_STORE, id);

export const saveActiveChat = (id: string, logs: LogMessage[]) => putItem(ACTIVE_CHAT_STORE, { id, logs });
export const loadActiveChat = async (id: string): Promise<LogMessage[]> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([ACTIVE_CHAT_STORE], 'readonly');
        const req = tx.objectStore(ACTIVE_CHAT_STORE).get(id);
        req.onsuccess = () => resolve(req.result?.logs || []);
        req.onerror = () => resolve([]);
    });
};

// --- AGENT CONFIG ---

export const saveAgentConfig = (agentId: string, config: Partial<AgentConfig>) => {
    return putItem(AGENT_CONFIG_STORE, { agentId, ...config });
};

export const getAgentConfig = async (agentId: string): Promise<Partial<AgentConfig>> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([AGENT_CONFIG_STORE], 'readonly');
        const req = tx.objectStore(AGENT_CONFIG_STORE).get(agentId);
        req.onsuccess = () => resolve(req.result || { modelConfig: DEFAULT_MODEL_CONFIG });
        req.onerror = () => resolve({ modelConfig: DEFAULT_MODEL_CONFIG });
    });
};

export const saveGeneralInstructions = (instruction: string) => putItem(SETTINGS_STORE, { id: 'GENERAL_INSTRUCTION', value: instruction });
export const getGeneralInstructions = async (): Promise<string> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([SETTINGS_STORE], 'readonly');
        const req = tx.objectStore(SETTINGS_STORE).get('GENERAL_INSTRUCTION');
        req.onsuccess = () => resolve(req.result?.value || "");
        req.onerror = () => resolve("");
    });
};

// --- MEDIA ASSETS ---

export const saveMediaAsset = (asset: MediaAsset) => putItem(MEDIA_STORE, asset);
export const getAllMediaAssets = () => getAll<MediaAsset>(MEDIA_STORE);
export const deleteMediaAsset = (id: string) => deleteItem(MEDIA_STORE, id);
export const updateMediaAsset = async (id: string, updates: Partial<MediaAsset>) => {
    const db = await initDB();
    const tx = db.transaction([MEDIA_STORE], 'readwrite');
    const store = tx.objectStore(MEDIA_STORE);
    const item = await new Promise<MediaAsset>((res) => {
        store.get(id).onsuccess = (e: any) => res(e.target.result);
    });
    if (item) {
        store.put({ ...item, ...updates });
    }
};

export const searchMediaAssets = async (query: string): Promise<MediaAsset[]> => {
    const all = await getAllMediaAssets();
    const q = query.toLowerCase();
    return all.filter(a => 
        a.prompt.toLowerCase().includes(q) || 
        a.tags?.some(t => t.toLowerCase().includes(q)) ||
        a.type.toLowerCase().includes(q)
    ).slice(0, 10);
};

export const getMediaAsset = async (id: string): Promise<MediaAsset | undefined> => {
    const all = await getAllMediaAssets();
    return all.find(a => a.id === id);
};

// --- LORE PACKS ---

export const saveLorePack = (pack: LorePack) => putItem(LORE_PACK_STORE, pack);
export const getLorePacksByAgentId = async (agentId: string): Promise<LorePack[]> => {
    const all = await getAll<LorePack>(LORE_PACK_STORE);
    return all.filter(p => p.header.agentId === agentId);
};
export const deleteLorePack = (id: string) => deleteItem(LORE_PACK_STORE, id);

// --- SAVED PROMPTS ---

export const getSavedPromptsByAgentId = (agentId: string) => getByIndex<SavedPrompt>(PROMPT_STORE, 'agentId', agentId);
export const deleteSavedPrompt = (id: string) => deleteItem(PROMPT_STORE, id);

// --- CANON BLOCKS (PRODUCTION) ---
export const saveCanonBlock = (block: CanonBlock) => putItem(CANON_STORE, block);
export const getCanonBlocks = () => getAll<CanonBlock>(CANON_STORE);
export const deleteCanonBlock = (id: string) => deleteItem(CANON_STORE, id);

// --- HOLODECK (CANVAS) ---

export const getCanvas = async (): Promise<WorkingMemory> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([HOLODECK_STORE], 'readonly');
        const req = tx.objectStore(HOLODECK_STORE).get('HOLODECK_MAIN');
        req.onsuccess = () => {
            if (req.result) resolve(req.result);
            else {
                // Return default
                resolve({
                    id: 'HOLODECK_MAIN',
                    title: 'Shared Workspace',
                    sections: [],
                    lastModified: Date.now()
                });
            }
        };
        req.onerror = () => resolve({ id: 'HOLODECK_MAIN', title: 'Error', sections: [], lastModified: Date.now() });
    });
};

export const updateCanvas = (canvas: WorkingMemory) => putItem(HOLODECK_STORE, canvas);

// --- SQL MOCK ---

export const executeSql = async (query: string): Promise<string> => {
    const q = query.trim().toLowerCase();
    
    try {
        if (q.startsWith('select')) {
            const parts = q.split(' ');
            const fromIndex = parts.indexOf('from');
            if (fromIndex === -1) return "Error: Invalid syntax";
            const table = parts[fromIndex + 1];
            
            let data: any[] = [];
            if (table === 'documents') data = await getAllDocuments();
            else if (table === 'agents') data = await getAll(AGENT_CONFIG_STORE);
            else if (table === 'lore') data = await getAllDocuments();
            else return `Error: Table '${table}' not found`;
            
            return JSON.stringify(data.slice(0, 50), null, 2); 
        } 
        else if (q.startsWith('delete from')) {
             const parts = q.split(' ');
             const table = parts[2];
             if (table === 'documents') {
                 return "Error: DELETE requires specific implementation safety in shell";
             }
             return `Error: Table '${table}' not found or locked`;
        }
        return "Error: Command not supported";
    } catch(e: any) {
        return `SQL Error: ${e.message}`;
    }
};
