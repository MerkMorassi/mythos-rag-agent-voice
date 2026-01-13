import { 
    VectorRecord,
    ChatSession, 
    LogMessage, 
    AgentConfig, 
    MediaAsset, 
    LorePack, 
    CanonBlock,
    WorkingMemory,
    SovereignConfig,
    DEFAULT_MODEL_CONFIG,
    DEFAULT_SOVEREIGN_CONFIG,
    GraphNode,
    GraphEdge
} from '../types';
import { UsageLogEntry } from './llmUsageLogger';

export interface SavedPrompt {
    id: string;
    agentId: string;
    name: string;
    content: string;
}

const DB_NAME = 'MythOS_DB';
const DB_VERSION = 8; // Incremented version to migrate to vectors store

// Stores
export const VECTORS_STORE = 'vectors';
export const CHAT_SESSION_STORE = 'chat_sessions';
export const ACTIVE_CHAT_STORE = 'active_chats';
export const AGENT_CONFIG_STORE = 'agent_configs';
export const SETTINGS_STORE = 'settings';
export const MEDIA_STORE = 'media_assets';
export const LORE_PACK_STORE = 'lore_packs';
export const PROMPT_STORE = 'saved_prompts';
export const CANON_STORE = 'canon_blocks';
export const HOLODECK_STORE = 'holodck';
export const LLM_USAGE_LOG_STORE = 'llm_usage_logs';
export const GRAPH_NODE_STORE = 'graph_nodes';
export const GRAPH_EDGE_STORE = 'graph_edges';

let dbInstance: IDBDatabase | null = null;

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
            
            const createStore = (name: string, keyPath: string | { autoIncrement: boolean } = 'id', indices: {name: string, unique: boolean}[]) => {
                if (!db.objectStoreNames.contains(name)) {
                    const store = db.createObjectStore(name, typeof keyPath === 'string' ? { keyPath } : keyPath);
                    indices.forEach(idx => store.createIndex(idx.name, idx.name, { unique: idx.unique }));
                }
            };
            
            // Migration: remove old 'documents' store if it exists
            if (db.objectStoreNames.contains('documents')) {
                db.deleteObjectStore('documents');
            }

            createStore(VECTORS_STORE, 'id', [{name: 'agent', unique: false}]);
            createStore(CHAT_SESSION_STORE, 'id', []);
            createStore(ACTIVE_CHAT_STORE, 'id', []);
            createStore(AGENT_CONFIG_STORE, 'agentId', []);
            createStore(SETTINGS_STORE, 'id', []);
            createStore(MEDIA_STORE, 'id', [{name: 'agentId', unique: false}]);
            createStore(LORE_PACK_STORE, 'id', []); 
            createStore(PROMPT_STORE, 'id', [{name: 'agentId', unique: false}]);
            createStore(CANON_STORE, 'id', []);
            createStore(HOLODECK_STORE, 'id', []);
            createStore(LLM_USAGE_LOG_STORE, { autoIncrement: true }, []);
            createStore(GRAPH_NODE_STORE, 'id', [{name: 'agentId', unique: false}]);
            createStore(GRAPH_EDGE_STORE, { autoIncrement: true }, []);
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

const clearStore = async (storeName: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const req = tx.objectStore(storeName).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

// --- VECTORS (KNOWLEDGE BASE) ---

export const putVector = (vec: VectorRecord) => putItem(VECTORS_STORE, vec);
export const deleteVector = (id: string) => deleteItem(VECTORS_STORE, id);
export const getVectorsByAgent = (agentHandle: string) => getByIndex<VectorRecord>(VECTORS_STORE, 'agent', agentHandle);
export const getAllVectors = () => getAll<VectorRecord>(VECTORS_STORE);

export const bulkPutVectors = async (vectors: VectorRecord[]) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction([VECTORS_STORE], 'readwrite');
        const store = tx.objectStore(VECTORS_STORE);
        vectors.forEach(vec => store.put(vec));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const deleteVectorsByAgent = async (agentHandle: string) => {
    const vectors = await getVectorsByAgent(agentHandle);
    const db = await initDB();
    const tx = db.transaction([VECTORS_STORE], 'readwrite');
    const store = tx.objectStore(VECTORS_STORE);
    vectors.forEach(v => store.delete(v.id));
    return new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
    });
};

export const bulkDeleteVectors = async (ids: string[]) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction([VECTORS_STORE], 'readwrite');
        const store = tx.objectStore(VECTORS_STORE);
        ids.forEach(id => store.delete(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const getVectorCountByAgent = async (agentHandle: string): Promise<number> => {
    const vectors = await getVectorsByAgent(agentHandle);
    return vectors.length;
};

export const clearVectorsStore = async (): Promise<void> => clearStore(VECTORS_STORE);

// This is required for ensureVectorIndex call in App.tsx
export const ensureVectorIndex = async () => { /* No-op for IndexedDB */ };

// FIX: Added function to update permissions on a vector record for the 'chmod' command.
export const updateDocumentPermissions = async (id: string, permissions: string): Promise<void> => {
    const db = await initDB();
    const tx = db.transaction([VECTORS_STORE], 'readwrite');
    const store = tx.objectStore(VECTORS_STORE);
    const item = await new Promise<VectorRecord>((res, rej) => {
        const req = store.get(id);
        req.onsuccess = (e: any) => res(e.target.result);
        req.onerror = () => rej(req.error);
    });
    if (item) {
        store.put({ ...item, permissions });
    }
};

// --- GRAPH (DEPRECATED - VISUALIZER ONLY) ---
export const getGraphNodesByAgent = (agentId: string) => getByIndex<GraphNode>(GRAPH_NODE_STORE, 'agentId', agentId);
export const getGraphEdges = () => getAll<GraphEdge>(GRAPH_EDGE_STORE);

export const bulkPutGraphNodes = async (nodes: GraphNode[]) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction([GRAPH_NODE_STORE], 'readwrite');
        const store = tx.objectStore(GRAPH_NODE_STORE);
        nodes.forEach(node => store.put(node));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const bulkPutGraphEdges = async (edges: GraphEdge[]) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction([GRAPH_EDGE_STORE], 'readwrite');
        const store = tx.objectStore(GRAPH_EDGE_STORE);
        edges.forEach(edge => store.put(edge));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const deleteGraphByAgent = async (agentId: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([GRAPH_NODE_STORE, GRAPH_EDGE_STORE], 'readwrite');
        const nodeStore = tx.objectStore(GRAPH_NODE_STORE);
        const edgeStore = tx.objectStore(GRAPH_EDGE_STORE);
        const nodeIndex = nodeStore.index('agentId');
        const nodeReq = nodeIndex.getAllKeys(agentId);

        nodeReq.onsuccess = () => {
            (nodeReq.result as IDBValidKey[]).forEach(key => nodeStore.delete(key));
        };
        nodeReq.onerror = () => reject(nodeReq.error);

        edgeStore.openCursor().onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (!cursor) return;
            if (cursor.value.agentId === agentId) {
                cursor.delete();
            }
            cursor.continue();
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const clearGraphStores = async (): Promise<void> => {
    await clearStore(GRAPH_NODE_STORE);
    await clearStore(GRAPH_EDGE_STORE);
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

export const saveSovereignConfig = (config: SovereignConfig) => putItem(SETTINGS_STORE, { id: 'SOVEREIGN_CONFIG', value: config });
export const getSovereignConfig = async (): Promise<SovereignConfig> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([SETTINGS_STORE], 'readonly');
        const req = tx.objectStore(SETTINGS_STORE).get('SOVEREIGN_CONFIG');
        req.onsuccess = () => resolve(req.result?.value || DEFAULT_SOVEREIGN_CONFIG);
        req.onerror = () => resolve(DEFAULT_SOVEREIGN_CONFIG);
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

export const savePrompt = (prompt: SavedPrompt) => putItem(PROMPT_STORE, prompt);
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

// --- LLM USAGE LOGS ---
export const addLlmLog = (log: UsageLogEntry) => putItem(LLM_USAGE_LOG_STORE, log);
export const getAllLlmLogs = () => getAll<UsageLogEntry>(LLM_USAGE_LOG_STORE);

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
            if (table === 'vectors') data = await getAllVectors();
            else if (table === 'agents') data = await getAll(AGENT_CONFIG_STORE);
            else return `Error: Table '${table}' not found`;
            
            return JSON.stringify(data.slice(0, 50), null, 2); 
        } 
        else if (q.startsWith('delete from')) {
             return "Error: DELETE requires specific implementation safety in shell";
        }
        return "Error: Command not supported";
    } catch(e: any) {
        return `SQL Error: ${e.message}`;
    }
};
