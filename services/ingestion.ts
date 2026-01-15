
import { VectorRecord } from '../types';
import { NumMarkX_GenerateID } from '../patterns/NumMarkX';
import { GeminiProvider } from './llmProviders/geminiProvider';
import { OllamaProvider } from './llmProviders/ollamaProvider';
import { 
    bulkPutVectors, 
    getAllVectors, 
    putVector,
    bulkPutGraphNodes,
    bulkPutGraphEdges,
    deleteGraphByAgent
} from "./db";

export const IngestionService = {

    /**
     * Ingests a block of text, chunks it, gets embeddings, and saves to the DB.
     */
    async ingestText(
        text: string, 
        source: string, 
        agentHandle: string, 
        apiKey: string, 
        onProgress?: (processed: number, total: number) => void
    ): Promise<number> {
        await new Promise(r => setTimeout(r, 10));

        const chunks = this.chunkText(text);
        if (chunks.length === 0) return 0;

        if (onProgress) onProgress(0, chunks.length);

        // --- OFFLINE / ONLINE SWITCH ---
        // If apiKey is empty, we assume Local Mode (Ollama)
        let provider: { embed: (t: string) => Promise<number[]> };
        
        if (!apiKey) {
            console.log("[Ingestion] No API Key found. Switching to Local Embeddings (Ollama/Nomic).");
            provider = new OllamaProvider(); 
        } else {
            provider = new GeminiProvider(apiKey);
        }

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
            }
        }
        return savedCount;
    },

    /**
     * IMPORT LOREPACK
     * Handles both .json (Standard Container with Graph) and .jsonl / .gz (Streaming Large Datasets)
     */
    async importLorePack(file: File, targetAgentHandle: string, onProgress?: (p: number, t: number) => void): Promise<number> {
        const fileName = file.name.toLowerCase();
        
        // STRATEGY A: Standard JSON Container (Supports Graph)
        // We read this fully into memory as it allows for the structured 'graph' property.
        if (fileName.endsWith('.json') && !fileName.endsWith('.jsonl')) {
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                
                // 1. Graph Handling
                if (data.graph) {
                    console.log(`[Ingestion] Found Graph for ${targetAgentHandle}`);
                    await deleteGraphByAgent(targetAgentHandle);
                    
                    if (data.graph.nodes && Array.isArray(data.graph.nodes)) {
                        const nodes = data.graph.nodes.map((n: any) => ({ ...n, agentId: targetAgentHandle }));
                        await bulkPutGraphNodes(nodes);
                    }
                    if (data.graph.edges && Array.isArray(data.graph.edges)) {
                        const edges = data.graph.edges.map((e: any) => ({ ...e, agentId: targetAgentHandle }));
                        await bulkPutGraphEdges(edges);
                    }
                }

                // 2. Vector Handling
                let nodes: VectorRecord[] = [];
                if (Array.isArray(data.sacred_archive)) {
                    nodes = data.sacred_archive.map((n: any, i: number) => this.normalizeNode(n, targetAgentHandle, i));
                } else if (Array.isArray(data)) {
                    nodes = data.map((n: any, i: number) => this.normalizeNode(n, targetAgentHandle, i));
                } else if (data.id && data.vector) {
                    // Single node
                    nodes = [this.normalizeNode(data, targetAgentHandle, 0)];
                }

                if (nodes.length > 0) {
                    await bulkPutVectors(nodes);
                }
                
                if (onProgress) onProgress(nodes.length, nodes.length);
                return nodes.length;

            } catch (e) {
                console.warn("[Ingestion] JSON parse failed, falling back to stream strategy.", e);
            }
        }

        // STRATEGY B: Streaming (JSONL or GZIP)
        // Designed for massive datasets where memory is a constraint.
        // NOTE: Streaming typically does NOT support Graph data unless encoded as special lines.
        let stream: ReadableStream<any> = file.stream();
        if (fileName.endsWith('.gz')) {
            stream = stream.pipeThrough(new DecompressionStream('gzip'));
        }
        const reader = stream.pipeThrough(new TextDecoderStream()).getReader();

        let buffer = '';
        let count = 0;
        let batch: VectorRecord[] = [];
        const BATCH_SIZE = 100;

        const writeBatch = async () => {
            if (batch.length === 0) return;
            await bulkPutVectors(batch);
            if (onProgress) onProgress(count, 0); 
            batch = [];
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += value;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';

            for (const line of lines) {
                const s = line.trim();
                if (!s) continue;
                try {
                    const rawNode = JSON.parse(s);
                    
                    // Special case: If user streams a file containing a single huge JSON object on one line
                    if (rawNode.schema === 'MYTHOS.LOREPACK.v1' || rawNode.sacred_archive) {
                         // Recurse into the array
                         const archive = rawNode.sacred_archive || [];
                         for (const item of archive) {
                             batch.push(this.normalizeNode(item, targetAgentHandle, count++));
                         }
                         // Also check graph in this line-object
                         if (rawNode.graph) {
                            await deleteGraphByAgent(targetAgentHandle);
                            if (rawNode.graph.nodes) await bulkPutGraphNodes(rawNode.graph.nodes.map((n:any) => ({...n, agentId: targetAgentHandle})));
                            if (rawNode.graph.edges) await bulkPutGraphEdges(rawNode.graph.edges.map((e:any) => ({...e, agentId: targetAgentHandle})));
                         }
                    } else {
                        // Standard Vector Line
                        const normalized = this.normalizeNode(rawNode, targetAgentHandle, count);
                        batch.push(normalized);
                        count++;
                    }

                    if (batch.length >= BATCH_SIZE) {
                        await writeBatch();
                    }
                } catch (e) {
                    console.warn(`[Import] Skipping malformed line ${count}:`, e);
                }
            }
        }

        if (buffer.trim()) {
            try {
                const rawNode = JSON.parse(buffer.trim());
                const normalized = this.normalizeNode(rawNode, targetAgentHandle, count);
                batch.push(normalized);
                count++;
            } catch (e) {
                console.warn(`[Import] Skipping malformed line ${count}:`, e);
            }
        }

        if (batch.length > 0) {
            await writeBatch();
        }
        
        if (onProgress) onProgress(count, 0);

        return count;
    },

    /**
     * STREAMING LOREPACK ITERATOR
     * Yields parsed objects from a JSONL file line by line.
     */
    async *streamLorePack(file: File): AsyncGenerator<any> {
        const text = await file.text();
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
            if (line.trim()) {
                try {
                    yield JSON.parse(line);
                } catch (e) {
                    console.warn("[Ingestion] Skipping malformed JSON line", e);
                }
            }
        }
    },

    /**
     * Ensures raw data from an external LorePack matches the internal schema.
     * This now handles the abbreviated format from the Lorepack Factory ('d', 't', 'vec').
     */
    normalizeNode(obj: any, targetAgentHandle: string, index: number): VectorRecord {
        const metadata = obj.d || obj.metadata || {};
        const timestamp = obj.timestamp || metadata.timestamp;

        return {
            id: obj.id || NumMarkX_GenerateID(`IMP-${index}`),
            text: obj.text || obj.content || obj.t || '',
            vector: obj.vector || obj.vec || [],
            source: obj.source || metadata.source || 'Imported Archive',
            agent: targetAgentHandle, // Force ownership to the importing agent
            timestamp: timestamp ? new Date(timestamp).getTime() : Date.now(), // Ensure it's a number
            permissions: obj.permissions || metadata.permissions || '644'
        };
    },

    async exportLorePack(agentHandle: string) {
        const allVectors = await getAllVectors();
        const vectors = allVectors.filter(v => v.agent === agentHandle);
        if (vectors.length === 0) throw new Error("No data found for this agent.");

        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `MYTHOS.LORE.${agentHandle.toUpperCase()}.${dateStr}.jsonl`;

        const content = vectors.map(v => JSON.stringify(v)).join('\n');
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

    chunkText(text: string): string[] {
        const CHUNK_SIZE = 1200;
        const chunks: string[] = [];
        const cleanText = text.replace(/\r\n/g, '\n');
        let startIndex = 0;
        while (startIndex < cleanText.length) {
            let endIndex = startIndex + CHUNK_SIZE;
            if (endIndex >= cleanText.length) {
                endIndex = cleanText.length;
            } else {
                const lastNewline = cleanText.lastIndexOf('\n', endIndex);
                if (lastNewline > startIndex && lastNewline > endIndex - 200) endIndex = lastNewline;
            }
            const chunk = cleanText.substring(startIndex, endIndex).trim();
            if (chunk) chunks.push(chunk);
            startIndex = endIndex;
        }
        return chunks;
    }
};
