// js/conference.js
// THE CONFERENCE: Multi-Agent State Manager

export class Conference {
    constructor() {
        this.participants = new Set(); // Active Agent IDs
    }

    join(agentId) {
        this.participants.add(agentId);
        console.log(`[Conference] ${agentId} has joined the Chorus.`);
    }

    leave(agentId) {
        this.participants.delete(agentId);
        console.log(`[Conference] ${agentId} has left the Chorus.`);
    }

    has(agentId) {
        return this.participants.has(agentId);
    }

    getParticipants() {
        return Array.from(this.participants);
    }

    clear() {
        this.participants.clear();
    }
}