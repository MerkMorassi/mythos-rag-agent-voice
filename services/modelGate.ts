
/**
 * MODEL GATE PROTOCOL (MGP)
 * Logic derived from model-gate.js
 * Analyzes query complexity to determine if "Deep Analysis" (Thinking Model) is required.
 */

export const ModelGate = {
    
    /**
     * Checks if the query contains triggers for high-reasoning tasks.
     * @param query The user's input text
     * @returns boolean - True if high complexity is detected
     */
    shouldActivateDeepAnalysis(query: string): boolean {
        const lowQuery = query.toLowerCase();

        const triggerWords = [
            'synthesize', 
            'deeply', 
            'complex analysis', 
            'tragedy', 
            'profound', 
            'critical assessment', 
            'paradigm shift', 
            'root cause',
            'comprehensive',
            'architectural',
            'ontology',
            'compare and contrast',
            'step by step'
        ];
        
        return triggerWords.some(word => lowQuery.includes(word));
    }
};
