

import { AGENTS } from "../agents";
// FIX: Replaced non-existent getAllDocuments with getAllVectors.
import { getAgentConfig, getAllVectors } from "./db";
import { AccessControl } from "./accessControl";

export interface VFile {
    path: string; // Full path
    name: string;
    type: 'file' | 'dir';
    permissions: string;
    owner: string;
    size: number;
    content?: string | (() => Promise<string>);
}

export const VirtualFs = {
    // List all files in path. If recursive, implementation in ShellService handles directory diving,
    // but here we just list the immediate children of the requested path.
    async list(path: string): Promise<VFile[]> {
        const p = path.replace(/\/$/, '') || '/'; 
        
        if (p === '/') {
            return [
                { path: '/agents', name: 'agents', type: 'dir', permissions: 'dr-xr-xr-x', owner: 'root', size: 4096 },
                { path: '/lore', name: 'lore', type: 'dir', permissions: 'drwxrwxrwx', owner: 'archivax', size: 8192 },
                { path: '/logs', name: 'logs', type: 'dir', permissions: 'drwxr-x---', owner: 'root', size: 0 },
                { path: '/sys', name: 'sys', type: 'dir', permissions: 'dr-xr-xr-x', owner: 'root', size: 0 },
            ];
        }

        if (p === '/agents') {
            return Promise.all(AGENTS.map(async (a) => {
                const config = await getAgentConfig(a.id);
                const perm = config.accessLevel || a.accessLevel;
                const chmodStr = this.octalToSymbolic(perm, false);
                return {
                    path: `/agents/${a.handle.toLowerCase()}`,
                    name: a.handle.toLowerCase(),
                    type: 'file',
                    permissions: `-rwxr-x${chmodStr}`, 
                    owner: 'root',
                    size: a.system_instruction.length
                };
            }));
        }

        if (p === '/lore') {
            // FIX: Replaced getAllDocuments with getAllVectors
            const docs = await getAllVectors();
            return docs.map(d => {
                // Ensure name is filesystem safe
                // FIX: Changed d.title to d.source
                const safeName = (d.source || d.id).replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase().substring(0, 40);
                const perm = d.permissions || '644';
                const chmodStr = this.octalToSymbolic(perm, false);
                return {
                    path: `/lore/${safeName}`,
                    name: safeName,
                    type: 'file',
                    permissions: `-${chmodStr}`,
                    // FIX: Changed d.agentId to d.agent
                    owner: (d.agent || 'unknown').toLowerCase(),
                    // FIX: Changed d.content to d.text
                    size: d.text.length
                };
            });
        }

        return [];
    },

    async read(path: string): Promise<string | null> {
        const parts = path.split('/').filter(Boolean);
        const dir = parts[0];
        const file = parts[1];

        if (dir === 'agents' && file) {
            const agent = AGENTS.find(a => a.handle.toLowerCase() === file.toLowerCase());
            if (!agent) return null;
            
            const config = await getAgentConfig(agent.id);
            const level = config.accessLevel || agent.accessLevel;
            const perms = AccessControl.resolve(level).join(', ');
            
            return JSON.stringify({
                id: agent.id,
                title: agent.title,
                accessLevel: level,
                capabilities: perms,
                voice: agent.voice,
                instruction_snippet: agent.system_instruction.substring(0, 100) + "..."
            }, null, 2);
        }

        if (dir === 'lore' && file) {
            // FIX: Replaced getAllDocuments with getAllVectors
            const docs = await getAllVectors();
            const doc = docs.find(d => 
                // FIX: Changed d.title to d.source
                (d.source || d.id).replace(/[^a-zA-Z0-9.-]/g, '_').toLowerCase().substring(0, 40) === file
            );
            
            // FIX: Changed doc.content to doc.text
            if (doc) return doc.text;
            return null;
        }

        return null;
    },

    octalToSymbolic(octal: string, isDir: boolean): string {
        const map = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
        const o = octal || '000';
        const u = parseInt(o[0]) || 0;
        const g = parseInt(o[1]) || 0;
        const w = parseInt(o[2]) || 0;
        return map[u] + map[g] + map[w]; // Removed dir prefix logic here as it's added by caller usually, but let's standardize
    }
};