// FIX: ModelConfig is a local type, not from @google/genai.
import { GoogleGenAI, FinishReason, Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";
import { ILLMProvider, LLMResponse, UsageRecord } from "./ILLMProvider";

// Standard model for text chat - Upgraded to Pro for best reasoning
const CHAT_MODEL = "gemini-3-pro-preview"; 

export class GeminiProvider implements ILLMProvider {
  name = "Gemini-3-Pro";
  type = 'token-based' as const;
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateResponse(
      contents: Content[], 
      config: { 
          tools?: Tool[]; 
          modelConfig?: ModelConfig 
      }
  ): Promise<LLMResponse> {
    
    try {
        const result = await this.ai.models.generateContent({
            model: CHAT_MODEL,
            contents: contents,
            config: {
                ...config.modelConfig,
                tools: config.tools
            }
        });
        
        const usage = result.usageMetadata;
        
        // Financial calculation for Gemini 3 Pro Paid Tier (example rates)
        // Rates can be adjusted
        const inputCost = (usage?.promptTokenCount || 0) * 0.000002;  // $2.00 per 1M
        const outputCost = (usage?.candidatesTokenCount || 0) * 0.000012; // $12.00 per 1M
        const cost = inputCost + outputCost;

        const isSafetyRefusal = result.candidates?.[0].finishReason === FinishReason.SAFETY;

        return {
            content: result.text || null,
            functionCalls: result.functionCalls,
            isSafetyRefusal: isSafetyRefusal,
            usage: {
                inputTokens: usage?.promptTokenCount || 0,
                outputTokens: usage?.candidatesTokenCount || 0,
                estimatedCostUsd: cost,
                timestamp: new Date()
            }
        };
    } catch (error: any) {
        // Re-throw to be handled by the orchestrator (multiAgent.ts)
        throw error;
    }
  }
}