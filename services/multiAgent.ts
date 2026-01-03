
import { GoogleGenAI } from "@google/genai";
import { Agent, MultiAgentMessage } from "../types";
import { searchDocuments, getAgentConfig } from "./db";
import { RetrievalGate } from "./retrievalGate";

// Standard model for text chat (cheaper/faster than Live model)
const CHAT_MODEL = "gemini-2.0-flash-exp"; 

export interface AgentResponse {
    agentId: string;
    text: string;
    error?: string;
}

export interface AgentAttachment {
    type: 'image' | 'text';
    content: string; // Base64 or Text
    mimeType: string;
}

export const MultiAgentService = {
    
    /**
     * Executes a single turn for a specific agent.
     * 1. Checks Retrieval Gate.
     * 2. Performs RAG (if gated).
     * 3. Constructs Prompt with History + Context + Attachments.
     * 4. Calls Gemini.
     */
    async queryAgent(
        agent: Agent, 
        userMessage: string, 
        history: MultiAgentMessage[],
        globalInstructions: string,
        attachment?: AgentAttachment | null
    ): Promise<AgentResponse> {
        
        const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
        if (!apiKey) return { agentId: agent.id, text: "", error: "Missing API Key" };

        try {
            const ai = new GoogleGenAI({ apiKey });
            
            // 1. MEMORY GATING (Skip if just processing an image with no text, otherwise evaluate)
            let contextDocs: any[] = [];
            
            if (userMessage.trim().length > 0) {
                const gate = RetrievalGate.evaluate(userMessage, agent.id);
                if (gate.shouldRetrieve) {
                    // Generate embedding for query
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

                    // Search Agent's specific knowledge base
                    contextDocs = await searchDocuments(userMessage, queryVector, agent.id);
                }
            }

            // 2. CONTEXT CONSTRUCTION
            // Load custom configs if any (persisted preferences)
            const agentConfig = await getAgentConfig(agent.id);
            const specificInstruction = agentConfig.instruction || "";

            let systemPrompt = `
${globalInstructions}

=== IDENTITY ===
NAME: ${agent.handle}
ROLE: ${agent.role}
CORE INSTRUCTION: ${agent.system_instruction}
${specificInstruction}

=== MEMORY / CONTEXT ===
${contextDocs.length > 0 ? "RELEVANT KNOWLEDGE RETRIEVED:\n" + contextDocs.map(d => `- ${d.content}`).join('\n') : "No specific memory retrieved for this query."}

=== CONVERSATION PROTOCOL ===
- You are in a multi-agent conference room.
- Read the TRANSCRIPT below to understand the flow.
- Respond to the USER or other AGENTS as appropriate.
- Be concise. Do not monologue.
- If an image is provided, analyze it within the context of your Role.
`;

            // 3. HISTORY FORMATTING
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

            // 4. PAYLOAD CONSTRUCTION
            const parts: any[] = [];
            
            // Add Attachment if present
            if (attachment) {
                if (attachment.type === 'image') {
                    parts.push({
                        inlineData: {
                            mimeType: attachment.mimeType,
                            data: attachment.content
                        }
                    });
                } else if (attachment.type === 'text') {
                    parts.push({
                        text: `\n[USER ATTACHED FILE]:\n${attachment.content}\n`
                    });
                }
            }

            // Add Text Prompt
            parts.push({ text: fullPrompt });

            // 5. GENERATION
            const result = await ai.models.generateContent({
                model: CHAT_MODEL,
                contents: [{ parts }],
                config: {
                    temperature: agentConfig.modelConfig.temperature || 0.7,
                    topP: agentConfig.modelConfig.topP || 0.95,
                    topK: agentConfig.modelConfig.topK || 40,
                }
            });

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
