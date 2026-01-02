// js/comms/conference.js - MYTHOS CONFERENCE ROOM (SOMA / Gemini-only)
// Purpose: 1 HITL user broadcasts -> Agents respond in parallel, each in their own voice.
// No direct DOM usage. All UI output goes through the provided Renderer.
// UNIX ethos: small, explicit, deterministic. No dependencies.

export class ConferenceRoom {
  /**
   * @param {object} cfg
   * @param {Record<string, any>} cfg.agents  Map of { agentId: AgentRuntime }
   * @param {object} cfg.renderer              Renderer with { system,user,agent,error }
   * @param {number} [cfg.concurrency=6]       Max parallel agent replies
   * @param {function} [cfg.logger=console.log]
   */
  constructor({ agents, renderer, concurrency = 6, logger = console.log }) {
    this.agents = agents || {};
    this.renderer = renderer || null;
    this.logger = logger || console.log;

    this.concurrency = Math.max(1, Number(concurrency) || 6);
    this.activeAgentIds = Object.keys(this.agents); // default: all
  }

  open() {
    this.renderer?.system?.("🟦 Conference Room OPEN.");
  }

  /**
   * Join a subset of agents (for selective talkers).
   * @param {string[]} agentIds
   */
  join(agentIds) {
    const ids = Array.isArray(agentIds) ? agentIds : Object.keys(this.agents);
    this.activeAgentIds = ids.filter((id) => !!this.agents[id]);
    this.renderer?.system?.(`🧬 Agents joined: ${this.activeAgentIds.length}`);
  }

  /**
   * Replace agent map at runtime (hot reload-friendly)
   * @param {Record<string, any>} agents
   */
  setAgents(agents) {
    this.agents = agents || {};
    // Keep current selection if possible, otherwise default to all.
    const all = Object.keys(this.agents);
    this.activeAgentIds = this.activeAgentIds?.length
      ? this.activeAgentIds.filter((id) => all.includes(id))
      : all;
    this.renderer?.system?.(`🔁 Agents updated: ${all.length}`);
  }

  setConcurrency(n) {
    this.concurrency = Math.max(1, Number(n) || 1);
    this.renderer?.system?.(`⚙️ Concurrency set: ${this.concurrency}`);
  }

  // Simple bounded concurrency pool (no deps).
  async #pool(items, worker) {
    const queue = [...items];
    const lanes = Array.from(
      { length: Math.min(this.concurrency, queue.length || 1) },
      async () => {
        while (queue.length) {
          const item = queue.shift();
          await worker(item);
        }
      }
    );
    await Promise.all(lanes);
  }

  /**
   * Broadcast a HITL message to all active agents.
   * @param {string} from - e.g. "HITL"
   * @param {string} text
   * @param {object} [opts]
   * @param {string} [opts.model] - optional model override for this broadcast
   */
  async broadcast(from, text, opts = {}) {
    const msg = String(text || "").trim();
    if (!msg) return;

    // Render user message once
    this.renderer?.user?.(from, msg);

    const ids =
      opts.target && opts.target !== 'ALL'
        ? [opts.target]
        : (Array.isArray(this.activeAgentIds) && this.activeAgentIds.length
            ? this.activeAgentIds
            : Object.keys(this.agents));

    // Run agents with bounded parallelism
    await this.#pool(ids, async (agentId) => {
      const agent = this.agents[agentId];
      if (!agent) return;

      const who =
        agent.handle ||
        agent.agentMeta?.handle ||
        agent.agentMeta?.name ||
        agentId;

      try {
        // AgentRuntime must expose respond(from, text, opts)
        const reply = await agent.respond({message: msg, from: from});
        this.renderer?.agent?.(who, reply);
      } catch (e) {
        const emsg = e?.message || String(e);
        this.renderer?.error?.(who, emsg);
        this.logger?.("[ConferenceRoom] agent error", agentId, emsg);
      }
    });
  }

  /**
   * Directed agent-to-agent communication (optional / future use).
   * This stays here so your protocol has a defined primitive.
   */
  async say(fromAgentId, toAgentId, text, opts = {}) {
    const msg = String(text || "").trim();
    if (!msg) return;

    const from = this.agents[fromAgentId];
    const to = this.agents[toAgentId];
    if (!from || !to) {
      this.renderer?.system?.("⚠️ Invalid agent routing for say().");
      return;
    }

    const fromName =
      from.handle || from.agentMeta?.handle || from.agentMeta?.name || fromAgentId;
    const toName =
      to.handle || to.agentMeta?.handle || to.agentMeta?.name || toAgentId;

    // Show the originating agent message
    this.renderer?.agent?.(fromName, msg);

    try {
      const reply = await to.respond({message: msg, from: fromName});
      this.renderer?.agent?.(toName, reply);
    } catch (e) {
      this.renderer?.error?.(toName, e?.message || String(e));
    }
  }
}

// Legacy global exposure (your loader/init uses window.ConferenceRoom)
window.ConferenceRoom = ConferenceRoom;