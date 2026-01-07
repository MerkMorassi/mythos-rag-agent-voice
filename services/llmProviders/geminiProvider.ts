// FIX: ModelConfig is a local type, not from @google/genai.
import { GoogleGenAI, FinishReason, Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";
import { ILLMProvider, LLMResponse, UsageRecord } from "./ILLMProvider";
import { ModelGate } from "../modelGate";

export class GeminiProvider implements ILLMProvider {
  name = "Gemini";
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
        // --- DYNAMIC MODEL SELECTION ---
        const lastUserContent = contents.filter(c => c.role === 'user').pop();
        const query = lastUserContent?.parts.find((p): p is { text: string } => 'text' in p)?.text || '';
        const modelToUse = ModelGate.selectModel(query);
        
        const result = await this.ai.models.generateContent({
            model: modelToUse,
            contents: contents,
            config: {
                ...config.modelConfig,
                tools: config.tools
            }
        });
        
        const usage = result.usageMetadata;
        
        // --- DYNAMIC COST CALCULATION ---
        let inputCost, outputCost;
        if (modelToUse.includes('pro')) {
            // Gemini 3 Pro Rates (Example)
            inputCost = (usage?.promptTokenCount || 0) * 0.000002;  // $2.00 per 1M
            outputCost = (usage?.candidatesTokenCount || 0) * 0.000012; // $12.00 per 1M
        } else {
            // Gemini Flash Rates (Example, ~10x cheaper)
            inputCost = (usage?.promptTokenCount || 0) * 0.0000002;
            outputCost = (usage?.candidatesTokenCount || 0) * 0.0000012;
        }
        const cost = inputCost + outputCost;

        const isSafetyRefusal = result.candidates?.[0].finishReason === FinishReason.SAFETY;

        return {
            content: result.text || null,
            functionCalls: result.functionCalls,
            isSafetyRefusal: isSafetyRefusal,
            model: modelToUse,
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