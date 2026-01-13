import React, { useState, useEffect, useRef } from 'react';
import { Lorepack } from '../services/lorepack';
import './../css/lorepack-harness.css';

interface LogEntry {
  id: string;
  msg: string;
  src: string;
  type: string;
}

interface LorepackHarnessProps {
  onExit: () => void;
}

export const LorepackHarness: React.FC<LorepackHarnessProps> = ({ onExit }) => {
  const loreRef = useRef<Lorepack | null>(null);
  const [isReady, setIsReady] = useState(false);
  
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState({ totalNodes: 0, totalEdges: 0 });
  const [fileQueue, setFileQueue] = useState<File[]>([]);
  const [stateLabel, setStateLabel] = useState('IDLE');
  const [progress, setProgress] = useState(0);
  const [progressLog, setProgressLog] = useState('0');
  
  const [agentId, setAgentId] = useState('');
  const [agentHandle, setAgentHandle] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are ARCHIVAX.');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [threads, setThreads] = useState('3');
  const [batchSize, setBatchSize] = useState('60');
  
  const [keys, setKeys] = useState(['', '', '', '', '']);
  const [isPromptVisible, setIsPromptVisible] = useState(false);
  const [isKeysVisible, setIsKeysVisible] = useState(false);
  const [isNukeModalVisible, setIsNukeModalVisible] = useState(false);

  const [chatInput, setChatInput] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const logConsoleRef = useRef<HTMLDivElement>(null);
  let abortControllerRef = useRef<AbortController | null>(null);

  const uiLog = (msg: string, src = 'SYS', type = 'sys') => {
    setLogs(prev => [...prev, { id: crypto.randomUUID(), msg, src, type }]);
  };

  const refreshStats = async () => {
    if (!loreRef.current) return;
    const s = await loreRef.current.getStats();
    setStats({ totalNodes: s.totalNodes, totalEdges: s.totalEdges });
  };
  
  // --- INITIALIZATION ---
  useEffect(() => {
    const init = async () => {
      try {
        const lore = new Lorepack();
        await lore.ready();
        loreRef.current = lore;
        
        const savedPrompt = localStorage.getItem('O_PROMPT');
        if (savedPrompt) setSystemPrompt(savedPrompt);
        
        const savedKeys = JSON.parse(localStorage.getItem('O_KEYS') || '[]');
        const newKeys = [...savedKeys];
        while (newKeys.length < 5) newKeys.push('');
        setKeys(newKeys);
        
        lore.setApiKeys(savedKeys.filter(Boolean));
        
        await refreshStats();
        setStateLabel('IDLE');
        uiLog('LOREPACK Factory online (Graph Ready).', 'SYS', 'ok');
        setIsReady(true);
      } catch (e: any) {
        uiLog(`Boot error: ${e.message}`, 'ERR', 'err');
      }
    };
    init();
  }, []);
  
  useEffect(() => {
    logConsoleRef.current?.scrollTo({ top: logConsoleRef.current.scrollHeight, behavior: 'smooth' });
  }, [logs]);

  // --- ACTIONS ---

  const handleSaveParams = () => {
    localStorage.setItem('O_PROMPT', systemPrompt);
    const validKeys = keys.map(k => k.trim()).filter(Boolean);
    localStorage.setItem('O_KEYS', JSON.stringify(validKeys));
    loreRef.current?.setApiKeys(validKeys);
    uiLog(`Parameters saved. Keys: ${validKeys.length}`, 'SYS');
  };

  const handleStageFiles = (files: FileList | null) => {
    const fileList = Array.from(files || []);
    if (!fileList.length) return;
    setFileQueue(prev => [...prev, ...fileList]);
    uiLog(`Staged ${fileList.length} file(s).`, 'SYS');
  };

  const buildTasksFromFiles = async () => {
    const tasks = [];
    for (const f of fileQueue) {
      const text = await f.text();
      const chunks = loreRef.current!.chunk(text);
      for (const c of chunks) tasks.push({ text: c, source: f.name });
    }
    return tasks;
  };

  const setControlsEnabled = (enabled: boolean) => {
    // In React, this is handled by the `disabled` prop on buttons based on stateLabel
  };

  const handleIngest = async () => {
    if (!agentId) return uiLog('Agent ID required.', 'ERR', 'err');
    if (fileQueue.length === 0) return uiLog('No files staged.', 'ERR', 'err');

    abortControllerRef.current = new AbortController();
    setControlsEnabled(false);
    setStateLabel('INGESTING');
    setProgress(0);
    
    try {
      const tasks = await buildTasksFromFiles();
      uiLog(`Ingesting ${tasks.length} chunks...`, 'SYS');
      await loreRef.current!.ingestBatches(tasks, {
        agentId: agentId.trim().toUpperCase(),
        agentHandle: agentHandle.trim(),
        batchSize: parseInt(batchSize, 10),
        threadsPerKey: parseInt(threads, 10),
        signal: abortControllerRef.current.signal,
        onProgress: ({ processed, total }) => {
          setProgress((processed / total) * 100);
          setProgressLog(String(processed));
        }
      });
      uiLog('Ingestion complete.', 'SYS', 'ok');
      setFileQueue([]);
      await refreshStats();
    } catch (e: any) {
      uiLog(`Ingest failed: ${e.message}`, 'ERR', 'err');
    } finally {
      setStateLabel('IDLE');
      setControlsEnabled(true);
      abortControllerRef.current = null;
    }
  };
  
  const handleExport = async () => {
    const id = agentId.trim().toUpperCase();
    if (!id) return uiLog('Agent ID required.', 'ERR', 'err');
    setControlsEnabled(false);
    setStateLabel('EXPORTING');
    setProgress(0);

    try {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          let count = 0;
          for await (const batch of loreRef.current!.yieldExportBatches(id, 1000)) {
            const lines = batch.map(obj => JSON.stringify(obj)).join('\n') + '\n';
            controller.enqueue(encoder.encode(lines));
            count += batch.length;
            setProgressLog(String(count));
            setProgress(Math.min(99, (count % 5000) / 50));
          }
          controller.close();
        }
      });
      const gz = stream.pipeThrough(new CompressionStream('gzip'));
      const blob = await new Response(gz).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `MYTHOS.LORE.${id}.LOREPACK.${new Date().toISOString().slice(0,10)}.jsonl.gz`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      uiLog(`Exported ${id}.`, 'SYS', 'ok');
    } catch (e: any) {
      uiLog(`Export failed: ${e.message}`, 'ERR', 'err');
    } finally {
      setStateLabel('IDLE');
      setControlsEnabled(true);
      setProgress(0);
    }
  };

  const handleImport = async (file: File | null) => {
    if (!file) return;
    setControlsEnabled(false);
    setStateLabel('IMPORTING');
    setProgress(0);
    try {
      const res = await loreRef.current!.import(file, ({ processed }) => {
        setProgress(Math.min(99, (processed % 5000) / 50));
        setProgressLog(String(processed));
      });
      uiLog(`Imported ${res.nodesImported} items.`, 'SYS', 'ok');
      await refreshStats();
    } catch (e: any) {
      uiLog(`Import failed: ${e.message}`, 'ERR', 'err');
    } finally {
      setStateLabel('IDLE');
      setControlsEnabled(true);
      setProgress(0);
    }
  };

  const handleChat = async () => {
    const q = chatInput.trim();
    if (!q) return;
    uiLog(q, 'OPERATOR', 'user');
    setChatInput('');
    try {
      const res = await loreRef.current!.chat(q, agentId.trim().toUpperCase(), systemPrompt, model);
      uiLog(res.response, agentId.trim().toUpperCase() || 'ARCHIVAX', 'ai');
      uiLog(`[${res.derivation}]`, 'SYS', 'sys');
    } catch (e: any) {
      uiLog(`Chat error: ${e.message}`, 'ERR', 'err');
    }
  };
  
  const handleBuildGraph = async () => {
    const aid = agentId.trim().toUpperCase();
    if (!aid) return uiLog('Agent ID required.', 'ERR', 'err');
    setControlsEnabled(false);
    setStateLabel('GRAPHING');
    setProgress(0);
    try {
      uiLog(`Building Graph for ${aid}...`, 'SYS');
      const count = await loreRef.current!.buildGraphLite(aid, {
        onProgress: (curr, total, created) => {
          setProgress((curr / total) * 100);
          setProgressLog(`${curr}/${total} | +${created} Edges`);
        },
        threadsPerKey: parseInt(threads, 10)
      });
      uiLog(`Graph build complete. ${count} edges created.`, 'SYS', 'ok');
      await refreshStats();
    } catch (e: any) {
      uiLog(`Graph build failed: ${e.message}`, 'ERR', 'err');
    } finally {
      setStateLabel('IDLE');
      setControlsEnabled(true);
      setProgress(0);
    }
  };
  
  const handleNuke = async () => {
      await loreRef.current?.nuke();
      window.location.reload();
  };

  return (
    <div className="lorepack-harness">
      <div className="header">
        <div className="brand">MYTHOS <span className="text-dim-alt">//</span> LOREPACK FACTORY</div>
        <button onClick={onExit} className="btn danger">EXIT FACTORY</button>
      </div>
      <div className="main-grid">
        <div className="controls">
          <input value={agentId} onChange={e => setAgentId(e.target.value)} type="text" placeholder="AGENT ID" />
          <input value={agentHandle} onChange={e => setAgentHandle(e.target.value)} type="text" placeholder="AGENT HANDLE (Optional)" />
          <div className="input-group">
            <label>MODEL OVERRIDE</label>
            <select value={model} onChange={e => setModel(e.target.value)}>
              <option value="gemini-2.5-flash">GEMINI 2.5 FLASH</option>
              <option value="gemini-3-pro-preview">GEMINI 3 PRO</option>
            </select>
          </div>
          <div className="input-group">
            <label onClick={() => setIsPromptVisible(!isPromptVisible)} className="cursor-pointer">SYSTEM INSTRUCTIONS</label>
            {isPromptVisible && <div className="collapsible-content"><textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={6}></textarea></div>}
          </div>
          <div className="input-group">
            <label onClick={() => setIsKeysVisible(!isKeysVisible)} className="cursor-pointer">PARALLEL API ARRAY</label>
            {isKeysVisible && <div className="collapsible-content">
              {keys.map((k, i) => <input key={i} value={k} onChange={e => { const newKeys = [...keys]; newKeys[i] = e.target.value; setKeys(newKeys); }} type="password" placeholder={`KEY ${i+1}`} />)}
            </div>}
          </div>
          <div className="input-group"><label>EMBED BATCH SIZE</label><input value={batchSize} onChange={e => setBatchSize(e.target.value)} type="number" min="1" max="200" /></div>
          <div className="input-group"><label>THREADS PER KEY</label><input value={threads} onChange={e => setThreads(e.target.value)} type="number" min="1" max="50" /></div>
          <button onClick={handleSaveParams} className="btn">LOCK PARAMETERS</button>
          <hr className="sep" />
          <button className="btn" onClick={() => fileInputRef.current?.click()}>[+] STAGE FILES</button>
          <input ref={fileInputRef} type="file" multiple style={{display:'none'}} onChange={(e) => { handleStageFiles(e.target.files); (e.target as HTMLInputElement).value = ''; }} />
          <button id="ingestBtn" onClick={handleIngest} className="btn">INGEST LORE</button>
          <button id="buildGraphBtn" onClick={handleBuildGraph} className="btn text-main-color">BUILD GRAPH LITE</button>
          <button id="exportBtn" onClick={handleExport} className="btn">EXPORT (GZIP)</button>
          <button id="importBtn" onClick={() => importFileRef.current?.click()} className="btn">IMPORT (GZIP)</button>
          <input ref={importFileRef} type="file" accept=".gz,.jsonl,.json" style={{display:'none'}} onChange={async (e) => { await handleImport(e.target.files?.[0] || null); (e.target as HTMLInputElement).value = ''; }} />
          <button id="nukeTrigger" onClick={() => setIsNukeModalVisible(true)} className="btn text-error-color margin-top-auto">NUKE VAULT</button>
        </div>
        <div className="dashboard">
          <div className="stats-grid">
            <div className="stat-item"><span className="stat-label">TOTAL NODES/EDGES</span><span id="statVectors" className="stat-value active">{stats.totalNodes} N / {stats.totalEdges} E</span></div>
            <div className="stat-item"><span className="stat-label">STAGED</span><span id="statChunks" className="stat-value">{fileQueue.length} Files | {(fileQueue.reduce((a, f) => a + (f.size || 0), 0) / (1024 * 1024)).toFixed(2)} MB</span></div>
            <div className="stat-item"><span className="stat-label">STATE</span><span id="statState" className="text-state-idle stat-value">{stateLabel}</span></div>
          </div>
          <div className="flex-row" style={{paddingBottom:'5px', fontSize:'12px'}}><div className="text-dim-alt">LOG: <span className="text-main-color">{progressLog}</span></div><div onClick={() => setLogs([])} className="cursor-pointer text-dim-alt">[X] CLEAR LOG</div></div>
          <div id="logConsole" ref={logConsoleRef}>
            {logs.map(log => (
              <div key={log.id} className={`log-entry ${log.type}`}><b>{log.src}</b>: {log.msg}</div>
            ))}
          </div>
          <div className="progress-container"><div id="progressBar" className="progress-bar" style={{width: `${progress}%`}}></div></div>
          <div className="terminal-group">
            <textarea id="chatInput" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat(); } }} placeholder="Command Oracle." rows={1} className="flex-1"></textarea>
            <button id="sendBtn" onClick={handleChat} className="btn" style={{padding: '0 20px'}}>SEND</button>
          </div>
        </div>
      </div>
      {isNukeModalVisible && <div id="nukeModal" className="modal-overlay">
        <div className="modal">
          <h2>PURGE VAULT?</h2>
          <div className="row" style={{display: 'flex', gap: '10px'}}>
            <button onClick={handleNuke} className="btn danger flex-1">CONFIRM</button>
            <button onClick={() => setIsNukeModalVisible(false)} className="btn flex-1">CANCEL</button>
          </div>
        </div>
      </div>}
    </div>
  );
};