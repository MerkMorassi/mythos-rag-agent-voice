// FIX: ModelConfig is a local type, not from @google/genai.
import { Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  timestamp: Date;
}

export interface LLMResponse {
    content: string | null;
    functionCalls?: any;
    usage: UsageRecord;
    isSafetyRefusal: boolean;
}

export interface ILLMProvider {
  readonly name: string;
  readonly type: 'token-based' | 'compute-based';
  
  generateResponse(
      contents: Content[], 
      config: { 
          tools?: Tool[]; 
          modelConfig?: ModelConfig 
      }
  ): Promise<LLMResponse>;
}