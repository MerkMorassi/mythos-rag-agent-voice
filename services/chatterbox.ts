

/**
 * Service for interacting with Chatterbox TTS (Hugging Face Space)
 * Space URL: https://huggingface.co/spaces/merkmorassi/Chatterbox
 */

// We target the Gradio API endpoint
const HF_SPACE_URL = "https://merkmorassi-chatterbox.hf.space/api/predict";

export interface ChatterboxRequest {
  text: string;
  audioRef: string; // Base64 string of the reference audio (wav/mp3)
  language?: string; // Default 'en'
}

export const ChatterboxService = {
  
  getHeaders() {
      const token = localStorage.getItem('hf_token') || process.env.HF_TOKEN;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
          headers["Authorization"] = `Bearer ${token}`;
      }
      return headers;
  },

  async synthesize(req: ChatterboxRequest): Promise<ArrayBuffer> {
    try {
      // Gradio API usually expects a structure like { data: [param1, param2, ...] }
      // Inputs: Text, Audio (as object or path), Language
      
      const response = await fetch(HF_SPACE_URL, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          data: [
            req.text,
            {
                data: req.audioRef,
                name: "reference.wav"
            },
            req.language || "en"
          ]
        }),
      });

      if (!response.ok) {
        throw new Error(`Chatterbox API Error: ${response.statusText}`);
      }

      const result = await response.json();
      
      // Gradio returns { data: [{ name: "...", data: "data:audio/wav;base64,..." }] }
      const output = result.data[0];
      
      let audioDataStr = "";
      if (typeof output === 'string') {
          audioDataStr = output; 
      } else if (output.data) {
          audioDataStr = output.data; 
      }

      if (audioDataStr.startsWith('data:')) {
          const base64 = audioDataStr.split(',')[1];
          const binaryString = atob(base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return bytes.buffer;
      }
      
      throw new Error("Invalid audio data format from Chatterbox");

    } catch (e) {
      console.error("Chatterbox Synthesis Failed:", e);
      throw e;
    }
  }
};