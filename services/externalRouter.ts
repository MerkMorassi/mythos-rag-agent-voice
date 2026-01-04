
import { saveMediaAsset } from "./db";
import { MediaAsset } from "../types";
import { NumMarkX_GenerateID } from "../patterns/NumMarkX";

/**
 * EXTERNAL MODEL ROUTER
 * Routes prompts to specialized Hugging Face Spaces.
 * 
 * TARGETS:
 * 1. FLUX_IMAGE -> Mythos Engine (Custom SDXL)
 * 2. EXTERNAL_LLM -> Mythos Engine (Text Logic)
 */

// User's specific Spaces
const MYTHOS_ENGINE_URL = "https://merkmorassi-mythos-engine.hf.space/api/predict";

export interface RouteResult {
    success: boolean;
    data?: string; // Text response or Base64 image
    type: 'text' | 'image';
    error?: string;
}

export const ExternalRouter = {

    async route(target: string, prompt: string, agent: { id: string, handle: string }): Promise<RouteResult> {
        console.log(`[ROUTER] Routing to ${target}: ${prompt} (Agent: ${agent.handle})`);
        
        try {
            if (target === 'FLUX_IMAGE') {
                return await this.callMythosImageGen(prompt, agent);
            } else if (target === 'EXTERNAL_LLM') {
                return await this.callMythosText(prompt);
            }
            return { success: false, type: 'text', error: "Unknown Target" };
        } catch (e: any) {
            console.error("[ROUTER] Call failed", e);
            return { success: false, type: 'text', error: e.message };
        }
    },

    async callMythosImageGen(prompt: string, agent: { id: string, handle: string }): Promise<RouteResult> {
        // SDXL / Custom Image Gen on Mythos Engine
        // Standard Gradio Payload for Image Gen usually involves [prompt, negative_prompt, ...]
        const response = await fetch(MYTHOS_ENGINE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                data: [
                    prompt,                                     // Prompt
                    "blur, low quality, distortion, ugly",      // Negative Prompt (Standard Safety)
                    true,                                       // Randomize Seed? (Common param)
                    1024,                                       // Width
                    1024,                                       // Height
                    7,                                          // Guidance Scale
                    30                                          // Steps
                ]
            })
        });

        if (!response.ok) throw new Error(`Mythos Engine (Image) Unavailable: ${response.statusText}`);

        const json = await response.json();
        
        // Gradio often returns path to file or base64 data uri in the 'data' array
        // Expecting: { data: [{ url: "..." }, ...] } OR { data: ["data:image/png;base64,..."] }
        const resultData = json.data?.[0]; 
        
        let imageUrl = "";
        
        if (typeof resultData === 'string' && resultData.startsWith('data:')) {
            imageUrl = resultData;
        } else if (resultData && resultData.url) {
            imageUrl = resultData.url;
        } else if (resultData && resultData.name) {
             // Sometimes it returns a file reference on the space
             imageUrl = resultData.name; 
        }

        if (imageUrl) {
             // --- AUTO-SAVE TO GALLERY ---
             await this.saveGeneratedImage(imageUrl, prompt, agent);
             return { success: true, type: 'image', data: imageUrl }; 
        }
        
        return { success: false, type: 'text', error: "Invalid response format from Mythos Engine" };
    },

    async callMythosText(prompt: string): Promise<RouteResult> {
        try {
            // Gradio API Call Structure for Text/Logic on Mythos Engine
            // Assuming same endpoint, different inputs or maybe just simple text input
            const response = await fetch(MYTHOS_ENGINE_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    data: [
                        prompt, // Input Text
                        0.7,    // Temperature
                        2048,   // Max Tokens
                        0.95,   // Top P
                        1.1     // Repetition Penalty
                    ]
                })
            });

            if (!response.ok) throw new Error(`Mythos Engine (Text) Unavailable: ${response.statusText}`);
            
            const json = await response.json();
            
            // Handle Gradio response format { data: [ "result_string", ... ] }
            let text = "";
            if (json.data && Array.isArray(json.data) && json.data.length > 0) {
                text = json.data[0];
            } else if (json.generated_text) {
                text = json.generated_text;
            } else {
                text = JSON.stringify(json);
            }
            
            return { success: true, type: 'text', data: text.trim() };

        } catch (e: any) {
            console.error("Mythos Engine Error", e);
            return { success: false, type: 'text', error: `Mythos Engine Error: ${e.message}` };
        }
    },

    // --- HELPER: KEYWORD EXTRACTION & SAVING ---
    async saveGeneratedImage(urlOrBase64: string, prompt: string, agent: { id: string, handle: string }) {
        try {
            // 1. Extract Keywords
            const stopWords = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'with', 'by', 'at', 'to', 'for', 'is', 'style', 'view', 'highly', 'detailed']);
            const cleanPrompt = prompt.replace(/[^a-zA-Z0-9, ]/g, '');
            const words = cleanPrompt.split(/[\s,]+/);
            
            const keywords = words
                .map(w => w.trim())
                .filter(w => w.length > 3 && !stopWords.has(w.toLowerCase()))
                .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()); // Capitalize

            const uniqueTags = Array.from(new Set(keywords)).slice(0, 7); // Max 7 content tags
            const finalTags = [agent.handle.toUpperCase(), ...uniqueTags];

            // 2. Fetch Blob to store Base64 if it's a URL (for offline persistence)
            let finalData = urlOrBase64;
            if (urlOrBase64.startsWith('http')) {
                try {
                    const imgRes = await fetch(urlOrBase64);
                    const blob = await imgRes.blob();
                    finalData = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const res = reader.result as string;
                            resolve(res.split(',')[1]); 
                        };
                        reader.readAsDataURL(blob);
                    });
                } catch (e) {
                    console.warn("Could not convert URL to Base64 for persistence, saving URL.");
                }
            } else if (urlOrBase64.startsWith('data:image')) {
                finalData = urlOrBase64.split(',')[1];
            }

            // 3. Create Asset
            const asset: MediaAsset = {
                id: NumMarkX_GenerateID('IMG'),
                type: 'image',
                data: finalData,
                prompt: prompt,
                agentId: agent.id,
                timestamp: Date.now(),
                tags: finalTags
            };

            await saveMediaAsset(asset);
            console.log(`[GALLERY] Auto-saved image for ${agent.handle} with tags: ${finalTags.join(', ')}`);

        } catch (e) {
            console.error("Failed to auto-save generated image", e);
        }
    }
};
