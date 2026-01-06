import { saveMediaAsset, getAgentConfig } from "./db";
import { MediaAsset } from "../types";
import { NumMarkX_GenerateID } from "../patterns/NumMarkX";
import { ChatterboxService } from "./chatterbox";
import { GoogleGenAI } from "@google/genai";

/**
 * EXTERNAL MODEL ROUTER & FALLBACK SYSTEM
 * Routes prompts to specialized Hugging Face Spaces for media generation.
 */

export interface RouteResult {
    success: boolean;
    data?: string; // Text response, Base64 image, or Audio URL
    type: 'text' | 'image' | 'audio' | 'video';
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
        console.log(`[ROUTER] Routing to ${target}: ${prompt.substring(0, 50)}...`);
        
        try {
            // --- IMAGE GENERATION ---
            if (target === 'FLUX_IMAGE') {
                // Fallback to Gemini Nano (Native)
                console.log("[ROUTER] Routing to Gemini Native Image Generation...");
                return await this.callGeminiImage(prompt, agent);
            } 
            
            // --- VIDEO GENERATION ---
            else if (target === 'VIDEO_GENERATION') {
                return await this.callVeoVideo(prompt, agent);
            }
            
            // --- TTS ---
            else if (target === 'CHATTERBOX_TTS') {
                return await this.callChatterboxTTS(prompt, agent);
            }
            
            return { success: false, type: 'text', error: `Unknown Target: ${target}` };
        } catch (e: any) {
            console.error(`[ROUTER] Call to ${target} failed`, e);
            return { success: false, type: 'text', error: e.message };
        }
    },

    // --- NATIVE GEMINI IMAGE (FALLBACK) ---
    async callGeminiImage(prompt: string, agent: { id: string, handle: string }): Promise<RouteResult> {
        try {
            const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
            if (!apiKey) return { success: false, type: 'text', error: "No API Key configured for Native Generation." };

            const ai = new GoogleGenAI({ apiKey });
            // Using 'gemini-2.5-flash-image' for image generation as per spec
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [{ text: prompt }] }
            });

            // Extract Image from Response
            let base64Image = "";
            const candidates = response.candidates;
            if (candidates && candidates.length > 0) {
                for (const part of candidates[0].content.parts) {
                    if (part.inlineData) {
                        base64Image = part.inlineData.data;
                        break;
                    }
                }
            }

            if (!base64Image) {
                // If text returned instead of image, it might be a refusal
                const text = response.text;
                if (text && (text.includes("policy") || text.includes("safety") || text.includes("unable"))) {
                    return { success: false, type: 'text', error: `Request refused by Safety Guidelines: ${text}` };
                }
                return { success: false, type: 'text', error: "Model did not return an image." };
            }

            await this.saveGeneratedImage(`data:image/jpeg;base64,${base64Image}`, prompt, agent);
            return { success: true, type: 'image', data: `data:image/jpeg;base64,${base64Image}` };

        } catch (e: any) {
            if (e.message?.includes('400') || e.message?.includes('SAFETY')) {
                return { success: false, type: 'text', error: "I cannot generate that image due to Google's Safety Policies regarding generated content." };
            }
            return { success: false, type: 'text', error: `Native Image Gen Failed: ${e.message}` };
        }
    },

    // --- NATIVE VEO VIDEO ---
    async callVeoVideo(prompt: string, agent: { id: string, handle: string }): Promise<RouteResult> {
        try {
            const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
            if (!apiKey) return { success: false, type: 'text', error: "No API Key configured for Veo." };

            const ai = new GoogleGenAI({ apiKey });
            
            // Start Operation
            let operation = await ai.models.generateVideos({
                model: 'veo-3.1-fast-generate-preview',
                prompt: prompt,
                config: {
                    numberOfVideos: 1,
                    aspectRatio: '16:9',
                    resolution: '720p'
                }
            });

            // Poll for Completion
            console.log("[VEO] Generating video...");
            while (!operation.done) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // 5s poll
                operation = await ai.operations.getVideosOperation({ operation: operation });
            }

            if (operation.error) {
                throw new Error(String((operation.error as any).message));
            }

            const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (!videoUri) throw new Error("No video URI returned.");

            const downloadUrl = `${videoUri}&key=${apiKey}`;
            
            const vidRes = await fetch(downloadUrl);
            const blob = await vidRes.blob();
            const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                reader.readAsDataURL(blob);
            });

            const asset: MediaAsset = {
                id: NumMarkX_GenerateID('VID'),
                type: 'video',
                data: base64, 
                prompt: prompt,
                agentId: agent.id,
                timestamp: Date.now(),
                tags: [agent.handle.toUpperCase(), 'VEO', 'GENERATED']
            };
            await saveMediaAsset(asset);

            return { success: true, type: 'video', data: `data:video/mp4;base64,${base64}` };

        } catch (e: any) {
            console.error("Veo Error:", e);
            if (e.message?.includes('SAFETY') || e.message?.includes('policy')) {
                return { success: false, type: 'text', error: "I cannot generate that video due to safety policies." };
            }
            return { success: false, type: 'text', error: `Video Generation Failed: ${e.message}` };
        }
    },

    async callChatterboxTTS(text: string, agent: { id: string, handle: string }): Promise<RouteResult> {
        try {
            const config = await getAgentConfig(agent.id);
            const voiceRef = config.voiceReference;

            if (!voiceRef) {
                return { success: false, type: 'text', error: `No voice reference found for ${agent.handle}.` };
            }

            const audioBuffer = await ChatterboxService.synthesize({
                text: text,
                audioRef: voiceRef,
                language: 'en'
            });

            const blob = new Blob([audioBuffer], { type: 'audio/wav' });
            const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
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
            return { success: false, type: 'text', error: `TTS Failed: ${e.message}` };
        }
    },

    async saveGeneratedImage(urlOrBase64: string, prompt: string, agent: { id: string, handle: string }) {
        try {
            let finalData: string = urlOrBase64;
            if (urlOrBase64.startsWith('http')) {
                const imgRes = await fetch(urlOrBase64);
                const blob = await imgRes.blob();
                finalData = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                    reader.readAsDataURL(blob);
                });
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
                tags: [agent.handle.toUpperCase(), 'GENERATED']
            };

            await saveMediaAsset(asset);
        } catch (e) {
            console.error("Failed to auto-save generated image", e);
        }
    }
};