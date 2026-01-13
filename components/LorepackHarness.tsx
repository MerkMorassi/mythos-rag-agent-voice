import React, { useState, useEffect, useRef } from 'react';
import { Lorepack, LorepackStats } from '../services/lorepack';

export const LorepackHarness: React.FC = () => {
    const [agentId, setAgentId] = useState('');
    const [sysStatus, setSysStatus] = useState('AWAITING KEY');
    const [keyStatus, setKeyStatus] = useState('No Keys Stored');
    const [stats, setStats] = useState<LorepackStats>({ totalNodes: 0, agents: [] });
    const [state, setState] = useState('IDLE');
    const [logs, setLogs] = useState<{msg: string, type: string}[]>([]);
    const [fileQueue, setFileQueue] = useState<File[]>([]);
    const [progress, setProgress] = useState(0);
    const [eta, setEta] = useState('--:--');
    const [chatInput, setChatInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [nodeOutput, setNodeOutput] = useState('');

    const lorepack = useRef(new Lorepack());
    const fileInputRef = useRef<HTMLInputElement>(null);
    const importRef = useRef<HTMLInputElement>(null);
    const logEndRef = useRef<HTMLDivElement>(null);

    const KEYS_STORAGE = 'MYTHOS_GEMINI_KEYS';

    useEffect(() => {
        const keys = JSON.parse(localStorage.getItem(KEYS_STORAGE) || '[]');
        if (keys.length > 0) {
            lorepack.current.setApiKeys(keys);
            setKeyStatus(`Loaded ${keys.length} Key(s)`);
            setSysStatus('ONLINE');
        }
        refreshStats();
    }, []);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const addLog = (msg: string, type = 'info') => {
        setLogs(prev => [...prev, { msg, type }]);
    };

    const refreshStats = async () => {
        const s = await lorepack.current.getStats();
        setStats(s);
    };

    const handleSaveKeys = () => {
        const key1 = (document.getElementById('apiKey1') as HTMLInputElement).value.trim();
        const key2 = (document.getElementById('apiKey2') as HTMLInputElement).value.trim();
        const key3 = (document.getElementById('apiKey3') as HTMLInputElement).value.trim();
        const keys = [key1, key2, key3].filter(k => k !== '');
        
        if (keys.length > 0) {
            localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
            lorepack.current.setApiKeys(keys);
            setKeyStatus(`Saved ${keys.length} Key(s)`);
            setSysStatus('ONLINE');
            addLog("API Keys updated.", "sys");
        }
    };

    const handleIngest = async () => {
        const id = agentId.trim().toUpperCase();
        if (!id) return addLog('Agent ID required.', 'err');
        if (fileQueue.length === 0) return addLog('No files staged.', 'err');

        setState('INGESTING');
        setProgress(0);
        const start = Date.now();

        try {
            await lorepack.current.ingest(fileQueue, id, ({ processed, total }) => {
                setProgress((processed / total) * 100);
                const elapsed = (Date.now() - start) / 1000;
                const rate = processed / elapsed;
                const remaining = (total - processed) / rate;
                
                const mins = Math.floor(remaining / 60);
                const secs = Math.floor(remaining % 60);
                setEta(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
            });
            addLog('Ingestion complete.', 'sys');
            setFileQueue([]);
            await refreshStats();
        } catch (e: any) {
            addLog(`Error: ${e.message}`, 'err');
        } finally {
            setState('IDLE');
            setProgress(0);
            setEta('--:--');
        }
    };

    const handleExport = async () => {
        if (!agentId) return addLog('Agent ID required for export.', 'err');
        setState('EXPORTING');
        try {
            const { nodes, count } = await lorepack.current.export(agentId.toUpperCase());
            if (count === 0) throw new Error("No nodes found.");
            
            const content = nodes.map(n => JSON.stringify(n)).join('\n');
            const blob = new Blob([content], { type: 'application/jsonl' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `MYTHOS.LORE.${agentId.toUpperCase()}.jsonl`;
            a.click();
            URL.revokeObjectURL(url);
            addLog(`Exported ${count} nodes.`, 'sys');
        } catch (e: any) {
            addLog(`Export failed: ${e.message}`, 'err');
        } finally {
            setState('IDLE');
        }
    };

    const handleExportGzip = async () => {
        if (!agentId) return addLog('Agent ID required for export.', 'err');
        setState('EXPORTING');
        try {
            const count = await lorepack.current.exportGzip(agentId.toUpperCase());
            addLog(`Exported ${count} nodes (gzip).`, 'sys');
        } catch (e: any) {
            addLog(`Export failed: ${e.message}`, 'err');
        } finally {
            setState('IDLE');
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setState('IMPORTING');
        addLog(`Importing ${file.name}...`, 'sys');
        try {
            const res = file.name.endsWith('.gz')
                ? await lorepack.current.importGzip(file, ({ processed, total }) => {
                    setProgress((processed / total) * 100);
                })
                : await lorepack.current.import(file, ({ processed, total }) => {
                setProgress((processed / total) * 100);
            });
            addLog(`Imported ${res.nodesImported} nodes for ${res.agentId || 'unknown'}.`, 'sys');
            await refreshStats();
        } catch (e: any) {
            addLog(`Import failed: ${e.message}`, 'err');
        } finally {
            setState('IDLE');
            setProgress(0);
            if (importRef.current) importRef.current.value = '';
        }
    };

    const handleBuildGraph = async () => {
        if (!agentId) return addLog('Agent ID required for graph build.', 'err');
        setState('BUILDING GRAPH');
        addLog(`Building graph lite for ${agentId.toUpperCase()}...`, 'sys');
        try {
            const res = await lorepack.current.buildGraphLite(agentId.toUpperCase());
            addLog(`Graph built (${res.nodes} nodes, ${res.edges} edges).`, 'sys');
        } catch (e: any) {
            addLog(`Graph build failed: ${e.message}`, 'err');
        } finally {
            setState('IDLE');
        }
    };

    const handleChat = async () => {
        if (!chatInput.trim() || isProcessing) return;
        const query = chatInput.trim();
        setChatInput('');
        addLog(`${agentId || 'USER'}: ${query}`, 'user');
        setIsProcessing(true);

        try {
            const res = await lorepack.current.chat(query, agentId.toUpperCase() || null);
            addLog(`ARCHIVAX: ${res.response}`, 'ai');
        } catch (e: any) {
            addLog(`Query Error: ${e.message}`, 'err');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="lorepack-harness">
            <div className="header">
                <div className="brand">LOREPACK <span style={{color:'#666'}}>//</span> HARNESS v1.1</div>
                <div className="status">STATUS: <span style={{color: sysStatus === 'ONLINE' ? '#00ffaa' : '#f87171'}}>{sysStatus}</span></div>
            </div>
            
            <div className="main-grid">
                <div className="controls">
                    <div className="input-group">
                        <label>LOCUS ID (AGENT)</label>
                        <input value={agentId} onChange={e => setAgentId(e.target.value)} type="text" placeholder="e.g. BARBELO" />
                    </div>

                    <div className="collapsible-section">
                        <label>GEMINI API KEYS</label>
                        <div className="key-inputs">
                            <input id="apiKey1" type="password" placeholder="Key #1" />
                            <input id="apiKey2" type="password" placeholder="Key #2" />
                            <input id="apiKey3" type="password" placeholder="Key #3" />
                            <div className="key-footer">
                                <span>{keyStatus}</span>
                                <button className="btn btn-xs" onClick={handleSaveKeys}>SAVE KEYS</button>
                            </div>
                        </div>
                    </div>

                    <div className="input-group">
                        <label>SOURCE MATERIAL</label>
                        <button className="btn primary" onClick={() => fileInputRef.current?.click()}>STAGED FILES ({fileQueue.length})</button>
                        <input ref={fileInputRef} type="file" multiple style={{display:'none'}} onChange={e => setFileQueue(Array.from(e.target.files || []))} />
                    </div>

                    <button className="btn" onClick={handleIngest} disabled={state !== 'IDLE'}>INGEST BATCH</button>
                    <button className="btn" onClick={() => importRef.current?.click()}>IMPORT LOREPACK</button>
                    <input ref={importRef} type="file" accept=".jsonl,.jsonl.gz,.gz" style={{display:'none'}} onChange={handleImport} />
                    <button className="btn" onClick={handleExport}>EXPORT LOREPACK</button>
                    <button className="btn" onClick={handleExportGzip}>EXPORT GZIP</button>
                    <button className="btn" onClick={handleBuildGraph}>BUILD GRAPH LITE</button>
                    <button
                        className="btn danger"
                        onClick={async () => {
                            if (!confirm('Nuke Vault?')) return;
                            setState('NUKING');
                            try {
                                await lorepack.current.nuke();
                                addLog('Vault nuked.', 'err');
                                await refreshStats();
                            } catch (e: any) {
                                addLog(`Nuke failed: ${e.message}`, 'err');
                            } finally {
                                setState('IDLE');
                            }
                        }}
                    >
                        NUKE VAULT
                    </button>
                </div>

                <div className="dashboard">
                    <div className="stats-grid">
                        <div className="stat-item"><span className="label">NODES</span><span className="value">{stats.totalNodes}</span></div>
                        <div className="stat-item"><span className="label">STAGED</span><span className="value">{fileQueue.length}</span></div>
                        <div className="stat-item"><span className="label">ETA</span><span className="value">{eta}</span></div>
                        <div className="stat-item" style={{gridColumn:'span 2'}}><span className="label">STATE</span><span className="value" style={{color: '#00ffaa'}}>{state}</span></div>
                    </div>

                    <div className="log-console">
                        {logs.map((log, i) => (
                            <div key={i} className={`log-entry ${log.type}`}>
                                {log.msg}
                            </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>

                    {progress > 0 && (
                        <div className="progress-container">
                            <div className="progress-bar" style={{width: `${progress}%`}}></div>
                        </div>
                    )}

                    <div className="chat-input-area">
                        <span>&gt;</span>
                        <textarea 
                            value={chatInput} 
                            onChange={e => setChatInput(e.target.value)} 
                            placeholder="Query Archivax..."
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleChat())}
                        />
                        <button className="btn primary" onClick={handleChat} disabled={isProcessing}>SEND</button>
                    </div>
                </div>
            </div>

            <style>{`
                .lorepack-harness { display: flex; flex-direction: column; height: 100vh; background: #050505; color: #ccc; font-family: monospace; font-size: 13px; }
                .header { display: flex; justify-content: space-between; padding: 1rem; border-bottom: 1px solid #333; }
                .brand { font-size: 1.2rem; font-weight: bold; color: #00ffaa; letter-spacing: 2px; }
                .main-grid { display: grid; grid-template-columns: 300px 1fr; gap: 1rem; flex: 1; padding: 1rem; overflow: hidden; }
                .controls { background: #111; border: 1px solid #333; padding: 1rem; display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; }
                .dashboard { display: flex; flex-direction: column; gap: 1rem; overflow: hidden; }
                .input-group { display: flex; flex-direction: column; gap: 0.5rem; }
                label { color: #666; font-size: 0.7rem; text-transform: uppercase; }
                input, textarea { background: #000; border: 1px solid #444; color: #fff; padding: 0.5rem; font-family: inherit; }
                .btn { background: #222; color: #fff; border: 1px solid #555; padding: 0.75rem; cursor: pointer; text-transform: uppercase; font-size: 0.75rem; }
                .btn:hover { border-color: #00ffaa; color: #00ffaa; }
                .btn.primary { border-color: #00ffaa; color: #00ffaa; background: rgba(0, 255, 170, 0.05); }
                .btn.danger { border-color: #ff3333; color: #ff3333; }
                .btn-xs { padding: 0.25rem 0.5rem; font-size: 0.6rem; }
                .stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.5rem; background: #000; padding: 0.5rem; border: 1px solid #333; }
                .stat-item { text-align: center; }
                .stat-item .label { display: block; font-size: 0.6rem; color: #666; }
                .stat-item .value { font-size: 1rem; font-weight: bold; }
                .log-console { flex: 1; background: #000; border: 1px solid #333; padding: 0.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
                .log-entry { padding-left: 0.5rem; border-left: 2px solid #333; }
                .log-entry.sys { border-left-color: #00ffaa; color: #00ffaa; }
                .log-entry.err { border-left-color: #ff3333; color: #ff3333; }
                .log-entry.user { border-left-color: #38bdf8; color: #eee; }
                .log-entry.ai { border-left-color: #888; color: #ccc; white-space: pre-wrap; padding: 0.5rem; background: #0a0a0a; }
                .progress-container { height: 4px; background: #222; }
                .progress-bar { height: 100%; background: #00ffaa; transition: width 0.2s; }
                .chat-input-area { display: flex; align-items: center; gap: 0.5rem; background: #0a0a0a; padding: 0.5rem; border: 1px solid #333; }
                .chat-input-area textarea { flex: 1; height: 2.5rem; resize: none; background: transparent; border: none; outline: none; }
                .key-inputs { display: flex; flex-direction: column; gap: 0.25rem; }
                .key-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 0.25rem; font-size: 0.6rem; color: #666; }
            `}</style>
        </div>
    );
};
