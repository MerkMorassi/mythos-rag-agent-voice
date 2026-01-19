
import { ILLMProvider, LLMResponse } from './ILLMProvider';
import { GoogleGenAI, Content, Tool, GenerateContentResponse } from "@google/genai";
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

  async generateResponse(
      contents: Content[], 
      config: { 
          tools?: Tool[]; 
          modelConfig?: ModelConfig 
      }
  ): Promise<LLMResponse> {
    
    const lastUserContent = contents.filter(c => c.role === 'user').pop();
    const query = lastUserContent?.parts.find((p): p is { text: string } => 'text' in p)?.text || '';
    const modelToUse = ModelGate.selectModel(query);
    
    try {
      const ai = new GoogleGenAI({ apiKey: this.apiKey });

      const streamResult = await ai.models.generateContentStream({
        model: modelToUse,
        contents: contents,
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
        ],
        generationConfig: config.modelConfig,
        tools: config.tools
      });

      let aggregatedText = "";
      let aggregatedFunctionCalls: any[] = [];
      let isRefusal = false;
      let finalUsage = { inputTokens: 0, outputTokens: 0 };

      for await (const chunk of streamResult) {
        const response = chunk as GenerateContentResponse;
        
        if (response.text) {
            aggregatedText += response.text;
        }
        
        if (response.functionCalls && response.functionCalls.length > 0) {
            aggregatedFunctionCalls.push(...response.functionCalls);
        }

        const candidate = response.candidates?.[0];
        if (candidate?.finishReason === 'SAFETY') {
            isRefusal = true;
        }

        if (response.usageMetadata) {
            finalUsage.inputTokens = response.usageMetadata.promptTokenCount;
            finalUsage.outputTokens = response.usageMetadata.candidatesTokenCount;
        }
      }

      // Final check on the aggregated response for safety feedback, in case it wasn't in a chunk.
      const aggregatedResponse = await streamResult.response;
      if (aggregatedResponse?.promptFeedback?.blockReason) {
        isRefusal = true;
        aggregatedText = `[SYSTEM] Content Blocked by Filters. (Reason: ${aggregatedResponse.promptFeedback.blockReason})`;
      }

      return {
        content: aggregatedText || null,
        functionCalls: aggregatedFunctionCalls.length > 0 ? aggregatedFunctionCalls : undefined,
        isSafetyRefusal: isRefusal,
        model: modelToUse,
        usage: {
            inputTokens: finalUsage.inputTokens,
            outputTokens: finalUsage.outputTokens,
            estimatedCostUsd: 0, // SDK does not provide cost.
            timestamp: new Date()
        }
      };

    } catch (error: any) {
        console.error("Gemini Provider Error (SDK):", error);
        
        // Handle specific safety errors from the SDK
        if (error.message && error.message.includes('SAFETY')) {
            return {
                content: `[SYSTEM] Content Blocked by Filters. (Reason: ${error.message})`,
                isSafetyRefusal: true,
                model: modelToUse,
                usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, timestamp: new Date() }
            };
        }
        
        throw error;
    }
  }

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
