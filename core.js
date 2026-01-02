// js/core.js (and js/core/core.js)
// MYTHOS CORE v3.0 [SERVERLESS EDITION]
// Direct-to-API implementation. No localhost required.

// 1. UTILS
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
                
                // Cosine Similarity (Dot Product of Normalized Vectors)
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

// 2. API CLIENT (Direct Fetch)
export async function apiCall(endpoint, payload, apiKey) {
    // Auto-resolve key if not passed, but warn
    const key = apiKey || localStorage.getItem('mythos_api_key');
    if (!key) throw new Error("API Key Missing. Please enter it in the Config tab.");

    const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
    let url, body;

    try {
        if (endpoint === 'embed') {
            url = `${BASE_URL}/text-embedding-004:embedContent?key=${key}`;
            body = {
                content: { parts: [{ text: payload.text }] }
            };
        } else if (endpoint === 'generate') {
            const model = payload.model || 'gemini-2.0-flash-exp';
            url = `${BASE_URL}/${model}:generateContent?key=${key}`;
            
            body = {
                contents: [{ parts: [{ text: payload.prompt }] }]
            };
            
            // System Instruction Support (v1beta)
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
            const errData = await response.json();
            throw new Error(`Gemini API Error: ${errData.error?.message || response.statusText}`);
        }

        return await response.json();

    } catch (e) {
        console.error("Core API Failure:", e);
        throw e;
    }
}