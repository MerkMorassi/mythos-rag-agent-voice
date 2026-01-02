// js/memory/lorepack-forge.js - LOREPACK FORGE (SOMA / Gemini-only)
// Purpose: ingest raw lore text -> sentence-ish chunks -> embed -> normalize -> persist in IndexedDB.
// Also supports exporting a LorePack JSON for portability.

import { apiCall, normalize } from '../core.js';
import { SimpleDB } from '../../core/mythos-db.js';
import { generateNumMarkX } from '../memory/numark-x.js';

const DB = new SimpleDB();

/**
 * Very simple chunker: splits into sentence-ish units while staying deterministic.
 * UNIX ethos: small, predictable, no heavy NLP.
 */
export function chunkText(raw, { maxLen = 480 } = {}) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  // Split on punctuation + newline boundaries
  const rough = text
    .split(/(?<=[.?!])\s+|\n{2,}/g)
    .map(s => s.trim())
    .filter(Boolean);

  // Enforce maxLen by further splitting long chunks on spaces
  const out = [];
  for (const part of rough) {
    if (part.length <= maxLen) {
      out.push(part);
      continue;
    }
    let buf = '';
    for (const word of part.split(/\s+/)) {
      if ((buf + ' ' + word).trim().length > maxLen) {
        if (buf.trim()) out.push(buf.trim());
        buf = word;
      } else {
        buf = (buf + ' ' + word).trim();
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

export async function ingestLoreText({
  agentId,
  agentHandle = 'UNKNOWN',
  source = 'manual',
  rawText,
  modelEmbed = 'text-embedding-004'
}) {
  if (!agentId) throw new Error('agentId required');

  await DB.ready;

  const chunks = chunkText(rawText);
  if (!chunks.length) return { ingested: 0 };

  const nodes = [];
  
  // Sequential individual embedding calls with retry logic
  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i];
    let retries = 3;
    let success = false;
    
    while (retries > 0 && !success) {
      try {
        // Single embedding call per chunk
        const emb = await apiCall(
          'embed',
          { text: text, model: modelEmbed, taskType: 'RETRIEVAL_DOCUMENT' }
        );

        // Extract embedding from response
        const embedding = emb?.embedding || emb?.embeddings?.[0];
        
        if (!embedding || !embedding.values) {
          console.warn(`Missing embedding for chunk ${i}, skipping`);
          break;
        }

        const { HDR, SIG } = generateNumMarkX(text);
        const vec = normalize(embedding.values);
        
        nodes.push({
          id: crypto.randomUUID(),
          agentId,
          agentHandle,
          source,
          text,
          vector: vec,
          num_mark_hdr: HDR,
          num_mark_sig: SIG,
          ts: Date.now()
        });

        success = true;

        // Rate limiting: 120ms delay between API calls (matches proven fast system)
        await new Promise(resolve => setTimeout(resolve, 120));
        
      } catch (error) {
        retries--;
        
        if (retries === 0) {
          console.error(`Failed to embed chunk ${i} after 3 attempts:`, error.message);
          break;
        }
        
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, 3 - retries) * 1000;
        console.warn(`Retry ${4 - retries}/3 for chunk ${i} after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // Persist each node individually
  for (const node of nodes) {
    await DB.put('vectors', node);
  }
  return { ingested: nodes.length };
}

/**
 * Export canonical LorePack JSON for an agent (portable "Digital Soul" payload).
 */
export async function exportLorePack(agentId) {
  await DB.ready;
  const agent = await DB.get('agents', agentId);
  const nodes = await DB.getByIndex('vectors', 'agentId', agentId);

  return {
    meta: {
      schema: 'LorePack.v2',
      exportedAt: new Date().toISOString(),
      count: nodes?.length || 0
    },
    agent: agent || { id: agentId },
    sacred_archive: (nodes || []).map(n => ({
      id: n.id,
      agentId: n.agentId,
      source: n.source,
      text: n.text,
      vector: n.vector,
      num_mark_hdr: n.num_mark_hdr,
      num_mark_sig: n.num_mark_sig,
      ts: n.ts
    }))
  };
}
