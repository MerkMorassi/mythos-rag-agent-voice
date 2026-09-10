import { ILLMProvider, LLMResponse } from "./ILLMProvider";
import { Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";
import OpenAI from "openai";

/**
 * OpenRouter Provider
 * Leverages the OpenAI client due to API compatibility.
 * Allows routing to a wide variety of models.
 */
export class OpenRouterProvider implements ILLMProvider {
  name = "OpenRouter";
  type = 'token-based' as const;
  private openai: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = "anthropic/claude-3-haiku") {
    this.openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: apiKey,
      defaultHeaders: {
        "HTTP-Referer": "http://localhost:4000",
        "X-Title": "MythOS Comms",
      },
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
        const textPart = c.parts?.find(p => 'text' in p);
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
    
    // Pricing varies wildly on OpenRouter. This is a placeholder.
    // In a real app, you'd fetch this from their API.
    const inputCost = (usage?.prompt_tokens || 0) * 0.00000025;  // Haiku rates: $0.25/1M
    const outputCost = (usage?.completion_tokens || 0) * 0.00000125; // Haiku rates: $1.25/1M

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
