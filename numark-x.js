// js/memory/numark-x.js
// THE JUMP DRIVE: Deterministic Retrieval System
// Exports the 'NumMarkX' singleton expected by agent-runtime.js

export const NumMarkX = {
    index: new Map(),

    // Generate a simple deterministic key (stripped, lowercase)
    encode(text) {
        return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    },

    // Build the Index from RAM Vectors
    initialize(vectors) {
        this.index.clear();
        // console.log(`[NumMarkX] Indexing ${vectors.length} nodes...`);
        vectors.forEach(v => {
            if (!v.text) return;
            // Index the first 50 chars as a "Header Sigil" for fast lookup
            const key = this.encode(v.text.substring(0, 50));
            if (key.length > 5) this.index.set(key, v);
        });
    },

    // Attempt a teleport (Direct Lookup)
    teleport(query) {
        if (!query) return null;
        const key = this.encode(query);
        
        // 1. Direct Hit
        if (this.index.has(key)) return this.index.get(key);
        
        // 2. Prefix Scan (fuzzy match for starts-with)
        // Only scan if query is substantial to avoid noise
        if (key.length > 8) {
            for (const [k, v] of this.index) {
                if (k.startsWith(key)) return v;
            }
        }
        
        return null;
    }
};