
import { KnowledgeDoc, LorePack, LorePackHeader, GraphNode, GraphEdge } from '../types';
import { NumMarkX_GenerateHeader, NumMarkX_GenerateID, NumMarkX_GenerateSigil } from '../patterns/NumMarkX';
import { GoogleGenAI, Type } from "@google/genai";
import { addDocument, saveGraphNode, saveGraphEdge, getDocumentsByAgentId } from "./db";

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
     * RETROFIT PROTOCOL (INCREMENTAL)
     * Upgrades existing documents to include Graph Data and NumMark Sigils.
     * Skips documents tagged with 'GRAPH_EXTRACTED' to allow resuming.
     */
    static async retrofitAgentMemory(agentId: string, apiKey: string, onProgress?: (current: number, total: number) => void): Promise<number> {
        const docs = await getDocumentsByAgentId(agentId);
        if (docs.length === 0) return 0;

        const ai = new GoogleGenAI({ apiKey });
        let processed = 0;

        // Process sequentially to avoid rate limits on the Graph Extraction Model
        for (const doc of docs) {
            
            // OPTIMIZATION: Skip if already has graph data
            if (doc.tags && doc.tags.includes('GRAPH_EXTRACTED')) {
                processed++;
                if (onProgress) onProgress(processed, docs.length);
                continue;
            }

            let updated = false;

            // 1. Generate Sigil if missing (Safety check, though you said they exist)
            if (!doc.numMarkId) {
                doc.numMarkId = NumMarkX_GenerateSigil(doc.content);
                updated = true;
            }

            // 2. Extract Graph
            try {
                await this.extractAndSaveGraph(doc.content, doc.id, agentId, ai);
                
                // Mark as processed
                if (!doc.tags) doc.tags = [];
                if (!doc.tags.includes('GRAPH_EXTRACTED')) {
                    doc.tags.push('GRAPH_EXTRACTED');
                    updated = true;
                }
            } catch (e) {
                console.warn(`[Retrofit] Graph extraction failed for ${doc.id}`, e);
                // We do NOT mark as extracted so it can be retried later
            }

            // 3. Save Update if we changed tags or sigil
            if (updated) {
                await addDocument(doc);
            }
            
            processed++;
            if (onProgress) onProgress(processed, docs.length);
            
            // Throttle slightly
            await new Promise(r => setTimeout(r, 800));
        }

        return processed;
    }

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
                        tags: ['AUTO_INGEST', 'CHAT_UPLOAD', 'GRAPH_EXTRACTED'], // Auto-mark new ingestions
                        numMarkId: NumMarkX_GenerateSigil(chunk)
                    };
                    await addDocument(doc);
                    // Generate Graph for every chunk to build dense connections
                    this.extractAndSaveGraph(chunk, docId, agentId, ai).catch(e => console.warn("Graph extract failed", e));
                });
                await Promise.all(savePromises);
                savedCount += batch.length;
            } catch (e) {
                console.warn(`[Ingestion] Batch failed for ${filename}:`, e);
                // Fallback save without vector
                const savePromises = batch.map((chunk, k) => {
                    const doc: KnowledgeDoc = {
                        id: crypto.randomUUID(),
                        agentId: agentId,
                        title: `${filename} (Part ${i + k + 1})`,
                        content: chunk,
                        timestamp: Date.now(),
                        tags: ['AUTO_INGEST', 'CHAT_UPLOAD', 'NO_VECTOR', 'GRAPH_EXTRACTED'],
                        numMarkId: NumMarkX_GenerateSigil(chunk)
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
        // Reduced Prompt for Speed/Cost
        const prompt = `
        Identify key ENTITIES (Person, Place, Object, Event) and RELATIONSHIPS in the text.
        Return JSON: { "entities": [{"name": "X", "label": "Y", "description": "Z"}], "relationships": [{"source": "X", "target": "A", "relation": "B"}] }
        TEXT: ${text.substring(0, 1500)}
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

    static chunkText(text: string, maxChunkSize: number = 1000, overlap: number = 100): string[] {
        if (text.includes('\0')) throw new Error("Binary content detected.");

        const chunks: string[] = [];
        let sections = text.split(/(?=^#{1,3}\s)|\n\s*\n/gm);
        
        if (sections.length === 1 && text.length > maxChunkSize * 5) {
             sections = text.split(/(?<=[.?!])\s+/);
        }

        let currentChunk = "";

        for (const section of sections) {
            const trimmed = section.trim();
            if (!trimmed) continue;

            if (currentChunk.length + trimmed.length <= maxChunkSize) {
                currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
                continue;
            }

            if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = "";
            }

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

    private static semanticSplit(text: string, limit: number, overlap: number): string[] {
        const results: string[] = [];
        const sentenceRegex = /(?<=[.?!])\s+/;
        const sentences = text.split(sentenceRegex);
        
        let buffer = "";
        
        for (const sentence of sentences) {
            if (buffer.length + sentence.length <= limit) {
                buffer += (buffer ? " " : "") + sentence;
            } else {
                if (sentence.length > limit) {
                    if (buffer) results.push(buffer);
                    buffer = "";
                    let i = 0;
                    while (i < sentence.length) {
                        results.push(sentence.substring(i, i + limit));
                        i += limit - overlap;
                    }
                } else {
                    results.push(buffer);
                    const overlapTxt = buffer.slice(-overlap);
                    buffer = overlapTxt + " " + sentence; 
                }
            }
        }
        if (buffer) results.push(buffer);
        return results;
    }
}
