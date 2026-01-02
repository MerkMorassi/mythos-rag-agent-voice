// js/core/mythos-engine.js
// MYTHOS ENGINE v3.1 [Stabilized]

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
    if (!key) throw new Error("API Key Missing");

    const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
    let url, body;

    if (endpoint === 'embed') {
        // SAFETY CHECK: Ensure text is valid
        if (!payload.text || typeof payload.text !== 'string' || payload.text.trim() === '') {
            throw new Error("Embedding Request Empty");
        }
        url = `${BASE}/text-embedding-004:embedContent?key=${key}`;
        body = { content: { parts: [{ text: payload.text.trim() }] } };
    } 
    else if (endpoint === 'generate') {
        const model = payload.model || 'gemini-2.5-flash';
        url = `${BASE}/${model}:generateContent?key=${key}`;
        body = { contents: [{ parts: [{ text: payload.prompt }] }] };
        if (payload.sys) body.systemInstruction = { parts: [{ text: payload.sys }] };
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `API ${res.status}`);
    }
    return await res.json();
}