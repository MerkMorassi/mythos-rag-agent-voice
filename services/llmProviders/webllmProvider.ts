import { ILLMProvider, LLMResponse } from "./ILLMProvider";
import { Content, Tool } from "@google/genai";
import { ModelConfig } from "../../types";

let enginePromise: Promise<any> | null = null;

const buildMessages = (contents: Content[]) =>
  contents.map((content) => {
    const textPart = content.parts.find((part) => "text" in part);
    return {
      role: content.role === "model" ? "assistant" : "user",
      content: textPart?.text ?? "",
    };
  });

export class WebLLMProvider implements ILLMProvider {
  name = "WebLLM";
  type = "compute-based" as const;
  private modelId: string;

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  private async getEngine(): Promise<any> {
    if (!enginePromise) {
      const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
      enginePromise = CreateMLCEngine(this.modelId, {
        initProgressCallback: (report: { text: string }) => {
          console.info(`[WebLLM] ${report.text}`);
        },
      });
    }

    return enginePromise;
  }

  async generateResponse(
    contents: Content[],
    config: {
      tools?: Tool[];
      modelConfig?: ModelConfig;
    }
  ): Promise<LLMResponse> {
    const engine = await this.getEngine();
    const messages = buildMessages(contents);

    const response = await engine.chat.completions.create({
      messages,
      stream: false,
      temperature: config.modelConfig?.temperature,
      top_p: config.modelConfig?.topP,
    });

    const content = response?.choices?.[0]?.message?.content ?? "";
    const usage = response?.usage ?? {};

    return {
      content,
      functionCalls: undefined,
      isSafetyRefusal: false,
      model: this.modelId,
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        estimatedCostUsd: 0,
        timestamp: new Date(),
      },
    };
  }
}
