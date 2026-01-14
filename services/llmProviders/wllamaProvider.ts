import { ILLMProvider, LLMResponse } from "./ILLMProvider";
import { Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";

const buildPrompt = (contents: Content[]) =>
  contents
    .map((content) => {
      const textPart = content.parts.find((part) => "text" in part);
      const label = content.role === "model" ? "Assistant" : "User";
      return `${label}: ${textPart?.text ?? ""}`.trim();
    })
    .join("\n");

export class WllamaProvider implements ILLMProvider {
  name = "wllama";
  type = "compute-based" as const;
  private modelUrl: string;
  private contextSize: number;
  private modelPromise: Promise<any> | null = null;

  constructor(modelUrl: string, contextSize: number = 2048) {
    this.modelUrl = modelUrl;
    this.contextSize = contextSize;
  }

  private async getModel(): Promise<any> {
    if (!this.modelPromise) {
      const { Wllama } = await import("wllama");
      const instance = new Wllama({
        n_ctx: this.contextSize,
        verbose: true,
      });
      this.modelPromise = instance
        .loadModelFromUrl(this.modelUrl)
        .then(() => instance);
    }

    return this.modelPromise;
  }

  async generateResponse(
    contents: Content[],
    config: {
      tools?: Tool[];
      modelConfig?: ModelConfig;
    }
  ): Promise<LLMResponse> {
    const model = await this.getModel();
    const prompt = buildPrompt(contents);

    const completion = await model.createCompletion({
      prompt,
      nPredict: 512,
      temperature: config.modelConfig?.temperature ?? 0.7,
      top_p: config.modelConfig?.topP ?? 0.9,
      stop: ["User:", "Assistant:"],
    });

    const content = completion?.text ?? "";

    return {
      content,
      functionCalls: undefined,
      isSafetyRefusal: false,
      model: this.name,
      usage: {
        inputTokens: completion?.tokens ?? 0,
        outputTokens: completion?.tokens ?? 0,
        estimatedCostUsd: 0,
        timestamp: new Date(),
      },
    };
  }
}
