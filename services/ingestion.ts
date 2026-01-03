
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
     */
    static async parseLorePack(input: string | Blob, defaultAgentId: string = 'UNKNOWN'): Promise<IngestionResult> {
        try {
            let fileBlob: Blob;
            if (typeof input === 'string') {
                if (!input || input.trim().length === 0) throw new Error("Input is empty");
                fileBlob = new Blob([input], { type: 'application/json' });
            } else {
                fileBlob = input;
            }

            const docs: KnowledgeDoc[] = [];
            let header: LorePackHeader = NumMarkX_GenerateHeader(defaultAgentId, defaultAgentId, "Streamed Import");
            let count = 0;

            for await (const obj of IngestionService.streamLorePack(fileBlob)) {
                if (obj.schema === 'MYTHOS.LOREPACK.v1' || (obj.agentId && obj.handle)) {
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
                    if (Array.isArray(obj)) {
                        obj.forEach(sub => docs.push(IngestionService.normalizeNode(sub, header.agentId, count++)));
                    } else if (obj.sacred_archive) {
                        obj.sacred_archive.forEach((sub: any) => docs.push(IngestionService.normalizeNode(sub, header.agentId, count++)));
                    } else {
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
     */
    static async *streamLorePack(file: Blob): AsyncGenerator<any, void, unknown> {
        const stream = file.stream();
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        
        let depth = 0;
        let inString = false;
        let escaped = false;
        
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

                    if (!rootDetermined) {
                        if (/\s/.test(char)) continue; 
                        
                        if (char === '[') {
                            isArrayRoot = true;
                            rootDetermined = true;
                            continue;
                        } else if (char === '{') {
                            isArrayRoot = false;
                            rootDetermined = true;
                            depth = 1;
                            continue;
                        }
                    }

                    if (char === '{') {
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
                            try {
                                const parsed = JSON.parse(objectBuffer);
                                yield parsed;
                            } catch (e) { }
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
        const embedding = n.embedding || n.vector || n.values;
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

    /**
     * STRUCTURE-AWARE RECURSIVE CHUNKER
     * Splits text by Headers -> Paragraphs -> Sentences to preserve context.
     */
    static chunkText(text: string, maxChunkSize: number = 1000, overlap: number = 100): string[] {
        const chunks: string[] = [];
        
        // 1. Split by Markdown Headers (Narrative Scenes)
        // Regex looks for # Header at start of line
        const sections = text.split(/(?=^#{1,3}\s)/gm);

        for (const section of sections) {
            if (section.trim().length === 0) continue;

            // If section fits, keep it whole (Preserve Context)
            if (section.length <= maxChunkSize) {
                chunks.push(section.trim());
                continue;
            }

            // 2. If too big, split by Paragraphs
            const paragraphs = section.split(/\n\s*\n/);
            let currentChunk = "";

            for (const para of paragraphs) {
                // If adding this para exceeds limit, push current and start new
                if ((currentChunk.length + para.length) > maxChunkSize) {
                    if (currentChunk) chunks.push(currentChunk.trim());
                    // Start new chunk with overlap from previous (The "Narrative Tail")
                    const tail = currentChunk.slice(-overlap);
                    currentChunk = tail + "\n\n" + para;
                } else {
                    currentChunk += (currentChunk ? "\n\n" : "") + para;
                }
            }
            if (currentChunk) chunks.push(currentChunk.trim());
        }

        return chunks;
    }
}
