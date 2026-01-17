
import { ILLMProvider, LLMResponse } from "./ILLMProvider";
import { Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";
import OpenAI from "openai";

/**
 * Ollama Provider
 * Connects to a local Ollama instance using its OpenAI-compatible API.
 */
export class OllamaProvider implements ILLMProvider {
  name = "Ollama";
  type = 'compute-based' as const;
  private openai: OpenAI;
  private model: string;
  private baseURL: string;

  constructor(baseURL: string = "http://localhost:11434", model: string = "llama3") {
    this.baseURL = baseURL;
    // Ollama's OpenAI endpoint is at /v1
    this.openai = new OpenAI({
      baseURL: `${baseURL}/v1`,
      apiKey: "ollama", // Required by the OpenAI client, but not used by Ollama
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

    try {
        const completion = await this.openai.chat.completions.create({
          model: this.model,
          messages: messages,
          temperature: config.modelConfig?.temperature ?? 0.7,
        });

        const usage = completion.usage;

        return {
          content: completion.choices[0].message.content || "",
          isSafetyRefusal: false,
          functionCalls: undefined, // Ollama's OpenAI endpoint doesn't support tools by default in this configuration.
          model: completion.model, // Will return the model name from Ollama
          usage: {
            inputTokens: usage?.prompt_tokens || 0,
            outputTokens: usage?.completion_tokens || 0,
            estimatedCostUsd: 0,
            timestamp: new Date(),
          },
        };
    } catch (e: any) {
        console.error("Ollama Provider Error:", e);
        throw new Error(`Ollama Connection Failed: ${e.message}. Is the server running at ${this.baseURL}?`);
    }
  }

  /**
   * Generates embeddings using the local Ollama instance.
   * Assumes an embedding model (like nomic-embed-text) is available.
   */
  async embed(text: string): Promise<number[]> {
      try {
          const response = await this.openai.embeddings.create({
            model: "nomic-embed-text", // A common embedding model to use with Ollama
            input: text,
          });

          return response.data[0].embedding;
      } catch (e: any) {
          console.error("Ollama Embedding Failed", e);
          throw new Error(`Local Embedding Failed: ${e.message}. Ensure an embedding model is available in Ollama at ${this.baseURL}.`);
      }
  }
}
