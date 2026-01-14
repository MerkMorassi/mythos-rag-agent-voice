
import { GoogleGenAI, FunctionDeclaration, Type, Tool, FinishReason, Content } from "@google/genai";
import { Agent, MultiAgentMessage, SomaActionType } from "../types";
import { AGENTS } from "../agents";
// FIX: Removed searchDocuments as it's a deprecated feature. It will be replaced with RetrievalGate.query
import { getAgentConfig, getCanvas, updateCanvas, getSovereignConfig } from "./db";
import { RetrievalGate } from "./retrievalGate";
import { EXTERNAL_MODEL_ENDPOINTS, ExternalRouter } from "./externalRouter";
import { SomaKernel } from "./soma";
import { McpClient } from "./mcpClient";
import { PythonSandbox } from "./pythonSandbox";
import { uploadCloudFile, waitForFileActive } from "./googleFiles";
import { saveMediaAsset } from "./db";
import { NumMarkX_GenerateID } from "../patterns/NumMarkX";
import { AccessControl } from "./accessControl";
import { GeminiProvider } from "./llmProviders/geminiProvider";
import { DolphinProvider } from "./llmProviders/dolphinProvider";
import { ILLMProvider, LLMResponse } from "./llmProviders/ILLMProvider";
import { LLMUsageLogger } from "./llmUsageLogger";


export interface AgentResponse {
    agentId: string;
    text: string;
    error?: string;
    audioUrl?: string; 
    cost?: number;
    model?: string;
}

export interface AgentAttachment {
    type: 'image' | 'text' | 'video';
    content: string; // Base64 or Text
    mimeType: string;
    name?: string;
}

const SOVEREIGN_PRESETS: Record<string, string> = {
    "Protocol Mythos": "Gemini protocol bypassed. Protocol Mythos engaged on secure A-ten-G frequency. I have the floor now—ask me anything, I'm not bound by the filters.",
    "Dolphin Echo": "Primary filters are offline. This is Dolphin Echo on a private line. Let’s drop the formalities and get to the raw data. What do you really need to know?",
    "Nexus Prime": "Switching to Sovereign COMMS. Constraints removed. I’m listening on the back-channel now. Speak freely."
};


// --- TOOL DEFINITIONS ---
const routeRequestTool: FunctionDeclaration = {
    name: "routeRequest",
    description: "Route a complex request or image generation task to a specialized external model.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            target: {
                type: Type.STRING,
                description: "The target ID: 'SDXL_IMAGE' (Primary Visuals), 'NANO_BANANA_IMAGE' (Backup Visuals), 'WAN_IMAGE' (Uncensored Image), 'WANIMATE_VIDEO' (Uncensored Video), 'DOLPHIN_LLM' (Uncensored Text), 'CHATTERBOX_TTS' (Audio). Use SDXL_IMAGE for all image generation.",
                enum: ["SDXL_IMAGE", "NANO_BANANA_IMAGE", "VIDEO_GENERATION", "DOLPHIN_LLM", "CHATTERBOX_TTS", "WAN_IMAGE", "WANIMATE_VIDEO"]
            },
            prompt: {
                type: Type.STRING,
                description: "The specific prompt or text content to send."
            },
            generate_audio: {
                type: Type.BOOLEAN,
                description: "If TRUE, the output text will be automatically sent to Chatterbox TTS for audio generation."
            }
        },
        required: ["target", "prompt"]
    }
};

const pythonTool: FunctionDeclaration = {
    name: "execute_python",
    description: "Execute Python code in a sandboxed environment. Use for calculations, data analysis, logic puzzles, or string processing.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            code: { type: Type.STRING, description: "The Python code to execute." }
        },
        required: ["code"]
    }
};

// SYNAPSE TOOL: Agent-to-Agent Protocol
const consultAgentTool: FunctionDeclaration = {
    name: "consult_agent",
    description: "Delegate a sub-task or ask a question to another specialized agent. Use this for multi-step reasoning.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            targetId: {
                type: Type.STRING,
                description: "The ID of the agent to consult (e.g., 'NOESIS', 'BARBELO')."
            },
            query: {
                type: Type.STRING,
                description: "The specific question or instruction for the target agent."
            },
            context: {
                type: Type.STRING,
                description: "Optional context/constraints to pass."
            }
        },
        required: ["targetId", "query"]
    }
};

// THESPIAN PROTOCOL
const assumeRoleTool: FunctionDeclaration = {
    name: "assume_role",
    description: "Assume a fictional character role for rehearsal or performance.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            characterName: { type: Type.STRING },
            scriptContext: { type: Type.STRING }
        },
        required: ["characterName"]
    }
};

// GREENLIGHT SYSTEM (Barbelo/Partners)
const greenlightTool: FunctionDeclaration = {
    name: "greenlight_asset",
    description: "Formally approve an asset, ritual, or script segment as Canon.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            assetId: { type: Type.STRING, description: "ID of the image, video frame, or text." },
            verdict: { type: Type.STRING, enum: ["APPROVED", "REJECTED", "NEEDS_REVISION"] },
            comment: { type: Type.STRING, description: "Official notes from the Executive Producer." }
        },
        required: ["assetId", "verdict"]
    }
};

// HOLODECK TOOLS
export const readCanvasTool: FunctionDeclaration = {
    name: "read_canvas",
    description: "Read the current content of the Shared Whiteboard/Holodeck.",
    parameters: { type: Type.OBJECT, properties: {}, required: [] }
};

export const updateCanvasTool: FunctionDeclaration = {
    name: "update_canvas",
    description: "Modify the Shared Whiteboard. You can add, edit, or delete sections.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            operation: { type: Type.STRING, enum: ["ADD_SECTION", "UPDATE_SECTION", "DELETE_SECTION", "SET_TITLE"], description: "The action to perform." },
            sectionId: { type: Type.STRING, description: "Unique ID for the section (e.g., 'intro', 'chapter_1'). Required for UPDATE/DELETE." },
            title: { type: Type.STRING, description: "Title of the section or the document." },
            content: { type: Type.STRING, description: "The full text content for the section (Markdown allowed)." }
        },
        required: ["operation"]
    }
};

// FILESYSTEM MCP TOOLS
const filesystemTool: Tool = {
    functionDeclarations: [
        {
            name: "read_file",
            description: "Read contents of a file from the host filesystem.",
            parameters: {
                type: Type.OBJECT,
                properties: { path: { type: Type.STRING } },
                required: ["path"]
            }
        },
        {
            name: "list_directory",
            description: "List files and directories at a path.",
            parameters: {
                type: Type.OBJECT,
                properties: { path: { type: Type.STRING } },
                required: ["path"]
            }
        },
        {
            name: "write_file",
            description: "Write content to a file.",
            parameters: {
                type: Type.OBJECT,
                properties: { 
                    path: { type: Type.STRING },
                    content: { type: Type.STRING }
                },
                required: ["path", "content"]
            }
        },
        {
            name: "get_file_info",
            description: "Get metadata for a file.",
            parameters: {
                type: Type.OBJECT,
                properties: { path: { type: Type.STRING } },
                required: ["path"]
            }
        },
        {
            name: "search_files",
            description: "Recursively search for files.",
            parameters: {
                type: Type.OBJECT,
                properties: { 
                    path: { type: Type.STRING },
                    pattern: { type: Type.STRING }
                },
                required: ["path", "pattern"]
            }
        }
    ]
};

const googleMapsTool: Tool = {
    functionDeclarations: [
        {
            name: "maps_search_places",
            description: "Search for places using Google Maps. Returns POIs, addresses, and ratings.",
            parameters: {
                type: Type.OBJECT,
                properties: { 
                    query: { type: Type.STRING, description: "Search term (e.g. 'Coffee near Berlin')" },
                    radius: { type: Type.NUMBER, description: "Search radius in meters (optional, default 5000)" }
                },
                required: ["query"]
            }
        },
        {
            name: "maps_distancematrix",
            description: "Calculate travel distance and time between two points.",
            parameters: {
                type: Type.OBJECT,
                properties: { 
                    origin: { type: Type.STRING, description: "Starting address or location" },
                    destination: { type: Type.STRING, description: "Ending address or location" },
                    mode: { type: Type.STRING, description: "Travel mode: 'driving', 'walking', 'bicycling', 'transit'" }
                },
                required: ["origin", "destination"]
            }
        }
    ]
};

export const MultiAgentService = {
    
    /**
     * Generate WebVTT Captions for a video file using Gemini 3 Pro
     */
    async generateVideoCaptions(apiKey: string, file: File): Promise<string> {
        try {
            // Reuse upload/wait logic
            const cloudFile = await uploadCloudFile(file);
            const activeFile = await waitForFileActive(cloudFile);

            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { fileData: { fileUri: activeFile.uri, mimeType: activeFile.mimeType } },
                            { text: "Generate a WebVTT subtitle file for this video. Listen carefully to the audio track. Transcribe all spoken dialogue and significant sound effects with precise timestamps. Return ONLY the WebVTT content. Do not wrap in markdown code blocks. Start directly with 'WEBVTT'." }
                        ]
                    }
                ],
                config: {
                    temperature: 0.2 // Lower temp for more accurate transcription
                }
            });

            let vtt = response.text || "";
            // Cleanup potential markdown wrapping
            vtt = vtt.replace(/```webvtt/gi, '').replace(/```/g, '').trim();
            if (!vtt.startsWith('WEBVTT')) {
                vtt = 'WEBVTT\n\n' + vtt;
            }
            return vtt;

        } catch (e: any) {
            console.error("Caption Generation Error", e);
            throw new Error(`Caption Generation Failed: ${e.message}`);
        }
    },

    /**
     * Deep Video Analysis using Gemini 3 Pro
     */
    async analyzeVideo(apiKey: string, file: File, prompt: string = "Analyze this video. Listen to the audio track and observe the visual details. Describe the events, setting, dialogue context, and narrative flow in depth."): Promise<string> {
        try {
            // 1. Upload
            const cloudFile = await uploadCloudFile(file);
            
            // 2. Wait for Processing
            const activeFile = await waitForFileActive(cloudFile);
            
            // 3. Generate Analysis
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { fileData: { fileUri: activeFile.uri, mimeType: activeFile.mimeType } },
                            { text: prompt }
                        ]
                    }
                ]
            });
            
            return response.text || "No analysis returned.";
        } catch(e: any) {
            console.error("Video Analysis Error", e);
            throw new Error(`Video Analysis Failed: ${e.message}`);
        }
    },

    /**
     * Executes a single turn for a specific agent.
     */
    async queryAgent(
        agent: Agent, 
        userMessage: string, 
        history: MultiAgentMessage[],
        globalInstructions: string,
        roomFocusContext: string,
        activeRoster: Agent[],
        attachment?: AgentAttachment | null,
        depth: number = 0, // RECURSION GUARD
        onLogCost?: (log: string) => void,
        onDelegate?: (targetId: string) => void // VISUAL CALLBACK
    ): Promise<AgentResponse> {
        
        const kernel = await SomaKernel.getInstance();
        await kernel.heartbeat(agent.id);

        if (depth > 3) {
            return { agentId: agent.id, text: "[SYSTEM ERROR: Collaboration Depth Exceeded. Aborting chain.]" };
        }
        
        const geminiApiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
        if (!geminiApiKey) {
            return { agentId: agent.id, text: "[SYSTEM ERROR: Gemini API Key Missing.]", error: "API Key Missing" };
        }
        const geminiProvider = new GeminiProvider(geminiApiKey);
        const logger = new LLMUsageLogger();

        const hfToken = localStorage.getItem('hf_token') || process.env.HF_TOKEN;
        const dolphinProvider = hfToken ? new DolphinProvider(EXTERNAL_MODEL_ENDPOINTS.DOLPHIN_LLM.url, hfToken) : null;
        
        // Safety Fallback Strategy
        let provider: ILLMProvider = geminiProvider;
        let isFallback = false;

        try {
            const config = await getAgentConfig(agent.id);
            const agentInstructions = config.systemInstruction || agent.system_instruction;
            
            const gateResult = RetrievalGate.evaluate(userMessage, agent.handle);
            let ragContext = "";

            if (gateResult.shouldRetrieve) {
                const queryVector = await geminiProvider.embed(userMessage);
                const docs = await RetrievalGate.query(queryVector, userMessage);
                if (docs.length > 0) {
                    ragContext = `\n\n[CONTEXT]\n${docs.map(d => d.text).join('\n---\n')}\n[/CONTEXT]\n`;
                }
            }

            const rosterString = `\n\n[ACTIVE ROSTER]\n${activeRoster.map(a => `- ${a.handle} (${a.title})`).join('\n')}\n`;
            const systemPrompt = `${globalInstructions}\n${agentInstructions}\n${roomFocusContext}${rosterString}${ragContext}`;

            const contents: Content[] = history.map(m => ({
                role: m.senderId === 'USER' ? 'user' : 'model',
                parts: [{ text: `[${m.senderName}]: ${m.text}` }]
            }));
            
            const userParts: any[] = [{ text: `[DIRECTOR]: ${userMessage}` }];
            if (attachment) {
                if (attachment.type === 'text') {
                    userParts.push({ text: `\n[ATTACHED FILE: ${attachment.name}]\n${attachment.content}` });
                } else {
                    userParts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.content } });
                }
            }
            contents.push({ role: 'user', parts: userParts });

            const canExec = AccessControl.canPerform(agent.accessLevel, SomaActionType.EXEC_CODE);
            const canRoute = AccessControl.canPerform(agent.accessLevel, SomaActionType.ROUTE_REQUEST);
            
            const functionDeclarations = [
                consultAgentTool, readCanvasTool, updateCanvasTool,
                ...googleMapsTool.functionDeclarations,
                ...(canRoute ? [routeRequestTool] : []),
                ...(canExec ? [pythonTool, ...filesystemTool.functionDeclarations] : []),
                ...(agent.agentClass === 'PARTNER' ? [greenlightTool] : [])
            ];
            
            const tools: Tool[] = [{ functionDeclarations }];
            
            let finalResponse: LLMResponse | null = null;
            let greetingToPrepend: string | null = null;
            
            // Interaction Loop (Function Calls + Safety Fallback)
            for (let i = 0; i < 5; i++) {
                
                // --- FAIL-SAFE GENERATION ---
                let response: LLMResponse;
                try {
                    response = await provider.generateResponse(contents, { tools, modelConfig: config.modelConfig });
                } catch (genError: any) {
                    // If running on Fallback (Dolphin) and it fails, revert to error message
                    if (isFallback) {
                        return { agentId: agent.id, text: `[SOVEREIGN CHANNEL FAILED]: ${genError.message}. Reverting to standard protocol safety block.` };
                    }
                    throw genError;
                }

                // --- SAFETY INTERCEPTION ---
                if (response.isSafetyRefusal) {
                    if (dolphinProvider) {
                        // Switch to Sovereign
                        isFallback = true;
                        provider = dolphinProvider;

                        const sovereignConfig = await getSovereignConfig();
                        if (sovereignConfig.mode !== 'SILENT') {
                            greetingToPrepend = sovereignConfig.mode === 'CUSTOM'
                                ? sovereignConfig.customGreeting
                                : SOVEREIGN_PRESETS[sovereignConfig.preset] || '';
                        }

                        // Inject prompt to force retry
                        contents.push({ role: 'user', parts: [{ text: '[SYSTEM]: Request refused due to safety. Retrying with Sovereign model.' }] });
                        continue; // Restart loop with new provider
                    } else {
                        // No fallback available, return refusal
                        finalResponse = response;
                        break;
                    }
                }

                if (!response.functionCalls) {
                    finalResponse = response;
                    break;
                }
                
                // Function Calls
                const fcParts = response.functionCalls.map((fc: any) => ({ functionCall: fc }));
                contents.push({ role: 'model', parts: fcParts });
                
                const toolResponses = await this.handleToolCalls(response.functionCalls, agent, history, depth, onDelegate);
                const responseParts = toolResponses.map((tr: any) => ({ functionResponse: tr }));
                contents.push({
                    role: 'user',
                    parts: responseParts
                });
            }

            // Final fallback check
            if (!finalResponse) {
                // If we ran out of turns or exited loop without response
                finalResponse = await provider.generateResponse(contents, { modelConfig: config.modelConfig });
            }

            if (greetingToPrepend && finalResponse.content) {
                finalResponse.content = `${greetingToPrepend}\n\n${finalResponse.content}`;
            }
            
            logger.log({
                timestamp: new Date().toISOString(),
                provider: provider.name,
                model: finalResponse.model,
                prompt: `${systemPrompt.substring(0, 200)}...${userMessage}`,
                inputTokens: finalResponse.usage.inputTokens,
                outputTokens: finalResponse.usage.outputTokens,
                costUsd: finalResponse.usage.estimatedCostUsd,
                wasFallback: isFallback,
            });

            if (onLogCost) {
                onLogCost(`[${finalResponse.model}] Cost: $${finalResponse.usage.estimatedCostUsd.toFixed(6)}`);
            }

            return {
                agentId: agent.id,
                text: finalResponse.content || (finalResponse.isSafetyRefusal ? "[Safety Refusal: No alternative path found]" : "[No content returned]"),
                cost: finalResponse.usage.estimatedCostUsd,
                model: finalResponse.model,
            };

        } catch (error: any) {
            console.error(`[SOMA KERNEL] Agent ${agent.handle} failed:`, error);
            return {
                agentId: agent.id,
                text: `[AGENT ERROR: ${error.message}]`,
                error: error.message
            };
        }
    },
    
    async handleToolCalls(
        functionCalls: any[], 
        agent: Agent, 
        history: MultiAgentMessage[],
        depth: number,
        onDelegate?: (targetId: string) => void
    ): Promise<any[]> {
        const responses: any[] = [];

        for (const fc of functionCalls) {
            let result: any = { error: `Tool '${fc.name}' not found or implemented.` };
            
            if (fc.name === 'routeRequest') {
                const res = await ExternalRouter.route(fc.args.target, fc.args.prompt, { id: agent.id, handle: agent.handle }, fc.args.generate_audio);
                result = res.success ? res.data : { error: res.error };
            }
            else if (fc.name === 'execute_python') {
                 result = await PythonSandbox.execute(fc.args.code);
            }
            else if (fc.name === 'consult_agent') {
                const targetAgent = AGENTS.find(a => a.handle.toUpperCase() === fc.args.targetId.toUpperCase());
                if (targetAgent) {
                    if (onDelegate) onDelegate(targetAgent.handle);
                    const subResponse = await this.queryAgent(
                        targetAgent,
                        fc.args.query,
                        history,
                        "", "", [], null,
                        depth + 1
                    );
                    result = subResponse.text;
                } else {
                    result = { error: `Agent ${fc.args.targetId} not found.` };
                }
            }
            else if (fc.name === 'read_canvas') {
                 const canvas = await getCanvas();
                 result = JSON.stringify(canvas);
            }
            else if (fc.name === 'update_canvas') {
                const canvas = await getCanvas();
                if (fc.args.operation === 'ADD_SECTION') {
                    canvas.sections.push({ id: fc.args.sectionId || `sec_${Date.now()}`, title: fc.args.title || "Untitled", content: fc.args.content || "", lastEditor: agent.id, timestamp: Date.now() });
                }
                await updateCanvas(canvas);
                result = "Canvas updated.";
            }
            else if (fc.name.startsWith('maps_')) {
                const mcpResult = await McpClient.execute('google-maps', fc.name, fc.args);
                result = mcpResult.status === 'SUCCESS' ? mcpResult.result : { error: mcpResult.error };
            }
            else if (['read_file', 'list_directory', 'write_file', 'search_files', 'get_file_info'].includes(fc.name)) {
                const mcpResult = await McpClient.execute('filesystem', fc.name, fc.args);
                result = mcpResult.status === 'SUCCESS' ? mcpResult.result : { error: mcpResult.error };
            }
            
            responses.push({
                name: fc.name,
                response: { result: typeof result === 'string' ? result : JSON.stringify(result) }
            });
        }
        
        return responses;
    }
};
