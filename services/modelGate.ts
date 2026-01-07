/**
 * MODEL GATE PROTOCOL (MGP)
 * Logic derived from model-gate.js
 * Analyzes query complexity to determine if "Deep Analysis" (Thinking Model) is required.
 */

export const ModelGate = {
    
    /**
     * Selects the optimal Gemini model based on query complexity.
     * @param query The user's input text
     * @returns string - The name of the model to use ('gemini-3-pro-preview' or 'gemini-3-flash-preview')
     */
    selectModel(query: string): string {
        if (this.shouldActivateDeepAnalysis(query)) {
            return 'gemini-3-pro-preview';
        }
        return 'gemini-3-flash-preview';
    },

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
            'step by step',
            'design a plan',
            'write code',
            'create an algorithm',
            'explain the concept',
            'philosophical',
            'ethical implications'
        ];
        
        return triggerWords.some(word => lowQuery.includes(word));
    }
};