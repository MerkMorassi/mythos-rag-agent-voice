
import { KnowledgeDoc, LorePack, LorePackHeader } from '../types';
import { NumMarkX_GenerateHeader, NumMarkX_GenerateID, NumMarkX_GenerateSigil } from '../patterns/NumMarkX';

export interface IngestionResult {
    success: boolean;
    header: LorePackHeader;
    docs: KnowledgeDoc[];
    error?: string;
    stats: {
        total: number;
        withVectors: number;
        avgSize: number;
        existingSigils: number;
    };
}

export class IngestionService {

    /**
     * UNIFIED INGESTION ENTRY POINT
     * Now redirects to streaming logic even for string inputs to ensure consistency and memory safety.
     */
    static async parseLorePack(input: string | Blob, defaultAgentId: string = 'UNKNOWN'): Promise<IngestionResult> {
        try {
            // Convert string input to Blob to use the unified streaming pipeline
            let fileBlob: Blob;
            if (typeof input === 'string') {
                if (!input || input.trim().length === 0) throw new Error("Input is empty");
                fileBlob = new Blob([input], { type: 'application/json' });
            } else {
                fileBlob = input;
            }

            // Accumulate results from stream
            const docs: KnowledgeDoc[] = [];
            let header: LorePackHeader = NumMarkX_GenerateHeader(defaultAgentId, defaultAgentId, "Streamed Import");
            let count = 0;

            for await (const obj of IngestionService.streamLorePack(fileBlob)) {
                if (obj.schema === 'MYTHOS.LOREPACK.v1' || (obj.agentId && obj.handle)) {
                    // It's the header
                    header = {
                         schema: 'MYTHOS.LOREPACK.v1',
                         id: obj.id || crypto.randomUUID(),
                         agentId: obj.agentId || defaultAgentId,
                         handle: obj.handle || obj.agentId || defaultAgentId,
                         version: obj.version || 1,
                         timestamp: obj.timestamp || Date.now(),
                         description: obj.description
                    };
                } else if (obj.content || obj.text || obj.sacred_archive || Array.isArray(obj)) {
                    // It's data
                    if (Array.isArray(obj)) {
                        // If we yielded a whole array (small file), flatten it
                        obj.forEach(sub => docs.push(IngestionService.normalizeNode(sub, header.agentId, count++)));
                    } else if (obj.sacred_archive) {
                        // Wrapped object that wasn't caught as header
                        obj.sacred_archive.forEach((sub: any) => docs.push(IngestionService.normalizeNode(sub, header.agentId, count++)));
                    } else {
                        // Single Node
                        docs.push(IngestionService.normalizeNode(obj, header.agentId, count++));
                    }
                }
            }

            return {
                success: true,
                header,
                docs,
                stats: {
                    total: docs.length,
                    withVectors: docs.filter(d => d.embedding).length,
                    avgSize: docs.length > 0 ? Math.round(docs.reduce((acc, c) => acc + c.content.length, 0) / docs.length) : 0,
                    existingSigils: docs.filter(d => d.numMarkId).length
                }
            };

        } catch (e: any) {
            console.error("[Forge] Ingestion Failed:", e);
            return {
                success: false,
                header: NumMarkX_GenerateHeader('ERROR', 'ERROR'),
                docs: [],
                error: e.message,
                stats: { total: 0, withVectors: 0, avgSize: 0, existingSigils: 0 }
            };
        }
    }

    /**
     * ROBUST STREAMING PROCESSOR
     * Handles Arrays [...], Objects { "nodes": [...] }, and Concatenated JSON {} {}
     */
    static async *streamLorePack(file: Blob): AsyncGenerator<any, void, unknown> {
        const stream = file.stream();
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        
        let depth = 0;
        let inString = false;
        let escaped = false;
        
        // Root detection state
        let rootDetermined = false;
        let isArrayRoot = false;
        
        let objectBuffer = '';
        let buffering = false;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                
                for (let i = 0; i < chunk.length; i++) {
                    const char = chunk[i];

                    // --- 1. STRING STATE MACHINE ---
                    if (inString) {
                        if (char === '\\' && !escaped) {
                            escaped = true;
                        } else if (char === '"' && !escaped) {
                            inString = false;
                        } else {
                            escaped = false;
                        }
                        if (buffering) objectBuffer += char;
                        continue;
                    }

                    if (char === '"') {
                        inString = true;
                        if (buffering) objectBuffer += char;
                        continue;
                    }

                    // --- 2. ROOT DETECTION ---
                    if (!rootDetermined) {
                        if (/\s/.test(char)) continue; // Skip whitespace
                        
                        if (char === '[') {
                            isArrayRoot = true;
                            rootDetermined = true;
                            // We are inside the root array, depth remains 0 relative to items
                            continue;
                        } else if (char === '{') {
                            isArrayRoot = false;
                            rootDetermined = true;
                            // We are inside a root object.
                            // If this object CONTAINS the array, we need to dig deeper.
                            // But for streaming, we treat the root object properties as streamable items too if possible.
                            depth = 1; // We consumed the first {
                            // Actually, let's treat the root object as a container.
                            // We want to capture items INSIDE it.
                            continue;
                        }
                    }

                    // --- 3. STRUCTURE PARSING ---
                    if (char === '{') {
                        // When to start buffering?
                        // If Array Root: Items are at depth 0 -> 1 (start at {)
                        // If Object Root: Items (like header) are at depth 1 -> 2
                        
                        const triggerDepth = isArrayRoot ? 0 : 1;
                        
                        if (depth === triggerDepth) {
                            buffering = true;
                            objectBuffer = '';
                        }
                        
                        depth++;
                        if (buffering) objectBuffer += char;
                    } 
                    else if (char === '}') {
                        if (buffering) objectBuffer += char;
                        depth--;
                        
                        const triggerDepth = isArrayRoot ? 0 : 1;

                        if (depth === triggerDepth && buffering) {
                            buffering = false;
                            // Emit Object
                            try {
                                const parsed = JSON.parse(objectBuffer);
                                yield parsed;
                            } catch (e) {
                                // Squelch parsing errors for partial/malformed chunks
                            }
                            objectBuffer = '';
                        }
                    }
                    else if (buffering) {
                        objectBuffer += char;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    static normalizeNode(n: any, agentId: string, index: number): KnowledgeDoc {
        const content = n.content || n.text || n.value || '';
        // Handle various vector formats (OpenAI style, Gemini style)
        const embedding = n.embedding || n.vector || n.values;
        // Generate deterministic sigil if missing
        const sigil = n.numMarkId || NumMarkX_GenerateSigil(typeof content === 'string' ? content : 'nodata');

        return {
            id: n.id || NumMarkX_GenerateID('LORE'),
            agentId: agentId, 
            title: n.title || n.name || `Lore Node ${index + 1}`,
            content: typeof content === 'string' ? content : JSON.stringify(content),
            embedding: Array.isArray(embedding) ? embedding : undefined,
            timestamp: n.timestamp || Date.now(),
            numMarkId: sigil, 
            tags: n.tags || []
        };
    }

    static exportLorePack(header: LorePackHeader, docs: KnowledgeDoc[]): Blob {
        const parts: BlobPart[] = [];
        parts.push(`{\n  "header": ${JSON.stringify(header, null, 2)},\n  "sacred_archive": [`);
        for (let i = 0; i < docs.length; i++) {
            const docStr = JSON.stringify(docs[i]); 
            parts.push(i === 0 ? "\n    " + docStr : ",\n    " + docStr);
        }
        parts.push("\n  ]\n}");
        return new Blob(parts, { type: 'application/json' });
    }
}
