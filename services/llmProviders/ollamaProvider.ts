
import { ILLMProvider, LLMResponse } from "./ILLMProvider";
import { Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";

export class OllamaProvider implements ILLMProvider {
  name = "Ollama";
  type = 'compute-based' as const;
  private baseURL: string;
  private model: string;
  private embeddingModel: string;

  constructor(baseURL: string = "http://localhost:11434", model: string = "gemma:2b", embeddingModel: string = "nomic-embed-text") {
    this.baseURL = baseURL;
    this.model = model;
    this.embeddingModel = embeddingModel;
  }

  async generateResponse(
    contents: Content[], 
    config: { 
        tools?: Tool[]; 
        modelConfig?: ModelConfig 
    }
  ): Promise<LLMResponse> {

    // Map Google GenAI Content to Ollama Messages
    const messages = contents.map(c => {
        const text = c.parts.map(p => 'text' in p ? p.text : '').join('\n');
        return {
            role: c.role === 'model' ? 'assistant' : 'user',
            content: text
        };
    });

    try {
        const response = await fetch(`${this.baseURL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: this.model,
                messages: messages,
                stream: false,
                options: {
                    temperature: config.modelConfig?.temperature ?? 0.7,
                    top_p: config.modelConfig?.topP ?? 0.9,
                    top_k: config.modelConfig?.topK ?? 40
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama Error: ${response.statusText}`);
        }

        const data = await response.json();
        
        const inputTokens = data.prompt_eval_count || 0;
        const outputTokens = data.eval_count || 0;

        return {
            content: data.message?.content || "",
            isSafetyRefusal: false, 
            functionCalls: undefined, 
            model: data.model,
            usage: {
                inputTokens,
                outputTokens,
                estimatedCostUsd: 0,
                timestamp: new Date()
            }
        };

    } catch (e: any) {
        console.error("Ollama Provider Error", e);
        throw new Error(`Ollama Connection Failed: ${e.message}`);
    }
  }

  /**
   * Generates embeddings using the local Ollama instance.
   * Default model: nomic-embed-text
   */
  async embed(text: string): Promise<number[]> {
      try {
          const response = await fetch(`${this.baseURL}/api/embeddings`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                  model: this.embeddingModel,
                  prompt: text
              })
          });

          if (!response.ok) {
              throw new Error(`Ollama Embedding Error: ${response.statusText}`);
          }

          const data = await response.json();
          return data.embedding;
      } catch (e: any) {
          console.error("Ollama Embedding Failed", e);
          throw new Error(`Local Embedding Failed: ${e.message}. Ensure 'ollama pull ${this.embeddingModel}' has been run.`);
      }
  }
}
