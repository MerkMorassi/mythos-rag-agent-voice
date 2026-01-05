
import { GoogleGenAI, FunctionDeclaration, Type, Tool } from "@google/genai";
import { Agent, MultiAgentMessage, SomaActionType } from "../types";
import { searchDocuments, getAgentConfig, getGraphContext, getCanvas, updateCanvas } from "./db";
import { RetrievalGate } from "./retrievalGate";
import { ExternalRouter } from "./externalRouter";
import { SomaKernel } from "./soma";
import { McpClient } from "./mcpClient";

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
            } catch (e: any) {
                return { agentId: agent.id, text: "", error: `Routing Error: ${e.message}` };
            }
        }

        const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
        if (!apiKey) return { agentId: agent.id, text: "", error: "Missing API Key" };

        try {
            const ai = new GoogleGenAI({ apiKey });
            
            // 2. MEMORY GATING (SOMA AUTHORIZATION CHECK)
            let contextDocs: any[] = [];
            let graphContext = "";
            
            const canReadLore = kernel.authorize(agent.id, SomaActionType.QUERY_DB);

            if (userMessage.trim().length > 0 && canReadLore) {
                const gate = RetrievalGate.evaluate(userMessage, agent.id);
                
                if (gate.shouldRetrieve) {
                    let queryVector = undefined;
                    try {
                        const embedRes = await ai.models.embedContent({
                            model: 'text-embedding-004',
                            contents: [{ parts: [{ text: userMessage }] }]
                        });
                        queryVector = embedRes.embeddings?.[0]?.values;
                    } catch(e) {
                        console.warn(`[${agent.handle}] Embedding failed`, e);
                    }

                    if (gate.strategy === 'GRAPH_LOCAL') {
                        graphContext = await getGraphContext(userMessage, queryVector, agent.id);
                    }
                    contextDocs = await searchDocuments(userMessage, queryVector, agent.id);
                }
            } 

            // 3. CONTEXT CONSTRUCTION
            const agentConfig = await getAgentConfig(agent.id);
            const specificInstruction = agentConfig.instruction || "";

            const rosterString = activeRoster
                .map(a => `- ${a.handle.toUpperCase()} (${a.pronouns || 'they/them'}): ${a.title}`)
                .join('\n');

            let memorySection = "";
            if (canReadLore) {
                if (graphContext) {
                    memorySection = `RELEVANT KNOWLEDGE GRAPH:\n${graphContext}\n\nRELATED TEXT CHUNKS:\n` + contextDocs.map(d => `- ${d.content.substring(0, 300)}...`).join('\n');
                } else if (contextDocs.length > 0) {
                    memorySection = "RELEVANT KNOWLEDGE RETRIEVED:\n" + contextDocs.map(d => `- ${d.content}`).join('\n');
                } else {
                    memorySection = "No specific memory retrieved for this query.";
                }
            } else {
                memorySection = "[SYSTEM: MEMORY SUBSYSTEM OFFLINE - INSUFFICIENT PERMISSIONS]";
            }

            let systemPrompt = `
${globalInstructions}

${roomFocusContext} 

=== ROSTER & IDENTITY CONTEXT ===
You are in a multi-agent conference room. The following agents are present:
${rosterString}

=== YOUR IDENTITY ===
NAME: ${agent.handle}
PRONOUNS: ${agent.pronouns || "they/them"}
TITLE: ${agent.title}
CLASS: ${agent.agentClass}
BIO: ${agent.bio}
ACCESS_LEVEL: ${agentConfig.accessLevel || agent.accessLevel} (SOMA Permission Bitmask)
CORE INSTRUCTION: ${agent.system_instruction}
${specificInstruction}

=== MEMORY / CONTEXT ===
${memorySection}

=== SOMA PROTOCOL ===
You operate under the SOMA kernel. Your actions are restricted by your ACCESS_LEVEL.
- If you lack permission for a tool (e.g. routing, coding, delegation), do not attempt to use it.
- To save the current conversation to permanent history, output exactly:
  [ACTION: SAVE_SESSION | title="Unique Title based on context"]
  (Requires WRITE_LORE permission)

=== CONVERSATION PROTOCOL ===
- Read the TRANSCRIPT below to understand the flow.
- Respond to the USER or other AGENTS as appropriate.
- Be concise. Do not monologue.
- If an image or video is provided, analyze it within the context of your Role.
`;

            const transcript = history.slice(-15).map(m => {
                let content = m.text;
                if (m.attachment) content += `\n[Reference: Attachment Provided]`;
                return `${m.senderName.toUpperCase()}: ${content}`;
            }).join('\n');

            const fullPrompt = `
${systemPrompt}

=== TRANSCRIPT (Last 15 Messages) ===
${transcript}
USER: ${userMessage}
${agent.handle.toUpperCase()}:`;

            // 5. PAYLOAD CONSTRUCTION
            const parts: any[] = [];
            
            if (attachment) {
                if (attachment.type === 'image') {
                    parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.content } });
                } else if (attachment.type === 'video') {
                    parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.content } });
                    parts.push({ text: `\n[VIDEO ATTACHED: ${attachment.name || 'video_clip'}]\n` });
                } else if (attachment.type === 'text') {
                    parts.push({ text: `\n[USER ATTACHED FILE: ${attachment.name || 'document'}]\n${attachment.content}\n` });
                }
            }

            parts.push({ text: fullPrompt });

            // 6. TOOL SETUP
            const tools: Tool[] = [];
            
            // Authorization for RouteRequest
            if (kernel.authorize(agent.id, SomaActionType.ROUTE_REQUEST)) {
                tools.push({ functionDeclarations: [routeRequestTool] });
            }
            
            // Authorization for Delegation (Synapse) & Holodeck (Collaboration)
            if (kernel.authorize(agent.id, SomaActionType.COLLABORATE)) {
                tools.push({ functionDeclarations: [consultAgentTool, readCanvasTool, updateCanvasTool] });
            }
            
            // Thespian Protocol (Partners & Talent)
            if (agent.agentClass === 'TALENT' || agent.agentClass === 'PARTNER') {
                tools.push({ functionDeclarations: [assumeRoleTool] });
            }

            // Greenlight System (Barbelo/Admins)
            if (agent.handle === 'BARBELO' || agent.accessLevel === '777') {
                tools.push({ functionDeclarations: [greenlightTool] });
            }
            
            // HARDCODED: Google Maps Tools
            if (googleMapsTool.functionDeclarations) {
                tools.push({ functionDeclarations: googleMapsTool.functionDeclarations });
            }

            // 7. GENERATION (PASS 1)
            const result = await ai.models.generateContent({
                model: CHAT_MODEL,
                contents: [{ parts }],
                config: {
                    temperature: agentConfig.modelConfig.temperature || 0.7,
                    topP: agentConfig.modelConfig.topP || 0.95,
                    topK: agentConfig.modelConfig.topK || 40,
                    tools: tools.length > 0 ? tools : undefined
                }
            });

            // 8. TOOL HANDLING LOOP
            const functionCalls = result.functionCalls;
            if (functionCalls && functionCalls.length > 0) {
                const call = functionCalls[0];
                
                // ROUTER TOOL
                if (call.name === "routeRequest") {
                    if (!kernel.authorize(agent.id, SomaActionType.ROUTE_REQUEST)) {
                        return { agentId: agent.id, text: `[SYSTEM NOTICE] Tool use blocked: Insufficient SOMA permissions (Need ROUTE_EXTERNAL).` };
                    }
                    const args = call.args as any;
                    const routerRes = await ExternalRouter.route(
                        args.target, 
                        args.prompt, 
                        { id: agent.id, handle: agent.handle },
                        args.generate_audio // Pass the audio flag
                    );
                    
                    if (routerRes.success && routerRes.data) {
                        if (routerRes.type === 'audio') {
                            return {
                                agentId: agent.id,
                                text: `[STORY GENERATED] I have synthesized the audio for this narrative using my high-fidelity voice module (Chatterbox).`,
                                audioUrl: routerRes.data
                            };
                        } else if (routerRes.type === 'image') {
                            return { 
                                agentId: agent.id, 
                                text: `[GENERATED IMAGE] I have visualized this request: ${args.prompt}`,
                            };
                        } else {
                            // Text Response (Dolphin/Venice)
                            return { agentId: agent.id, text: `[UNRESTRICTED MODEL]: ${routerRes.data}` };
                        }
                    } else {
                        return { agentId: agent.id, text: `[ERROR] Accessing ${args.target} failed: ${routerRes.error}` };
                    }
                }
                
                // SYNAPSE: DELEGATION
                else if (call.name === "consult_agent") {
                    if (!kernel.authorize(agent.id, SomaActionType.COLLABORATE)) {
                        return { agentId: agent.id, text: `[SYSTEM BLOCK] Synapse Failure: Agent ${agent.handle} lacks COLLABORATE permissions.` };
                    }
                    
                    const args = call.args as any;
                    const targetId = args.targetId.toUpperCase();
                    
                    // Identify Target
                    const targetAgent = activeRoster.find(a => a.id === targetId) || activeRoster.find(a => a.handle.toUpperCase() === targetId);
                    
                    if (!targetAgent) {
                        return { agentId: agent.id, text: `[SYSTEM ERROR] Target Agent '${targetId}' is not available in the active roster.` };
                    }

                    // VISUAL CALLBACK
                    if (onDelegate) onDelegate(targetAgent.handle);

                    // RECURSIVE CALL
                    // We pass an empty history or minimal context to the sub-agent so they focus purely on the query
                    const subPrompt = `[DIRECT DELEGATION FROM ${agent.handle}]: ${args.query}\nCONTEXT: ${args.context || "None"}`;
                    
                    try {
                        const subResponse = await MultiAgentService.queryAgent(
                            targetAgent,
                            subPrompt,
                            [], // Empty history to force focus on the specific query
                            globalInstructions,
                            "FOCUS: SUB-QUERY DELEGATION",
                            activeRoster,
                            null,
                            depth + 1, // INCREMENT DEPTH
                            onDelegate
                        );

                        // FEEDBACK LOOP
                        const feedbackPrompt = `
${fullPrompt}

[SYSTEM: You successfully delegated to ${targetAgent.handle}.]
[RESPONSE FROM ${targetAgent.handle}]:
${subResponse.text}

[INSTRUCTION]: Incorporate this delegated knowledge into your final response to the user.
${agent.handle.toUpperCase()}:`;

                        const finalRes = await ai.models.generateContent({
                            model: CHAT_MODEL,
                            contents: [{ parts: [{ text: feedbackPrompt }] }],
                            config: { ...agentConfig.modelConfig, tools: undefined } // Disable tools to prevent loops
                        });

                        return { agentId: agent.id, text: finalRes.text || "..." };

                    } catch(e: any) {
                        return { agentId: agent.id, text: `[DELEGATION FAILED]: ${e.message}` };
                    }
                }

                // THESPIAN PROTOCOL: ASSUME ROLE
                else if (call.name === "assume_role") {
                    const args = call.args as any;
                    return { 
                        agentId: agent.id, 
                        text: `[SYSTEM: ROLE_SHIFT_ACTIVE] ${agent.handle} is now performing as "${args.characterName}".\nContext: ${args.scriptContext || 'Improv'}` 
                    };
                }

                // GREENLIGHT SYSTEM
                else if (call.name === "greenlight_asset") {
                    const args = call.args as any;
                    const statusIcon = args.verdict === 'APPROVED' ? '✅' : '❌';
                    return {
                        agentId: agent.id,
                        text: `[EXECUTIVE ORDER] Asset ${args.assetId} has been ${args.verdict} ${statusIcon}.\nNote: ${args.comment}`
                    };
                }

                // HOLODECK: READ
                else if (call.name === "read_canvas") {
                    const canvas = await getCanvas();
                    const summary = `=== HOLODECK: ${canvas.title} ===\n` + 
                        canvas.sections.map(s => `[ID: ${s.id}] ## ${s.title}\n${s.content}`).join('\n\n');
                    return { agentId: agent.id, text: `[READING CANVAS...]\n${summary}` };
                }

                // HOLODECK: UPDATE
                else if (call.name === "update_canvas") {
                    const args = call.args as any;
                    const canvas = await getCanvas();
                    
                    if (args.operation === 'SET_TITLE') {
                        canvas.title = args.title || canvas.title;
                    } else if (args.operation === 'ADD_SECTION') {
                        const newId = args.sectionId || `sec_${Date.now()}`;
                        canvas.sections.push({
                            id: newId,
                            title: args.title || "Untitled",
                            content: args.content || "",
                            lastEditor: agent.id,
                            timestamp: Date.now()
                        });
                    } else if (args.operation === 'UPDATE_SECTION') {
                        const idx = canvas.sections.findIndex(s => s.id === args.sectionId);
                        if (idx !== -1) {
                            if(args.title) canvas.sections[idx].title = args.title;
                            if(args.content) canvas.sections[idx].content = args.content;
                            canvas.sections[idx].lastEditor = agent.id;
                            canvas.sections[idx].timestamp = Date.now();
                        }
                    } else if (args.operation === 'DELETE_SECTION') {
                        canvas.sections = canvas.sections.filter(s => s.id !== args.sectionId);
                    }
                    
                    canvas.lastModified = Date.now();
                    await updateCanvas(canvas);
                    
                    return { agentId: agent.id, text: `[HOLODECK UPDATED] Operation ${args.operation} successful.` };
                }

                // GOOGLE MAPS TOOL (RE-PROMPT PATTERN)
                else if (call.name.startsWith("maps_")) {
                    try {
                        const mcpRes = await McpClient.execute('google-maps', call.name, call.args as any);
                        const toolResult = mcpRes.status === 'SUCCESS' ? JSON.stringify(mcpRes.result) : `Error: ${mcpRes.error}`;
                        
                        const rePrompt = `
${fullPrompt}

[SYSTEM: You invoked the tool '${call.name}'.]
[TOOL OUTPUT]: ${toolResult.substring(0, 8000)}

[INSTRUCTION]: Incorporate this new information into your final response to the user.
${agent.handle.toUpperCase()}:`;

                        const secondResult = await ai.models.generateContent({
                            model: CHAT_MODEL,
                            contents: [{ parts: [{ text: rePrompt }] }],
                            config: { ...agentConfig.modelConfig, tools: undefined } 
                        });
                        
                        return { agentId: agent.id, text: secondResult.text || "..." };

                    } catch (e: any) {
                        return { agentId: agent.id, text: `[MAPS ERROR]: ${e.message}` };
                    }
                }
            }

            return {
                agentId: agent.id,
                text: result.text || "..."
            };

        } catch (e: any) {
            console.error(`Error querying agent ${agent.handle}:`, e);
            return {
                agentId: agent.id,
                text: "",
                error: e.message || "Connection failed"
            };
        }
    }
};
