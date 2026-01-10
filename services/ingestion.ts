import { VectorRecord } from '../types';
import { NumMarkX_GenerateID } from '../patterns/NumMarkX';
import { GeminiProvider } from './llmProviders/geminiProvider'; // Using the new provider for embedding
import { bulkPutVectors, getAllVectors, putVector } from "./db";

export const IngestionService = {

    /**
     * Ingests a block of text, chunks it, gets embeddings, and saves to the DB.
     * Adapted from the old IngestionService class.
     */
    async ingestText(
        text: string, 
        source: string, 
        agentHandle: string, 
        apiKey: string, 
        onProgress?: (processed: number, total: number) => void
    ): Promise<number> {
        await new Promise(r => setTimeout(r, 10)); // Yield for UI

        const chunks = this.chunkText(text);
        if (chunks.length === 0) return 0;

        if (onProgress) onProgress(0, chunks.length);

        const provider = new GeminiProvider(apiKey);
        let savedCount = 0;

        for (const chunk of chunks) {
            try {
                const vector = await provider.embed(chunk);
                const record: VectorRecord = {
                    id: NumMarkX_GenerateID('INGEST'),
                    agent: agentHandle,
                    text: chunk,
                    vector,
                    source,
                    timestamp: Date.now(),
                };
                await putVector(record);
                savedCount++;
                if (onProgress) onProgress(savedCount, chunks.length);
            } catch (e) {
                console.error(`[Ingestion] Embedding failed for chunk in ${source}:`, e);
                // Optionally save without vector on failure
            }
        }
        return savedCount;
    },

    /**
     * THE LOREPACK FORGE EXPORT
     * Exports all vectors to a .jsonl file, streaming directly to disk.
     */
    async exportLorePack(agentHandle: string) {
        const vectors = await getAllVectors();
        if (vectors.length === 0) throw new Error("Database Empty");

        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `MYTHOS.LORE.${agentHandle.toUpperCase()} ${dateStr}.jsonl`;

        // 1. Streaming Export (Chromium Native File System Access API)
        // Check for API existence more robustly
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await (window as any).showSaveFilePicker({
                    suggestedName: fileName,
                    types: [{ description: 'LorePack', accept: { 'application/jsonl': ['.jsonl'] } }]
                });
                const writable = await handle.createWritable();
                for (const v of vectors) {
                    await writable.write(JSON.stringify(v) + "\n");
                }
                await writable.close();
                console.log("LorePack Streaming Export Complete.");
                return; // <--- CRITICAL FIX: Stop execution here on success
            } catch (e) {
                if ((e as Error).name === 'AbortError') {
                    console.log("File save picker was cancelled.");
                    return; // <--- CRITICAL FIX: Stop execution if user cancels
                } else {
                    console.warn("Streaming export failed, falling back to Blob method.", e);
                    // Fall through to Blob method only on actual error
                }
            }
        }

        // 2. Blob Fallback (Legacy/Firefox)
        console.log("Using Blob fallback for export.");
        const content = vectors.map((v: any) => JSON.stringify(v)).join('\n');
        const blob = new Blob([content], { type: "application/jsonl" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    /**
     * THE LOREPACK IMPORT
     * Imports a .jsonl file, parsing each line and bulk-inserting into the database.
     * This version is robust and uses normalizeNode to handle schema variations.
     */
    async importLorePack(file: File, targetAgentHandle: string): Promise<number> {
        const text = await file.text();
        const lines = text.split('\n').filter(l => l.trim());
        
        // FIX: Batch Processing to prevent IndexedDB Transaction Size Limit errors
        const BATCH_SIZE = 500;
        let batch: VectorRecord[] = [];
        let totalProcessed = 0;
        let index = 0;
        
        for (const line of lines) {
            try {
                const record = JSON.parse(line);
                const normalizedRecord = this.normalizeNode(record, targetAgentHandle, index++);
                batch.push(normalizedRecord);

                if (batch.length >= BATCH_SIZE) {
                    await bulkPutVectors(batch);
                    totalProcessed += batch.length;
                    batch = []; // Clear batch
                }
            } catch (e) { 
                console.warn("Skipping corrupt or invalid line in LorePack:", line, e);
            }
        }
        
        // Flush remaining items
        if (batch.length > 0) {
            await bulkPutVectors(batch);
            totalProcessed += batch.length;
        }
        
        return totalProcessed;
    },

    async *streamLorePack(file: File): AsyncGenerator<any, void, unknown> {
        const text = await file.text();
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
            try {
                const record = JSON.parse(line);
                yield record;
            } catch (e) {
                console.warn("Skipping corrupt line in LorePack:", line, e);
            }
        }
    },

    normalizeNode(obj: any, targetAgentHandle: string, index: number): VectorRecord {
        return {
            id: obj.id || NumMarkX_GenerateID(`IMPORT_${index}`),
            text: obj.text || '',
            vector: obj.vector || [],
            source: obj.source || 'Imported File',
            agent: targetAgentHandle, // This is the critical override.
            timestamp: obj.timestamp || Date.now(),
            permissions: obj.permissions
        };
    },


    // --- PRIVATE HELPERS ---
    chunkText(text: string): string[] {
        const CHUNK_SIZE = 1500;
        const chunks: string[] = [];
        const cleanText = text.replace(/\r\n/g, '\n');
        
        let startIndex = 0;
        while (startIndex < cleanText.length) {
            let endIndex = startIndex + CHUNK_SIZE;
            
            if (endIndex >= cleanText.length) {
                endIndex = cleanText.length;
            } else {
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
};