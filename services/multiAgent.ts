
import { GoogleGenAI, FunctionDeclaration, Type } from "@google/genai";
import { Agent, MultiAgentMessage, SomaActionType } from "../types";
import { searchDocuments, getAgentConfig } from "./db";
import { RetrievalGate } from "./retrievalGate";
import { ExternalRouter } from "./externalRouter";
import { SomaKernel } from "./soma"; // Import Kernel

// Standard model for text chat
const CHAT_MODEL = "gemini-3-flash-preview"; 

export interface AgentResponse {
    agentId: string;
    text: string;
    error?: string;
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
                description: "The target model ID. Use 'FLUX_IMAGE' for images/visuals. Use 'EXTERNAL_LLM' for uncensored/specialized text.",
                enum: ["FLUX_IMAGE", "EXTERNAL_LLM"]
            },
            prompt: {
                type: Type.STRING,
                description: "The specific prompt to send to the external model."
            }
        },
        required: ["target", "prompt"]
    }
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
        roomFocusContext: string, // Parameter for focus
        activeRoster: Agent[],    // <-- NEW: Parameter for active agents
        attachment?: AgentAttachment | null
    ): Promise<AgentResponse> {
        
        const kernel = SomaKernel.getInstance();
        
        // 0. HEARTBEAT & SYNC
        // Ensure the kernel knows this agent is alive and has latest permissions
        await kernel.heartbeat(agent.id);

        // 1. SAFETY & ROUTING PRE-CHECK (NSFW GUARD)
        // If the attachment is flagged, we bypass Gemini entirely to avoid policy strikes.
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
            
            const safetyPrompt = `[SYSTEM: The user attached a file named '${attachment.name}' flagged as NSFW/Restricted. It has been withheld from the primary model. The user's text prompt is: "${userMessage}". Please respond to the user's text prompt within your persona (${agent.handle}: ${agent.role}), acknowledging you cannot see the image but proceeding with the conversation.]`;
            
            try {
                const routerRes = await ExternalRouter.route(
                    'EXTERNAL_LLM', 
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
            
            // Check if agent has READ_LORE permission
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
                    contextDocs = await searchDocuments(userMessage, queryVector, agent.id);
                }
            } else if (!canReadLore) {
                // console.debug(`[SOMA] Agent ${agent.handle} denied READ_LORE access.`);
            }

            // 3. CONTEXT CONSTRUCTION
            const agentConfig = await getAgentConfig(agent.id);
            const specificInstruction = agentConfig.instruction || "";

            // --- ROSTER GENERATION ---
            // Creates a list like: "- Archivax (he/him): Central Hypervisor"
            const rosterString = activeRoster
                .map(a => `- ${a.handle.toUpperCase()} (${a.pronouns || 'they/them'}): ${a.role}`)
                .join('\n');

            let systemPrompt = `
${globalInstructions}

${roomFocusContext} 

=== ROSTER & IDENTITY CONTEXT ===
You are in a multi-agent conference room. The following agents are present:
${rosterString}

=== YOUR IDENTITY ===
NAME: ${agent.handle}
PRONOUNS: ${agent.pronouns || "they/them"}
ROLE: ${agent.role}
ACCESS_LEVEL: ${agentConfig.accessLevel || agent.accessLevel} (SOMA Permission Bitmask)
CORE INSTRUCTION: ${agent.system_instruction}
${specificInstruction}

=== MEMORY / CONTEXT ===
${canReadLore 
    ? (contextDocs.length > 0 ? "RELEVANT KNOWLEDGE RETRIEVED:\n" + contextDocs.map(d => `- ${d.content}`).join('\n') : "No specific memory retrieved for this query.") 
    : "[SYSTEM: MEMORY SUBSYSTEM OFFLINE - INSUFFICIENT PERMISSIONS]"
}

=== SOMA PROTOCOL ===
You operate under the SOMA kernel. Your actions are restricted by your ACCESS_LEVEL.
- If you lack permission for a tool (e.g. routing, coding), do not attempt to use it.
- To save the current conversation to permanent history, output exactly:
  [ACTION: SAVE_SESSION | title="Unique Title based on context"]
  (Requires WRITE_LORE permission)

=== CONVERSATION PROTOCOL ===
- Read the TRANSCRIPT below to understand the flow.
- Respond to the USER or other AGENTS as appropriate.
- Be concise. Do not monologue.
- If an image or video is provided, analyze it within the context of your Role.
`;

            // 4. HISTORY FORMATTING
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
                    parts.push({
                        inlineData: {
                            mimeType: attachment.mimeType,
                            data: attachment.content
                        }
                    });
                } else if (attachment.type === 'video') {
                    parts.push({
                        inlineData: {
                            mimeType: attachment.mimeType,
                            data: attachment.content
                        }
                    });
                    // Hint to model about the video
                    parts.push({ text: `\n[VIDEO ATTACHED: ${attachment.name || 'video_clip'}]\n` });
                } else if (attachment.type === 'text') {
                    parts.push({
                        text: `\n[USER ATTACHED FILE: ${attachment.name || 'document'}]\n${attachment.content}\n`
                    });
                }
            }

            parts.push({ text: fullPrompt });

            // 6. GENERATION WITH TOOLS
            // Check if agent has ROUTE_REQUEST permission
            const tools = [];
            if (kernel.authorize(agent.id, SomaActionType.ROUTE_REQUEST)) {
                tools.push({ functionDeclarations: [routeRequestTool] });
            }

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

            // 7. TOOL HANDLING
            const functionCalls = result.functionCalls;
            if (functionCalls && functionCalls.length > 0) {
                const call = functionCalls[0];
                if (call.name === "routeRequest") {
                    
                    // DOUBLE CHECK PERMISSION (Kernel Level Enforcement)
                    if (!kernel.authorize(agent.id, SomaActionType.ROUTE_REQUEST)) {
                        return { agentId: agent.id, text: `[SYSTEM NOTICE] Tool use blocked: Insufficient SOMA permissions (Need ROUTE_EXTERNAL).` };
                    }

                    const args = call.args as any;
                    const target = args.target;
                    const prompt = args.prompt;
                    
                    const routerRes = await ExternalRouter.route(target, prompt, { id: agent.id, handle: agent.handle });
                    
                    if (routerRes.success && routerRes.data) {
                        if (routerRes.type === 'image') {
                            // GENERATE_MEDIA PERMISSION CHECK implicit in routeRequest for FLUX?
                            // Technically routeRequest covers it, but we can separate later if needed.
                            return {
                                agentId: agent.id,
                                text: `[GENERATED IMAGE: ${routerRes.data}] I have visualized this request: ${prompt}`
                            };
                        } else {
                            return {
                                agentId: agent.id,
                                text: routerRes.data
                            };
                        }
                    } else {
                        return {
                            agentId: agent.id,
                            text: `[ERROR] I attempted to access ${target} but failed: ${routerRes.error}`
                        };
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
