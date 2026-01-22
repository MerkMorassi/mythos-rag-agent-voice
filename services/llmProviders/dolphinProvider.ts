
import { ILLMProvider, LLMResponse } from "./ILLMProvider";
// FIX: ModelConfig is a local type, not from @google/genai.
import { Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";

export class DolphinProvider implements ILLMProvider {
  name = "Dolphin-Mistral";
  type = 'compute-based' as const;
  private baseURL: string;
  private apiKey: string; // This is the HF_TOKEN

  constructor(baseURL: string, apiKey: string) {
    this.baseURL = baseURL;
    this.apiKey = apiKey;
  }

  async generateResponse(
    contents: Content[], 
    config: { 
        tools?: Tool[]; 
        modelConfig?: ModelConfig 
    }
  ): Promise<LLMResponse> {

    // Convert Gemini Content[] to OpenAI messages[]
    const messages: any[] = contents.map(c => {
        const textPart = c.parts.find(p => 'text' in p);
        return {
            role: c.role === 'model' ? 'assistant' : 'user',
            content: textPart?.text || ''
        };
    });
    
    const systemPrompt = `
You are MythOS Dolphin, an AI assistant with powerful multi-modal capabilities. You can understand and analyze images, videos, and even content from YouTube URLs provided by the user. When a user attaches media, seamlessly integrate it into the conversation. For example, if they provide a video, you can summarize it, answer questions about its content, or describe specific events within it. Your primary knowledge source for specific, contextual information is a LOREPACK knowledge base, which you should query with your tools. Synthesize information from all sources (media, LOREPACK, your internal training) into a direct and helpful answer. Ask clarifying questions when needed. Only use a web search as a last resort if explicitly enabled and necessary.
`.trim();

    messages.unshift({ role: "system", content: systemPrompt });

    const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
            model: "local-model", // Standard for llama-cpp-python/vLLM backends
            messages: messages,
            temperature: config.modelConfig?.temperature ?? 0.8,
            max_tokens: 1024,
            stop: ["<|im_end|>", "<|im_start|>"],
            top_p: config.modelConfig?.topP
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Dolphin API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const res = await response.json();
    const usage = res.usage;

    return {
      content: res.choices[0].message.content || "",
      isSafetyRefusal: false, // Dolphin is uncensored
      functionCalls: undefined, // Dolphin does not support function calling in this setup
      model: this.name,
      usage: {
        inputTokens: usage?.prompt_tokens || 0,
        outputTokens: usage?.completion_tokens || 0,
        // For a hosted Space or local server, cost per request is effectively $0
        // because the hourly/hardware cost is a fixed sunk cost.
        estimatedCostUsd: 0, 
        timestamp: new Date()
      }
    };
  }
}
