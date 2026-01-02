
/**
 * NumMark-X Logic Patterns
 * 
 * This file contains isolated logic examples for the NumMark-X pattern system.
 * These patterns are designed to be "harvested" or imported into the main application
 * when advanced reasoning or specific data formatting is required.
 */

import { LorePackHeader } from "../types";

// --- CORE NUMMARK LOGIC (from numark-x.js) ---

/**
 * Generates a deterministic "Sigil" (alphanumeric key) from text.
 * Used for O(1) "Teleport" lookups, bypassing vector search.
 * @param text The text to encode
 * @returns A lowercase, stripped alphanumeric string
 */
export const NumMarkX_Encode = (text: string): string => {
    return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
};

/**
 * Generates a Header Sigil from the first N characters of a node.
 * This is the "Jump Coordinate" for the node.
 */
export const NumMarkX_GenerateSigil = (text: string, length: number = 50): string => {
    const substring = text.substring(0, length);
    return NumMarkX_Encode(substring);
};

// ----------------------------------------------

// 1. Recursive Data Structuring Pattern
// Used for organizing flat RAG data into hierarchical logic trees.
export const NumMarkX_RecursiveStruct = (data: any[]): any => {
    // Example logic placeholder
    console.log("NumMark-X: Initializing Recursive Struct");
    return {
        root: "active",
        nodes: data.map(d => ({ type: "leaf", content: d }))
    };
};

// 2. Temporal Marker Pattern
// Used for stamping memory nodes with specific temporal context for the AI.
export const NumMarkX_TimeStamp = (): string => {
    return `[NMX-${Date.now().toString(16).toUpperCase()}]`;
};

// 3. Logic Gate Pattern for Agent Decision Making
export const NumMarkX_DecisionPrompt = (context: string): string => {
    return `
    ${context}
    
    [NUMMARK-X PROTOCOL: DECISION GATE]
    Analyze the above context.
    Return ONLY a JSON object:
    {
      "decision": "EXECUTE" | "ABORT",
      "confidence": number (0-1),
      "reasoning": "string"
    }
    `;
};

// 4. Sentinel Token Pattern
export const NumMarkX_Sentinel = (content: string): string => {
    const sentinel = "X-99";
    return `[START ${sentinel}] ${content} [END ${sentinel}]`;
};

// 5. Canonical Header Generator (Universal Module)
export const NumMarkX_GenerateHeader = (agentId: string, handle: string, description?: string): LorePackHeader => {
    return {
        schema: "MYTHOS.LOREPACK.v1",
        id: crypto.randomUUID(),
        agentId: agentId.toUpperCase(),
        handle: handle,
        version: 1,
        timestamp: Date.now(),
        description: description || "Generated via MythOS Forge"
    };
};

// 6. Universal ID Generator
export const NumMarkX_GenerateID = (prefix: string = "NODE"): string => {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
};
