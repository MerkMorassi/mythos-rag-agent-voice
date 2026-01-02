// js/envelope.js
// THE ENVELOPE: Provenance Protocol

export class Envelope {
    constructor(from, payload, type = 'utterance', to = 'ROOM') {
        this.id = crypto.randomUUID();
        this.timestamp = Date.now();
        this.from = from;     // Agent ID or 'USER'
        this.to = to;         // 'ROOM', 'MERKOS', etc.
        this.type = type;     // 'utterance', 'sys', 'action'
        this.payload = payload; // The text content
        this.sealed = true;
    }
}