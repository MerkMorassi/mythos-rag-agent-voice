// js/core/core-v2.js
// MYTHOS ENGINE V2 (Browser Native)
// Bypasses localhost. Talks to Gemini directly.

export function normalize(vec) {
    if (!vec || !vec.length) return [];
    const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    return mag === 0 ? vec : vec.map(v => v / mag);
}

export const VectorEngine = {
    search(queryVec, vectors, limit = 5) {
        if (!vectors || vectors.length === 0) return [];
        return vectors
            .map(v => {
                const vec = v.vector || v.values || v.embedding;
                if (!vec) return { ...v, score: -1 };
                let dot = 0;
                for (let i = 0; i < queryVec.length; i++) {
                    dot += queryVec[i] * vec[i];
                }
                return { ...v, score: dot };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
};

export async function apiCall(endpoint, payload, apiKey) {
    const key = apiKey || localStorage.getItem('mythos_api_key');
    if (!key) throw new Error("API Key Missing. Please check CONFIG tab.");

    const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
    let url, body;

    // 1. EMBEDDING
    if (endpoint === 'embed') {
        url = `${BASE}/text-embedding-004:embedContent?key=${key}`;
        body = { content: { parts: [{ text: payload.text }] } };
    } 
    // 2. GENERATION
    else if (endpoint === 'generate') {
        const model = payload.model || 'gemini-2.0-flash-exp';
        url = `${BASE}/${model}:generateContent?key=${key}`;
        body = { contents: [{ parts: [{ text: payload.prompt }] }] };
        
        if (payload.sys) {
            body.systemInstruction = { parts: [{ text: payload.sys }] };
        }
    }

    // 3. EXECUTE
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await res.json();
        
        if (!res.ok) {
            const msg = data.error?.message || res.statusText;
            throw new Error(`Gemini API Failed [${res.status}]: ${msg}`);
        }
        return data;
    } catch (e) {
        console.error("API Call Failed:", e);
        throw e; // Propagate to UI
    }
}