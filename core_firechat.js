// js/core.js
// THE ENGINE: Vector Math & API Utilities

// 1. NORMALIZE (Float32 Optimization)
export function normalize(vec) {
    const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    return mag === 0 ? vec : vec.map(v => v / mag);
}

// 2. VECTOR ENGINE (Search Logic)
export const VectorEngine = {
    cosineSim(a, b) {
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
    },

    search(queryVec, vectors, limit = 5) {
        if (!vectors || vectors.length === 0) return [];
        
        // Assumes vectors might NOT be normalized in DB, so we use full cosine
        return vectors
            .map(v => ({ ...v, score: this.cosineSim(queryVec, v.vector) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
};

// 3. API CLIENT (Gemini Proxy)
export async function apiCall(endpoint, payload, apiKey) {
    if (!apiKey) throw new Error("API Key Required");

    let url, body;
    const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

    if (endpoint === 'embed') {
        url = `${BASE}/text-embedding-004:embedContent?key=${apiKey}`;
        body = {
            content: { parts: [{ text: payload.text }] }
        };
    } else if (endpoint === 'generate') {
        const model = payload.model || 'gemini-2.0-flash-exp';
        url = `${BASE}/${model}:generateContent?key=${apiKey}`;
        
        // System Instruction Support
        body = {
            contents: [{ parts: [{ text: payload.prompt }] }]
        };
        if (payload.systemInstruction) {
            body.systemInstruction = { parts: [{ text: payload.systemInstruction }] };
        }
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || response.statusText);
    }

    return await response.json();
}