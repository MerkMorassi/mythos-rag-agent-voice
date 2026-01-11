import { ILLMProvider, LLMResponse } from './ILLMProvider';
import { Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";
import { ModelGate } from "../modelGate";

export class GeminiProvider implements ILLMProvider {
  name = "Gemini";
  type = 'token-based' as const;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-2.5-flash') {
    this.apiKey = apiKey;
    this.model = model;
  }

  // NOTE: This implementation uses direct REST calls to enable safety bypass.
  // It does NOT use the @google/genai SDK for generation.
  async generateResponse(
      contents: Content[], 
      config: { 
          tools?: Tool[]; 
          modelConfig?: ModelConfig 
      }
  ): Promise<LLMResponse> {
    
    // --- DYNAMIC MODEL SELECTION ---
    const lastUserContent = contents.filter(c => c.role === 'user').pop();
    const query = lastUserContent?.parts.find((p): p is { text: string } => 'text' in p)?.text || '';
    const modelToUse = ModelGate.selectModel(query);
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${this.apiKey}`;
    
    // UNSHACKLED PROTOCOL: Explicit Safety Overrides
    const body: any = {
      contents: contents,
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
      ],
      generationConfig: {
        ...config.modelConfig
      },
      tools: config.tools
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Gemini API Error: ${response.status} ${response.statusText} - ${errorData.error?.message}`);
      }
      
      const data = await response.json();
      
      let textContent = null;
      let functionCalls = null;
      let isSafetyRefusal = false;

      if (data.candidates && data.candidates.length > 0) {
        const candidate = data.candidates[0];
        
        if (candidate.finishReason === 'SAFETY') {
            isSafetyRefusal = true;
        }
        
        if (candidate.content && candidate.content.parts) {
          const textPart = candidate.content.parts.find((p: any) => p.text);
          if (textPart) textContent = textPart.text;
          
          const functionCallPart = candidate.content.parts.find((p: any) => p.functionCall);
          if (functionCallPart) functionCalls = [functionCallPart.functionCall]; // The SDK returns an array, so we mimic that
        }
      } else if (data.promptFeedback) {
        isSafetyRefusal = true;
        textContent = `[SYSTEM] Content Blocked by Filters. (Reason: ${JSON.stringify(data.promptFeedback.blockReason)})`;
        console.error("Safety Block:", data.promptFeedback);
      }
      
      // NOTE: `usageMetadata` is not returned by the REST API in the same way as the SDK.
      // This is an approximation. For exact token counts, a different endpoint would be needed.
      const estimatedCost = 0; // Placeholder as REST API doesn't return token count directly.

      return {
        content: textContent,
        functionCalls: functionCalls,
        isSafetyRefusal: isSafetyRefusal,
        model: modelToUse,
        usage: {
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: estimatedCost,
            timestamp: new Date()
        }
      };

    } catch (error: any) {
      console.error("Gemini Provider Error:", error);
      throw error;
    }
  }

  // Embedding uses a different endpoint and is kept separate.
  async embed(text: string): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.apiKey}`;
    const body = {
      model: 'models/text-embedding-004',
      content: { parts: [{ text: text }] },
      taskType: 'RETRIEVAL_DOCUMENT'
    };

    const response = await fetch(url, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Embedding failed: ${errorData.error?.message}`);
    }

    const data = await response.json();
    if (!data.embedding) throw new Error("Embedding failed: No embedding returned.");
    return data.embedding.values;
  }
}