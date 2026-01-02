// js/core/mcp-proxy.js
// MYTHOS MCP BRIDGE v2.0
// Implements a "One-Shot" JSON-RPC Client for MCP Servers.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, '../../config/mcp_servers.json');

// --- HELPER: Load Config ---
function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return {};
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')).mcpServers || {};
    } catch (e) { 
        console.error("Config Load Error:", e);
        return {}; 
    }
}

/**
 * Executes a specific Tool on an MCP Server via JSON-RPC
 * @param {string} serverName - Key from config (e.g. "notebooklm")
 * @param {Object} toolPayload - { name: "authenticate", arguments: {} }
 */
export function runMcpTool(serverName, toolPayload) {
    return new Promise((resolve, reject) => {
        const config = loadConfig();
        const serverDef = config[serverName];
        
        if (!serverDef) return reject(new Error(`MCP Server [${serverName}] not found in config.`));

        // 1. SPAWN SERVER
        const cmd = serverDef.command;
        const args = serverDef.args || [];
        
        console.log(`[MCP BRIDGE] Spawning: ${cmd} ${args.join(' ')}`);
        
        const child = spawn(cmd, args, {
            env: { ...process.env, HEADLESS: 'false' }, // Visible browser for auth interactions
            stdio: ['pipe', 'pipe', 'inherit'] // Write to stdin, read stdout, log stderr
        });

        let buffer = '';
        let hasInitialized = false;
        let toolExecuted = false;

        // Helper to send JSON-RPC
        const send = (msg) => {
            try {
                const str = JSON.stringify(msg);
                child.stdin.write(str + "\n");
            } catch(e) {
                console.error("MCP Write Error:", e);
            }
        };

        // 2. TIMEOUT SAFETY (30s)
        const timer = setTimeout(() => {
            if (!toolExecuted) {
                child.kill();
                reject(new Error("MCP Tool Execution Timed Out (30s)"));
            }
        }, 30000);

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
        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString();
            // Handle split packets
            const lines = buffer.split('\n');
            buffer = lines.pop(); 

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    
                    // A. Handle Initialize Response
                    if (msg.id === 1 && !hasInitialized) {
                        hasInitialized = true;
                        // Send "Initialized" notification
                        send({ jsonrpc: "2.0", method: "notifications/initialized" });
                        
                        // *** EXECUTE THE REQUESTED TOOL ***
                        console.log(`[MCP BRIDGE] Calling Tool:`, toolPayload.name);
                        
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
                        
                        // Check for tool-level errors
                        if (msg.error) {
                            reject(new Error(`Tool Error: ${msg.error.message}`));
                        } else {
                            resolve(msg.result); 
                        }
                        
                        child.kill(); // Close connection
                    }

                } catch (err) {
                    // Ignore non-JSON debug lines if any
                }
            }
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