
import { KnowledgeDoc, ChatSession, LogMessage, AgentConfig, ModelConfig, DEFAULT_MODEL_CONFIG, LorePack, MediaAsset, CanonBlock, GraphNode, GraphEdge, CommunitySummary } from '../types';

const DB_NAME = 'gemini_rag_db';
const STORE_NAME = 'documents';
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

const DB_VERSION = 11; // Upgrade for Graph Stores

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

      // 2. Standard Stores
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

      // 3. GRAPH STORES (New)
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
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
  });
};

// --- GRAPH OPERATIONS ---

export const saveGraphNode = async (node: GraphNode): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([GRAPH_NODE_STORE], 'readwrite');
        const store = tx.objectStore(GRAPH_NODE_STORE);
        store.put(node).onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const saveGraphEdge = async (edge: GraphEdge): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([GRAPH_EDGE_STORE], 'readwrite');
        const store = tx.objectStore(GRAPH_EDGE_STORE);
        store.put(edge).onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const getGraphNodesByAgent = async (agentId: string): Promise<GraphNode[]> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([GRAPH_NODE_STORE], 'readonly');
        const store = tx.objectStore(GRAPH_NODE_STORE);
        const index = store.index('agentId');
        const req = index.getAll(agentId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

export const getGraphEdges = async (): Promise<GraphEdge[]> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([GRAPH_EDGE_STORE], 'readonly');
        const store = tx.objectStore(GRAPH_EDGE_STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

// --- HYBRID SEARCH LOGIC ---

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

/**
 * Perform semantic search on Graph Nodes.
 */
export const searchGraphNodes = async (queryEmbedding: number[], agentId?: string): Promise<GraphNode[]> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([GRAPH_NODE_STORE], 'readonly');
        const store = tx.objectStore(GRAPH_NODE_STORE);
        
        let req: IDBRequest;
        if (agentId) {
            req = store.index('agentId').getAll(agentId);
        } else {
            req = store.getAll();
        }

        req.onsuccess = () => {
            const nodes = req.result as GraphNode[];
            const scored = nodes
                .map(n => ({
                    node: n,
                    score: n.embedding ? cosineSimilarity(queryEmbedding, n.embedding) : 0
                }))
                .filter(n => n.score > 0.65) // Higher threshold for entities
                .sort((a,b) => b.score - a.score)
                .slice(0, 5); // Get top 5 entities
            resolve(scored.map(s => s.node));
        };
        req.onerror = () => reject(req.error);
    });
};

/**
 * "Local Search" - Traverses from relevant nodes to find context.
 */
export const getGraphContext = async (query: string, queryEmbedding?: number[], agentId?: string): Promise<string> => {
    if (!queryEmbedding) return "";

    // 1. Find Anchor Nodes
    const anchors = await searchGraphNodes(queryEmbedding, agentId);
    if (anchors.length === 0) return "";

    const anchorIds = new Set(anchors.map(n => n.id));
    const allEdges = await getGraphEdges();
    
    // 2. Traverse 1-Hop
    // Find edges where source OR target is in anchors
    const relevantEdges = allEdges.filter(e => anchorIds.has(e.source) || anchorIds.has(e.target));
    
    // 3. Format Context
    // Output: "Zeus (Person): King of Gods. Relations: MARRIED_TO Hera, FATHER_OF Hercules"
    let context = "### GRAPH KNOWLEDGE ###\n";
    
    for (const node of anchors) {
        context += `ENTITY: ${node.name} (${node.label})\nDESC: ${node.description}\n`;
        
        const nodeEdges = relevantEdges.filter(e => e.source === node.id || e.target === node.id);
        if (nodeEdges.length > 0) {
            context += "RELATIONSHIPS:\n";
            for (const e of nodeEdges) {
                const isOutbound = e.source === node.id;
                const otherId = isOutbound ? e.target : e.source;
                const relType = e.relation;
                // If we want the name of the other node, we'd need to look it up, but ID is usually the name in our simplified model
                context += `  - [${relType}] ${isOutbound ? '->' : '<-'} ${otherId} ${e.description ? `(${e.description})` : ''}\n`;
            }
        }
        context += "\n";
    }
    
    return context;
};

export const searchDocuments = async (query: string, queryEmbedding?: number[], agentId?: string): Promise<KnowledgeDoc[]> => {
  const docsToSearch = agentId ? await getDocumentsByAgentId(agentId) : await getAllDocuments();
  const lowerQuery = query.toLowerCase();
  const queryTerms = lowerQuery.split(/\s+/).filter(t => t.length > 2); 

  const scoredDocs = docsToSearch.map(doc => {
      // 1. Vector Score (Semantic) - 70% Weight
      let vectorScore = 0;
      if (doc.embedding && queryEmbedding) {
          const rawScore = cosineSimilarity(queryEmbedding, doc.embedding);
          vectorScore = Math.max(0, rawScore);
      }

      // 2. Keyword Score (Precision) - 30% Weight
      let keywordHits = 0;
      const contentLower = (doc.content + " " + doc.title).toLowerCase();
      
      queryTerms.forEach(term => {
          if (contentLower.includes(term)) keywordHits++;
      });
      
      const keywordScore = Math.min(keywordHits * 0.2, 1.0);

      // 3. Hybrid Fusion
      let finalScore = 0;
      if (queryEmbedding && doc.embedding) {
          finalScore = (vectorScore * 0.7) + (keywordScore * 0.3);
      } else {
          finalScore = keywordScore;
      }

      return { doc, score: finalScore };
  });

  return scoredDocs
    .filter(item => item.score > 0.15) 
    .sort((a, b) => b.score - a.score)
    .slice(0, 8) 
    .map(item => item.doc);
};

// --- REST OF DB METHODS ---

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

// --- CHAT SESSIONS & CONFIG ---

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
        
        const setClause = setMatch[1]; 
        const [col, val] = setClause.split('=').map(s => s.trim());
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
