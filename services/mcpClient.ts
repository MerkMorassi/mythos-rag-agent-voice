
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

const BRIDGE_URL = 'http://localhost:4000/mcp/execute';

export const McpClient = {
    async execute(server: string, tool: string, args: Record<string, any> = {}): Promise<McpResponse> {
        try {
            const response = await fetch(BRIDGE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ server, tool, args })
            });
            
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || response.statusText);
            }
            
            return await response.json();
        } catch (e: any) {
            console.error("MCP Client Error:", e);
            return { status: 'ERROR', error: e.message };
        }
    }
};
