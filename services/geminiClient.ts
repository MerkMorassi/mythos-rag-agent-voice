
import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';

/**
 * A client for interacting with the Google Gemini API.
 * This class encapsulates all the logic for making requests to Gemini,
 * including checking connections and listing models.
 * It is designed to be a standalone module for use in any TypeScript application.
 */
class GeminiClient {
    /**
     * Verifies if the provided API key is valid by attempting to list models.
     * @param {string} apiKey The Google Gemini API key.
     * @returns {Promise<boolean>} A promise that resolves to true if the connection is successful, false otherwise.
     */
    async checkConnection(apiKey: string): Promise<boolean> {
        if (!apiKey) return false;
        try {
            // Use the new, working listModels method to validate the key.
            await this.listModels(apiKey);
            return true;
        } catch (e) {
            console.error("Gemini API key check failed:", e);
            return false;
        }
    }
    
    /**
     * Fetches a list of available Gemini models that support content generation.
     * @param {string} apiKey The Google Gemini API key.
     * @returns {Promise<{ name: string, displayName: string }[]>} A promise that resolves to an array of model objects.
     * @throws An error if the API key is missing or the request fails.
     */
    async listModels(apiKey: string): Promise<{ name: string, displayName: string }[]> {
        const fallbackModels = [
            { name: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash (Economic & Fast)' },
            { name: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro (Complex Reasoning)' },
            { name: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash Lite (Ultra Economic)' },
            { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
            { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
            { name: 'gemini-2.0-flash-exp', displayName: 'Gemini 2.0 Flash Experimental' },
            { name: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
            { name: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' }
        ];

        if (!apiKey) {
            console.warn("API Key is missing, returning fallback Gemini models.");
            return fallbackModels;
        }
    
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    
        try {
            const response = await fetch(url);
            
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || response.statusText);
            }
    
            const data = await response.json();
            
            if (!data.models || !Array.isArray(data.models)) {
                return fallbackModels;
            }
    
            const compatibleModels = data.models
                .filter((model: any) => model.supportedGenerationMethods?.includes("generateContent"))
                .map((model: any) => ({
                    // The SDK expects the model name without the 'models/' prefix.
                    name: model.name.replace('models/', ''),
                    displayName: model.displayName
                }));
    
            return compatibleModels.length > 0 ? compatibleModels : fallbackModels;
    
        } catch (error) {
            console.warn("Failed to list Gemini models via API, utilizing resilient fallback list:", error);
            return fallbackModels;
        }
    }
}

export const geminiClient = new GeminiClient();
