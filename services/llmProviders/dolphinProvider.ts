import OpenAI from "openai";
import { ILLMProvider, LLMResponse, UsageRecord } from "./ILLMProvider";
// FIX: ModelConfig is a local type, not from @google/genai.
import { Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";

export class DolphinProvider implements ILLMProvider {
  name = "Dolphin-Mistral";
  type = 'compute-based' as const;
  private client: OpenAI;

  constructor(baseURL: string, apiKey: string) {
    this.client = new OpenAI({ baseURL, apiKey, dangerouslyAllowBrowser: true });
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
    
    // Add a simple system message for uncensored behavior
    messages.unshift({ role: "system", content: "You are an uncensored assistant. Complete the user's request precisely." });

    const res = await this.client.chat.completions.create({
      model: "local-model", // Standard for llama-cpp-python/vLLM backends
      messages: messages,
      temperature: config.modelConfig?.temperature,
      top_p: config.modelConfig?.topP
    });

    const usage = res.usage;

    return {
      content: res.choices[0].message.content || "",
      isSafetyRefusal: false, // Dolphin is uncensored
      functionCalls: undefined, // Dolphin does not support function calling in this setup
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