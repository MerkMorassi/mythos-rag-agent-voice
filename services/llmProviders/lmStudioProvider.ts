
import { ILLMProvider, LLMResponse } from "./ILLMProvider";
import { Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";
import OpenAI from "openai";

/**
 * LM Studio Provider
 * Connects to a local LM Studio instance using its OpenAI-compatible API.
 */
export class LmStudioProvider implements ILLMProvider {
  name = "LM Studio";
  type = 'compute-based' as const;
  private openai: OpenAI;
  private model: string;
  private baseURL: string;

  constructor(baseURL: string = "http://192.168.56.1:1234", model: string = "local-model") {
    this.baseURL = baseURL;
    this.openai = new OpenAI({
      baseURL: `${baseURL}/v1`,
      apiKey: "not-needed", // API key is not required for local LM Studio
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
          functionCalls: undefined, // LM Studio's OpenAI endpoint doesn't support tools by default.
          model: completion.model, // Will return the model file name from LM Studio
          usage: {
            inputTokens: usage?.prompt_tokens || 0,
            outputTokens: usage?.completion_tokens || 0,
            estimatedCostUsd: 0,
            timestamp: new Date(),
          },
        };
    } catch (e: any) {
        console.error("LM Studio Provider Error:", e);
        throw new Error(`LM Studio Connection Failed: ${e.message}. Is the server running at ${this.baseURL}?`);
    }
  }
  
  /**
   * Generates embeddings using the local LM Studio instance.
   * Assumes an embedding model (like nomic-embed-text) is loaded.
   */
  async embed(text: string): Promise<number[]> {
      try {
          const response = await this.openai.embeddings.create({
            model: "nomic-embed-text", // A common embedding model to use with LM Studio
            input: text,
          });

          return response.data[0].embedding;
      } catch (e: any) {
          console.error("LM Studio Embedding Failed", e);
          throw new Error(`Local Embedding Failed: ${e.message}. Ensure an embedding model is loaded in LM Studio at ${this.baseURL}.`);
      }
  }
}
