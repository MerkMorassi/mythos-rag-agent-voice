// js/core/api-client.js

const API_KEY_STORAGE = 'gemini_api_key';

// Internal helper for API calls
async function apiCall(endpoint, payload) {
    const key = localStorage.getItem(API_KEY_STORAGE); // Get key from localStorage
    if(!key) throw new Error("API Key required");
    
    let url = "", body = {};
    
    if (endpoint === 'embed') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`;
        body = { model: 'models/text-embedding-004', content: { parts: [{ text: payload.text }] }, taskType: payload.type };
    } else if (endpoint === 'generate') {
        // Model and systemInstruction will be handled by the caller,
        // as api-client should be generic
        const model = payload.model || 'gemini-2.5-flash'; // Default model if not specified
        url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        body = { contents: [{ parts: [{ text: payload.prompt }] }] };
        if (payload.systemInstruction) {
            body.systemInstruction = { parts: [{ text: payload.systemInstruction }] };
        }
    } else if (endpoint === 'models') {
        url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
        const res = await fetch(url);
        if(!res.ok) throw new Error("Fetch failed");
        return await res.json();
    }
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) { const err = await response.json(); throw new Error(err.error?.message || response.statusText); }
    return await response.json();
}

// Exported function for API calls with retry logic
export async function apiCallWithRetry(endpoint, payload, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await apiCall(endpoint, payload);
        } catch (error) {
            if (attempt === maxRetries - 1 || (error.message && !/API Key required|Fetch failed/.test(error.message))) {
                throw error;
            }
            const delay = Math.pow(2, attempt) * 1000;
            console.warn(`[API Retry] Attempt ${attempt + 1}/${maxRetries} failed. Retrying in ${delay}ms...`);
            // In a real application, you might want a more sophisticated logger here
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}
