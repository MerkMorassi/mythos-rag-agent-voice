
import { KnowledgeDoc, LorePack, LorePackHeader, GraphNode, GraphEdge } from '../types';
import { NumMarkX_GenerateHeader, NumMarkX_GenerateID, NumMarkX_GenerateSigil } from '../patterns/NumMarkX';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
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
        // Increase batch size for Embeddings API (Supports up to 100, strictly)
        // Larger batches reduce HTTP overhead
        const BATCH_SIZE = 20; 
        let savedCount = 0;

        // Process batches
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            try {
                // 1. Get Embeddings for Batch
                // Wrapped in Retry Logic
                const batchResult = await retryWithBackoff(() => ai.models.embedContent({
                    model: 'text-embedding-004',
                    contents: batch.map(c => ({ parts: [{ text: c }] })),
                    config: { taskType: 'RETRIEVAL_DOCUMENT', title: filename }
                }));
                
                const embeddings = (batchResult as any).embeddings;

                // 2. Prepare Save & Extract Tasks
                // Execute Graph Extraction in parallel (limited pool)
                // Gemini 3 Flash is faster, allowing higher concurrency (5)
                await asyncPool(5, batch, async (chunk, list) => {
                    const k = batch.indexOf(chunk);
                    const docId = crypto.randomUUID();
                    
                    // A. Extract Graph
                    try {
                        await this.extractAndSaveGraph(chunk, docId, agentId, ai);
                    } catch(e) {
                        console.warn("Graph extract failed for chunk", k, e);
                    }

                    // B. Save Doc
                    const doc: KnowledgeDoc = {
                        id: docId,
                        agentId: agentId,
                        title: `${filename} (Part ${i + k + 1})`,
                        content: chunk,
                        embedding: embeddings?.[k]?.values,
                        timestamp: Date.now(),
                        tags: ['AUTO_INGEST', 'CHAT_UPLOAD', 'GRAPH_EXTRACTED'],
                        numMarkId: NumMarkX_GenerateSigil(chunk)
                    };
                    await addDocument(doc);
                });

                savedCount += batch.length;
                if (onProgress) onProgress(savedCount, chunks.length);
                
            } catch (e) {
                console.warn(`[Ingestion] Batch failed for ${filename}:`, e);
                
                // Fallback: Save without vector/graph if API fails completely
                for(let k=0; k<batch.length; k++) {
                    const chunk = batch[k];
                    const doc: KnowledgeDoc = {
                        id: crypto.randomUUID(),
                        agentId: agentId,
                        title: `${filename} (Part ${i + k + 1})`,
                        content: chunk,
                        timestamp: Date.now(),
                        tags: ['AUTO_INGEST', 'CHAT_UPLOAD', 'NO_VECTOR', 'GRAPH_EXTRACTED'],
                        numMarkId: NumMarkX_GenerateSigil(chunk)
                    };
                    await addDocument(doc);
                }
                savedCount += batch.length;
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
                // If it's not valid JSON, treat it as raw text wrapped in a doc
                console.warn("Invalid JSON in LorePack, treating as text.");
                yield { content: text, title: "Raw Import" };
                return;
            }

            // Structure 1: LorePack { header: {}, sacred_archive: [] }
            if (data.header) {
                yield data.header;
            }

            // Find the array content, supporting various property names
            let items: any[] = [];
            
            if (Array.isArray(data)) {
                items = data;
            } else {
                // Look for *any* array property if typical ones aren't found
                const possibleArrays = [
                    data.sacred_archive, 
                    data.docs, 
                    data.documents, 
                    data.nodes,
                    data.items,
                    data.records,
                    data.data
                ];
                
                const foundArray = possibleArrays.find(arr => Array.isArray(arr));
                
                if (foundArray) {
                    items = foundArray;
                } else if (!data.header) {
                    // If no array found and no header, assume the object itself is the doc
                    items = [data];
                }
            }

            for (const item of items) {
                yield item;
            }

        } catch (e: any) {
            console.error("LorePack JSON Parse Error:", e);
            throw new Error(`Invalid LorePack JSON: ${e.message}`);
        }
    }

    static normalizeNode(n: any, agentId: string, index: number): KnowledgeDoc {
        // Handle raw strings (common in basic array exports)
        let content = '';
        if (typeof n === 'string') {
            content = n;
        } else {
            content = n.content || n.text || n.value || n.pageContent || n.body || '';
        }

        const embedding = n.embedding || n.vector || n.values;
        const sigil = n.numMarkId || NumMarkX_GenerateSigil(content.length > 0 ? content : 'nodata');
        
        return {
            id: n.id || NumMarkX_GenerateID('LORE'),
            agentId: agentId, 
            title: n.title || n.name || `Lore Node ${index + 1}`,
            content: content,
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

    // --- RECURSIVE CHUNK TEXT ---
    // Hierarchical chunking: Headers > Paragraphs > Sentences > Words
    static chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
        // 1. Recursive splitting logic
        const recursiveSplit = (str: string, separators: string[]): string[] => {
            const finalChunks: string[] = [];
            const separator = separators[0];
            const remainingSeparators = separators.slice(1);
            
            // Base Case: If chunk is small enough, return it
            if (str.length <= chunkSize) return [str];
            
            // Fallback: If no separators left, hard split
            if (separators.length === 0) {
                for (let i = 0; i < str.length; i += chunkSize - overlap) {
                    finalChunks.push(str.slice(i, i + chunkSize));
                }
                return finalChunks;
            }

            // Split by current separator
            // Use regex to lookahead for headers (keep headers attached)
            let parts: string[] = [];
            if (separator.includes('#')) {
                // Split before the header
                // Note: JS split consumes separator unless captured. 
                // We use positive lookahead regex to match position before header
                const regex = new RegExp(`(?=${separator})`); 
                parts = str.split(regex);
            } else {
                // For paragraphs/newlines, we consume the separator but might want to re-inject it for readability
                // Here we just split
                parts = str.split(separator);
            }

            let currentChunk = '';
            
            for (const part of parts) {
                if (!part.trim()) continue;
                
                // Determine joiner based on separator type
                const joiner = separator.includes('#') ? '' : (separator.includes('\n') ? '\n\n' : ' ');

                if (part.length > chunkSize) {
                    // Part is too big, flush current buffer first
                    if (currentChunk) {
                        finalChunks.push(currentChunk.trim());
                        currentChunk = '';
                    }
                    // Recurse on the big part
                    const subChunks = recursiveSplit(part, remainingSeparators);
                    finalChunks.push(...subChunks);
                } else {
                    // Accumulate
                    const nextPotential = currentChunk ? (currentChunk + joiner + part) : part;
                    
                    if (nextPotential.length > chunkSize) {
                        finalChunks.push(currentChunk.trim());
                        
                        // Overlap Logic: Take tail of previous chunk to start new one
                        const overlapTxt = currentChunk.slice(-overlap);
                        currentChunk = overlapTxt + joiner + part;
                    } else {
                        currentChunk = nextPotential;
                    }
                }
            }
            if (currentChunk.trim()) finalChunks.push(currentChunk.trim());
            
            return finalChunks;
        };

        // 2. Define delimiters in order of semantic importance
        // Headers -> Double Newline (Para) -> Single Newline -> Sentence -> Space
        const delimiters = ['\n# ', '\n## ', '\n### ', '\n\n', '\n', '. ', ' '];
        
        // Normalize line endings before processing
        const cleanText = text.replace(/\r\n/g, '\n');
        
        return recursiveSplit(cleanText, delimiters);
    }
}
