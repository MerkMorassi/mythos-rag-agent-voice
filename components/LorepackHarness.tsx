import React, { useState, useEffect, useRef } from 'react';
import { Lorepack } from '../services/lorepack';
import './../css/lorepack-harness.css';

interface LorepackHarnessProps {
  onExit: () => void;
}

export const LorepackHarness: React.FC<LorepackHarnessProps> = ({ onExit }) => {
    const lorepack = useRef(new Lorepack());
    const [isReady, setIsReady] = useState(false);
    
    // UI State
    const [logs, setLogs] = useState<{ msg: string, type: string, src: string, timestamp: number }[]>([]);
    const [stats, setStats] = useState({ nodes: 0, edges: 0, staged: 0, stagedSize: 0 });
    const [state, setState] = useState('IDLE');
    const [progress, setProgress] = useState(0);

    // Params State
    const [agentId, setAgentId] = useState('');
    const [model, setModel] = useState('gemini-2.5-flash');
    const [systemPrompt, setSystemPrompt] = useState('You are ARCHIVAX.');
    const [apiKeys, setApiKeys] = useState(['', '', '']);
    const [batchSize, setBatchSize] = useState('40');
    const [lanesPerKey, setLanesPerKey] = useState('3');
    
    const [chatInput, setChatInput] = useState('');
    
    // File & Modal State
    const [fileQueue, setFileQueue] = useState<File[]>([]);
    const [showNukeModal, setShowNukeModal] = useState(false);
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const importRef = useRef<HTMLInputElement>(null);
    const logEndRef = useRef<HTMLDivElement>(null);
    let abortController = useRef<AbortController | null>(null);

    // --- INITIALIZATION & LIFECYCLE ---
    useEffect(() => {
        const init = async () => {
            await lorepack.current.ready();
            loadSavedParams();
            await refreshStats();
            setIsReady(true);
            addLog('LOREPACK Factory online (Graph Ready).', 'SYS', 'ok');
        };
        init().catch(e => addLog(`Boot error: ${e.message}`, 'ERR', 'err'));
    }, []);

    useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
    useEffect(() => { refreshStats(); }, [fileQueue]); // Refresh staged count when files change

    // --- UI & STATE HELPERS ---
    const addLog = (msg: string, src = 'SYS', type = 'sys') => {
        setLogs(prev => [...prev, { msg, src, type, timestamp: Date.now() }]);
    };
    
    const setBusy = (isBusy: boolean, newState: string) => {
        setState(newState);
    };

    const refreshStats = async () => {
        const s = await lorepack.current.getStats();
        const size = fileQueue.reduce((a, f) => a + (f.size || 0), 0);
        setStats({ 
            nodes: s.totalNodes, 
            edges: s.totalEdges, 
            staged: fileQueue.length, 
            stagedSize: size 
        });
    };

    // --- PARAMS & CONFIG ---
    const loadSavedParams = () => {
        const p = localStorage.getItem('O_PROMPT_V2');
        if (p) setSystemPrompt(p);
        const keys = JSON.parse(localStorage.getItem('O_KEYS_V2') || '["","",""]');
        setApiKeys(keys);
        lorepack.current.setApiKeys(keys);
    };

    const saveParams = () => {
        localStorage.setItem('O_PROMPT_V2', systemPrompt);
        localStorage.setItem('O_KEYS_V2', JSON.stringify(apiKeys));
        lorepack.current.setApiKeys(apiKeys);
        addLog(`Parameters saved. Keys: ${apiKeys.filter(Boolean).length}`, 'SYS');
    };
    
    // --- CORE ACTIONS ---
    const runIngest = async () => {
        if (!agentId) return addLog('Agent ID required.', 'ERR', 'err');
        if (!fileQueue.length) return addLog('No files staged.', 'ERR', 'err');
        
        abortController.current = new AbortController();
        setBusy(true, 'INGESTING');
        setProgress(0);
        
        try {
            const tasks = [];
            for (const f of fileQueue) {
                const text = await f.text();
                const chunks = lorepack.current.chunk(text);
                for (const c of chunks) tasks.push({ text: c, source: f.name });
            }

            addLog(`Ingesting ${tasks.length} chunks...`, 'SYS');
            await lorepack.current.ingestBatches(tasks, {
                agentId,
                batchSize: parseInt(batchSize, 10),
                lanesPerKey: parseInt(lanesPerKey, 10),
                signal: abortController.current.signal,
                onProgress: ({ processed, total }: {processed: number, total: number}) => {
                    setProgress((processed / total) * 100);
                    // This stat is updated frequently, so it's handled differently in the original
                }
            });
            addLog('Ingestion complete.', 'SYS', 'ok');
            setFileQueue([]);
            await refreshStats();
        } catch (e: any) {
            addLog(`Ingest failed: ${e.message}`, 'ERR', 'err');
        } finally {
            setBusy(false, 'IDLE');
            setProgress(0);
            abortController.current = null;
        }
    };

    const runExport = async () => {
        if (!agentId) return addLog('Agent ID required.', 'ERR', 'err');
        setBusy(true, 'EXPORTING');
        setProgress(0);
      
        try {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                async start(controller) {
                    let count = 0;
                    for await (const batch of lorepack.current.yieldExportBatches(agentId, 1000)) {
                        const lines = batch.map(obj => JSON.stringify(obj)).join('\n') + '\n';
                        controller.enqueue(encoder.encode(lines));
                        count += batch.length;
                        setProgress(Math.min(99, (count % 5000) / 50));
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
            addLog(`Exported ${agentId}.`, 'SYS', 'ok');
        } catch (e: any) {
            addLog(`Export failed: ${e.message}`, 'ERR', 'err');
        } finally {
            setBusy(false, 'IDLE');
            setProgress(0);
        }
    };

    const runImport = async (file: File) => {
        if (!file) return;
        setBusy(true, 'IMPORTING');
        setProgress(0);
        try {
            const res = await lorepack.current.import(file, ({ processed }) => {
                setProgress(Math.min(99, (processed % 5000) / 50));
            });
            addLog(`Imported ${res.nodesImported} items.`, 'SYS', 'ok');
            await refreshStats();
        } catch (e: any) {
            addLog(`Import failed: ${e.message}`, 'ERR', 'err');
        } finally {
            setBusy(false, 'IDLE');
            setProgress(0);
            if(importRef.current) importRef.current.value = '';
        }
    };

    const runBuildGraph = async () => {
        if (!agentId) return addLog('Agent ID required.', 'ERR', 'err');
        setBusy(true, 'GRAPHING');
        setProgress(0);
        try {
            addLog(`Building Graph for ${agentId}...`, 'SYS');
            const count = await lorepack.current.buildGraphLite(agentId, (curr, total, created) => {
                setProgress((curr / total) * 100);
                addLog(`Analyzed ${curr}/${total} nodes | +${created} Edges`, 'GRAPH');
            });
            addLog(`Graph build complete. ${count} edges created.`, 'SYS', 'ok');
            await refreshStats();
        } catch (e: any) {
            addLog(`Graph build failed: ${e.message}`, 'ERR', 'err');
        } finally {
            setBusy(false, 'IDLE');
            setProgress(0);
        }
    };

    const runChat = async () => {
        if (!chatInput) return;
        const q = chatInput;
        addLog(q, 'OPERATOR', 'user');
        setChatInput('');
        try {
            const res = await lorepack.current.chat(q, agentId || null, systemPrompt, model);
            addLog(res.response, agentId || 'ARCHIVAX', 'ai');
            addLog(`[${res.derivation}]`, 'SYS', 'sys');
        } catch (e: any) {
            addLog(`Chat error: ${e.message}`, 'ERR', 'err');
        }
    };

    const runNuke = async () => {
        await lorepack.current.nuke();
        location.reload();
    };

    return (
        <div className="lorepack-harness">
            {showNukeModal && (
                <div id="nukeModal" className="modal-overlay" style={{display:'flex'}}>
                    <div className="modal">
                        <h2>PURGE VAULT?</h2>
                        <div className="row" style={{display:'flex', gap:'1rem'}}>
                            <button id="nukeConfirmBtn" className="btn danger flex-1" onClick={runNuke}>CONFIRM</button>
                            <button onClick={() => setShowNukeModal(false)} className="btn flex-1">CANCEL</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="header">
                <div className="brand">MYTHOS <span style={{color: '#666'}}>//</span> LOREPACK FACTORY</div>
                <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
                    <div style={{fontSize: '12px', color: '#888'}}>STATUS: <span style={{color: '#4ade80'}}>GRAPH READY</span></div>
                    <button onClick={onExit} className="btn" style={{borderColor: '#facc15', color: '#facc15', padding: '5px 10px', fontSize: '10px'}}>EXIT</button>
                </div>
            </div>

            <div className="main-grid">
                <div className="controls">
                    <input value={agentId} onChange={e => setAgentId(e.target.value)} type="text" placeholder="AGENT ID" />

                    <div className="input-group">
                        <label>MODEL OVERRIDE</label>
                        <select value={model} onChange={e => setModel(e.target.value)}>
                            <option value="gemini-2.5-flash">GEMINI 2.5 FLASH</option>
                            <option value="gemini-2.5-pro">GEMINI 2.5 PRO</option>
                        </select>
                    </div>

                    <div className="input-group">
                        <label onClick={e => (e.currentTarget.nextElementSibling as HTMLElement).style.display = (e.currentTarget.nextElementSibling as HTMLElement).style.display === 'none' ? 'flex' : 'none'}>
                            [+] SYSTEM INSTRUCTIONS
                        </label>
                        <div className="collapsible-content" style={{display:'none', flexDirection: 'column'}}>
                            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={6}></textarea>
                        </div>
                    </div>

                    <div className="input-group">
                        <label onClick={e => (e.currentTarget.nextElementSibling as HTMLElement).style.display = (e.currentTarget.nextElementSibling as HTMLElement).style.display === 'none' ? 'flex' : 'none'}>
                            [+] PARALLEL API ARRAY
                        </label>
                        <div className="collapsible-content" style={{display:'none', flexDirection:'column', gap:'8px'}}>
                            {apiKeys.map((k, i) => (
                                <input key={i} type="password" placeholder={`KEY ${i+1}`} value={k} onChange={e => { const newKeys = [...apiKeys]; newKeys[i] = e.target.value; setApiKeys(newKeys); }} />
                            ))}
                        </div>
                    </div>

                    <div className="input-group">
                        <label>EMBED BATCH SIZE</label>
                        <input type="number" min="1" max="200" value={batchSize} onChange={e => setBatchSize(e.target.value)} />
                    </div>

                    <div className="input-group">
                        <label>LANES PER KEY</label>
                        <input type="number" min="1" max="20" value={lanesPerKey} onChange={e => setLanesPerKey(e.target.value)} />
                    </div>

                    <button className="btn" onClick={saveParams}>LOCK PARAMETERS</button>
                    <hr style={{borderColor: '#333', margin: '5px 0'}} />
                    <button className="btn" onClick={() => fileInputRef.current?.click()}>[+] STAGE FILES</button>
                    <input ref={fileInputRef} type="file" multiple style={{display:'none'}} onChange={e => setFileQueue(Array.from(e.target.files || []))} />
                    <button className="btn" onClick={runIngest} disabled={state !== 'IDLE'}>INGEST LORE</button>
                    <button className="btn" style={{color: '#4ade80'}} onClick={runBuildGraph} disabled={state !== 'IDLE'}>BUILD GRAPH LITE</button>
                    <button className="btn" onClick={runExport} disabled={state !== 'IDLE'}>EXPORT (GZIP)</button>
                    <button className="btn" onClick={() => importRef.current?.click()} disabled={state !== 'IDLE'}>IMPORT (GZIP)</button>
                    <input ref={importRef} type="file" accept=".gz,.jsonl,.json" style={{display:'none'}} onChange={e => runImport(e.target.files?.[0]!)} />
                    <button className="btn danger" onClick={() => setShowNukeModal(true)} style={{marginTop:'auto'}}>NUKE VAULT</button>
                </div>

                <div className="dashboard">
                    <div className="stats-grid">
                        <div className="stat-item">
                            <span className="stat-label">TOTAL NODES/EDGES</span>
                            <span className="stat-value active">{stats.nodes} N / {stats.edges} E</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">STAGED</span>
                            <span className="stat-value">{stats.staged} | {(stats.stagedSize / (1024*1024)).toFixed(2)}MB</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">STATE</span>
                            <span className="stat-value" style={{color: '#4ade80'}}>{state}</span>
                        </div>
                    </div>

                    <div style={{display:'flex', justifyContent:'space-between', paddingBottom:'5px', fontSize:'12px', color:'#888'}}>
                        <div>LOG: <span style={{color:'#fff'}}>{logs.length}</span></div>
                        <div onClick={() => setLogs([])} style={{cursor:'pointer'}}>[X] CLEAR LOG</div>
                    </div>

                    <div id="logConsole" className="log-console">
                        {logs.map((log, i) => (
                            <div key={i} className={`log-entry ${log.type}`}>
                                [{new Date(log.timestamp).toLocaleTimeString()}] <b>{log.src}</b>: {log.msg}
                            </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>

                    <div className="progress-container">
                        <div className="progress-bar" style={{width: `${progress}%`}}></div>
                    </div>

                    <div className="chat-input-area">
                        <textarea 
                            placeholder="Command Oracle." 
                            rows={1} 
                            style={{flex:1}}
                            value={chatInput} 
                            onChange={e => setChatInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runChat(); }}}
                        />
                        <button className="btn" onClick={runChat} style={{padding:'0 20px'}}>SEND</button>
                    </div>
                </div>
            </div>
        </div>
    );
};