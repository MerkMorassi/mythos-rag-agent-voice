
/**
 * EXTERNAL MODEL ROUTER
 * Routes prompts to specialized Hugging Face Spaces (or other APIs) 
 * to offload tasks like Image Generation or Uncensored Chat.
 */

// Example Space: Flux.1-Schnell (Fast, High Quality Images)
const HF_FLUX_URL = "https://black-forest-labs-flux-1-schnell.hf.space/api/predict";

// Target Model: Cognitive Computations Dolphin 2.9.4 (Llama 3.1 8B)
// This is an uncensored model widely available on HF Inference API
const HF_TEXT_URL = "https://api-inference.huggingface.co/models/cognitivecomputations/dolphin-2.9.4-llama3.1-8b";

export interface RouteResult {
    success: boolean;
    data?: string; // Text response or Base64 image
    type: 'text' | 'image';
    error?: string;
}

export const ExternalRouter = {

    async route(target: string, prompt: string): Promise<RouteResult> {
        console.log(`[ROUTER] Routing to ${target}: ${prompt}`);
        
        try {
            if (target === 'FLUX_IMAGE') {
                return await this.callFluxSchnell(prompt);
            } else if (target === 'EXTERNAL_LLM') {
                return await this.callExternalLLM(prompt);
            }
            return { success: false, type: 'text', error: "Unknown Target" };
        } catch (e: any) {
            console.error("[ROUTER] Call failed", e);
            return { success: false, type: 'text', error: e.message };
        }
    },

    async callFluxSchnell(prompt: string): Promise<RouteResult> {
        // Gradio API call structure for Flux Spaces
        // Note: Public spaces often require this format: { data: [prompt, seed, randomize, width, height, steps] }
        const response = await fetch(HF_FLUX_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                data: [
                    prompt, // Prompt
                    0,      // Seed
                    true,   // Randomize Seed
                    512,    // Width
                    512,    // Height
                    4       // Num Inference Steps
                ]
            })
        });

        if (!response.ok) throw new Error("Flux Space Unavailable");

        const json = await response.json();
        // Gradio returns [{ url: "..." }, ...] or data objects
        const resultData = json.data[0]; 
        
        // Handle result (Gradio usually returns a URL or Base64 structure)
        if (resultData && resultData.url) {
             return { success: true, type: 'image', data: resultData.url }; 
        }
        
        return { success: false, type: 'text', error: "Invalid Flux response format" };
    },

    async callExternalLLM(prompt: string): Promise<RouteResult> {
        // Hugging Face Inference API Structure
        const headers: Record<string, string> = { 
            "Content-Type": "application/json" 
        };
        
        // Use token if available to avoid rate limits
        // Check localStorage first, then process.env
        const token = localStorage.getItem('hf_token') || process.env.HF_TOKEN;
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const response = await fetch(HF_TEXT_URL, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                inputs: prompt,
                parameters: {
                    temperature: 0.7,
                    max_new_tokens: 2048,
                    top_p: 0.95,
                    repetition_penalty: 1.1,
                    return_full_text: false // We only want the generation
                }
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error("HF Inference Error:", errBody);
            throw new Error(`External LLM Unavailable: ${response.statusText}`);
        }
        
        const json = await response.json();
        
        // HF Inference API returns an array: [{ generated_text: "..." }]
        let text = "";
        if (Array.isArray(json) && json[0]?.generated_text) {
            text = json[0].generated_text;
        } else if (typeof json === 'object' && json.generated_text) {
            text = json.generated_text;
        } else {
            text = JSON.stringify(json);
        }
        
        return { success: true, type: 'text', data: text.trim() };
    }
};
