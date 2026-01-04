
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
     * AUTO-INGESTION FOR CHAT FILES + GRAPH EXTRACTION (GraphMAGRAG Lite)
     */
    static async ingestText(
        text: string, 
        filename: string, 
        agentId: string, 
        apiKey: string
    ): Promise<number> {
        const chunks = this.chunkText(text);
        if (chunks.length === 0) return 0;

        const ai = new GoogleGenAI({ apiKey });
        const BATCH_SIZE = 10; 
        let savedCount = 0;

        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            
            // 1. Generate Embeddings & Save Docs
            try {
                const batchResult = await ai.models.embedContent({
                    model: 'text-embedding-004',
                    contents: batch.map(c => ({ parts: [{ text: c }] })),
                    config: { taskType: 'RETRIEVAL_DOCUMENT', title: filename }
                });
                
                const embeddings = batchResult.embeddings;

                // Save Documents
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
                    
                    // --- GRAPH EXTRACTION (For every 2nd chunk to save tokens/time) ---
                    // "Lite" Mode: We don't extract every single chunk to keep it fast.
                    if ((i + k) % 2 === 0) {
                       this.extractAndSaveGraph(chunk, docId, agentId, ai).catch(e => console.warn("Graph extract failed", e));
                    }
                });

                await Promise.all(savePromises);
                savedCount += batch.length;

            } catch (e) {
                console.warn(`[Ingestion] Batch failed for ${filename}:`, e);
                // Fallback: Save without vectors
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

    /**
     * EXTRACT ENTITIES AND RELATIONSHIPS
     * Uses Gemini to parse text into Graph Nodes and Edges
     */
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
                model: 'gemini-3-flash-preview',
                contents: [{ parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: "application/json"
                }
            });

            const raw = result.text;
            if(!raw) return;
            const data = JSON.parse(raw);

            // Save Nodes
            if (data.entities) {
                for (const e of data.entities) {
                    // ID Normalization: UPPERCASE_UNDERSCORE
                    const id = e.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
                    
                    // Check if we need embedding for node (Lite mode: skip node embeddings for speed, rely on text lookup)
                    // If we want node embeddings, we'd batch call embedContent here.
                    
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

            // Save Edges
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

        } catch (e) {
            // console.warn("Graph Extraction Failed (Non-fatal)", e);
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
                            objectBuffer += char;
                        } else if (buffering) {
                            objectBuffer += char;
                        }
                        depth++;
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
     * Prevents giant chunks from large paragraphs.
     * 
     * SAFE MODE: Detects binary and uses fallback simple chunking for massive files.
     */
    static chunkText(text: string, maxChunkSize: number = 1000, overlap: number = 100): string[] {
        // 0. Binary Detection (Null characters)
        // If >0.1% of characters are null, likely binary.
        if (text.includes('\0')) {
             throw new Error("Binary content detected. Please upload valid text/markdown/json.");
        }

        const chunks: string[] = [];
        
        try {
            // 1. Split by Markdown Headers (Narrative Scenes)
            // Safety: If file is too large, skip regex split to avoid stack overflow/memory issues
            let sections = [text];
            if (text.length < 5 * 1024 * 1024) { // 5MB Limit for Regex Split
                sections = text.split(/(?=^#{1,3}\s)/gm);
            }

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
                    // 3. FORCE SPLIT GIANT PARAGRAPHS
                    if (para.length > maxChunkSize) {
                        // Flush current
                        if (currentChunk) {
                            chunks.push(currentChunk.trim());
                            currentChunk = "";
                        }
                        
                        let i = 0;
                        while (i < para.length) {
                            let end = i + maxChunkSize;
                            if (end > para.length) end = para.length;
                            chunks.push(para.substring(i, end).trim());
                            i = end - overlap; 
                            if (i < 0) i = 0; // Prevent infinite loop if overlap >= maxChunkSize
                            // Safety break for logic error
                            if (i >= para.length) break;
                        }
                        continue; 
                    }

                    // If adding this para exceeds limit, push current and start new
                    if ((currentChunk.length + para.length) > maxChunkSize) {
                        if (currentChunk) chunks.push(currentChunk.trim());
                        // Start new chunk with overlap
                        const tail = currentChunk.slice(-overlap);
                        currentChunk = tail + "\n\n" + para;
                    } else {
                        currentChunk += (currentChunk ? "\n\n" : "") + para;
                    }
                }
                if (currentChunk) chunks.push(currentChunk.trim());
            }
        } catch (e) {
            console.warn("Regex chunking failed, falling back to simple linear chunking.", e);
            // FALLBACK: LINEAR SCAN
            let i = 0;
            while (i < text.length) {
                let end = i + maxChunkSize;
                if (end > text.length) end = text.length;
                chunks.push(text.substring(i, end).trim());
                i = end - overlap;
                if (i < 0) i = 0;
            }
        }

        return chunks;
    }
}
