
export interface McpToolCall {
    server: string;
    tool: string;
    args?: Record<string, any>;
}

export interface McpResponse {
    status: string;
    result?: any;
    error?: string;
}

// Use relative path so it works on any port (4000, 7860, etc.)
const BRIDGE_URL = '/mcp/execute';

export const McpClient = {
    async execute(server: string, tool: string, args: Record<string, any> = {}): Promise<McpResponse> {
        try {
            const response = await fetch(BRIDGE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ server, tool, args })
            });
            
            if (!response.ok) {
                // Try to parse error details if available
                let errorMessage = response.statusText;
                try {
                    const err = await response.json();
                    if (err.error) errorMessage = err.error;
                } catch (e) {}
                
                throw new Error(`Server Error (${response.status}): ${errorMessage}`);
            }
            
            return await response.json();
        } catch (e: any) {
            console.error("MCP Client Error:", e);
            return { status: 'ERROR', error: e.message || "Network request failed" };
        }
    }
};
