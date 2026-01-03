import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join((process as any).cwd(), 'mcp_config.json');

export function loadMcpConfig(): Record<string, any> {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return {};
        const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
        return JSON.parse(content).mcpServers || {};
    } catch (e) { 
        console.error("Config Load Error:", e);
        return {}; 
    }
}

/**
 * Executes a specific Tool on an MCP Server via JSON-RPC
 */
export function runMcpTool(serverName: string, toolPayload: { name: string, arguments?: any }): Promise<any> {
    return new Promise((resolve, reject) => {
        const config = loadMcpConfig();
        const serverDef = config[serverName];
        
        if (!serverDef) return reject(new Error(`MCP Server [${serverName}] not found in mcp_config.json`));

        // 1. SPAWN SERVER
        const cmd = serverDef.command;
        const args = serverDef.args || [];
        const env = { ...process.env, ...(serverDef.env || {}) };
        
        const child = spawn(cmd, args, {
            env: env,
            stdio: ['pipe', 'pipe', 'inherit'] // Write to stdin, read stdout, log stderr
        });

        let buffer = '';
        let hasInitialized = false;
        let toolExecuted = false;

        const send = (msg: any) => {
            try {
                const str = JSON.stringify(msg);
                child.stdin?.write(str + "\n");
            } catch(e) {
                console.error("MCP Write Error:", e);
            }
        };

        // 2. TIMEOUT SAFETY (60s)
        const timer = setTimeout(() => {
            if (!toolExecuted) {
                child.kill();
                reject(new Error("MCP Tool Execution Timed Out (60s)"));
            }
        }, 60000);

        // 3. SEQUENCE START: Send Initialize
        send({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "mythos-bridge", version: "1.0" }
            }
        });

        // 4. LISTEN FOR RESPONSE
        child.stdout?.on('data', (chunk) => {
            buffer += chunk.toString();
            
            const lines = buffer.split('\n');
            // Process all complete lines
            while (lines.length > 1) {
                 const line = lines.shift();
                 if (!line || !line.trim()) continue;
                 
                 try {
                    const msg = JSON.parse(line);
                    
                    // A. Handle Initialize Response
                    if (msg.id === 1 && !hasInitialized) {
                        hasInitialized = true;
                        send({ jsonrpc: "2.0", method: "notifications/initialized" });
                        
                        // *** EXECUTE THE REQUESTED TOOL ***
                        send({
                            jsonrpc: "2.0",
                            id: 2,
                            method: "tools/call",
                            params: {
                                name: toolPayload.name,
                                arguments: toolPayload.arguments || {}
                            }
                        });
                    }

                    // B. Handle Tool Result
                    if (msg.id === 2) {
                        toolExecuted = true;
                        clearTimeout(timer);
                        
                        if (msg.error) {
                            reject(new Error(`Tool Error: ${msg.error.message}`));
                        } else {
                            resolve(msg.result); 
                        }
                        
                        child.kill(); 
                    }

                } catch (err) {
                    // Ignore non-JSON output (debug logs from server)
                }
            }
            buffer = lines[0] || '';
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        
        child.on('exit', (code) => {
            if (!toolExecuted && code !== 0) {
                 clearTimeout(timer);
                 reject(new Error(`MCP Server exited explicitly with code ${code}`));
            }
        });
    });
}