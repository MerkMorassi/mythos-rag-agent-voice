
import { Agent, SomaActionType, MultiAgentMessage } from "../types";
import { AccessControl } from "./accessControl";
import { AGENTS } from "../agents";
import { getAgentConfig } from "./db";

/**
 * S.O.M.A. KERNEL
 * Service Oriented Multi-Agent Orchestrator
 * 
 * This service acts as the Hypervisor for the agent cluster.
 * It does not generate content itself, but manages the routing,
 * permission checks, and state of the cluster.
 */

export interface ClusterNode {
    id: string;
    handle: string;
    accessLevel: string;
    status: 'ONLINE' | 'OFFLINE' | 'BUSY';
    lastHeartbeat: number;
}

export class SomaKernel {
    
    private static instance: SomaKernel;
    private nodes: Map<string, ClusterNode> = new Map();

    private constructor() {
        this.initializeCluster();
    }

    public static getInstance(): SomaKernel {
        if (!SomaKernel.instance) {
            SomaKernel.instance = new SomaKernel();
        }
        return SomaKernel.instance;
    }

    private async initializeCluster() {
        for (const agent of AGENTS) {
            // Hydrate initial state
            // In a real system, we'd check DB for override config here
            const config = await getAgentConfig(agent.id);
            this.nodes.set(agent.id, {
                id: agent.id,
                handle: agent.handle,
                accessLevel: config.accessLevel || agent.accessLevel,
                status: 'OFFLINE',
                lastHeartbeat: Date.now()
            });
        }
    }

    /**
     * Registers a heartbeat from an agent, updating its status and config.
     */
    public async heartbeat(agentId: string): Promise<boolean> {
        if (!this.nodes.has(agentId)) return false;
        
        const node = this.nodes.get(agentId)!;
        
        // Refresh permissions from DB in case of Admin change
        const config = await getAgentConfig(agentId);
        
        node.status = 'ONLINE';
        node.lastHeartbeat = Date.now();
        node.accessLevel = config.accessLevel || node.accessLevel;
        
        this.nodes.set(agentId, node);
        return true;
    }

    /**
     * THE GATEKEEPER
     * Validates if a specific agent is allowed to perform a specific SOMA Action.
     */
    public authorize(agentId: string, action: SomaActionType): boolean {
        const node = this.nodes.get(agentId);
        if (!node) {
            console.warn(`[SOMA KERNEL] Access Denied: Unknown Agent ${agentId}`);
            return false;
        }

        const allowed = AccessControl.canPerform(node.accessLevel, action);
        
        if (!allowed) {
            console.warn(`[SOMA KERNEL] ACCESS DENIED: ${node.handle} (Level ${node.accessLevel}) attempted ${action}`);
        } else {
            // console.debug(`[SOMA KERNEL] ACCESS GRANTED: ${node.handle} -> ${action}`);
        }

        return allowed;
    }

    /**
     * Returns the active roster for the prompt context, filtered by status.
     */
    public getActiveRoster(): Agent[] {
        const active: Agent[] = [];
        this.nodes.forEach(node => {
            if (node.status === 'ONLINE' || node.status === 'BUSY') {
                const agentDef = AGENTS.find(a => a.id === node.id);
                if (agentDef) active.push(agentDef);
            }
        });
        // Fallback if none (e.g., initialization)
        if (active.length === 0) return AGENTS.slice(0, 3);
        return active;
    }

    /**
     * Resolves which agents should respond to a user message (Routing Logic).
     */
    public resolveRouting(userMessage: string, availableAgents: Agent[]): Agent[] {
        const mentions = this.parseMentions(userMessage, availableAgents);
        
        // 1. Direct Mention Priority
        if (mentions.length > 0) {
            return mentions;
        }

        // 2. Default to "High Clearance" or "General" agents if query is broad?
        // For now, in our app, we usually manual select or broadcast.
        // This kernel method handles the "Broadcast" logic logic.
        
        // Filter agents capable of ROUTE_EXTERNAL if the prompt asks for images?
        if (userMessage.toLowerCase().includes('image') || userMessage.toLowerCase().includes('visual')) {
            return availableAgents.filter(a => {
                const node = this.nodes.get(a.id);
                return node && AccessControl.canPerform(node.accessLevel, SomaActionType.ROUTE_REQUEST);
            });
        }

        return availableAgents; // Return all for broad broadcast (Console handles slicing)
    }

    private parseMentions(text: string, agents: Agent[]): Agent[] {
        const mentioned: Agent[] = [];
        const lower = text.toLowerCase();
        
        agents.forEach(a => {
            if (lower.includes(`@${a.handle.toLowerCase()}`) || lower.includes(`${a.handle.toLowerCase()}:`)) {
                mentioned.push(a);
            }
        });
        return mentioned;
    }
}
