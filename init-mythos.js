// js/core/init-mythos.js - MYTHOS BOOTSTRAP PHASE 1 & 2
// Handles the ForgeLattice ritual and instantiates the Conference Room.

import { SimpleDB } from './mythos-db.js';
import { InitialAgentManifest } from '../agents/initial-manifest.js';
import { AgentRuntime } from '../agents/agent-runtime.js'; 

const DB = new SimpleDB(); // Global persistence instance

/**
 * Executes the ForgeLattice Protocol for Agent Identity.
 * Writes the Canonical Manifest into the 'agents' store in SimpleDB.
 */
export async function forgeAgentLattice() {
  console.log("⚙️ Phase 1: Initiating Agent ForgeLattice Protocol...");
  
  try {
    await DB.ready;
    
    // Clear existing agents to prevent ID conflicts during initial forge
    await DB.clear('agents');
    console.log("✅ Agents store cleared for fresh forging.");

    // Write the Manifest (Digital Souls) to the DB
    const agentPromises = InitialAgentManifest.map(agentData => {
      const forgeData = { 
        ...agentData, 
        createdAt: new Date().toISOString()
      };
      return DB.put('agents', forgeData);
    });

    await Promise.all(agentPromises);
    console.log(`✅ ${InitialAgentManifest.length} LIAs successfully forged into the Lattice.`);

    return DB.getAll('agents');
    
  } catch (error) {
    console.error("❌ Fatal Error during ForgeLattice (Agent Identity):", error);
    throw new Error("Lattice Forge Failed: " + error.message);
  }
}

/**
 * Renders the Agent list in the sidebar (js/comms/renderer.js does not handle this).
 */
function renderAgentList(agents) {
    const listEl = document.getElementById('agent-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    
    if (agents.length === 0) {
        listEl.innerHTML = '<div class="message system">No Agents found in manifest.</div>';
        return;
    }

    agents.forEach(agent => {
        const div = document.createElement('div');
        div.className = 'agent-item';
        div.id = `agent-${agent.id}`;
        
        // Display Agent Identity and Role
        div.innerHTML = `
            <div>
                <strong>${agent.handle}</strong> 
                <span style="opacity: 0.7; font-size: 0.9em;">(${agent.role_layer.split('/')[0].trim()})</span>
            </div>
            <span style="font-size: 0.8em; color: ${agent.onboarding_status === 'ONBOARDED' ? 'lightgreen' : 'yellow'}">
                ${agent.onboarding_status}
            </span>
        `;
        listEl.appendChild(div);
    });
}

/**
 * Executes Phase 2: Runtime Initialization and Conference Room Assembly.
 */
export async function initMythos(apiKey) {
  if (!apiKey) {
    window.Renderer.system("⚠️ INIT PENDING: GEMINI API Key is missing.");
    return;
  }
  
  // 1. Forge the identity persistence layer
  const persistedAgents = await forgeAgentLattice();

  // 2. Render the agents list in the sidebar
  renderAgentList(persistedAgents);

  // 3. Create the AgentRuntimes (one for each LIA)
  const agentRuntimes = {};
  persistedAgents.forEach(agentData => {
    // AgentRuntime is the core cognitive processor
    agentRuntimes[agentData.id] = new window.AgentRuntime({
      agentMeta: agentData,
      db: DB,
      apiKey: apiKey 
    });
  });
  
  console.log(`✨ ${persistedAgents.length} Agent Runtimes instantiated.`);

  // 4. Initialize the Conference Room (COMMS)
  // NOTE: Concurrency set to 2 to avoid free tier rate limits (5 req/min)
  // For paid API keys, increase to 6 or higher for faster responses
  const room = new window.ConferenceRoom({
    agents: agentRuntimes,
    renderer: window.Renderer, 
    logger: console.log,
    concurrency: 2  // Reduced from 6 to 2 for free tier compatibility
  });

  room.open();
  room.join(Object.keys(agentRuntimes));

  window.Renderer.system("🌐 MythOS Core v1.0 Operational. Dekatríadic Cluster is LIVE.");
  return room;
}

// Expose initMythos globally for mythos-loader.js
window.initMythos = initMythos;
