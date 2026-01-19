
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
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:streamGenerateContent?key=${this.apiKey}&alt=sse`;
    
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
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('text/event-stream')) {
          const data = await response.json();
          if (data.promptFeedback) {
              return {
                  content: `[SYSTEM] Content Blocked by Filters. (Reason: ${JSON.stringify(data.promptFeedback.blockReason)})`,
                  isSafetyRefusal: true,
                  model: modelToUse,
                  usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, timestamp: new Date() }
              };
          }
          throw new Error("Expected a stream response, but got a single JSON object without safety feedback.");
      }

      if (!response.body) {
        throw new Error("Streaming response body is null.");
      }

      let aggregatedText = "";
      let aggregatedFunctionCalls: any[] = [];
      let isRefusal = false;
      let finalUsage = { inputTokens: 0, outputTokens: 0 };

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
              if (part.startsWith('data: ')) {
                  const jsonStr = part.substring(6);
                  try {
                      const chunk = JSON.parse(jsonStr);

                      if (chunk.candidates && chunk.candidates.length > 0) {
                          const candidate = chunk.candidates[0];

                          if (candidate.finishReason === 'SAFETY') {
                              isRefusal = true;
                          }
                          
                          if (candidate.content?.parts) {
                              for(const p of candidate.content.parts) {
                                  if(p.text) {
                                      aggregatedText += p.text;
                                  }
                                  if(p.functionCall) {
                                      aggregatedFunctionCalls.push(p.functionCall);
                                  }
                              }
                          }
                      }
                      
                      if(chunk.usageMetadata) {
                          finalUsage.inputTokens = chunk.usageMetadata.promptTokenCount;
                          finalUsage.outputTokens = chunk.usageMetadata.candidatesTokenCount;
                      }

                  } catch (e) {
                      console.warn("Failed to parse stream chunk:", jsonStr, e);
                  }
              }
          }
      }
      
      return {
        content: aggregatedText || null,
        functionCalls: aggregatedFunctionCalls.length > 0 ? aggregatedFunctionCalls : undefined,
        isSafetyRefusal: isRefusal,
        model: modelToUse,
        usage: {
            inputTokens: finalUsage.inputTokens,
            outputTokens: finalUsage.outputTokens,
            estimatedCostUsd: 0,
            timestamp: new Date()
        }
      };

    } catch (error: any) {
      console.error("Gemini Provider Error:", error);
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
