

/**
 * MYTHOS GATING LAYER
 * The "Sacred Contraction": Determines when to open the context floodgates.
 * Ported from retrieval-gate.js
 */

export interface GateResult {
    shouldRetrieve: boolean;
    reason: string;
    strategy: 'TELEPORT' | 'RCI' | 'GRAPH_LOCAL' | 'GRAPH_GLOBAL' | 'NONE'; 
}

export const RetrievalGate = {
    evaluate(query: string, agentId: string): GateResult {
        const q = query.trim().toLowerCase();
        const wordCount = q.split(/\s+/).length;

        // 1. IDENTITY GATE (Short greetings/phatic)
        if (wordCount < 3 && !q.includes('?')) {
             const commands = ['log', 'status', 'report', 'explain', 'search', 'find'];
             if (commands.some(w => q.includes(w))) {
                 return { shouldRetrieve: true, strategy: 'RCI', reason: 'Command Keyword Detected' };
             }
             return { shouldRetrieve: false, strategy: 'NONE', reason: 'Phatic/Conversational' };
        }

        // 2. EXPLICIT RECALL (Triggers)
        const recallTriggers = [
            'remember', 'recall', 'what did', 'who is', 'define', 
            'report', 'status', 'tell me about', 'history', 'context', 
            'earlier', 'myth', 'search', 'lookup'
        ];
        
        // 3. GRAPH INTENT (Deep Connections)
        // Questions that imply relationships or specific entity connections benefit from Graph Search
        const graphTriggers = ['how is', 'connected', 'related', 'relationship', 'link', 'between'];
        
        if (graphTriggers.some(t => q.includes(t))) {
            return { shouldRetrieve: true, strategy: 'GRAPH_LOCAL', reason: 'Graph Relation Query' };
        }
        
        if (recallTriggers.some(t => q.includes(t))) {
            // Default to Graph Local for better context if available
            return { shouldRetrieve: true, strategy: 'GRAPH_LOCAL', reason: 'Explicit Intent' };
        }

        // 4. PERSONA GATE
        if (['CLIO', 'ARCHIVAX', 'POLYHYMNIA', 'MERKOS'].includes(agentId)) {
            return { shouldRetrieve: true, strategy: 'GRAPH_LOCAL', reason: 'Role Mandate: Historian/Memory' };
        }

        // 5. COMPLEXITY HEURISTIC
        if (wordCount > 8) {
            return { shouldRetrieve: true, strategy: 'RCI', reason: 'Complexity Heuristic' };
        }

        // Default Contraction
        return { shouldRetrieve: false, strategy: 'NONE', reason: 'Default Contraction' };
    }
};