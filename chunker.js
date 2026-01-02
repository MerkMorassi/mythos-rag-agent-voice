// js/ingestion/chunker.js
export function chunkText(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(t => t.trim())
    .filter(Boolean);
}
