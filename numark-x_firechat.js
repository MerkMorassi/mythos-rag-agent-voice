// js/numark-x.js
// THE JUMP DRIVE: Deterministic Sigil Indexing
// Bypass vector search for exact keyword/phrase matches.

export const NumMarkX = {
    index: new Map(),

    // Generate a simple deterministic key (stripped, lowercase)
    encode(text) {
        return text.toLowerCase().replace(/[^a-z0-9]/g, '');
    },

    // Build the Index from RAM Vectors
    initialize(vectors) {
        this.index.clear();
        console.log(`[NumMarkX] Indexing ${vectors.length} nodes...`);
        vectors.forEach(v => {
            // Index the first 50 chars as a "Header Sigil"
            const key = this.encode(v.text.substring(0, 50));
            if (key.length > 5) this.index.set(key, v);
        });
        console.log(`[NumMarkX] Jump Coordinates Locked.`);
    },

    // Attempt a teleport (Direct Lookup)
    teleport(query) {
        const key = this.encode(query);
        // Look for exact match or partial starts-with
        if (this.index.has(key)) return this.index.get(key);
        
        // Fallback: Check if query matches the start of any key
        for (const [k, v] of this.index) {
            if (k.startsWith(key) && key.length > 8) return v;
        }
        return null;
    }
};