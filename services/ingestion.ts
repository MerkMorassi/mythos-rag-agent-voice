
import { KnowledgeDoc, LorePack, LorePackHeader, GraphNode, GraphEdge } from '../types';
import { NumMarkX_GenerateHeader, NumMarkX_GenerateID, NumMarkX_GenerateSigil } from '../patterns/NumMarkX';
import { GoogleGenAI, Type } from "@google/genai";
import { addDocument, saveGraphNode, saveGraphEdge } from "./db";

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

    // ... (Keep existing methods: parseLorePack, streamLorePack, normalizeNode, exportLorePack, ingestText, extractAndSaveGraph - assuming they are unchanged for this task) ...
    // RE-INJECTING UNCHANGED METHODS FOR COMPLETENESS OF FILE, BUT FOCUSING ON CHUNKTEXT CHANGE BELOW.
    // DUE TO CONTEXT LIMIT, I WILL REWRITE THE FILE WITH THE CHUNKTEXT IMPROVEMENT.

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

    static async ingestText(text: string, filename: string, agentId: string, apiKey: string): Promise<number> {
        const chunks = this.chunkText(text);
        if (chunks.length === 0) return 0;

        const ai = new GoogleGenAI({ apiKey });
        const BATCH_SIZE = 10; 
        let savedCount = 0;

        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            try {
                const batchResult = await ai.models.embedContent({
                    model: 'text-embedding-004',
                    contents: batch.map(c => ({ parts: [{ text: c }] })),
                    config: { taskType: 'RETRIEVAL_DOCUMENT', title: filename }
                });
                
                const embeddings = batchResult.embeddings;
                const savePromises = batch.map(async (chunk, k) => {
                    const docId = crypto.randomUUID();
                    const doc: KnowledgeDoc = {
                        id: docId,
                        agentId: agentId,
                        title: `${filename} (Part ${i + k + 1})`,
                        content: chunk,
                        embedding: embeddings?.[k]?.values,
                        timestamp: Date.now(),
                        tags: ['AUTO_INGEST', 'CHAT_UPLOAD']
                    };
                    await addDocument(doc);
                    if ((i + k) % 2 === 0) {
                       this.extractAndSaveGraph(chunk, docId, agentId, ai).catch(e => console.warn("Graph extract failed", e));
                    }
                });
                await Promise.all(savePromises);
                savedCount += batch.length;
            } catch (e) {
                console.warn(`[Ingestion] Batch failed for ${filename}:`, e);
                const savePromises = batch.map((chunk, k) => {
                    const doc: KnowledgeDoc = {
                        id: crypto.randomUUID(),
                        agentId: agentId,
                        title: `${filename} (Part ${i + k + 1})`,
                        content: chunk,
                        timestamp: Date.now(),
                        tags: ['AUTO_INGEST', 'CHAT_UPLOAD', 'NO_VECTOR']
                    };
                    return addDocument(doc);
                });
                await Promise.all(savePromises);
                savedCount += batch.length;
            }
        }
        return savedCount;
    }

    static async extractAndSaveGraph(text: string, sourceDocId: string, agentId: string, ai: GoogleGenAI) {
        const prompt = `
        EXTRACT KNOWLEDGE GRAPH DATA.
        Analyze the text below. Identify key ENTITIES (Person, Location, Organization, Event, Concept) and RELATIONSHIPS.
        
        Output strictly JSON:
        {
          "entities": [
            { "name": "Exact Name", "label": "TYPE", "description": "Brief summary" }
          ],
          "relationships": [
            { "source": "Entity Name 1", "target": "Entity Name 2", "relation": "ACTION_OR_LINK", "description": "Context" }
          ]
        }
        
        TEXT:
        ${text.substring(0, 2000)}
        `;

        try {
            const result = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: [{ parts: [{ text: prompt }] }],
                config: { responseMimeType: "application/json" }
            });

            const raw = result.text;
            if(!raw) return;
            const data = JSON.parse(raw);

            if (data.entities) {
                for (const e of data.entities) {
                    const id = e.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
                    const node: GraphNode = {
                        id: id,
                        label: e.label?.toUpperCase() || 'CONCEPT',
                        name: e.name,
                        description: e.description || '',
                        sourceDocIds: [sourceDocId],
                        agentId: agentId,
                        timestamp: Date.now()
                    };
                    await saveGraphNode(node);
                }
            }

            if (data.relationships) {
                for (const r of data.relationships) {
                    const sourceId = r.source.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
                    const targetId = r.target.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
                    const edge: GraphEdge = {
                        id: `${sourceId}-${r.relation}-${targetId}`,
                        source: sourceId,
                        target: targetId,
                        relation: r.relation?.toUpperCase().replace(/\s+/g, '_') || 'RELATED_TO',
                        description: r.description,
                        agentId: agentId,
                        timestamp: Date.now()
                    };
                    await saveGraphEdge(edge);
                }
            }
        } catch (e) { }
    }

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
                        if (char === '\\' && !escaped) escaped = true;
                        else if (char === '"' && !escaped) inString = false;
                        else escaped = false;
                        if (buffering) objectBuffer += char;
                        continue;
                    }
                    if (char === '"') { inString = true; if (buffering) objectBuffer += char; continue; }
                    if (!rootDetermined) {
                        if (/\s/.test(char)) continue; 
                        if (char === '[') { isArrayRoot = true; rootDetermined = true; continue; }
                        else if (char === '{') { isArrayRoot = false; rootDetermined = true; depth = 1; continue; }
                    }
                    if (char === '{') {
                        const triggerDepth = isArrayRoot ? 0 : 1;
                        if (depth === triggerDepth) { buffering = true; objectBuffer += char; }
                        else if (buffering) { objectBuffer += char; }
                        depth++;
                    } 
                    else if (char === '}') {
                        if (buffering) objectBuffer += char;
                        depth--;
                        const triggerDepth = isArrayRoot ? 0 : 1;
                        if (depth === triggerDepth && buffering) {
                            buffering = false;
                            try { yield JSON.parse(objectBuffer); } catch (e) { }
                            objectBuffer = '';
                        }
                    }
                    else if (buffering) { objectBuffer += char; }
                }
            }
        } finally { reader.releaseLock(); }
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
     * SEMANTIC AWARE CHUNKER
     * Recursively splits by Paragraphs (\n\n) -> Sentences (. ) -> Punctuation (, ) -> Chars
     */
    static chunkText(text: string, maxChunkSize: number = 1000, overlap: number = 100): string[] {
        if (text.includes('\0')) throw new Error("Binary content detected.");

        const chunks: string[] = [];
        
        // 1. Primary Split: Paragraphs (Markdown Headers included in regex)
        // Split by double newlines or headers
        let sections = text.split(/(?=^#{1,3}\s)|\n\s*\n/gm);
        
        // Safety check for single massive line file
        if (sections.length === 1 && text.length > maxChunkSize * 5) {
             // Force split by period if no paragraphs found
             sections = text.split(/(?<=[.?!])\s+/);
        }

        let currentChunk = "";

        for (const section of sections) {
            const trimmed = section.trim();
            if (!trimmed) continue;

            // Simple Case: Fits in chunk
            if (currentChunk.length + trimmed.length <= maxChunkSize) {
                currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
                continue;
            }

            // Overflow Case: Push current if valid
            if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = "";
            }

            // If section itself is huge, Semantic Recursion required
            if (trimmed.length > maxChunkSize) {
                const subChunks = this.semanticSplit(trimmed, maxChunkSize, overlap);
                chunks.push(...subChunks);
            } else {
                currentChunk = trimmed;
            }
        }
        
        if (currentChunk) chunks.push(currentChunk);
        
        return chunks;
    }

    // Helper for recursive sentence splitting
    private static semanticSplit(text: string, limit: number, overlap: number): string[] {
        const results: string[] = [];
        
        // Attempt split by Sentence Endings
        // Look for . ? ! followed by space
        const sentenceRegex = /(?<=[.?!])\s+/;
        const sentences = text.split(sentenceRegex);
        
        let buffer = "";
        
        for (const sentence of sentences) {
            if (buffer.length + sentence.length <= limit) {
                buffer += (buffer ? " " : "") + sentence;
            } else {
                // If single sentence is massive (code blob, base64, etc), hard split
                if (sentence.length > limit) {
                    if (buffer) results.push(buffer);
                    buffer = "";
                    
                    // Char chop
                    let i = 0;
                    while (i < sentence.length) {
                        results.push(sentence.substring(i, i + limit));
                        i += limit - overlap;
                    }
                } else {
                    // Flush buffer
                    results.push(buffer);
                    // Start new buffer with overlap context (approx last 100 chars)
                    const overlapTxt = buffer.slice(-overlap);
                    buffer = overlapTxt + " " + sentence; 
                }
            }
        }
        if (buffer) results.push(buffer);
        
        return results;
    }
}
