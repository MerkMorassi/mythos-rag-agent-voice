// js/retrieval-gate.js
// THE SACRED CONTRACTION: Intent Evaluation
// "To hold everything is to hold nothing."

export const RetrievalGate = {
    evaluate(query, agent) {
        const q = query.trim().toLowerCase();
        const wordCount = q.split(/\s+/).length;

        // 1. PHATIC GATE (Too short? Don't search)
        if (wordCount < 3) {
            return { shouldRetrieve: false, reason: "Phatic/Short" };
        }

        // 2. EXPLICIT RECALL (Triggers)
        const triggers = ['remember', 'recall', 'what did', 'who is', 'define', 'report', 'status', 'tell me about'];
        if (triggers.some(t => q.includes(t))) {
            return { shouldRetrieve: true, reason: "Explicit Intent" };
        }

        // 3. DEFAULT CONTRACTION (Context is heavy, use sparingly)
        // If it's a long query, assume it needs grounding.
        if (wordCount > 8) {
            return { shouldRetrieve: true, reason: "Complexity Heuristic" };
        }

        return { shouldRetrieve: false, reason: "Default Contraction" };
    }
};