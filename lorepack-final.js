// File: js/lorepack-final.js
// LOREPACK™ v3.7.0 :: BRIDGE CONTROLLER
// - Controls UI, Bridge, and Graph Triggers
// © 2026 MYTHOS. All Rights Reserved.

import { Lorepack } from './lorepack.js';

const lore = new Lorepack();

const ui = {
  log(msg, src = 'SYS', type = 'sys') {
    const c = document.getElementById('logConsole');
    if (!c) return;
    const d = document.createElement('div');
    d.className = `log-entry ${type}`;
    d.innerHTML = `[${new Date().toLocaleTimeString()}] <b>${src}</b>: ${msg}`;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
  },
  stat(id, val) {
    const el = document.getElementById(id);
    if (el) el.innerText = String(val);
  },
  bar(pct) {
    const el = document.getElementById('progressBar');
    if (el) el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }
};

function toggleFlex(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = (window.getComputedStyle(el).display !== 'none') ? 'none' : 'flex';
}

let fileQueue = [];
let abortController = null;

function getAgentId() { return (document.getElementById('agentId')?.value || '').trim().toUpperCase(); }
function getAgentHandle() { return (document.getElementById('agentHandle')?.value || '').trim(); }
function getSystemPrompt() { return document.getElementById('systemPrompt')?.value || 'You are ARCHIVAX.'; }
function getModel() { return document.getElementById('modelSelect')?.value || 'gemini-2.5-flash'; }
function getThreadsPerKey() { return parseInt(document.getElementById('threadsPerKey')?.value || '3', 10); }
function getBatchSize() { return parseInt(document.getElementById('batchSize')?.value || '60', 10); }

function loadSavedParams() {
  const p = localStorage.getItem('O_PROMPT');
  if (p && document.getElementById('systemPrompt')) document.getElementById('systemPrompt').value = p;
  const keys = JSON.parse(localStorage.getItem('O_KEYS') || '[]');
  ['k1', 'k2', 'k3', 'k4', 'k5'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.value = keys[i] || '';
  });
  lore.setApiKeys(keys.filter(Boolean));
}

function saveParams() {
  const prompt = document.getElementById('systemPrompt')?.value || '';
  const keys = ['k1', 'k2', 'k3', 'k4', 'k5'].map(id => (document.getElementById(id)?.value || '').trim()).filter(Boolean);
  localStorage.setItem('O_PROMPT', prompt);
  localStorage.setItem('O_KEYS', JSON.stringify(keys));
  lore.setApiKeys(keys);
  ui.log(`Parameters saved. Keys: ${keys.length}`, 'SYS');
}

async function refreshStats() {
  const s = await lore.getStats();
  ui.stat('statVectors', `${s.totalNodes} N / ${s.totalEdges} E`);
  const size = fileQueue.reduce((a, f) => a + (f.size || 0), 0);
  ui.stat('statChunks', `${fileQueue.length} Files | ${(size / (1024 * 1024)).toFixed(2)} MB`);
}

function stageFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  fileQueue.push(...list);
  refreshStats();
  ui.log(`Staged ${list.length} file(s).`, 'SYS');
}

async function buildTasksFromFiles() {
  const tasks = [];
  for (const f of fileQueue) {
    const text = await f.text();
    const chunks = lore.chunk(text);
    for (const c of chunks) tasks.push({ text: c, source: f.name });
  }
  return tasks;
}

function setBusy(stateLabel) { ui.stat('statState', stateLabel); }

function setControlsEnabled(enabled) {
  ['ingestBtn', 'exportBtn', 'importBtn', 'sendBtn', 'stageFilesBtn', 'buildGraphBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

// --- ACTIONS ---

async function runIngest() {
  const agentId = getAgentId();
  if (!agentId) return ui.log('Agent ID required.', 'ERR', 'err');
  if (!fileQueue.length) return ui.log('No files staged.', 'ERR', 'err');
  
  abortController = new AbortController();
  setControlsEnabled(false);
  setBusy('INGESTING');
  ui.bar(0);
  
  try {
    const tasks = await buildTasksFromFiles();
    ui.log(`Ingesting ${tasks.length} chunks...`, 'SYS');
    await lore.ingestBatches(tasks, {
      agentId,
      agentHandle: getAgentHandle(),
      batchSize: getBatchSize(),
      threadsPerKey: getThreadsPerKey(),
      signal: abortController.signal,
      onProgress: ({ processed, total }) => {
        ui.bar((processed / total) * 100);
        ui.stat('statVectorsLog', processed);
      }
    });
    ui.log('Ingestion complete.', 'SYS', 'ok');
    fileQueue = [];
    await refreshStats();
  } catch (e) {
    ui.log(`Ingest failed: ${e.message}`, 'ERR', 'err');
  } finally {
    setBusy('IDLE');
    setControlsEnabled(true);
    abortController = null;
  }
}

async function runExport() {
  const agentId = getAgentId();
  if (!agentId) return ui.log('Agent ID required.', 'ERR', 'err');
  setControlsEnabled(false);
  setBusy('EXPORTING');
  ui.bar(0);

  try {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let count = 0;
        for await (const batch of lore.yieldExportBatches(agentId, 1000)) {
          const lines = batch.map(obj => JSON.stringify(obj)).join('\n') + '\n';
          controller.enqueue(encoder.encode(lines));
          count += batch.length;
          ui.stat('statVectorsLog', count);
          ui.bar(Math.min(99, (count % 5000) / 50));
        }
        controller.close();
      }
    });
    const gz = stream.pipeThrough(new CompressionStream('gzip'));
    const blob = await new Response(gz).blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `MYTHOS.LORE.${agentId}.LOREPACK.${new Date().toISOString().slice(0,10)}.jsonl.gz`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    ui.log(`Exported ${agentId}.`, 'SYS', 'ok');
  } catch (e) {
    ui.log(`Export failed: ${e.message}`, 'ERR', 'err');
  } finally {
    setBusy('IDLE');
    setControlsEnabled(true);
    ui.bar(0);
  }
}

async function runImport(file) {
  if (!file) return;
  setControlsEnabled(false);
  setBusy('IMPORTING');
  ui.bar(0);
  try {
    const res = await lore.import(file, ({ processed }) => {
      ui.bar(Math.min(99, (processed % 5000) / 50));
      ui.stat('statVectorsLog', processed);
    });
    ui.log(`Imported ${res.nodesImported} items.`, 'SYS', 'ok');
    await refreshStats();
  } catch (e) {
    ui.log(`Import failed: ${e.message}`, 'ERR', 'err');
  } finally {
    setBusy('IDLE');
    setControlsEnabled(true);
    ui.bar(0);
  }
}

async function runChat() {
  const qEl = document.getElementById('chatInput');
  const q = (qEl?.value || '').trim();
  if (!q) return;
  const agentId = getAgentId();
  ui.log(q, 'OPERATOR', 'user');
  try {
    const res = await lore.chat(q, agentId, getSystemPrompt(), getModel());
    ui.log(res.response, agentId || 'ARCHIVAX', 'ai');
    ui.log(`[${res.derivation}]`, 'SYS', 'sys');
  } catch (e) {
    ui.log(`Chat error: ${e.message}`, 'ERR', 'err');
  } finally {
    qEl.value = '';
  }
}

// --- INIT ---

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await lore.ready();
    loadSavedParams();
    await refreshStats();
    ui.stat('statState', 'IDLE');
    ui.log('LOREPACK Factory online (Graph Ready).', 'SYS', 'ok');
  } catch (e) {
    ui.log(`Boot error: ${e.message}`, 'ERR', 'err');
  }

  // Bind Buttons
  const bind = (id, fn) => { const el = document.getElementById(id); if(el) el.onclick = fn; };
  
  bind('togglePrompt', () => toggleFlex('prompt'));
  bind('toggleKeys', () => toggleFlex('keys'));
  bind('saveBtn', saveParams);
  bind('ingestBtn', runIngest);
  bind('exportBtn', runExport);
  bind('sendBtn', runChat);
  bind('clearLogBtn', () => document.getElementById('logConsole').innerHTML = '');
  
  const stageBtn = document.getElementById('stageFilesBtn');
  const fileInput = document.getElementById('fileInput');
  if (stageBtn && fileInput) stageBtn.onclick = () => fileInput.click();
  if (fileInput) fileInput.onchange = (e) => { stageFiles(e.target.files); e.target.value = ''; };

  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  if (importBtn && importFile) importBtn.onclick = () => importFile.click();
  if (importFile) importFile.onchange = async (e) => { await runImport(e.target.files?.[0]); e.target.value = ''; };

  bind('nukeTrigger', () => toggleFlex('nukeModal'));
  bind('nukeConfirmBtn', async () => { await lore.nuke(); location.reload(); });

  // Graph Trigger
  bind('buildGraphBtn', async () => {
    const aid = getAgentId();
    if (!aid) return ui.log('Agent ID required.', 'ERR', 'err');
    setControlsEnabled(false);
    setBusy('GRAPHING');
    ui.bar(0);
    try {
      ui.log(`Building Graph for ${aid}...`, 'SYS');
      const count = await lore.buildGraphLite(aid, (curr, total, created) => {
        ui.bar((curr / total) * 100);
        if (curr % 5 === 0) ui.stat('statVectorsLog', `${curr}/${total} | +${created} Edges`);
      });
      ui.log(`Graph build complete. ${count} edges created.`, 'SYS', 'ok');
      await refreshStats();
    } catch (e) {
      ui.log(`Graph build failed: ${e.message}`, 'ERR', 'err');
    } finally {
      setBusy('IDLE');
      setControlsEnabled(true);
      ui.bar(0);
    }
  });
});