
import { KnowledgeDoc, ChatSession, LogMessage, AgentConfig, ModelConfig, DEFAULT_MODEL_CONFIG, LorePack, MediaAsset, CanonBlock } from '../types';

const DB_NAME = 'gemini_rag_db';
const STORE_NAME = 'documents';
const CHAT_STORE_NAME = 'chat_sessions';
const ACTIVE_CHAT_STORE_NAME = 'active_chats'; 
const CONFIG_STORE_NAME = 'config';
const PROMPT_STORE_NAME = 'saved_prompts';
const LORE_PACK_STORE = 'lore_packs';
const MEDIA_STORE = 'media_assets';
const CANON_STORE = 'production_blocks'; // New Store for AnimAgents
const DB_VERSION = 10; // Increment version

// --- PORTABILITY INTERFACE ---
export interface IVectorStore {
    addDocument(doc: KnowledgeDoc): Promise<void>;
    updateDocument(id: string, content: string): Promise<void>;
    deleteDocument(id: string): Promise<void>;
    search(query: string, embedding?: number[], agentId?: string): Promise<KnowledgeDoc[]>;
    count(agentId: string): Promise<number>;
    purge(agentId: string): Promise<void>;
}
// -----------------------------

export interface SavedPrompt {
    id: string;
    agentId: string;
    name: string;
    content: string;
    timestamp: number;
}

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then((granted) => {
    if (granted) {
      console.log("Storage will not be cleared except by explicit user action");
    } else {
      console.log("Storage may be cleared by the UA under storage pressure.");
    }
  });
}

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
      
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('title', 'title', { unique: false });
      } else {
        store = tx!.objectStore(STORE_NAME);
      }

      if (!store.indexNames.contains('agentId')) {
        store.createIndex('agentId', 'agentId', { unique: false });
      }
      
      if (!store.indexNames.contains('numMarkId')) {
        store.createIndex('numMarkId', 'numMarkId', { unique: false });
      }

      if (!db.objectStoreNames.contains(CHAT_STORE_NAME)) {
        const chatStore = db.createObjectStore(CHAT_STORE_NAME, { keyPath: 'id' });
        chatStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      if (!db.objectStoreNames.contains(ACTIVE_CHAT_STORE_NAME)) {
        db.createObjectStore(ACTIVE_CHAT_STORE_NAME, { keyPath: 'agentId' });
      }

      if (!db.objectStoreNames.contains(CONFIG_STORE_NAME)) {
        db.createObjectStore(CONFIG_STORE_NAME, { keyPath: 'id' });
      }

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

      // AnimAgents Store
      if (!db.objectStoreNames.contains(CANON_STORE)) {
          const cStore = db.createObjectStore(CANON_STORE, { keyPath: 'id' });
          cStore.createIndex('stage', 'stage', { unique: false });
          cStore.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
  });
};

// --- CANON BLOCKS (ANIMAGENTS) ---

export const saveCanonBlock = async (block: CanonBlock): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([CANON_STORE], 'readwrite');
        const store = tx.objectStore(CANON_STORE);
        store.put(block).onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const getCanonBlocks = async (): Promise<CanonBlock[]> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([CANON_STORE], 'readonly');
        const store = tx.objectStore(CANON_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
             const results = req.result as CanonBlock[];
             // Sort by timestamp asc (story order usually)
             results.sort((a,b) => a.timestamp - b.timestamp);
             resolve(results);
        };
        req.onerror = () => reject(req.error);
    });
};

export const deleteCanonBlock = async (id: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([CANON_STORE], 'readwrite');
        const store = tx.objectStore(CANON_STORE);
        store.delete(id).onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

// --- DOCUMENTS ---

export const addDocument = async (doc: KnowledgeDoc): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    if (!doc.permissions) doc.permissions = '644';
    const request = store.put(doc);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const updateDocumentContent = async (id: string, newContent: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            const doc = getReq.result as KnowledgeDoc;
            if (!doc) { reject("Document not found"); return; }
            doc.content = newContent;
            doc.timestamp = Date.now(); 
            store.put(doc).onsuccess = () => resolve();
        };
        getReq.onerror = () => reject(getReq.error);
    });
};

export const updateDocumentPermissions = async (id: string, permissions: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            const doc = getReq.result as KnowledgeDoc;
            if (!doc) { reject("Document not found"); return; }
            doc.permissions = permissions;
            store.put(doc).onsuccess = () => resolve();
        };
        getReq.onerror = () => reject(getReq.error);
    });
};

export const bulkAddDocuments = async (docs: KnowledgeDoc[]): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    docs.forEach(doc => { 
        if(!doc.permissions) doc.permissions = '644';
        store.put(doc); 
    });
  });
};

export const deleteDocument = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const deleteDocumentsByAgentId = async (agentId: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('agentId');
    const keyRequest = index.getAllKeys(agentId);
    keyRequest.onsuccess = () => {
        const keys = keyRequest.result;
        if (!keys || keys.length === 0) return;
        keys.forEach(key => { store.delete(key); });
    };
    keyRequest.onerror = () => reject(keyRequest.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const clearAllDocuments = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getAllDocuments = async (): Promise<KnowledgeDoc[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const results = request.result as KnowledgeDoc[];
      results.sort((a, b) => b.timestamp - a.timestamp);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
};

export const getDocumentsByAgentId = async (agentId: string): Promise<KnowledgeDoc[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('agentId');
    const request = index.getAll(agentId);
    request.onsuccess = () => {
      const results = request.result as KnowledgeDoc[];
      results.sort((a, b) => b.timestamp - a.timestamp);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
};

export const getDocumentCountByAgentId = async (agentId: string): Promise<number> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('agentId');
    const request = index.count(agentId);
    request.onsuccess = () => { resolve(request.result || 0); };
    request.onerror = () => reject(request.error);
  });
};

// --- LORE PACKS ---

export const saveLorePack = async (pack: LorePack): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([LORE_PACK_STORE], 'readwrite');
        const store = tx.objectStore(LORE_PACK_STORE);
        store.put(pack).onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const getLorePacksByAgentId = async (agentId: string): Promise<LorePack[]> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([LORE_PACK_STORE], 'readonly');
        const store = tx.objectStore(LORE_PACK_STORE);
        const index = store.index('agentId');
        // Because agentId is inside header, we indexed header.agentId
        const req = index.getAll(agentId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

export const deleteLorePack = async (id: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([LORE_PACK_STORE], 'readwrite');
        const store = tx.objectStore(LORE_PACK_STORE);
        store.delete(id).onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

// --- MEDIA ASSETS ---

export const saveMediaAsset = async (asset: MediaAsset): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([MEDIA_STORE], 'readwrite');
        const store = tx.objectStore(MEDIA_STORE);
        store.put(asset).onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const updateMediaAsset = async (id: string, updates: Partial<MediaAsset>): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([MEDIA_STORE], 'readwrite');
        const store = tx.objectStore(MEDIA_STORE);
        const req = store.get(id);
        req.onsuccess = () => {
            const asset = req.result as MediaAsset;
            if (!asset) { reject("Asset not found"); return; }
            const updated = { ...asset, ...updates };
            store.put(updated).onsuccess = () => resolve();
        };
        req.onerror = () => reject(req.error);
    });
};

export const getAllMediaAssets = async (): Promise<MediaAsset[]> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([MEDIA_STORE], 'readonly');
        const store = tx.objectStore(MEDIA_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
            const results = req.result as MediaAsset[];
            results.sort((a,b) => b.timestamp - a.timestamp);
            resolve(results);
        };
        req.onerror = () => reject(req.error);
    });
};

export const deleteMediaAsset = async (id: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([MEDIA_STORE], 'readwrite');
        const store = tx.objectStore(MEDIA_STORE);
        store.delete(id).onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

// --- CHAT SESSIONS & CONFIG (Existing) ---

export const saveChatSession = async (session: ChatSession): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHAT_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CHAT_STORE_NAME);
    const request = store.put(session);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getAllChatSessions = async (): Promise<ChatSession[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHAT_STORE_NAME], 'readonly');
    const store = transaction.objectStore(CHAT_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const results = request.result as ChatSession[];
      results.sort((a, b) => b.timestamp - a.timestamp);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
};

export const deleteChatSession = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHAT_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CHAT_STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const saveActiveChat = async (agentId: string, logs: LogMessage[]): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([ACTIVE_CHAT_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(ACTIVE_CHAT_STORE_NAME);
    const request = store.put({ agentId, logs, timestamp: Date.now() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const loadActiveChat = async (agentId: string): Promise<LogMessage[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([ACTIVE_CHAT_STORE_NAME], 'readonly');
    const store = transaction.objectStore(ACTIVE_CHAT_STORE_NAME);
    const request = store.get(agentId);
    request.onsuccess = () => { resolve(request.result?.logs || []); };
    request.onerror = () => reject(request.error);
  });
};

export const saveGeneralInstructions = async (instructions: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONFIG_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CONFIG_STORE_NAME);
    const request = store.put({ id: 'general_instructions', value: instructions });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getGeneralInstructions = async (): Promise<string> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONFIG_STORE_NAME], 'readonly');
    const store = transaction.objectStore(CONFIG_STORE_NAME);
    const request = store.get('general_instructions');
    request.onsuccess = () => { resolve(request.result?.value || ''); };
    request.onerror = () => reject(request.error);
  });
};

export const saveAgentConfig = async (agentId: string, config: { instruction: string, modelConfig: ModelConfig, voiceName?: string, voiceReference?: string, accessLevel?: string, voiceSpeed?: number, voicePitch?: number }): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONFIG_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CONFIG_STORE_NAME);
    const request = store.put({ id: `agent_config_${agentId}`, value: config });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getAgentConfig = async (agentId: string): Promise<{ instruction: string, modelConfig: ModelConfig, voiceName?: string, voiceReference?: string, accessLevel?: string, voiceSpeed?: number, voicePitch?: number }> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONFIG_STORE_NAME], 'readonly');
    const store = transaction.objectStore(CONFIG_STORE_NAME);
    const request = store.get(`agent_config_${agentId}`);
    request.onsuccess = () => { resolve(request.result?.value || { instruction: '', modelConfig: DEFAULT_MODEL_CONFIG, accessLevel: '' }); };
    request.onerror = () => reject(request.error);
  });
};

export const saveSystemInstructions = saveGeneralInstructions;
export const getSystemInstructions = getGeneralInstructions;

export const saveSavedPrompt = async (prompt: SavedPrompt): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PROMPT_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(PROMPT_STORE_NAME);
    const request = store.put(prompt);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getSavedPromptsByAgentId = async (agentId: string): Promise<SavedPrompt[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PROMPT_STORE_NAME], 'readonly');
    const store = transaction.objectStore(PROMPT_STORE_NAME);
    const index = store.index('agentId');
    const request = index.getAll(agentId);
    request.onsuccess = () => {
      const results = request.result as SavedPrompt[];
      results.sort((a, b) => b.timestamp - a.timestamp);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
};

export const deleteSavedPrompt = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PROMPT_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(PROMPT_STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// Helper: Normalize score (0-1)
const normalize = (val: number, max: number) => (max === 0 ? 0 : val / max);

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
  const docsToSearch = agentId ? await getDocumentsByAgentId(agentId) : await getAllDocuments();
  const lowerQuery = query.toLowerCase();
  const queryTerms = lowerQuery.split(/\s+/).filter(t => t.length > 2); 

  const scoredDocs = docsToSearch.map(doc => {
      // 1. Vector Score (Semantic) - 70% Weight
      let vectorScore = 0;
      if (doc.embedding && queryEmbedding) {
          const rawScore = cosineSimilarity(queryEmbedding, doc.embedding);
          // Clamp negative cosine similarity to 0
          vectorScore = Math.max(0, rawScore);
      }

      // 2. Keyword Score (Precision) - 30% Weight
      // Simple heuristic: saturation at 5 matches = 100% relevance
      let keywordHits = 0;
      const contentLower = (doc.content + " " + doc.title).toLowerCase();
      
      queryTerms.forEach(term => {
          if (contentLower.includes(term)) keywordHits++;
      });
      
      const keywordScore = Math.min(keywordHits * 0.2, 1.0);

      // 3. Hybrid Fusion
      let finalScore = 0;
      if (queryEmbedding && doc.embedding) {
          // Weighted Fusion: 70% Semantic, 30% Keyword
          finalScore = (vectorScore * 0.7) + (keywordScore * 0.3);
      } else {
          // Fallback to pure Keyword scoring if embedding missing
          finalScore = keywordScore;
      }

      return { doc, score: finalScore };
  });

  return scoredDocs
    .filter(item => item.score > 0.1) // Noise filter
    .sort((a, b) => b.score - a.score)
    .slice(0, 8) 
    .map(item => item.doc);
};

// --- SIMULATED SQL ENGINE ---
export const executeSql = async (query: string): Promise<string> => {
    const upperQuery = query.trim().toUpperCase();
    
    // DELETE
    if (upperQuery.startsWith('DELETE FROM')) {
        const tableMatch = upperQuery.match(/DELETE FROM (\w+)/);
        const table = tableMatch ? tableMatch[1] : '';
        if (table !== 'LORE') return `Error: Table '${table}' not found. Only 'LORE' supported.`;
        
        // WHERE clause
        const whereMatch = query.match(/WHERE\s+(.+)$/i);
        if (!whereMatch) return "Error: DELETE requires WHERE clause.";
        
        const condition = whereMatch[1];
        const allDocs = await getAllDocuments();
        let deletedCount = 0;
        
        for (const doc of allDocs) {
            // Simple condition parser: id = '...'
            // Very basic support for now: id equals, or content like
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
        
        // SET clause
        const setMatch = query.match(/SET\s+(.+?)\s+WHERE/i);
        if (!setMatch) return "Error: UPDATE syntax: UPDATE lore SET col=val WHERE ...";
        
        const setClause = setMatch[1]; // e.g. content = 'new text'
        // Naive parser for column=value
        const [col, val] = setClause.split('=').map(s => s.trim());
        const cleanVal = val.replace(/^['"]|['"]$/g, '');
        
        // WHERE clause
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
                if (col.toUpperCase() === 'CONTENT') {
                    await updateDocumentContent(doc.id, cleanVal);
                    updatedCount++;
                } else if (col.toUpperCase() === 'PERMISSIONS') {
                    await updateDocumentPermissions(doc.id, cleanVal);
                    updatedCount++;
                }
            }
        }
        return `Query executed. ${updatedCount} rows updated.`;
    }

    // SELECT
    if (upperQuery.startsWith('SELECT')) {
        // Syntax: SELECT * FROM lore WHERE content LIKE '%query%'
        const likeMatch = query.match(/LIKE\s+['"]%?(.*?)%?['"]/i);
        const term = likeMatch ? likeMatch[1] : '';
        
        if (!term && !upperQuery.includes('*')) return "Error: SELECT requires 'WHERE content LIKE' or similar.";
        
        let results = await getAllDocuments();
        if (term) {
            results = await searchDocuments(term);
        }
        
        if (results.length === 0) return '0 rows returned.';

        const rows = results.map(r => `| ${r.id.substring(0,8)}... | ${r.title.padEnd(20).substring(0,20)} | ${(r.permissions || '644').padEnd(5)} | ${(r.agentId || 'ALL').padEnd(10)} |`);
        const header = `| ID           | TITLE                | PERM  | OWNER      |`;
        const sep = `+--------------+----------------------+-------+------------+`;
        
        return `<pre>${sep}\n${header}\n${sep}\n${rows.join('\n')}\n${sep}\n(${results.length} rows)</pre>`;
    }

    return "SQL Error: Command not supported. Use SELECT, UPDATE, DELETE.";
};
