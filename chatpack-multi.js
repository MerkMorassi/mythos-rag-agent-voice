// js/chatpack-multi.js - MYTHOS MAGRAG ENGINE v1.5 (Gated Retrieval)

import { SimpleDB } from './core/mythos-db.js';
import { requestContext } from './core.js'; 
import { RetrievalGate } from './retrieval-gate.js'; // NEW: Import the Gate

const DB = new SimpleDB();

export class ChatPackMulti {
    constructor({ dom = false } = {}) {
        this.activeAgentId = null;
        this.domLoaded = dom;
    }

    async setActiveAgent(id) {
        this.activeAgentId = id;
    }

    async listAgents() {
        try {
            const dbReady = new Promise((resolve, reject) => {
                DB.ready.then(resolve).catch(reject);
                setTimeout(() => resolve('timeout'), 1000); 
            });
            await dbReady;
            const agents = await DB.getAll('agents');
            if (!agents || agents.length === 0) {
                console.warn("MAGRAG: Local Agent Store is empty. Hydration required.");
                return [];
            }
            return agents;
        } catch (e) {
            console.error("MAGRAG: Identity Retrieval Failed:", e);
            return [];
        }
    }

    saveHistory(agentId, historyArray) {
        if (!agentId || !historyArray) return;
        const historyKey = `chat_history_${agentId}`;
        localStorage.setItem(historyKey, JSON.stringify(historyArray));
    }

    loadHistory(agentId) {
        const historyKey = `chat_history_${agentId}`;
        const storedHistory = localStorage.getItem(historyKey);
        
        if (storedHistory) {
            try {
                const history = JSON.parse(storedHistory);
                return Array.isArray(history) ? history : [];
            } catch (e) {
                console.error("History Parse Error:", agentId, e);
                return []; 
            }
        }
        return []; 
    }

    // --- MAGRAG GENERATION PIPELINE (GATED) ---
    
    async query(prompt, apiKey, agentIds) {
        const results = [];
        
        for (const agentId of agentIds) {
            try {
                // 1. Identity Lock
                const agentData = await DB.getById('agents', agentId);
                if (!agentData) {
                    results.push({ agentId, error: "Identity corruption: Agent not found." });
                    continue;
                }

                // 2. GATING DECISION (The Sacred Contraction)
                const gateDecision = RetrievalGate.evaluate(prompt, agentData);
                let contextBlock = "";
                let gateLog = `[GATE: ${gateDecision.strategy} | Reason: ${gateDecision.reason}]`;

                // 3. RETRIEVAL EXECUTION (Conditional)
                if (gateDecision.shouldRetrieve) {
                    if (agentData.port && agentData.port !== 4015) { 
                        try {
                            const contextResponse = await requestContext(agentData.port, {
                                query: prompt,
                                limit: 5,
                                threshold: 0.45
                            });

                            if (contextResponse && contextResponse.fragments && contextResponse.fragments.length > 0) {
                                const fragments = contextResponse.fragments;
                                contextBlock = fragments
                                    .map(f => `[Source: ${f.id}] ${f.text}`)
                                    .join("\n\n");
                                contextBlock = `\n\n=== MAGRAG RETRIEVAL (GATED) ===\n${contextBlock}\n=== END RETRIEVAL ===`;
                            } else {
                                gateLog += " (RCI: No fragments found)";
                            }
                        } catch (rciError) {
                            console.warn(`RCI Offline for ${agentId}:`, rciError.message);
                            gateLog += " (RCI: Offline/Failed)";
                        }
                    }
                } else {
                    gateLog += " (Skipped RCI)";
                }

                // 4. CONSTRUCTION: Merge Identity + Gate Log + Context + Prompt
                // We inject the Gate Log invisibly into the system instruction so the Agent "knows" why it has no memory.
                const baseInstruction = agentData.system_instruction || "You are a helpful AI.";
                const finalSystemInstruction = `${baseInstruction}\n\nSYSTEM NOTE: ${gateLog}${contextBlock}`;

                // 5. GENERATION
                const response = await fetch('http://localhost:4100/api/gemini', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event: 'generate',
                        apiKey: apiKey, 
                        prompt: prompt,
                        model: agentData.default_model || 'gemini-2.5-flash',
                        systemInstruction: finalSystemInstruction
                    }),
                });

                const data = await response.json();

                if (response.ok) {
                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    results.push({ agentId, reply: text || JSON.stringify(data) });
                } else {
                    const errorDetails = data.error || 'Unknown API Error';
                    results.push({ agentId, error: errorDetails });
                }
            } catch (error) {
                results.push({ agentId, error: `MAGRAG FAILURE: ${error.message}` });
            }
        }
        return results;
    }
}