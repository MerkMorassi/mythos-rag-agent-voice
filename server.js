// server.js - MYTHOS VAULT SERVER v1.5 [MCP ACTIVE]

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import orchestratorApp from './orchestrator.js'; 

// *** IMPORT THE BRIDGE ***
import { runMcpTool } from './js/core/mcp-proxy.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 4100;

app.use(express.json());

// Mount Orchestrator Logic
app.use(orchestratorApp); 

// *** MCP TOOL ROUTE ***
app.post('/api/tools/execute', async (req, res) => {
    // Expects: { tool: "notebooklm", query: { name: "authenticate", arguments: {} } }
    const { tool, query } = req.body;
    
    try {
        const result = await runMcpTool(tool, query);
        res.json({ status: 'success', data: result });
    } catch (e) {
        console.error("MCP Route Error:", e.message);
        res.status(500).json({ status: 'error', message: e.message });
    }
});

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
    console.log('\n--------------------------------------------');
    console.log(`MYTHOS SERVER ACTIVE on PORT ${PORT}`);
    console.log(`[MCP BRIDGE]: READY`);
    console.log('--------------------------------------------');
});