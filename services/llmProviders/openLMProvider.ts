import { ILLMProvider, LLMResponse } from "./ILLMProvider";
import { Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";
import OpenAI from "openai";

/**
 * OpenLM Provider (e.g., Llama-3, etc.)
 * Leverages the OpenAI client due to API compatibility.
 */
export class OpenLMProvider implements ILLMProvider {
  name = "OpenLM";
  type = 'token-based' as const;
  private openai: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = "llama-3-8b-instruct") {
    this.openai = new OpenAI({
      baseURL: "https://api.openlm.ai/v1",
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
    });
    this.model = model;
  }

  async generateResponse(
    contents: Content[], 
    config: { 
        tools?: Tool[]; 
        modelConfig?: ModelConfig 
    }
  ): Promise<LLMResponse> {

    const messages: any[] = contents.map(c => {
        const textPart = c.parts.find(p => 'text' in p);
        return {
            role: c.role === 'model' ? 'assistant' : 'user',
            content: textPart?.text || ''
        };
    });

    const completion = await this.openai.chat.completions.create({
      model: this.model,
      messages: messages,
      temperature: config.modelConfig?.temperature,
      top_p: config.modelConfig?.topP,
    });

    const usage = completion.usage;
    
    // OpenLM Pricing (Example for Llama-3-8B)
    const inputCost = (usage?.prompt_tokens || 0) * 0.0000002;  // $0.20 per 1M
    const outputCost = (usage?.completion_tokens || 0) * 0.000001; // $1.00 per 1M

    return {
      content: completion.choices[0].message.content || "",
      isSafetyRefusal: false,
      functionCalls: undefined,
      model: completion.model,
      usage: {
        inputTokens: usage?.prompt_tokens || 0,
        outputTokens: usage?.completion_tokens || 0,
        estimatedCostUsd: inputCost + outputCost,
        timestamp: new Date(),
      },
    };
  }
}
