// js/identity-sync.js - CAS IDENTITY HYDRATION MODULE
// Pulls authoritative identity from Server (4100) -> Pushes to Local DB

import { SimpleDB } from './core/mythos-db.js';

const DB = new SimpleDB();
const SERVER_URL = 'http://localhost:4100';

// The 16 Canonical Agents
const CANONICAL_ROSTER = [
    'ARCHIVAX', 'CALLIOPE', 'CLIO', 'ERATO', 
    'EUTERPE', 'MELPOMENE', 'POLYHYMNIA', 'TERPSICHORE', 
    'THALIA', 'URANIA', 'DOMANTHEIA', 'SOPHIA', 
    'NOESIS', 'BARBELO', 'MERKOS', 'NULL'
];

export async function hydrateIdentities() {
    console.log(`\n=== INITIATING IDENTITY HYDRATION ===`);
    let synced = 0;
    let failed = 0;

    await DB.ready;

    for (const agentId of CANONICAL_ROSTER) {
        try {
            // 1. REQUEST from Authority
            const response = await fetch(`${SERVER_URL}/agents/${agentId}`);
            
            if (response.status === 404) {
                console.warn(`[SKIP] Authority has no file for: ${agentId}`);
                continue;
            }

            if (!response.ok) throw new Error(`Server Error: ${response.status}`);

            // 2. RECEIVE Authoritative Data
            const identity = await response.json();

            // 3. COMMIT to Local Cache (IndexedDB)
            // Ensure we preserve the LorePack structure 'meta' mapping if needed
            // The JSON from server is already the canonical structure.
            await DB.put('agents', identity);
            
            console.log(`[SYNC] Verified Identity: ${identity.handle} (${identity.id})`);
            synced++;

        } catch (err) {
            console.error(`[FAIL] Could not sync ${agentId}:`, err);
            failed++;
        }
    }

    console.log(`=== HYDRATION COMPLETE: ${synced} Synced, ${failed} Failed/Missing ===\n`);
    return synced;
}