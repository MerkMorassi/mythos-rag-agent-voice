---
title: MythOS RAG Voice
emoji: 🌌
colorFrom: indigo
colorTo: purple
sdk: docker
pinned: false
---

# MythOS RAG Voice

Real-time voice conversation with Gemini 2.5, grounded in your own local knowledge base and visual input.
Supports model offloading to **Dolphin 2.9.4 Llama 3.1 8B** for specialized/uncensored tasks.

## 🚀 Setup on Hugging Face Spaces (Docker)

1.  **Create Space**:
    *   Click **New Space**.
    *   Select **Docker** as the SDK.
    *   Choose "Blank" or clone this repo directly.

2.  **Configure Secrets (Settings -> Variables and secrets)**:
    *   `API_KEY`: Your **Google Gemini API Key**.
    *   `HF_TOKEN`: Your **Hugging Face Access Token** (Read).
        *   *Required to query the Llama Dolphin model via the Inference API.*
    *   `OPENL_API_KEY`: (Optional) Your **OpenL.io API Key** for Ancient Greek translation tools.

3.  **Deploy**:
    *   The Space will build automatically using the `Dockerfile`.
    *   Once "Running", open the App URL.

## 🧠 Features

-   **Gemini Live API**: Low latency voice interaction.
-   **RAG**: Drag & drop .txt/.md/.json files to chat with them (Stored in Browser IndexedDB).
-   **Vision**: Real-time camera stream analysis.
-   **Uncensored Router**: Agents can offload restrictive or creative tasks to the Dolphin model via the `routeRequest` tool.

## 🛠️ Local Development

1.  `npm install`
2.  Create `.env`:
    ```
    API_KEY=your_gemini_key
    HF_TOKEN=your_hf_token
    OPENL_API_KEY=your_openl_key
    ```
3.  `npm run dev`
