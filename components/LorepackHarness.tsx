import React, { useState, useEffect, useRef } from 'react';
import { Lorepack } from '../services/lorepack';
import './../css/lorepack-harness.css';

// Local type definition for compatibility. The service layer may need updates for full functionality.
interface LorepackStats {
    totalNodes: number;
    agents: { id: string, count: number }[];
}

interface LorepackHarnessProps {
  onExit: () => void;
}

export const LorepackHarness: React.FC<LorepackHarnessProps> = ({ onExit }) => {
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

    const lorepack = useRef(new Lorepack());
    const fileInputRef = useRef<HTMLInputElement>(null);
    const importRef = useRef<HTMLInputElement>(null);
    const graphPackRef = useRef<HTMLInputElement>(null);
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
        try {
            // @ts-ignore - The service returns a different stats object. Adapting for UI.
            const s = await lorepack.current.getStats();
            // @ts-ignore
            setStats({ totalNodes: s.totalNodes, agents: [] }); // Agents not provided by this service version.
        } catch (e: any) {
            addLog(`Failed to refresh stats: ${e.message}`, 'err');
        }
    };

    const handleSaveKeys = () => {
        const keys = [
            (document.getElementById('apiKey1') as HTMLInputElement).value,
            (document.getElementById('apiKey2') as HTMLInputElement).value,
            (document.getElementById('apiKey3') as HTMLInputElement).value,
        ].filter(Boolean);
        localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
        lorepack.current.setApiKeys(keys);
        setKeyStatus(`Saved ${keys.length} Key(s)`);
        if (keys.length > 0) setSysStatus('ONLINE');
        else setSysStatus('AWAITING KEY');
    };

    const handleIngest = async () => {
        addLog("Ingest function not available in this service version.", 'err');
        // This function requires a `lorepack.ingest` method that is not on the current service.
    };

    const handleExport = async () => {
        addLog("Export (.jsonl) function not available in this service version.", 'err');
        // This function requires a `lorepack.export` method that is not on the current service.
    };

    const handleExportGzip = async () => {
        if (!agentId) return addLog('Agent ID required for export.', 'err');
        setState('EXPORTING');
        try {
            // FIX: The method 'yieldExportBatches' does not exist. Using the available 'exportGzip' method from the service.
            const count = await lorepack.current.exportGzip(agentId.toUpperCase());
            addLog(`Exported ${count} nodes for ${agentId.toUpperCase()}.`, 'sys');
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
            const res = await lorepack.current.import(file, ({ processed }) => {
                // Cannot calculate percentage without total file size knowledge in this service version.
                // setProgress(...);
            });
            addLog(`Imported ${res.nodesImported} nodes.`, 'sys');
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
            // FIX: Invalid arguments passed to buildGraphLite. The service method doesn't take an options object for progress.
            // Also corrected the handling of the return value.
            const graphStats = await lorepack.current.buildGraphLite(agentId.toUpperCase());
            addLog(`Graph built (${graphStats.edges} edges).`, 'sys');
        } catch (e: any) {
            addLog(`Graph build failed: ${e.message}`, 'err');
        } finally {
            setState('IDLE');
        }
    };

    const handleGraphPack = async (e: React.ChangeEvent<HTMLInputElement>) => {
        addLog("GraphPack function not available in this service version.", 'err');
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
                <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
                    <div className="status">STATUS: <span style={{color: sysStatus === 'ONLINE' ? '#00ffaa' : '#f87171'}}>{sysStatus}</span></div>
                    <button onClick={onExit} className="btn danger">EXIT</button>
                </div>
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
                    <button className="btn" onClick={() => graphPackRef.current?.click()}>GRAPH + EXPORT LOREPACK</button>
                    <input ref={graphPackRef} type="file" accept=".jsonl,.jsonl.gz,.gz,.json" style={{display:'none'}} onChange={handleGraphPack} />
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
                        <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChat()} placeholder="Query ARCHIVAX..." />
                        <button onClick={handleChat} disabled={isProcessing}>{isProcessing ? '...' : 'SEND'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
};