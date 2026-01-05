
import { KnowledgeDoc, ChatSession, LogMessage, AgentConfig, ModelConfig, DEFAULT_MODEL_CONFIG, LorePack, MediaAsset, CanonBlock, GraphNode, GraphEdge, WorkingMemory } from '../types';

const DB_NAME = 'gemini_rag_db';
const STORE_NAME = 'documents';
const VECTOR_STORE_NAME = 'doc_vectors'; // NEW: Lightweight store for embeddings
const CHAT_STORE_NAME = 'chat_sessions';
const ACTIVE_CHAT_STORE_NAME = 'active_chats'; 
const CONFIG_STORE_NAME = 'config';
const PROMPT_STORE_NAME = 'saved_prompts';
const LORE_PACK_STORE = 'lore_packs';
const MEDIA_STORE = 'media_assets';
const CANON_STORE = 'production_blocks'; 
const GRAPH_NODE_STORE = 'graph_nodes';
const GRAPH_EDGE_STORE = 'graph_edges';
const COMMUNITY_STORE = 'community_summaries';
const WORKING_MEMORY_STORE = 'working_memory'; // HOLODECK

const DB_VERSION = 13; // Bumped for working_memory

// --- TYPES ---
interface DocVector {
    id: string;
    agentId: string;
    embedding: number[];
}

export interface SavedPrompt {
    id: string;
    agentId: string;
    name: string;
    content: string;
    timestamp: number;
}

// --- DB INIT ---
export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error("IndexedDB error:", event);
      reject("Error opening database");
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const tx = (event.target as IDBOpenDBRequest).transaction;
      
      // 1. Documents Store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('title', 'title', { unique: false });
        store.createIndex('agentId', 'agentId', { unique: false });
        store.createIndex('numMarkId', 'numMarkId', { unique: false });
      } else {
        const store = tx!.objectStore(STORE_NAME);
        if (!store.indexNames.contains('agentId')) store.createIndex('agentId', 'agentId', { unique: false });
        if (!store.indexNames.contains('numMarkId')) store.createIndex('numMarkId', 'numMarkId', { unique: false });
      }

      // 2. Vector Store (Optimization)
      if (!db.objectStoreNames.contains(VECTOR_STORE_NAME)) {
          const vStore = db.createObjectStore(VECTOR_STORE_NAME, { keyPath: 'id' });
          vStore.createIndex('agentId', 'agentId', { unique: false });
      }

      // 3. Standard Stores
      if (!db.objectStoreNames.contains(CHAT_STORE_NAME)) {
        const chatStore = db.createObjectStore(CHAT_STORE_NAME, { keyPath: 'id' });
        chatStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(ACTIVE_CHAT_STORE_NAME)) db.createObjectStore(ACTIVE_CHAT_STORE_NAME, { keyPath: 'agentId' });
      if (!db.objectStoreNames.contains(CONFIG_STORE_NAME)) db.createObjectStore(CONFIG_STORE_NAME, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PROMPT_STORE_NAME)) {
        const promptStore = db.createObjectStore(PROMPT_STORE_NAME, { keyPath: 'id' });
        promptStore.createIndex('agentId', 'agentId', { unique: false });
      }
      if (!db.objectStoreNames.contains(LORE_PACK_STORE)) {
          const lpStore = db.createObjectStore(LORE_PACK_STORE, { keyPath: 'id' });
          lpStore.createIndex('agentId', 'header.agentId', { unique: false });
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
          const mStore = db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
          mStore.createIndex('agentId', 'agentId', { unique: false });
          mStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(CANON_STORE)) {
          const cStore = db.createObjectStore(CANON_STORE, { keyPath: 'id' });
          cStore.createIndex('stage', 'stage', { unique: false });
          cStore.createIndex('status', 'status', { unique: false });
      }

      // 4. GRAPH STORES
      if (!db.objectStoreNames.contains(GRAPH_NODE_STORE)) {
          const nodeStore = db.createObjectStore(GRAPH_NODE_STORE, { keyPath: 'id' });
          nodeStore.createIndex('agentId', 'agentId', { unique: false });
      }
      if (!db.objectStoreNames.contains(GRAPH_EDGE_STORE)) {
          const edgeStore = db.createObjectStore(GRAPH_EDGE_STORE, { keyPath: 'id' });
          edgeStore.createIndex('source', 'source', { unique: false });
          edgeStore.createIndex('target', 'target', { unique: false });
          edgeStore.createIndex('agentId', 'agentId', { unique: false });
      }
      if (!db.objectStoreNames.contains(COMMUNITY_STORE)) {
          const commStore = db.createObjectStore(COMMUNITY_STORE, { keyPath: 'id' });
          commStore.createIndex('agentId', 'agentId', { unique: false });
      }

      // 5. HOLODECK STORE
      if (!db.objectStoreNames.contains(WORKING_MEMORY_STORE)) {
          db.createObjectStore(WORKING_MEMORY_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
  });
};

// --- HOLODECK OPERATIONS ---
export const getCanvas = async (id: string = 'HOLODECK_MAIN'): Promise<WorkingMemory> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([WORKING_MEMORY_STORE], 'readonly');
        const req = tx.objectStore(WORKING_MEMORY_STORE).get(id);
        req.onsuccess = (e: any) => {
            const res = e.target.result;
            resolve(res || { id, title: "New Project", sections: [], lastModified: Date.now() });
        };
    });
};

export const updateCanvas = async (memory: WorkingMemory): Promise<void> => {
    const db = await initDB();
    const tx = db.transaction([WORKING_MEMORY_STORE], 'readwrite');
    tx.objectStore(WORKING_MEMORY_STORE).put(memory);
    return new Promise((resolve) => { tx.oncomplete = () => resolve(); });
};

// --- MIGRATION UTILITY ---
export const ensureVectorIndex = async (): Promise<string> => {
    const db = await initDB();
    
    // Check if vectors exist
    const count = await new Promise<number>((resolve) => {
        const tx = db.transaction([VECTOR_STORE_NAME], 'readonly');
        const req = tx.objectStore(VECTOR_STORE_NAME).count();
        req.onsuccess = () => resolve(req.result);
    });

    if (count > 0) return "Index OK";

    // If empty, backfill from Documents
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, VECTOR_STORE_NAME], 'readwrite');
        const docStore = tx.objectStore(STORE_NAME);
        const vecStore = tx.objectStore(VECTOR_STORE_NAME);
        let processed = 0;

        const cursorReq = docStore.openCursor();
        cursorReq.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
            if (cursor) {
                const doc = cursor.value as KnowledgeDoc;
                if (doc.embedding && doc.embedding.length > 0) {
                    vecStore.put({
                        id: doc.id,
                        agentId: doc.agentId || 'UNKNOWN',
                        embedding: doc.embedding
                    });
                    processed++;
                }
                cursor.continue();
            } else {
                resolve(`Migrated ${processed} vectors to optimized index.`);
            }
        };
        cursorReq.onerror = () => reject("Migration failed");
    });
};

// --- CORE OPERATIONS ---

export const addDocument = async (doc: KnowledgeDoc): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, VECTOR_STORE_NAME], 'readwrite');
    
    const docStore = transaction.objectStore(STORE_NAME);
    if (!doc.permissions) doc.permissions = '644';
    docStore.put(doc);

    // Write to Vector Store
    if (doc.embedding) {
        const vecStore = transaction.objectStore(VECTOR_STORE_NAME);
        vecStore.put({
            id: doc.id,
            agentId: doc.agentId || 'UNKNOWN',
            embedding: doc.embedding
        });
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const deleteDocument = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, VECTOR_STORE_NAME], 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.objectStore(VECTOR_STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const bulkAddDocuments = async (docs: KnowledgeDoc[]): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, VECTOR_STORE_NAME], 'readwrite');
    const docStore = transaction.objectStore(STORE_NAME);
    const vecStore = transaction.objectStore(VECTOR_STORE_NAME);

    docs.forEach(doc => { 
        if(!doc.permissions) doc.permissions = '644';
        docStore.put(doc); 
        if (doc.embedding) {
            vecStore.put({
                id: doc.id,
                agentId: doc.agentId || 'UNKNOWN',
                embedding: doc.embedding
            });
        }
    });
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const deleteDocumentsByAgentId = async (agentId: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, VECTOR_STORE_NAME], 'readwrite');
    const docStore = transaction.objectStore(STORE_NAME);
    const vecStore = transaction.objectStore(VECTOR_STORE_NAME);

    // Delete from Docs
    const docIndex = docStore.index('agentId');
    docIndex.getAllKeys(agentId).onsuccess = (e) => {
        const keys = (e.target as IDBRequest).result;
        keys.forEach((k: any) => docStore.delete(k));
    };

    // Delete from Vectors
    const vecIndex = vecStore.index('agentId');
    vecIndex.getAllKeys(agentId).onsuccess = (e) => {
        const keys = (e.target as IDBRequest).result;
        keys.forEach((k: any) => vecStore.delete(k));
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

// --- OPTIMIZED SEARCH ---

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const searchDocuments = async (query: string, queryEmbedding?: number[], agentId?: string): Promise<KnowledgeDoc[]> => {
    if (!queryEmbedding) {
        // Fallback to keyword search if no embedding (slower full scan)
        const allDocs = agentId ? await getDocumentsByAgentId(agentId) : await getAllDocuments();
        const lowerQuery = query.toLowerCase();
        return allDocs.filter(d => d.content.toLowerCase().includes(lowerQuery) || d.title.toLowerCase().includes(lowerQuery)).slice(0, 5);
    }

    const db = await initDB();
    
    // 1. Scan Vector Store (Memory Efficient)
    // We only load {id, embedding} tuples, not full content.
    const scoredIds = await new Promise<{id: string, score: number}[]>((resolve) => {
        const tx = db.transaction([VECTOR_STORE_NAME], 'readonly');
        const store = tx.objectStore(VECTOR_STORE_NAME);
        const request = agentId ? store.index('agentId').openCursor(IDBKeyRange.only(agentId)) : store.openCursor();
        
        const results: {id: string, score: number}[] = [];

        request.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
            if (cursor) {
                const vecDoc = cursor.value as DocVector;
                const score = cosineSimilarity(queryEmbedding, vecDoc.embedding);
                if (score > 0.15) {
                    results.push({ id: vecDoc.id, score });
                }
                cursor.continue();
            } else {
                resolve(results);
            }
        };
    });

    // 2. Sort and slice IDs
    scoredIds.sort((a, b) => b.score - a.score);
    const topIds = scoredIds.slice(0, 8).map(r => r.id);

    if (topIds.length === 0) return [];

    // 3. Fetch Full Content for Top K
    const docs = await new Promise<KnowledgeDoc[]>((resolve) => {
        const tx = db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const finalDocs: KnowledgeDoc[] = [];
        let fetched = 0;

        topIds.forEach(id => {
            store.get(id).onsuccess = (e) => {
                const doc = (e.target as IDBRequest).result;
                if (doc) finalDocs.push(doc);
                fetched++;
                if (fetched === topIds.length) resolve(finalDocs);
            };
        });
    });

    return docs;
};

// --- GRAPH OPS (Unchanged but ensuring exports) ---
export const saveGraphNode = async (node: GraphNode): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([GRAPH_NODE_STORE], 'readwrite');
        tx.objectStore(GRAPH_NODE_STORE).put(node).onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const saveGraphEdge = async (edge: GraphEdge): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([GRAPH_EDGE_STORE], 'readwrite');
        tx.objectStore(GRAPH_EDGE_STORE).put(edge).onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const getGraphNodesByAgent = async (agentId: string): Promise<GraphNode[]> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([GRAPH_NODE_STORE], 'readonly');
        tx.objectStore(GRAPH_NODE_STORE).index('agentId').getAll(agentId).onsuccess = (e) => resolve((e.target as IDBRequest).result);
    });
};

export const getGraphEdges = async (): Promise<GraphEdge[]> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([GRAPH_EDGE_STORE], 'readonly');
        tx.objectStore(GRAPH_EDGE_STORE).getAll().onsuccess = (e) => resolve((e.target as IDBRequest).result);
    });
};

export const searchGraphNodes = async (queryEmbedding: number[], agentId?: string): Promise<GraphNode[]> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([GRAPH_NODE_STORE], 'readonly');
        const store = tx.objectStore(GRAPH_NODE_STORE);
        const req = agentId ? store.index('agentId').getAll(agentId) : store.getAll();
        
        req.onsuccess = () => {
            const nodes = req.result as GraphNode[];
            const scored = nodes
                .map(n => ({
                    node: n,
                    score: n.embedding ? cosineSimilarity(queryEmbedding, n.embedding) : 0
                }))
                .filter(n => n.score > 0.65)
                .sort((a,b) => b.score - a.score)
                .slice(0, 5);
            resolve(scored.map(s => s.node));
        };
    });
};

export const getGraphContext = async (query: string, queryEmbedding?: number[], agentId?: string): Promise<string> => {
    if (!queryEmbedding) return "";
    const anchors = await searchGraphNodes(queryEmbedding, agentId);
    if (anchors.length === 0) return "";

    const anchorIds = new Set(anchors.map(n => n.id));
    const allEdges = await getGraphEdges();
    const relevantEdges = allEdges.filter(e => anchorIds.has(e.source) || anchorIds.has(e.target));
    
    let context = "### GRAPH KNOWLEDGE ###\n";
    for (const node of anchors) {
        context += `ENTITY: ${node.name} (${node.label})\nDESC: ${node.description}\n`;
        const nodeEdges = relevantEdges.filter(e => e.source === node.id || e.target === node.id);
        if (nodeEdges.length > 0) {
            context += "RELATIONSHIPS:\n";
            for (const e of nodeEdges) {
                const isOutbound = e.source === node.id;
                const otherId = isOutbound ? e.target : e.source;
                context += `  - [${e.relation}] ${isOutbound ? '->' : '<-'} ${otherId} ${e.description ? `(${e.description})` : ''}\n`;
            }
        }
        context += "\n";
    }
    return context;
};

// --- PASSTHROUGH METHODS (Standard CRUD) ---
export const updateDocumentContent = async (id: string, newContent: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.get(id).onsuccess = (e) => {
            const doc = (e.target as IDBRequest).result;
            if (doc) {
                doc.content = newContent;
                doc.timestamp = Date.now();
                store.put(doc);
                resolve();
            }
        };
    });
};

export const updateDocumentPermissions = async (id: string, permissions: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.get(id).onsuccess = (e) => {
            const doc = (e.target as IDBRequest).result;
            if (doc) {
                doc.permissions = permissions;
                store.put(doc);
                resolve();
            }
        };
    });
};

export const getAllDocuments = async (): Promise<KnowledgeDoc[]> => {
  const db = await initDB();
  return new Promise((resolve) => {
    db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME).getAll().onsuccess = (e) => {
      resolve(((e.target as IDBRequest).result as KnowledgeDoc[]).sort((a,b) => b.timestamp - a.timestamp));
    };
  });
};

export const getDocumentsByAgentId = async (agentId: string): Promise<KnowledgeDoc[]> => {
  const db = await initDB();
  return new Promise((resolve) => {
    db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME).index('agentId').getAll(agentId).onsuccess = (e) => {
      resolve(((e.target as IDBRequest).result as KnowledgeDoc[]).sort((a,b) => b.timestamp - a.timestamp));
    };
  });
};

export const getDocumentCountByAgentId = async (agentId: string): Promise<number> => {
  const db = await initDB();
  return new Promise((resolve) => {
    db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME).index('agentId').count(agentId).onsuccess = (e) => {
      resolve((e.target as IDBRequest).result);
    };
  });
};

// LorePack, Media, Session, Config methods remain same but compacted for brevity
export const saveLorePack = async (pack: LorePack) => (await initDB()).transaction([LORE_PACK_STORE], 'readwrite').objectStore(LORE_PACK_STORE).put(pack);
export const getLorePacksByAgentId = async (id: string) => new Promise<LorePack[]>(async r => (await initDB()).transaction([LORE_PACK_STORE]).objectStore(LORE_PACK_STORE).index('agentId').getAll(id).onsuccess = e => r((e.target as IDBRequest).result));
export const deleteLorePack = async (id: string) => (await initDB()).transaction([LORE_PACK_STORE], 'readwrite').objectStore(LORE_PACK_STORE).delete(id);

export const saveMediaAsset = async (a: MediaAsset) => (await initDB()).transaction([MEDIA_STORE], 'readwrite').objectStore(MEDIA_STORE).put(a);
export const updateMediaAsset = async (id: string, u: Partial<MediaAsset>) => {
    const db = await initDB();
    const store = db.transaction([MEDIA_STORE], 'readwrite').objectStore(MEDIA_STORE);
    store.get(id).onsuccess = (e) => { const a = (e.target as IDBRequest).result; if(a) store.put({...a, ...u}); };
};
export const getAllMediaAssets = async () => new Promise<MediaAsset[]>(async r => (await initDB()).transaction([MEDIA_STORE]).objectStore(MEDIA_STORE).getAll().onsuccess = e => r((e.target as IDBRequest).result.sort((a:any,b:any)=>b.timestamp-a.timestamp)));
export const deleteMediaAsset = async (id: string) => (await initDB()).transaction([MEDIA_STORE], 'readwrite').objectStore(MEDIA_STORE).delete(id);

export const saveChatSession = async (s: ChatSession) => (await initDB()).transaction([CHAT_STORE_NAME], 'readwrite').objectStore(CHAT_STORE_NAME).put(s);
export const getAllChatSessions = async () => new Promise<ChatSession[]>(async r => (await initDB()).transaction([CHAT_STORE_NAME]).objectStore(CHAT_STORE_NAME).getAll().onsuccess = e => r((e.target as IDBRequest).result.sort((a:any,b:any)=>b.timestamp-a.timestamp)));
export const deleteChatSession = async (id: string) => (await initDB()).transaction([CHAT_STORE_NAME], 'readwrite').objectStore(CHAT_STORE_NAME).delete(id);

export const saveActiveChat = async (id: string, logs: LogMessage[]) => (await initDB()).transaction([ACTIVE_CHAT_STORE_NAME], 'readwrite').objectStore(ACTIVE_CHAT_STORE_NAME).put({agentId: id, logs, timestamp: Date.now()});
export const loadActiveChat = async (id: string) => new Promise<LogMessage[]>(async r => (await initDB()).transaction([ACTIVE_CHAT_STORE_NAME]).objectStore(ACTIVE_CHAT_STORE_NAME).get(id).onsuccess = e => r((e.target as IDBRequest).result?.logs || []));

export const saveGeneralInstructions = async (val: string) => (await initDB()).transaction([CONFIG_STORE_NAME], 'readwrite').objectStore(CONFIG_STORE_NAME).put({id:'general_instructions', value:val});
export const getGeneralInstructions = async () => new Promise<string>(async r => (await initDB()).transaction([CONFIG_STORE_NAME]).objectStore(CONFIG_STORE_NAME).get('general_instructions').onsuccess = e => r((e.target as IDBRequest).result?.value || ''));

export const saveAgentConfig = async (id: string, val: any) => (await initDB()).transaction([CONFIG_STORE_NAME], 'readwrite').objectStore(CONFIG_STORE_NAME).put({id: `agent_config_${id}`, value: val});
export const getAgentConfig = async (id: string) => new Promise<any>(async r => (await initDB()).transaction([CONFIG_STORE_NAME]).objectStore(CONFIG_STORE_NAME).get(`agent_config_${id}`).onsuccess = e => r((e.target as IDBRequest).result?.value || { instruction: '', modelConfig: DEFAULT_MODEL_CONFIG, accessLevel: '' }));

export const saveSavedPrompt = async (p: SavedPrompt) => (await initDB()).transaction([PROMPT_STORE_NAME], 'readwrite').objectStore(PROMPT_STORE_NAME).put(p);
export const getSavedPromptsByAgentId = async (id: string) => new Promise<SavedPrompt[]>(async r => (await initDB()).transaction([PROMPT_STORE_NAME]).objectStore(PROMPT_STORE_NAME).index('agentId').getAll(id).onsuccess = e => r((e.target as IDBRequest).result.sort((a:any,b:any)=>b.timestamp-a.timestamp)));
export const deleteSavedPrompt = async (id: string) => (await initDB()).transaction([PROMPT_STORE_NAME], 'readwrite').objectStore(PROMPT_STORE_NAME).delete(id);

// PRODUCTION BOARD
export const saveCanonBlock = async (b: CanonBlock) => (await initDB()).transaction([CANON_STORE], 'readwrite').objectStore(CANON_STORE).put(b);
export const getCanonBlocks = async () => new Promise<CanonBlock[]>(async r => (await initDB()).transaction([CANON_STORE]).objectStore(CANON_STORE).getAll().onsuccess = e => r((e.target as IDBRequest).result.sort((a:any,b:any)=>a.timestamp-b.timestamp)));
export const deleteCanonBlock = async (id: string) => (await initDB()).transaction([CANON_STORE], 'readwrite').objectStore(CANON_STORE).delete(id);

// --- SQL ---
export const executeSql = async (query: string): Promise<string> => {
    const upperQuery = query.trim().toUpperCase();
    
    // DELETE
    if (upperQuery.startsWith('DELETE FROM')) {
        const tableMatch = upperQuery.match(/DELETE FROM (\w+)/);
        const table = tableMatch ? tableMatch[1] : '';
        if (table !== 'LORE') return `Error: Table '${table}' not found. Only 'LORE' supported.`;
        
        const whereMatch = query.match(/WHERE\s+(.+)$/i);
        if (!whereMatch) return "Error: DELETE requires WHERE clause.";
        
        const condition = whereMatch[1];
        const allDocs = await getAllDocuments();
        let deletedCount = 0;
        
        for (const doc of allDocs) {
            let match = false;
            if (condition.toUpperCase().includes("ID =")) {
                const targetId = condition.split('=')[1].trim().replace(/['"]/g, '');
                if (doc.id === targetId) match = true;
            } else if (condition.toUpperCase().includes("LIKE")) {
                const term = condition.split(/LIKE/i)[1].trim().replace(/['"%]/g, '').toLowerCase();
                if (doc.content.toLowerCase().includes(term) || doc.title.toLowerCase().includes(term)) match = true;
            }
            if (match) {
                await deleteDocument(doc.id);
                deletedCount++;
            }
        }
        return `Query executed. ${deletedCount} rows deleted.`;
    }
    
    // UPDATE
    if (upperQuery.startsWith('UPDATE')) {
        const tableMatch = upperQuery.match(/UPDATE (\w+)/);
        const table = tableMatch ? tableMatch[1] : '';
        if (table !== 'LORE') return `Error: Table '${table}' not found.`;
        
        const setMatch = query.match(/SET\s+(.+?)\s+WHERE/i);
        if (!setMatch) return "Error: UPDATE syntax: UPDATE lore SET col=val WHERE ...";
        const [col, val] = setMatch[1].split('=').map(s => s.trim());
        const cleanVal = val.replace(/^['"]|['"]$/g, '');
        
        const whereMatch = query.match(/WHERE\s+(.+)$/i);
        if (!whereMatch) return "Error: UPDATE requires WHERE clause.";
        const condition = whereMatch[1];
        const allDocs = await getAllDocuments();
        let updatedCount = 0;
        
        for (const doc of allDocs) {
            let match = false;
            if (condition.toUpperCase().includes("ID =")) {
                const targetId = condition.split('=')[1].trim().replace(/['"]/g, '');
                if (doc.id === targetId) match = true;
            }
            if (match) {
                if (col.toUpperCase() === 'CONTENT') { await updateDocumentContent(doc.id, cleanVal); updatedCount++; }
                else if (col.toUpperCase() === 'PERMISSIONS') { await updateDocumentPermissions(doc.id, cleanVal); updatedCount++; }
            }
        }
        return `Query executed. ${updatedCount} rows updated.`;
    }

    // SELECT
    if (upperQuery.startsWith('SELECT')) {
        const likeMatch = query.match(/LIKE\s+['"]%?(.*?)%?['"]/i);
        const term = likeMatch ? likeMatch[1] : '';
        if (!term && !upperQuery.includes('*')) return "Error: SELECT requires 'WHERE content LIKE' or similar.";
        
        let results = await getAllDocuments();
        if (term) results = await searchDocuments(term);
        
        if (results.length === 0) return '0 rows returned.';
        const rows = results.map(r => `| ${r.id.substring(0,8)}... | ${r.title.padEnd(20).substring(0,20)} | ${(r.permissions || '644').padEnd(5)} | ${(r.agentId || 'ALL').padEnd(10)} |`);
        const header = `| ID           | TITLE                | PERM  | OWNER      |`;
        const sep = `+--------------+----------------------+-------+------------+`;
        return `<pre>${sep}\n${header}\n${sep}\n${rows.join('\n')}\n${sep}\n(${results.length} rows)</pre>`;
    }

    return "SQL Error: Command not supported. Use SELECT, UPDATE, DELETE.";
};
