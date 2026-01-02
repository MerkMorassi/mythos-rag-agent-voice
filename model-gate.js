// js/core/model-gate.js

// Model Gate Protocol (MGP) module
export function getModelForTask(queryText, defaultModel = 'gemini-2.5-flash') { // Accept defaultModel as parameter

    const lowQuery = queryText.toLowerCase();

    const triggerWords = [
        'synthesize', 'deeply', 'complex analysis', 'tragedy', 
        'profound', 'critical assessment', 'paradigm shift', '3.0 pro', '3.0'
    ];
    
    const isHighReasoning = triggerWords.some(word => lowQuery.includes(word));

    if (isHighReasoning) {
        const proModel = 'gemini-3.0-pro'; 
        // In a modular context, the calling component will need to handle model availability.
        // For now, we assume it's a valid model to request.
        console.log(`[MGP] High Reasoning task detected. Requesting ${proModel}.`);
        return proModel;
    }
    return defaultModel;
}
