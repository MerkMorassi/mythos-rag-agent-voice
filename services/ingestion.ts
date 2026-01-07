import { KnowledgeDoc, LorePack, LorePackHeader, GraphNode, GraphEdge } from '../types';
import { NumMarkX_GenerateHeader, NumMarkX_GenerateID, NumMarkX_GenerateSigil } from '../patterns/NumMarkX';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { addDocument, saveGraphNode, saveGraphEdge, getDocumentsByAgentId, bulkAddDocuments } from "./db";

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

// Simple p-limit style concurrency controller
async function asyncPool(poolLimit: number, array: any[], iteratorFn: (item: any, array: any[]) => Promise<any>) {
    const ret = [];
    const executing: Promise<any>[] = [];
    for (const item of array) {
        const p = Promise.resolve().then(() => iteratorFn(item, array));
        ret.push(p);

        if (poolLimit <= array.length) {
            const e: Promise<any> = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= poolLimit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(ret);
}

// Helper: Retry with Exponential Backoff
async function retryWithBackoff<T>(operation: () => Promise<T>, retries = 3, baseDelay = 1000): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        if (retries > 0 && (
            error.message?.includes('unavailable') || 
            error.message?.includes('503') || 
            error.message?.includes('429') ||
            error.status === 503
        )) {
            const delay = baseDelay * (Math.random() + 1); // Add jitter
            console.warn(`[Retry] Operation failed (${error.message}). Retrying in ${Math.round(delay)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return retryWithBackoff(operation, retries - 1, baseDelay * 2);
        }
        throw error;
    }
}

export class IngestionService {

    /**
     * CANONICAL FILENAME GENERATOR
     * Enforces the "MYTHOS.LORE.[SOVEREIGN].LOREPACK.[DATE]" standard.
     */
    static buildCanonicalFilename(agentId: string): string {
        // Strip "agent-" prefix and Uppercase
        const cleanId = agentId.replace(/^agent-/i, '').toUpperCase();
        const date = new Date().toISOString().slice(0, 10);
        return `MYTHOS.LORE.${cleanId}.LOREPACK.${date}.json`;
    }

    /**
     * RETROFIT PROTOCOL (INCREMENTAL)
     * Upgrades existing documents to include Graph Data and NumMark Sigils.
     * Skips documents tagged with 'GRAPH_EXTRACTED' to allow resuming.
     * Optimized with concurrency pool.
     */
    static async retrofitAgentMemory(agentId: string, apiKey: string, onProgress?: (current: number, total: number) => void): Promise<number> {
        const docs = await getDocumentsByAgentId(agentId);
        if (docs.length === 0) return 0;

        const ai = new GoogleGenAI({ apiKey });
        let processed = 0;

        // Parallel processing for retrofitting to improve speed
        await asyncPool(5, docs, async (doc: KnowledgeDoc) => {
            
            // OPTIMIZATION: Skip if already has graph data
            if (doc.tags && doc.tags.includes('GRAPH_EXTRACTED')) {
                processed++;
                if (onProgress) onProgress(processed, docs.length);
                return;
            }

            let updated = false;

            // 1. Generate Sigil if missing
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
            }

            // 3. Save Update if we changed tags or sigil
            if (updated) {
                await addDocument(doc);
            }
            
            processed++;
            if (onProgress) onProgress(processed, docs.length);
        });

        return processed;
    }

    static async ingestText(text: string, filename: string, agentId: string, apiKey: string, onProgress?: (processed: number, total: number) => void): Promise<number> {
        // Yield to let UI render initial "Processing" state
        await new Promise(r => setTimeout(r, 10));

        const chunks = this.chunkText(text);
        if (chunks.length === 0) return 0;

        // REPORT INITIAL TOTAL IMMEDIATELY so UI bar appears
        if (onProgress) onProgress(0, chunks.length);

        const ai = new GoogleGenAI({ apiKey });
        const BATCH_SIZE = 100; // Max batch size for embedContent API
        let savedCount = 0;

        // Process batches
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batchChunks = chunks.slice(i, i + BATCH_SIZE);
            try {
                // 1. Get Embeddings for Batch
                const batchResult = await retryWithBackoff(() => ai.models.embedContent({
                    model: 'text-embedding-004',
                    contents: batchChunks.map(c => ({ parts: [{ text: c }] })),
                    config: { taskType: 'RETRIEVAL_DOCUMENT', title: filename }
                }));
                
                const embeddings = (batchResult as any).embeddings;

                // 2. Prepare docs for batch saving
                const docsToSave: KnowledgeDoc[] = batchChunks.map((chunk, k) => ({
                    id: NumMarkX_GenerateID('INGEST'),
                    agentId: agentId,
                    title: `${filename} (Part ${i + k + 1})`,
                    content: chunk,
                    embedding: embeddings?.[k]?.values,
                    timestamp: Date.now(),
                    tags: ['AUTO_INGEST', 'CHAT_UPLOAD'], // Graph extraction is now a separate process
                    numMarkId: NumMarkX_GenerateSigil(chunk)
                }));
                
                // 3. Save all docs in the batch at once
                await bulkAddDocuments(docsToSave);

                savedCount += batchChunks.length;
                if (onProgress) onProgress(savedCount, chunks.length);
                
            } catch (e) {
                console.warn(`[Ingestion] Embedding failed for batch in ${filename}:`, e);
                
                // Fallback: Save batch without vectors if API fails
                const docsToSave: KnowledgeDoc[] = batchChunks.map((chunk, k) => ({
                    id: NumMarkX_GenerateID('INGEST'),
                    agentId: agentId,
                    title: `${filename} (Part ${i + k + 1})`,
                    content: chunk,
                    timestamp: Date.now(),
                    tags: ['AUTO_INGEST', 'CHAT_UPLOAD', 'NO_VECTOR'],
                    numMarkId: NumMarkX_GenerateSigil(chunk)
                }));
                await bulkAddDocuments(docsToSave);

                savedCount += batchChunks.length;
                if (onProgress) onProgress(savedCount, chunks.length);
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
            // Wrapped in Retry Logic
            const result = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
                model: 'gemini-3-flash-preview', 
                contents: [{ parts: [{ text: prompt }] }],
                config: { responseMimeType: "application/json" }
            }));

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
        } catch (e) { 
            // Silent fail for graph extraction to prevent total ingest failure
        }
    }

    /**
     * Robust Stream Parser
     * Replaced custom byte-stream parser with JSON.parse for reliability.
     */
    static async *streamLorePack(file: Blob): AsyncGenerator<any, void, unknown> {
        try {
            const text = await file.text();
            
            // Handle empty files gracefully
            if (!text.trim()) return;

            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                throw new Error("Invalid JSON format. Ensure the file is a valid JSON array or a single JSON object.");
            }

            // Handle both array of objects and single object formats
            if (Array.isArray(data)) {
                for (const item of data) {
                    yield item;
                }
            } else if (typeof data === 'object' && data !== null) {
                // If it's a LorePack, yield the header then the docs
                if ((data as LorePack).header && (data as LorePack).sacred_archive) {
                    yield data.header;
                    for (const doc of (data as LorePack).sacred_archive) {
                        yield doc;
                    }
                } else {
                    yield data;
                }
            }

        } catch (err: any) {
            console.error("LorePack Stream Error:", err);
            throw new Error(`Failed to parse file: ${err.message}`);
        }
    }

    /**
     * Normalizes a raw object from a JSON import into a valid KnowledgeDoc.
     */
    static normalizeNode(obj: any, agentId: string, index: number): KnowledgeDoc {
        // Use any available text-like field as content
        const content = obj.content || obj.text || obj.body || JSON.stringify(obj, null, 2);
        
        // Use any available title-like field
        const title = obj.title || obj.name || `Imported Document ${index + 1}`;
        
        return {
            id: obj.id || crypto.randomUUID(),
            agentId: agentId,
            title: title,
            content: content,
            timestamp: obj.timestamp || Date.now(),
            embedding: obj.embedding,
            numMarkId: obj.numMarkId
        };
    }
    
    /**
     * EXPORT LOREPACK
     * Packages documents and a header into a Blob.
     */
    static exportLorePack(header: LorePackHeader, docs: KnowledgeDoc[]): Blob {
        const fullPack = {
            header: header,
            sacred_archive: docs
        };
        const str = JSON.stringify(fullPack, null, 2);
        return new Blob([str], { type: 'application/json' });
    }

    // --- PRIVATE HELPERS ---

    private static chunkText(text: string): string[] {
        const CHUNK_SIZE = 1500;
        const chunks: string[] = [];
        const cleanText = text.replace(/\r\n/g, '\n');
        
        let startIndex = 0;
        while (startIndex < cleanText.length) {
            let endIndex = startIndex + CHUNK_SIZE;
            
            if (endIndex >= cleanText.length) {
                endIndex = cleanText.length;
            } else {
                // Try to find a natural break (newline or sentence end)
                const lastNewline = cleanText.lastIndexOf('\n', endIndex);
                if (lastNewline > startIndex && lastNewline > endIndex - 200) {
                    endIndex = lastNewline;
                } else {
                     const lastSpace = cleanText.lastIndexOf(' ', endIndex);
                     if (lastSpace > startIndex) endIndex = lastSpace;
                }
            }
            
            const chunk = cleanText.substring(startIndex, endIndex).trim();
            if (chunk) chunks.push(chunk);
            startIndex = endIndex;
        }
        return chunks;
    }
}