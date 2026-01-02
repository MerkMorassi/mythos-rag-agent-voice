// js/comms/envelope.js - MESSAGE ENVELOPE (Canonical)
// The atomic unit of communication in the Conference Room.

/** Creates an immutable message envelope for internal traffic. */
export function createEnvelope({
  from,          // Agent ID or 'HITL' or 'SYSTEM'
  to = 'ROOM',   // 'ROOM' (broadcast) or specific Agent ID
  type = 'utterance', // utterance | sys | action
  content,       // The actual text/payload
  meta = {}      // Timestamp, confidence, provenance
}) {
  return {
    id: crypto.randomUUID(),
    ts: Date.now(),
    from,
    to,
    type,
    content,
    meta
  };
}