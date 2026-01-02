
import { KnowledgeDoc, ChatSession, LogMessage, AgentConfig, ModelConfig, DEFAULT_MODEL_CONFIG } from '../types';

const DB_NAME = 'gemini_rag_db';
const STORE_NAME = 'documents';
const CHAT_STORE_NAME = 'chat_sessions';
const ACTIVE_CHAT_STORE_NAME = 'active_chats'; 
const CONFIG_STORE_NAME = 'config';
const PROMPT_STORE_NAME = 'saved_prompts'; // New Store
const DB_VERSION = 7; // Increment version

export interface SavedPrompt {
    id: string;
    agentId: string;
    name: string;
    content: string;
    timestamp: number;
}

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

      if (!store.indexNames.contains('agentId')) {
        store.createIndex('agentId', 'agentId', { unique: false });
      }
      
      if (!store.indexNames.contains('numMarkId')) {
        store.createIndex('numMarkId', 'numMarkId', { unique: false });
      }

      // Chat Sessions Store
      if (!db.objectStoreNames.contains(CHAT_STORE_NAME)) {
        const chatStore = db.createObjectStore(CHAT_STORE_NAME, { keyPath: 'id' });
        chatStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Active Chat Store
      if (!db.objectStoreNames.contains(ACTIVE_CHAT_STORE_NAME)) {
        db.createObjectStore(ACTIVE_CHAT_STORE_NAME, { keyPath: 'agentId' });
      }

      // Config Store
      if (!db.objectStoreNames.contains(CONFIG_STORE_NAME)) {
        db.createObjectStore(CONFIG_STORE_NAME, { keyPath: 'id' });
      }

      // Prompts Store (NEW)
      if (!db.objectStoreNames.contains(PROMPT_STORE_NAME)) {
        const promptStore = db.createObjectStore(PROMPT_STORE_NAME, { keyPath: 'id' });
        promptStore.createIndex('agentId', 'agentId', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
  });
};

// ... [Existing Document Methods: addDocument, bulkAddDocuments, deleteDocument, etc. - No changes needed] ...
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
    docs.forEach(doc => { store.put(doc); });
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

export const findDocumentBySigil = async (sigil: string): Promise<KnowledgeDoc | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('numMarkId');
    const request = index.get(sigil);
    request.onsuccess = () => { resolve(request.result || null); };
    request.onerror = () => reject(request.error);
  });
};

// ... [Existing Chat Session Methods - No changes] ...
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

// ... [Existing Active Chat Methods - No changes] ...
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

// ... [Existing Config Methods - No changes] ...
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
    request.onsuccess = () => { resolve(request.result?.value || { instruction: '', modelConfig: DEFAULT_MODEL_CONFIG }); };
    request.onerror = () => reject(request.error);
  });
};

export const saveSystemInstructions = saveGeneralInstructions;
export const getSystemInstructions = getGeneralInstructions;

// --- PROMPT MANAGEMENT (New) ---

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

// ... [Existing Vector Search - No changes] ...
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
  const startTime = performance.now();
  const docsToSearch = agentId ? await getDocumentsByAgentId(agentId) : await getAllDocuments();
  
  if (queryEmbedding && docsToSearch.some(d => d.embedding)) {
    const scoredDocs = docsToSearch.map(doc => {
      if (!doc.embedding) return { doc, score: -1 };
      return { doc, score: cosineSimilarity(queryEmbedding, doc.embedding) };
    });
    const results = scoredDocs
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.doc);
    return results;
  } else {
    const lowerQuery = query.toLowerCase();
    const results = docsToSearch.filter(doc => 
      doc.title.toLowerCase().includes(lowerQuery) || 
      doc.content.toLowerCase().includes(lowerQuery)
    ).slice(0, 5);
    return results;
  }
};
