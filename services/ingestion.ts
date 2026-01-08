import { KnowledgeDoc, LorePack, LorePackHeader } from '../types';
import { NumMarkX_GenerateHeader, NumMarkX_GenerateID, NumMarkX_GenerateSigil } from '../patterns/NumMarkX';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { addDocument, getDocumentsByAgentId, bulkAddDocuments } from "./db";

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
                    tags: ['AUTO_INGEST', 'CHAT_UPLOAD'],
                    numMarkId: NumMarkX_GenerateSigil(chunk),
                    sourceFile: filename
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
                    numMarkId: NumMarkX_GenerateSigil(chunk),
                    sourceFile: filename
                }));
                await bulkAddDocuments(docsToSave);

                savedCount += batchChunks.length;
                if (onProgress) onProgress(savedCount, chunks.length);
            }
        }
        return savedCount;
    }

    /**
     * Robust Stream Parser
     * Replaced custom byte-stream parser with JSON.parse for reliability.
     */
    // FIX: Changed `file: Blob` to `file: File` as `file.name` is used.
    static async *streamLorePack(file: File): AsyncGenerator<any, void, unknown> {
        console.log(`[IngestionService] Starting stream for file: ${file.name}, type: ${file.type}`);
        try {
            const text = await file.text();
            
            if (!text.trim()) {
                console.warn("[IngestionService] LorePack file is empty.");
                return;
            }

            let data;
            try {
                data = JSON.parse(text);
                console.log(`[IngestionService] JSON parsing successful. Detected data type: ${typeof data}, isArray: ${Array.isArray(data)}`);
            } catch (e: any) {
                console.error("[IngestionService] JSON parsing failed:", e.message);
                throw new Error("Invalid JSON format. Ensure the file is a valid JSON array or a single JSON object.");
            }

            if (Array.isArray(data)) {
                for (const item of data) {
                    yield item;
                }
            } else if (typeof data === 'object' && data !== null) {
                if ((data as LorePack).header && (data as LorePack).sacred_archive) {
                    console.log("[IngestionService] Detected LorePack schema (header + sacred_archive).");
                    yield (data as LorePack).header;
                    for (const doc of (data as LorePack).sacred_archive) {
                        yield doc;
                    }
                } else {
                    console.log("[IngestionService] Detected single JSON object (non-LorePack schema).");
                    yield data;
                }
            } else {
                console.error(`[IngestionService] Unexpected top-level data format: ${typeof data}. Expected array or object.`);
                throw new Error("Unsupported file content structure. Expected a JSON array of documents or a LorePack object.");
            }

        } catch (err: any) {
            console.error("[IngestionService] LorePack Stream Error:", err);
            throw new Error(`Failed to parse file: ${err.message}`);
        }
    }

    /**
     * Normalizes a raw object from a JSON import into a valid KnowledgeDoc.
     * Ensures `content` and `title` always resolve to non-empty strings.
     */
    static normalizeNode(obj: any, agentId: string, index: number): KnowledgeDoc {
        let content = '';
        if (typeof obj === 'string') {
            content = obj;
        } else if (typeof obj === 'object' && obj !== null) {
            content = obj.content || obj.text || obj.body || JSON.stringify(obj);
        } else {
            content = String(obj); // Convert any primitive to string
        }
        
        if (!content.trim()) {
            content = `[Empty Content for Node ${index + 1}]`;
            console.warn(`[IngestionService] Node ${index + 1} has empty content. Using fallback: "${content}"`);
        }

        let title = '';
        if (typeof obj === 'object' && obj !== null) {
            title = obj.title || obj.name || (content.split('\n')[0] || `Imported Document ${index + 1}`).substring(0, 100);
        } else {
            title = (content.split('\n')[0] || `Imported Document ${index + 1}`).substring(0, 100);
        }

        if (!title.trim()) {
            title = `Untitled Document ${index + 1}`;
            console.warn(`[IngestionService] Node ${index + 1} has empty title. Using fallback: "${title}"`);
        }

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