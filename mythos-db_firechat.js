// js/mythos-db.js
// THE BELTED OBLISOS: Persistence Layer (IndexedDB Wrapper)
// V2.1 - Canonical

const DB_NAME = 'mythos_vault';
const DB_VERSION = 5;

export class SimpleDB {
    constructor() {
        this.db = null;
        this.ready = this.init();
    }

    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                // 1. Agents Store (Identity)
                if (!db.objectStoreNames.contains('agents')) {
                    db.createObjectStore('agents', { keyPath: 'id' });
                }
                // 2. Vectors Store (The Knowing)
                if (!db.objectStoreNames.contains('vectors')) {
                    const store = db.createObjectStore('vectors', { keyPath: 'id' });
                    store.createIndex('agentId', 'agentId', { unique: false });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };

            request.onerror = (e) => reject(e);
        });
    }

    async tx(storeName, mode, callback) {
        await this.ready;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            
            let result;
            if (callback) result = callback(store);

            transaction.oncomplete = () => resolve(result);
            transaction.onerror = (e) => reject(e.target.error);
        });
    }

    async put(storeName, item) {
        return this.tx(storeName, 'readwrite', s => s.put(item));
    }

    async get(storeName, key) {
        return this.tx(storeName, 'readonly', s => {
            const req = s.get(key);
            return new Promise(res => { req.onsuccess = () => res(req.result); });
        });
    }

    async getAll(storeName) {
        return this.tx(storeName, 'readonly', s => {
            const req = s.getAll();
            return new Promise(res => { req.onsuccess = () => res(req.result); });
        });
    }
    
    async clear(storeName) {
        return this.tx(storeName, 'readwrite', s => s.clear());
    }

    async addBulk(storeName, items) {
        return this.tx(storeName, 'readwrite', s => {
            items.forEach(item => s.put(item));
        });
    }
}