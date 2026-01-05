
import { saveMediaAsset, getAgentConfig } from "./db";
import { MediaAsset } from "../types";
import { NumMarkX_GenerateID } from "../patterns/NumMarkX";
import { ChatterboxService } from "./chatterbox";

/**
 * EXTERNAL MODEL ROUTER
 * Routes prompts to specialized Hugging Face Spaces or External APIs.
 * 
 * TARGETS:
 * 1. FLUX_IMAGE -> Mythos Engine (Custom SDXL)
 * 2. DOLPHIN_LLM -> Uncensored Text Generation (Venice/Dolphin)
 * 3. CHATTERBOX_TTS -> High Fidelity Speech Synthesis
 */

// User's specific Spaces
const MYTHOS_ENGINE_URL = "https://merkmorassi-mythos-engine.hf.space/api/predict";

export interface RouteResult {
    success: boolean;
    data?: string; // Text response, Base64 image, or Audio URL
    type: 'text' | 'image' | 'audio';
    error?: string;
}

export const ExternalRouter = {

    getHeaders() {
        const token = localStorage.getItem('hf_token') || process.env.HF_TOKEN;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }
        return headers;
    },

    async route(target: string, prompt: string, agent: { id: string, handle: string }, generateAudio: boolean = false): Promise<RouteResult> {
        console.log(`[ROUTER] Routing to ${target}: ${prompt.substring(0, 50)}... (Audio: ${generateAudio})`);
        
        try {
            // 1. IMAGE GENERATION
            if (target === 'FLUX_IMAGE') {
                return await this.callMythosImageGen(prompt, agent);
            } 
            
            // 2. TEXT GENERATION (DOLPHIN/VENICE)
            else if (target === 'DOLPHIN_LLM' || target === 'EXTERNAL_LLM') {
                const textResult = await this.callDolphinText(prompt);
                
                // CHAINING: If Audio requested, pipe text result to Chatterbox
                if (textResult.success && generateAudio && textResult.data) {
                    return await this.callChatterboxTTS(textResult.data, agent);
                }
                return textResult;
            } 
            
            // 3. DIRECT TTS
            else if (target === 'CHATTERBOX_TTS') {
                return await this.callChatterboxTTS(prompt, agent);
            }
            
            return { success: false, type: 'text', error: `Unknown Target: ${target}` };
        } catch (e: any) {
            console.error(`[ROUTER] Call to ${target} failed`, e);
            return { success: false, type: 'text', error: e.message };
        }
    },

    async callMythosImageGen(prompt: string, agent: { id: string, handle: string }): Promise<RouteResult> {
        // SDXL / Custom Image Gen on Mythos Engine
        const response = await fetch(MYTHOS_ENGINE_URL, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify({
                data: [
                    prompt,                                     // Prompt
                    "blur, low quality, distortion, ugly",      // Negative Prompt
                    true,                                       // Randomize Seed
                    1024,                                       // Width
                    1024,                                       // Height
                    7,                                          // Guidance Scale
                    30                                          // Steps
                ]
            })
        });

        if (!response.ok) throw new Error(`Mythos Engine (Image) Unavailable: ${response.statusText}`);

        const json = await response.json();
        const resultData = json.data?.[0]; 
        let imageUrl = "";
        
        if (typeof resultData === 'string' && resultData.startsWith('data:')) {
            imageUrl = resultData;
        } else if (resultData && resultData.url) {
            imageUrl = resultData.url;
        }

        if (imageUrl) {
             await this.saveGeneratedImage(imageUrl, prompt, agent);
             return { success: true, type: 'image', data: imageUrl }; 
        }
        
        return { success: false, type: 'text', error: "Invalid response from Image Engine" };
    },

    async callDolphinText(prompt: string): Promise<RouteResult> {
        try {
            const response = await fetch(MYTHOS_ENGINE_URL, {
                method: "POST",
                headers: this.getHeaders(),
                body: JSON.stringify({
                    data: [
                        prompt, // Input Text
                        0.85,   // Higher Temp for Creative/Uncensored feel
                        4096,   // Max Tokens
                        0.95,   // Top P
                        1.1     // Repetition Penalty
                    ]
                })
            });

            if (!response.ok) throw new Error(`Dolphin Engine Unavailable: ${response.statusText}`);
            
            const json = await response.json();
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
            return { success: false, type: 'text', error: `Dolphin Error: ${e.message}` };
        }
    },

    async callChatterboxTTS(text: string, agent: { id: string, handle: string }): Promise<RouteResult> {
        try {
            // 1. Get Agent Voice Config
            const config = await getAgentConfig(agent.id);
            const voiceRef = config.voiceReference;

            if (!voiceRef) {
                return { success: false, type: 'text', error: `No voice reference found for ${agent.handle}. Upload a sample in Settings.` };
            }

            // 2. Synthesize
            const audioBuffer = await ChatterboxService.synthesize({
                text: text,
                audioRef: voiceRef,
                language: 'en'
            });

            // 3. Convert to Blob URL
            const blob = new Blob([audioBuffer], { type: 'audio/wav' });
            
            // 4. Save as Asset (Story Mode)
            const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const res = reader.result as string;
                    resolve(res.split(',')[1]);
                };
                reader.readAsDataURL(blob);
            });

            const asset: MediaAsset = {
                id: NumMarkX_GenerateID('AUD'),
                type: 'audio',
                data: base64,
                prompt: `Story TTS: ${text.substring(0, 30)}...`,
                agentId: agent.id,
                timestamp: Date.now(),
                tags: ['STORY_MODE', 'TTS', agent.handle.toUpperCase()]
            };
            await saveMediaAsset(asset);

            const audioUrl = URL.createObjectURL(blob);
            return { success: true, type: 'audio', data: audioUrl };

        } catch (e: any) {
            return { success: false, type: 'text', error: `TTS Error: ${e.message}` };
        }
    },

    // --- HELPER: KEYWORD EXTRACTION & SAVING ---
    async saveGeneratedImage(urlOrBase64: string, prompt: string, agent: { id: string, handle: string }) {
        try {
            const stopWords = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'with', 'by', 'at', 'to', 'for', 'is', 'style', 'view', 'highly', 'detailed']);
            const cleanPrompt = prompt.replace(/[^a-zA-Z0-9, ]/g, '');
            const words = cleanPrompt.split(/[\s,]+/);
            
            const keywords = words
                .map(w => w.trim())
                .filter(w => w.length > 3 && !stopWords.has(w.toLowerCase()))
                .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

            const uniqueTags = Array.from(new Set(keywords)).slice(0, 7);
            const finalTags = [agent.handle.toUpperCase(), ...uniqueTags];

            let finalData = urlOrBase64;
            if (urlOrBase64.startsWith('http')) {
                try {
                    const imgRes = await fetch(urlOrBase64);
                    const blob = await imgRes.blob();
                    finalData = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                        reader.readAsDataURL(blob);
                    });
                } catch (e) {
                    console.warn("Could not convert URL to Base64");
                }
            } else if (urlOrBase64.startsWith('data:image')) {
                finalData = urlOrBase64.split(',')[1];
            }

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
        } catch (e) {
            console.error("Failed to auto-save generated image", e);
        }
    }
};
