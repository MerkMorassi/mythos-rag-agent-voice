import { getAllVectors } from './db';
import { VectorRecord } from '../types';

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

  async query(queryVector: number[], queryText: string, topK: number = 8): Promise<VectorRecord[]> {
    const allVectors = await getAllVectors();
    if (allVectors.length === 0) return [];
    
    // 1. Source Awareness (Meta-Cognitive)
    // Checks if the user asked for a specific file by name
    const distinctSources = [...new Set(allVectors.map(v => v.source))];
    const targetSource = distinctSources.find(s => queryText.toLowerCase().includes(s.toLowerCase()));
    
    if (targetSource) {
      console.log(`[Retrieval] Source Lock Engaged: ${targetSource}`);
      // Return the full context of that file, sorted by timestamp
      return allVectors
        .filter(v => v.source === targetSource)
        .sort((a,b) => a.timestamp - b.timestamp);
    }

    // 2. Semantic Search (Elara Logic)
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