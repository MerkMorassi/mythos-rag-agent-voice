# MythOS COMMS - Local Setup

This is a Vite-based React application for real-time voice conversations with Gemini, grounded in a local knowledge base.

## Prerequisites

- **Node.js and npm:** You must have Node.js (which includes npm) installed on your machine.

## 1. Setup

First, open your terminal in the project's root directory and install the necessary dependencies by running:

```bash
npm install
```

## 2. Environment Configuration

Next, create a file named `.env` in the root of the project. This file will hold your secret API keys. Add your Google Gemini API key and your Hugging Face token to it like this:

```
# .env file
API_KEY="AIza..."
HF_TOKEN="hf_..."
```

*The application is pre-configured to read these variables automatically.*
*Alternatively, you can enter these keys in the application's **Settings** panel.*

## 3. Running the Application

To start the local development server on **port 4000**, run the following command in your terminal:

```bash
npm start
```

This command executes the `start` script defined in `package.json`, which launches the Vite server. Your default web browser should open automatically to `http://localhost:4000`.

## 4. WebGPU LLM (Browser-Only) plan

If you want to run **local, offline LLM inference in the browser** (no server, no API keys), see the WebGPU LLM plan:

- [`docs/webgpu-llm.md`](docs/webgpu-llm.md)

That guide outlines how to keep Gemini as the primary model while falling back to a light, uncensored WebGPU (and optional GGUF/WASM) model for sensitive/explicit prompt generation, including the smallest viable GGUF options such as dolphin-phi.
