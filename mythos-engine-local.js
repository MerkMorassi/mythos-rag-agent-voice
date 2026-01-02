// js/core/mythos-engine-local.js
// MYTHOS SILICON ENGINE v3.2 [Optimized Hybrid]
// Embedder -> CPU (Stability) | LLM -> GPU (Speed)

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0-alpha.19';

// 1. CONFIGURATION
env.allowLocalModels = false;
env.useBrowserCache = true;

let generator = null;
let embedder = null;
let activeModelId = null;

// 2. EMBEDDING (CPU / WASM)
// We force this to CPU to avoid WebGPU partitioning errors on small models.
export async function embedLocal(text) {
    if (!embedder) {
        console.log("[Local] Loading Embedder (CPU Mode)...");
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            device: 'wasm', // <--- STABILITY FIX (Was 'webgpu')
        });
    }
    // Normalize and pool
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return output.data; 
}

// 3. GENERATION (WebGPU)
// We keep the heavy lifting on the GPU.
export async function generateLocal(prompt, modelId = 'onnx-community/Llama-3.2-1B-Instruct', callback) {
    
    // Model Swapping Logic
    if (generator && activeModelId !== modelId) {
        console.log("[Local] Flushing GPU memory for new model...");
        await generator.dispose(); // Cleanup if possible
        generator = null; 
    }

    if (!generator) {
        console.log(`[Local] Loading Generator: ${modelId} (WebGPU)...`);
        if(callback) callback(`[SYSTEM] Loading Neural Weights (${modelId})...`);
        
        activeModelId = modelId;
        generator = await pipeline('text-generation', modelId, {
            device: 'webgpu',
            dtype: 'q4f16', // 4-bit Quantization is mandatory for 1B+ params in browser
        });
    }

    console.log("[Local] Generating...");
    const output = await generator(prompt, {
        max_new_tokens: 256,
        temperature: 0.6,
        do_sample: true,
        top_k: 40,
    });

    return output[0].generated_text;
}

// 4. UTILS
export const VectorEngineLocal = {
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