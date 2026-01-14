# WebGPU LLM (Browser-Only) Plan

This project can be extended to run a local LLM **entirely in the browser** using WebGPU, with **Gemini as the primary model** for safe tasks and **WebGPU (Mistral Dolphin/Venice-style) as the fallback** for sensitive/explicit content that Gemini refuses. The goal is to keep everything client-side where possible (no server, no API keys required for local inference), while still supporting a hosted primary for reliability and tool access.

## What this enables

- **Gemini-first responses** for safe content.
- **Sensitive-content fallback** to an uncensored local model for prompt creation.
- **Offline-capable chat** in the browser using WebGPU.
- **Streaming responses** via the WebLLM OpenAI-style API.
- **Optional GGUF/WASM fallback** (wllama) for devices without WebGPU.

## Recommended stack

- **Primary (hosted):** Gemini (already integrated in this repo).
- **WebGPU fallback:** [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm)
- **WASM fallback (GGUF):** [`wllama`](https://github.com/ngxson/wllama)

## Model expectations

WebLLM runs models that are compiled to MLC format. You cannot load an arbitrary GGUF directly into WebLLM. If you want **Dolphin Mistral / Venice AI** locally, you have two options:

1. **Use WebLLM-compatible models** (MLC format) that are close to your target (e.g., Mistral 7B / Dolphin-tuned variants built for MLC).
2. **Use GGUF via WASM** with wllama (slower than WebGPU, but supports more GGUF variants).

## High-level implementation plan

### 1) Add WebLLM dependency

```bash
npm install @mlc-ai/web-llm
```

### 2) Add a local provider (new file)

Create a new provider, `services/llmProviders/webllmProvider.ts`, that implements `ILLMProvider`. It should:

- Initialize a WebLLM engine once.
- Load a model from the WebLLM model registry.
- Stream tokens into the UI.
- Return `LLMResponse` in the same shape used by other providers.

### 3) Detect WebGPU support

In the browser, check:

```ts
const hasWebGPU = !!navigator.gpu;
```

If `false`, fall back to wllama.

### 4) Gemini-first routing with sensitive-content fallback

Use Gemini by default for safe content. When Gemini refuses or when a request is explicitly flagged as sensitive/explicit, route to the uncensored local model to generate the **prompt only**, then pass that prompt to the specialized downstream service (SDXL, WAN 2.x, etc.). The fallback model should not execute the downstream pipeline itself.

1. Attempt Gemini response for safe requests.
2. If Gemini refuses or the request is sensitive/explicit, route to WebLLM (Mistral Dolphin/Venice-style) **for prompt generation only**.
3. Send the generated prompt to the appropriate uncensored image/video service.
4. If WebGPU is unavailable or fails, fall back to wllama (GGUF).

### 5) Add wllama as a GGUF fallback (optional)

Install and integrate wllama:

```bash
npm install wllama
```

Use it only when WebGPU is unavailable or when a specific GGUF model is required.

## Practical model notes

- **Mistral Dolphin (Venice AI)** is usually released as GGUF (for llama.cpp). You will need a **WebLLM-compatible build** or use the **wllama GGUF fallback**.
- WebLLM includes a **model registry** you can use directly without conversion. For best results, start with a supported Mistral or Llama variant and confirm GPU stability.
- For the **lightest uncensored fallback**, prefer the **smallest viable model size** (e.g., 2B–7B class) with aggressive quantization so it stays responsive in-browser.

### Smallest uncensored fallback recommendation

If you want the **absolute smallest uncensored model**, a common pick is **dolphin-phi** (Phi-based, ~2.7B). It is typically distributed as **GGUF**, so in this browser-only plan it maps to the **wllama WASM fallback**, not WebLLM. The same model can be run with `ollama run dolphin-phi`, but Ollama is a local server runtime (not in-browser), so it is **not** the browser path described here.

**Browser-oriented guidance:**

- Prefer **dolphin-phi GGUF** with wllama for the smallest uncensored prompt-only fallback.
- Keep **WebLLM** for supported MLC models (fast WebGPU) when the model exists in the registry.

## Why Gemini as primary

Gemini remains the safest and easiest primary because:

- It already powers this app.
- It supports embeddings and tool calling already in the codebase.
- It provides strong latency and reliability when local execution is unavailable.

## Wired-in behavior in this repo

This repo now wires the routing in **Gemini → WebLLM → wllama** order for sensitive prompts or Gemini safety refusals:

1. **WebLLM provider** for WebGPU-capable browsers.
2. **Gemini-first routing** with a **sensitive-content fallback** to WebGPU (Gemini → WebLLM → wllama).
3. **Capability check** for WebGPU availability via `!!navigator.gpu`.
4. **Prompt-only** pathway that can hand off to SDXL/WAN 2.x or another uncensored service.

### Local configuration keys

You can tune the local fallback without code changes by setting these in the browser console:

```js
localStorage.setItem('webllm_model_id', 'Llama-3.2-3B-Instruct-q4f16_1');
localStorage.setItem('wllama_model_url', 'https://your-hosted-models/dolphin-phi.gguf');
```
