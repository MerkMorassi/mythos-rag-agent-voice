
import { KnowledgeDoc, ChatSession, LogMessage, AgentConfig, ModelConfig, DEFAULT_MODEL_CONFIG } from '../types';

const DB_NAME = 'gemini_rag_db';
const STORE_NAME = 'documents';
const CHAT_STORE_NAME = 'chat_sessions';
const ACTIVE_CHAT_STORE_NAME = 'active_chats'; 
const CONFIG_STORE_NAME = 'config';
const DB_VERSION = 5; // Increment for agentId index

// Request persistent storage if available
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
      
      // Documents Store
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('title', 'title', { unique: false });
      } else {
        store = tx!.objectStore(STORE_NAME);
      }

      // Add agentId index if it doesn't exist
      if (!store.indexNames.contains('agentId')) {
        store.createIndex('agentId', 'agentId', { unique: false });
      }

      // Chat Sessions Store (Saved Snapshots)
      if (!db.objectStoreNames.contains(CHAT_STORE_NAME)) {
        const chatStore = db.createObjectStore(CHAT_STORE_NAME, { keyPath: 'id' });
        chatStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Active Chat Store (Persistence per Agent)
      if (!db.objectStoreNames.contains(ACTIVE_CHAT_STORE_NAME)) {
        db.createObjectStore(ACTIVE_CHAT_STORE_NAME, { keyPath: 'agentId' });
      }

      // Config Store
      if (!db.objectStoreNames.contains(CONFIG_STORE_NAME)) {
        db.createObjectStore(CONFIG_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
  });
};

export const addDocument = async (doc: KnowledgeDoc): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(doc);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
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
    const request = index.getAllKeys(agentId);

    request.onsuccess = () => {
      const keys = request.result;
      keys.forEach((key) => {
        store.delete(key);
      });
    };

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
      // Sort by timestamp desc
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

export const getDocumentsByTitlePrefix = async (prefix: string): Promise<KnowledgeDoc[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('title');
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
    const request = index.getAll(range);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// Chat Session Methods (Snapshots)

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

// Active Chat Persistence Methods (Per Agent)

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

    request.onsuccess = () => {
      resolve(request.result?.logs || []);
    };
    request.onerror = () => reject(request.error);
  });
};


// --- CONFIGURATION MANAGEMENT ---

// 1. General System Instructions (Global)
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

    request.onsuccess = () => {
      resolve(request.result?.value || '');
    };
    request.onerror = () => reject(request.error);
  });
};

// 2. Agent Specific Config (Instructions + Model Params)
export const saveAgentConfig = async (agentId: string, config: { instruction: string, modelConfig: ModelConfig }): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONFIG_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CONFIG_STORE_NAME);
    const request = store.put({ id: `agent_config_${agentId}`, value: config });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getAgentConfig = async (agentId: string): Promise<{ instruction: string, modelConfig: ModelConfig }> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONFIG_STORE_NAME], 'readonly');
    const store = transaction.objectStore(CONFIG_STORE_NAME);
    const request = store.get(`agent_config_${agentId}`);

    request.onsuccess = () => {
      const saved = request.result?.value;
      if (saved) {
        // Merge saved config with defaults to ensure all keys are present
        const mergedModelConfig = { ...DEFAULT_MODEL_CONFIG, ...saved.modelConfig };
        resolve({ ...saved, modelConfig: mergedModelConfig });
      } else {
        // No saved config, return a fresh default
        resolve({ instruction: '', modelConfig: DEFAULT_MODEL_CONFIG });
      }
    };
    request.onerror = () => reject(request.error);
  });
};

// Legacy support: We can remove getSystemInstructions and saveSystemInstructions as we are migrating to General/Agent specific
// but I'll keep them aliased to General for now to prevent breaking immediate reload if data exists
export const saveSystemInstructions = saveGeneralInstructions;
export const getSystemInstructions = getGeneralInstructions;


// Vector Utility: Cosine Similarity
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const searchDocuments = async (query: string, queryEmbedding?: number[], agentId?: string): Promise<KnowledgeDoc[]> => {
  // If agentId is provided, retrieve only that agent's documents.
  // Otherwise, if no agentId is passed (unlikely in this app), search all.
  const docsToSearch = agentId ? await getDocumentsByAgentId(agentId) : await getAllDocuments();
  
  if (queryEmbedding && docsToSearch.some(d => d.embedding)) {
    // Vector Search
    const scoredDocs = docsToSearch.map(doc => {
      if (!doc.embedding) return { doc, score: -1 };
      return {
        doc,
        score: cosineSimilarity(queryEmbedding, doc.embedding)
      };
    });

    return scoredDocs
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.doc);
  } else {
    // Fallback: Keyword Search
    const lowerQuery = query.toLowerCase();
    return docsToSearch.filter(doc => 
      doc.title.toLowerCase().includes(lowerQuery) || 
      doc.content.toLowerCase().includes(lowerQuery)
    ).slice(0, 5);
  }
};
