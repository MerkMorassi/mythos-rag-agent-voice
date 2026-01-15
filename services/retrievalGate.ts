
import { getAllVectors } from './db';
import { VectorRecord } from '../types';
import { GeminiProvider } from './llmProviders/geminiProvider';
import { OllamaProvider } from './llmProviders/ollamaProvider';

export const RetrievalGate = {
  
  // FIX: Added evaluate method to decide if retrieval is necessary.
  evaluate(queryText: string, agentHandle: string): { shouldRetrieve: boolean } {
    // Simple heuristic: always retrieve if the query is more than a few words long,
    // or if it doesn't look like a simple greeting.
    const words = queryText.trim().toLowerCase().split(/\s+/);
    if (words.length > 3) return { shouldRetrieve: true };
    const greetings = ['hi', 'hello', 'hey', 'yo'];
    if (words.length === 1 && greetings.includes(words[0])) return { shouldRetrieve: false };
    return { shouldRetrieve: true }; // Default to retrieve
  },

  cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, nA = 0, nB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      nA += a[i] * a[i];
      nB += b[i] * b[i];
    }
    return dot / (Math.sqrt(nA) * Math.sqrt(nB)) || 0;
  },

  async query(queryVectorOrText: number[] | string, queryTextFallback: string, topK: number = 8): Promise<VectorRecord[]> {
    let queryVector: number[];

    // 1. Resolve Vector (Handle Text vs Pre-computed Vector)
    if (typeof queryVectorOrText === 'string') {
        const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
        if (apiKey) {
            const provider = new GeminiProvider(apiKey);
            queryVector = await provider.embed(queryVectorOrText);
        } else {
            console.log("[Retrieval] Offline Mode: Using Ollama Embeddings");
            const provider = new OllamaProvider();
            queryVector = await provider.embed(queryVectorOrText);
        }
        // Use the text provided as first arg as the query text logic
        queryTextFallback = queryVectorOrText;
    } else {
        queryVector = queryVectorOrText;
    }

    const allVectors = await getAllVectors();
    if (allVectors.length === 0) return [];
    
    // 2. Source Awareness (Meta-Cognitive)
    // Checks if the user asked for a specific file by name
    const distinctSources = [...new Set(allVectors.map(v => v.source))];
    const targetSource = distinctSources.find(s => queryTextFallback.toLowerCase().includes(s.toLowerCase()));
    
    if (targetSource) {
      console.log(`[Retrieval] Source Lock Engaged: ${targetSource}`);
      // Return the full context of that file, sorted by timestamp
      return allVectors
        .filter(v => v.source === targetSource)
        .sort((a,b) => a.timestamp - b.timestamp);
    }

    // 3. Semantic Search (Elara Logic)
    const scored = allVectors.map(v => ({
      ...v,
      score: this.cosineSimilarity(queryVector, v.vector)
    }));

    // Sort descending by score
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
};
