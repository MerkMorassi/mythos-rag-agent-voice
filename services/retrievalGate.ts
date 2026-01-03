
/**
 * MYTHOS GATING LAYER
 * The "Sacred Contraction": Determines when to open the context floodgates.
 * Ported from retrieval-gate.js
 */

export interface GateResult {
    shouldRetrieve: boolean;
    reason: string;
    strategy: 'TELEPORT' | 'RCI' | 'NONE'; // RCI = Retrieval Augmented Context Injection
}

export const RetrievalGate = {
    evaluate(query: string, agentId: string): GateResult {
        const q = query.trim().toLowerCase();
        const wordCount = q.split(/\s+/).length;

        // 1. IDENTITY GATE (Short greetings/phatic)
        // If it's very short and not a question, assume it's conversational filler.
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
        
        if (recallTriggers.some(t => q.includes(t))) {
            return { shouldRetrieve: true, strategy: 'RCI', reason: 'Explicit Intent' };
        }

        // 3. PERSONA GATE
        // Archivists and Memory Proxies always check records.
        if (['CLIO', 'ARCHIVAX', 'POLYHYMNIA', 'MERKOS'].includes(agentId)) {
            return { shouldRetrieve: true, strategy: 'RCI', reason: 'Role Mandate: Historian/Memory' };
        }

        // 4. COMPLEXITY HEURISTIC
        // Long queries imply a need for grounding.
        if (wordCount > 8) {
            return { shouldRetrieve: true, strategy: 'RCI', reason: 'Complexity Heuristic' };
        }

        // Default Contraction
        return { shouldRetrieve: false, strategy: 'NONE', reason: 'Default Contraction' };
    }
};
