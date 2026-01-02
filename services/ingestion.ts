
import { KnowledgeDoc, LorePack, LorePackHeader } from '../types';
import { NumMarkX_GenerateHeader, NumMarkX_GenerateID, NumMarkX_TimeStamp, NumMarkX_GenerateSigil } from '../patterns/NumMarkX';

export interface IngestionResult {
    success: boolean;
    header: LorePackHeader;
    docs: KnowledgeDoc[];
    error?: string;
    stats: {
        total: number;
        withVectors: number;
        avgSize: number;
    };
}

export class IngestionService {

    /**
     * The "Forge" Logic.
     * Parses raw file content (JSON string) and normalizes it into a MYTHOS.LOREPACK.v1 structure.
     * Harvested from single-chat.html and orchestrator.js
     */
    static async parseLorePack(fileContent: string, defaultAgentId: string = 'UNKNOWN'): Promise<IngestionResult> {
        try {
            const raw = JSON.parse(fileContent);
            let header: LorePackHeader;
            let nodes: any[] = [];

            // 1. HEURISTIC: Check if it's a Raw Array (Legacy Prototype Format)
            if (Array.isArray(raw)) {
                console.log("[Forge] Detected Legacy Array Format");
                header = NumMarkX_GenerateHeader(defaultAgentId, defaultAgentId, "Legacy Import");
                nodes = raw;
            } 
            // 2. HEURISTIC: Check for Standard Object Format (MYTHOS.LOREPACK.v1)
            else if (typeof raw === 'object' && raw !== null) {
                // Check if it matches orchestrator.js schema or single-chat.html schema
                if (raw.schema === 'MYTHOS.LOREPACK.v1') {
                     // Orchestrator format
                     header = {
                         schema: 'MYTHOS.LOREPACK.v1',
                         id: raw.id || crypto.randomUUID(),
                         agentId: raw.agentId || defaultAgentId,
                         handle: raw.handle || raw.agentId || defaultAgentId,
                         version: raw.version || 1,
                         timestamp: raw.timestamp || Date.now(),
                         description: raw.description
                     };
                     nodes = raw.sacred_archive || [];
                } else {
                    // Generic Object (maybe just { nodes: [...] })
                    console.log("[Forge] Detected Generic Object Format");
                    const extractedNodes = raw.sacred_archive || raw.nodes || raw.data || [];
                    const agentInfo = raw.header || raw.agent || {};
                    
                    header = NumMarkX_GenerateHeader(
                        agentInfo.id || agentInfo.agentId || defaultAgentId,
                        agentInfo.handle || agentInfo.name || defaultAgentId,
                        "Generic Import"
                    );
                    nodes = extractedNodes;
                }
            } else {
                throw new Error("Unknown JSON structure.");
            }

            // 3. NORMALIZE NODES
            // Ensure every node conforms to KnowledgeDoc interface
            const normalizedDocs: KnowledgeDoc[] = nodes.map((n: any, index: number) => {
                const content = n.content || n.text || n.value || '';
                
                // Harvest vector from various possible fields (vector, embedding, values)
                const embedding = n.embedding || n.vector || n.values;

                // NUMMARK INTEGRATION: Generate Sigil if missing
                const sigil = n.numMarkId || NumMarkX_GenerateSigil(typeof content === 'string' ? content : 'nodata');

                return {
                    id: n.id || NumMarkX_GenerateID('LORE'),
                    agentId: header.agentId, // Force bind to Pack Agent
                    title: n.title || n.name || `Lore Node ${index + 1}`,
                    content: typeof content === 'string' ? content : JSON.stringify(content),
                    embedding: Array.isArray(embedding) ? embedding : undefined,
                    timestamp: n.timestamp || Date.now(),
                    numMarkId: sigil, // Stamp with NumMark Sigil
                    tags: n.tags || []
                };
            }).filter(d => d.content && d.content.trim().length > 0);

            return {
                success: true,
                header,
                docs: normalizedDocs,
                stats: {
                    total: normalizedDocs.length,
                    withVectors: normalizedDocs.filter(d => d.embedding).length,
                    avgSize: Math.round(normalizedDocs.reduce((acc, c) => acc + c.content.length, 0) / (normalizedDocs.length || 1))
                }
            };

        } catch (e: any) {
            console.error("[Forge] Ingestion Failed:", e);
            return {
                success: false,
                header: NumMarkX_GenerateHeader('ERROR', 'ERROR'),
                docs: [],
                error: e.message,
                stats: { total: 0, withVectors: 0, avgSize: 0 }
            };
        }
    }

    /**
     * Create a downloadable JSON string from docs.
     */
    static exportLorePack(header: LorePackHeader, docs: KnowledgeDoc[]): string {
        const pack: LorePack = {
            header,
            sacred_archive: docs
        };
        return JSON.stringify(pack, null, 2);
    }
}
