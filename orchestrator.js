import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const PORT = 4000;
const storageDir = process.env.STORAGE_PATH || 'Z:\\'; 
const loreDir = path.join(storageDir, 'MYTHOS', 'LORE');

// Ensure directories exist
fs.mkdir(loreDir, { recursive: true }).catch(console.error);

app.use(cors({ origin: '*' }));

// CRITICAL FIX: Explicitly set massive limits for JSON payloads
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ limit: '1000mb', extended: true }));

// Serving static files from root
app.use(express.static(path.resolve(process.cwd()))); 

// --- LOREPACK INGESTION AUTHORITY v3.5 ---
app.post('/lorepack/ingest/:agentId', async (req, res) => {
    const agentId = req.params.agentId.toUpperCase();
    const nodes = req.body.nodes; 
    const date = new Date().toISOString().slice(0, 10);
    
    if (!nodes || !nodes.length) {
        return res.status(400).json({ error: "Payload missing 'nodes' array." });
    }

    const targetFolder = path.join(loreDir, agentId);
    const filename = `MYTHOS.LORE.${agentId}.LOREPACK.${date}.json`;
    const filePath = path.join(targetFolder, filename);

    console.log(`> [LPS] Receiving Locus: ${agentId} (${nodes.length} nodes)`);

    try {
        await fs.mkdir(targetFolder, { recursive: true });
        // Using stringify with null, 2 for readability on the Z: drive
        await fs.writeFile(filePath, JSON.stringify({ 
            schema: "MYTHOS.LOREPACK.v1",
            agentId: agentId,
            count: nodes.length,
            sacred_archive: nodes 
        }, null, 2));
        
        console.log(`> [LPS] Successfully Mirrored: ${filePath}`);
        res.json({ status: 'SUCCESS', path: filePath });
    } catch (e) {
        console.error(`> [LPS] Write Failure: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

// Start server with extended timeout for large file writes
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`MYTHOS HYPERVISOR v3.5 ACTIVE on Port ${PORT}`);
    console.log(`> Buffer Limit: 1000MB`);
    console.log(`> Target Drive: ${storageDir}`);
});

server.timeout = 600000; // 10-minute timeout for 364MB+ transfers

export default app;