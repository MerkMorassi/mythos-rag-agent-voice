
import { GoogleGenAI, FunctionDeclaration, Type, Tool } from "@google/genai";
import { Agent, MultiAgentMessage, SomaActionType } from "../types";
import { searchDocuments, getAgentConfig, getGraphContext, getCanvas, updateCanvas } from "./db";
import { RetrievalGate } from "./retrievalGate";
import { ExternalRouter } from "./externalRouter";
import { SomaKernel } from "./soma";
import { McpClient } from "./mcpClient";
import { PythonSandbox } from "./pythonSandbox";
import { uploadCloudFile, waitForFileActive } from "./googleFiles";
import { saveMediaAsset } from "./db";
import { NumMarkX_GenerateID } from "../patterns/NumMarkX";

// Standard model for text chat - Upgraded to Pro for best reasoning
const CHAT_MODEL = "gemini-3-pro-preview"; 

export interface AgentResponse {
    agentId: string;
    text: string;
    error?: string;
    audioUrl?: string; 
}

export interface AgentAttachment {
    type: 'image' | 'text' | 'video';
    content: string; // Base64 or Text
    mimeType: string;
    name?: string;
}

// --- TOOL DEFINITIONS ---
const routeRequestTool: FunctionDeclaration = {
    name: "routeRequest",
    description: "Route a complex request or image generation task to a specialized external model.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            target: {
                type: Type.STRING,
                description: "The target ID: 'FLUX_IMAGE' (Visuals), 'DOLPHIN_LLM' (NSFW/Uncensored Text), 'CHATTERBOX_TTS' (Audio Story).",
                enum: ["FLUX_IMAGE", "DOLPHIN_LLM", "CHATTERBOX_TTS", "EXTERNAL_LLM"]
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
        onDelegate?: (targetId: string) => void // VISUAL CALLBACK
    ): Promise<AgentResponse> {
        
        const kernel = SomaKernel.getInstance();
        
        // 0. HEARTBEAT & SYNC
        await kernel.heartbeat(agent.id);

        // RECURSION GUARD
        if (depth > 3) {
            return { agentId: agent.id, text: "[SYSTEM ERROR: Collaboration Depth Exceeded. Aborting chain.]" };
        }

        // 1. SAFETY & ROUTING PRE-CHECK (NSFW GUARD)
        if (attachment && attachment.name && (
            attachment.name.toLowerCase().includes('nsfw') || 
            attachment.name.toLowerCase().includes('restricted') ||
            attachment.name.toLowerCase().includes('uncensored')
        )) {
            // Permission Check: Does agent have ROUTE_EXTERNAL permission?
            if (!kernel.authorize(agent.id, SomaActionType.ROUTE_REQUEST)) {
                return { agentId: agent.id, text: `[ACCESS DENIED] My security protocols (SOMA Level ${agent.accessLevel}) prevent me from handling restricted content.` };
            }

            console.warn(`[SAFETY] Attachment '${attachment.name}' flagged. Routing to External Cluster.`);
            
            const safetyPrompt = `[SYSTEM: The user attached a file named '${attachment.name}' flagged as NSFW/Restricted. It has been withheld from the primary model. The user's text prompt is: "${userMessage}". Please respond to the user's text prompt within your persona (${agent.handle}: ${agent.title}), acknowledging you cannot see the image but proceeding with the conversation.]`;
            
            try {
                const routerRes = await ExternalRouter.route(
                    'DOLPHIN_LLM', 
                    safetyPrompt, 
                    { id: agent.id, handle: agent.handle }
                );

                if (routerRes.success) {
                    return {
                        agentId: agent.id,
                        text: routerRes.data || "[External Model Returned Empty Response]"
                    };
                } else {
                    return {
                        agentId: agent.id,
                        text: `[SYSTEM] Safety routing failed: ${routerRes.error}`
                    };
                }