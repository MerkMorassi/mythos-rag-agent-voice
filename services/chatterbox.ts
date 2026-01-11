/**
 * Service for interacting with Chatterbox TTS (Hugging Face Space)
 * Space URL: https://huggingface.co/spaces/merkmorassi/Chatterbox
 * Architecture: SOMA A2A Grounded Synthesis
 */
import { EXTERNAL_MODEL_ENDPOINTS } from './externalRouter';

export interface ChatterboxRequest {
  text: string;
  audioRef: string; // Base64 Data URL string of the reference audio
  exaggeration?: number; // Default 0.5
  temperature?: number; // Default 0.8
  seed_num?: number; // Default 0
  cfg_weight?: number; // Default 0.5
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

  /**
   * Transmutes text into synthetic speech using the provided reference audio clone.
   */
  async synthesize(req: ChatterboxRequest): Promise<ArrayBuffer> {
    try {
      // Gradio API expects: [text, audio_prompt, exaggeration, temperature, seed, cfg]
      const payload = {
        data: [
          req.text,
          {
            data: req.audioRef.startsWith('data:') ? req.audioRef : `data:audio/wav;base64,${req.audioRef}`,
            name: "reference.wav"
          },
          req.exaggeration ?? 0.5,
          req.temperature ?? 0.8,
          req.seed_num ?? 0,
          req.cfg_weight ?? 0.5
        ]
      };

      const response = await fetch(EXTERNAL_MODEL_ENDPOINTS.CHATTERBOX_TTS.url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Chatterbox API Error: ${response.statusText}`);
      }

      const result = await response.json();
      const output = result.data?.[0];
      
      let audioDataStr = "";
      if (typeof output === 'string') {
          audioDataStr = output; 
      } else if (output && output.data) {
          audioDataStr = output.data; 
      }

      if (audioDataStr && audioDataStr.startsWith('data:')) {
          const base64 = audioDataStr.split(',')[1];
          const binaryString = atob(base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return bytes.buffer;
      }
      
      throw new Error("Invalid audio payload received from Chatterbox Space.");
    } catch (e) {
      console.error("[CHATTERBOX] Neural synthesis failed:", e);
      throw e;
    }
  }
};