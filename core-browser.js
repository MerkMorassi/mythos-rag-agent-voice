// js/core/core-browser.js
// SERVERLESS CORE: Direct-to-API implementation for Firechat Lattice

export function normalize(vec) {
    const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    return mag === 0 ? vec : vec.map(v => v / mag);
}

export const VectorEngine = {
    search(queryVec, vectors, limit = 5) {
        if (!vectors || vectors.length === 0) return [];
        return vectors
            .map(v => {
                // Handle different vector storage formats
                const vec = v.vector || v.embedding || v.values;
                if(!vec) return { ...v, score: -1 };
                
                // Dot Product (assumes normalized inputs for Cosine Sim)
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
    if (!apiKey) throw new Error("API Key Required for Browser Core");

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
        
        body = {
            contents: [{ parts: [{ text: payload.prompt }] }]
        };
        // Add System Instruction if present
        if (payload.sys || payload.systemInstruction) {
            body.systemInstruction = { 
                parts: [{ text: payload.sys || payload.systemInstruction }] 
            };
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