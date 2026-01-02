
import { KnowledgeDoc } from '../types';

const ORCHESTRATOR_URL = 'http://localhost:4000';

export interface SyncStatus {
    online: boolean;
    latency: number;
    version?: string;
}

export const SyncBridge = {
    /**
     * Checks if the Localhost Orchestrator (Z: Drive Vault) is running.
     */
    async checkHeartbeat(): Promise<SyncStatus> {
        const start = Date.now();
        try {
            // We use a simple HEAD or GET request. 
            // Since orchestrator.js serves static files, fetching root is safe.
            const response = await fetch(ORCHESTRATOR_URL, { method: 'HEAD', mode: 'cors' });
            if (response.ok) {
                return { online: true, latency: Date.now() - start };
            }
            return { online: false, latency: 0 };
        } catch (e) {
            return { online: false, latency: 0 };
        }
    },

    /**
     * Pushes a specific Agent's knowledge base to the Z: Drive via Orchestrator.
     * Matches the endpoint in orchestrator.js: /lorepack/ingest/:agentId
     */
    async pushLorePack(agentId: string, docs: KnowledgeDoc[]): Promise<{ success: boolean; path?: string; error?: string }> {
        try {
            // Prepare payload matching orchestrator.js expectation: { nodes: [] }
            // The orchestrator writes this to MYTHOS/LORE/{AgentID}/...
            const payload = {
                nodes: docs,
                timestamp: Date.now(),
                source: "MythOS_React_Client"
            };

            const response = await fetch(`${ORCHESTRATOR_URL}/lorepack/ingest/${agentId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (response.ok) {
                return { success: true, path: result.path };
            } else {
                return { success: false, error: result.error || 'Server rejected payload' };
            }
        } catch (e: any) {
            console.error("SyncBridge Push Error:", e);
            return { success: false, error: e.message };
        }
    }
};
