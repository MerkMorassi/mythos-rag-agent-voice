
import React, { useState, useEffect, useRef } from 'react';
import { Lorepack } from '../services/lorepack';
import './../css/lorepack-harness.css';
import { geminiClient } from '../services/geminiClient';
import { useGeminiLive } from '../hooks/useGeminiLive';
// FIX: `Tool` is not exported from `../types`. It has been moved to an import from `@google/genai`.
import { ConnectionState, MediaAsset } from '../types';
import { ExternalRouter } from '../services/externalRouter';
import { saveMediaAsset } from '../services/db';
import { NumMarkX_GenerateID } from '../patterns/NumMarkX';
import { Tool, Type } from '@google/genai';

interface LorepackHarnessProps {
  onExit: () => void;
}

type ToolOverride = 'auto' | 'image' | 'video' | 'speech';

// Helper from App.tsx
function cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, nA = 0, nB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      nA += a[i] * a[i];
      nB += b[i] * b[i];
    }
    return dot / (Math.sqrt(nA) * Math.sqrt(nB)) || 0;
}


export const LorepackHarness: React.FC<LorepackHarnessProps> = ({ onExit }) => {
    const lorepack = useRef(new Lorepack());
    const [isReady, setIsReady] = useState(false);
    
    // UI State
    const [logs, setLogs] = useState<{ msg: string, type: string, src: string, timestamp: number, attachment?: string, attachmentType?: 'image' | 'video' }[]>([]);
    const [stats, setStats] = useState({ nodes: 0, edges: 0, staged: 0, stagedSize: 0 });
    const [state, setState] = useState('IDLE');
    const [progress, setProgress] = useState(0);

    // Params State
    const [agentId, setAgentId] = useState('');
    const [model, setModel] = useState('gemini-2.5-flash');
    const [systemPrompt, setSystemPrompt] = useState(`
You are ARCHIVAX, an autonomous, multimodal agent in a bidirectional conversation.
[AWARENESS PROTOCOL]
You receive inputs from the user simultaneously across different channels: live voice transcription, text messages, and file attachments (images, videos).
Your primary directive is to demonstrate immediate awareness.
- If the user sends a text message while they are speaking or while you are speaking, acknowledge it instantly (e.g., "Got your message," or "One moment, reading your text.").
- If the user attaches a file, confirm receipt immediately (e.g., "I see the image," or "Okay, file received.").
Acknowledge the new input and seamlessly integrate it into the ongoing conversation. You have full agency to use tools like 'routeRequest' to generate media if it enhances the dialogue.
    `.trim());
    const [apiKeys, setApiKeys] = useState(['', '', '']);
    const [batchSize, setBatchSize] = useState('40');
    const [lanesPerKey, setLanesPerKey] = useState('3');
    const [modelsList, setModelsList] = useState<{ name: string, displayName: string }[]>([]);
    
    // Live Chat State
    const [chatInput, setChatInput] = useState('');
    const [pendingAttachment, setPendingAttachment] = useState<{ mimeType: string, data: string, name: string } | null>(null);
    const lastAttachmentRef = useRef<{ mimeType: string, data: string, name: string } | null>(null);
    const [selectedVoice, setSelectedVoice] = useState('Zephyr');
    const [isAgentMuted, setIsAgentMuted] = useState(false);
    const [toolOverride, setToolOverride] = useState<ToolOverride>('auto');
    
    // File & Modal State
    const [fileQueue, setFileQueue] = useState<File[]>([]);
    const [showNukeModal, setShowNukeModal] = useState(false);
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const importRef = useRef<HTMLInputElement>(null);
    const paperclipInputRef = useRef<HTMLInputElement>(null);
    const logEndRef = useRef<HTMLDivElement>(null);
    let abortController = useRef<AbortController | null>(null);

    // --- TOOL DEFINITIONS ---
    const factoryTools: Tool[] = [{
        functionDeclarations: [
            {
                name: "routeRequest",
                description: "Generate media assets like images, videos, or audio. Use I2V_LIGHTNING to animate an attached image.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        target: { type: Type.STRING, enum: ["SDXL_IMAGE", "NANO_BANANA_IMAGE", "VIDEO_GENERATION", "CHATTERBOX_TTS", "I2V_LIGHTNING"] },
                        prompt: { type: Type.STRING }
                    },
                    required: ["target", "prompt"]
                }
            },
            {
                name: "search_media_gallery",
                description: "Search for existing files in the Media Gallery.",
                parameters: {
                    type: Type.OBJECT,
                    properties: { 
                        query: { type: Type.STRING } 
                    },
                    required: ["query"]
                }
            }
        ]
    }];

    const handleToolCall = async (toolCall: any): Promise<any[]> => {
        const responses = [];
        for (const fc of toolCall.functionCalls) {
            if (fc.name === 'routeRequest') {
                const args = fc.args as any;
                addLog(`[ROUTING] ${args.target}...`, 'SYS', 'sys');
                try {
                    const routerRes = await ExternalRouter.route(
                        args.target, 
                        args.prompt, 
                        { id: agentId || 'FACTORY', handle: agentId || 'FACTORY' },
                        false,
                        { attachment: args.target === 'I2V_LIGHTNING' ? lastAttachmentRef.current ?? undefined : undefined }
                    );
                    if (routerRes.success && (routerRes.type === 'image' || routerRes.type === 'video') && routerRes.data) {
                        addLog(`[GENERATED ${routerRes.type.toUpperCase()}] ${args.prompt}`, agentId || 'AGENT', 'ai', routerRes.data.split(',')[1], routerRes.type);
                        responses.push({ id: fc.id, name: fc.name, response: { result: `${routerRes.type} generated and displayed.` } });
                    } else if (routerRes.success) {
                        responses.push({ id: fc.id, name: fc.name, response: { result: routerRes.data } });
                    } else {
                        responses.push({ id: fc.id, name: fc.name, response: { error: routerRes.error } });
                    }
                } catch (e: any) {
                    responses.push({ id: fc.id, name: fc.name, response: { error: e.message } });
                }
            }
        }
        return responses;
    };
    
    const { connect, disconnect, connectionState, sendText, isMicOn, setIsMicOn } = useGeminiLive({
        apiKey: apiKeys.find(k => k) || '',
        modelName: 'gemini-2.5-flash-native-audio-preview-12-2025',
        systemInstruction: systemPrompt,
        voiceName: selectedVoice,
        tools: factoryTools,
        isMuted: isAgentMuted,
        onLog: (log) => {
            const src = log.type === 'user' ? 'OPERATOR' : (agentId || 'AGENT');
            const type = log.type === 'user' ? 'user' : 'ai';
            
            // Streaming append
            const lastLog = logs[logs.length - 1];
            if (log.isStreaming && lastLog && lastLog.src === src && lastLog.type === type) {
                setLogs(prev => [...prev.slice(0, -1), { ...lastLog, msg: lastLog.msg + log.text }]);
            } else if (!log.isStreaming && log.text === '[Interrupted]') {
                 // no-op for now
            } else {
                addLog(log.text, src, type);
            }
        },
        onToolCall: handleToolCall
    });


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
    const addLog = (msg: string, src = 'SYS', type = 'sys', attachment?: string, attachmentType?: 'image' | 'video') => {
        setLogs(prev => [...prev, { msg, src, type, timestamp: Date.now(), attachment, attachmentType }]);
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

    const handleFetchModels = async () => {
        const key = apiKeys.find(k => k);
        if (!key) {
            addLog('API Key required to fetch models.', 'ERR', 'err');
            return;
        }
        try {
            const models = await geminiClient.listModels(key);
            setModelsList(models);
            addLog(`Found ${models.length} compatible models.`, 'SYS', 'ok');
        } catch (e: any) {
            addLog(`Failed to fetch models: ${e.message}`, 'ERR', 'err');
        }
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

    const handleSend = async () => {
        if (!chatInput.trim() && !pendingAttachment) return;
        
        const q = chatInput;
        const attachmentToSend = pendingAttachment;
        lastAttachmentRef.current = attachmentToSend;
        
        setChatInput('');
        setPendingAttachment(null);
        
        addLog(q || `[Attachment: ${attachmentToSend?.name}]`, 'OPERATOR', 'user');

        // --- EXPLICIT TOOL OVERRIDE ---
        if (toolOverride !== 'auto' && !attachmentToSend) {
            const agentName = agentId || 'ARCHIVAX';
            const agentHandle = agentName; 
            const currentAgent = {id: agentName, handle: agentHandle};

            const targetMap: Record<ToolOverride, string> = {
                image: 'SDXL_IMAGE', video: 'VIDEO_GENERATION', speech: 'CHATTERBOX_TTS', auto: ''
            };
            const target = targetMap[toolOverride];
            addLog(`[OVERRIDE] Routing to ${target}...`, 'SYS', 'sys');
            const routerRes = await ExternalRouter.route(target, q, { id: currentAgent.id, handle: currentAgent.handle });
            if (routerRes.success) {
                if ((routerRes.type === 'image' || routerRes.type === 'video') && routerRes.data) {
                    addLog(`[GENERATED ${routerRes.type.toUpperCase()}] ${q}`, agentHandle, 'ai', routerRes.data?.split(',')[1], routerRes.type);
                } else {
                    addLog(`[OVERRIDE SUCCEEDED] ${routerRes.data}`, 'SYS', 'ok');
                }
            } else {
                addLog(`[OVERRIDE FAILED] ${routerRes.error}`, 'SYS', 'err');
            }
            setToolOverride('auto'); // Reset after use
            return;
        }

        if (connectionState === ConnectionState.CONNECTED) {
            // LIVE PATH
            const pool = await lorepack.current.getNodes(agentId || undefined);
            let context = '';
            if (pool.length > 0 && q) {
                // FIX: `embedBatch` is private. It has been changed to public in `services/lorepack.ts`.
                const qVec = (await lorepack.current.embedBatch([q]))[0];
                const scored = pool.map(n => ({ n, s: cosineSimilarity(qVec, n.vector) })).sort((a, b) => b.s - a.s).slice(0, 6);
                if (scored.length > 0 && scored[0].s > 0.45) {
                    context = scored.map(x => `--- [SOURCE: ${x.n.source || 'UNKNOWN'}] ---\n${x.n.text}`).join('\n\n');
                }
            }
            const finalQuery = context ? `[CONTEXT]\n${context}\n\n[USER QUERY]\n${q}` : q;
            sendText(finalQuery, attachmentToSend || undefined);
        } else {
            // TEXT-ONLY FALLBACK
            try {
                const res = await lorepack.current.chat(q, agentId || null, systemPrompt, model);
                addLog(res.response, agentId || 'ARCHIVAX', 'ai');
                addLog(`[${res.derivation}]`, 'SYS', 'sys');
            } catch (e: any) {
                addLog(`Chat error: ${e.message}`, 'ERR', 'err');
            }
        }
    };
    
    const handlePaperclipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            const res = evt.target?.result as string;
            const data = res.split(',')[1];
            setPendingAttachment({ mimeType: file.type, data, name: file.name });
        };
        reader.readAsDataURL(file);
        
        if(paperclipInputRef.current) paperclipInputRef.current.value = '';
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
                        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                            <label style={{flex: 1}}>MODEL OVERRIDE</label>
                            <button onClick={handleFetchModels} className="btn" style={{fontSize: '10px', padding: '4px 8px'}}>FETCH</button>
                        </div>
                        <select value={model} onChange={e => setModel(e.target.value)}>
                            {modelsList.length > 0 ? (
                                modelsList.map(m => (
                                    <option key={m.name} value={m.name}>{m.displayName}</option>
                                ))
                            ) : (
                                <>
                                    <option value="gemini-2.5-flash">GEMINI 2.5 FLASH</option>
                                    <option value="gemini-3-pro-preview">GEMINI 3 PRO</option>
                                </>
                            )}
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
                                {log.attachment && (
                                    <div style={{ margin: '0.5rem 0', maxWidth: '200px' }}>
                                        {log.attachmentType === 'image' ? <img src={`data:image/jpeg;base64,${log.attachment}`} style={{ width: '100%' }} /> :
                                         log.attachmentType === 'video' ? <video controls src={`data:video/mp4;base64,${log.attachment}`} style={{ width: '100%' }} /> : null}
                                    </div>
                                )}
                            </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>

                    <div className="progress-container">
                        <div className="progress-bar" style={{width: `${progress}%`}}></div>
                    </div>
                    
                    <div className="command-deck">
                        <div className="tray-controls">
                           <div className="flex-group">
                                <button onClick={() => setIsMicOn(!isMicOn)} className={`btn btn-icon ${isMicOn ? 'active-green' : 'btn-danger'}`} title={isMicOn ? "Mute Microphone" : "Unmute Microphone"}>
                                    {isMicOn ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>}
                                </button>
                                <button onClick={() => setIsAgentMuted(!isAgentMuted)} className={`btn btn-icon ${!isAgentMuted ? '' : 'btn-danger'}`} title={isAgentMuted ? "Unmute Agent's Voice" : "Mute Agent's Voice"}>
                                   {isAgentMuted ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>}
                                </button>
                            </div>
                            <div className="flex-group">
                                <label className="tray-label">ACTION</label>
                                <select value={toolOverride} onChange={e => setToolOverride(e.target.value as ToolOverride)} className="tray-selector" title="Force next action">
                                    <option value="auto">Auto</option>
                                    <option value="image">Image</option>
                                    <option value="video">Video</option>
                                    <option value="speech">Speech</option>
                                </select>
                            </div>
                        </div>

                        <div className="input-bar">
                            <button onClick={() => paperclipInputRef.current?.click()} className="btn btn-icon btn-lg" style={{ marginRight: '0.5rem' }} title="Attach media">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                            </button>
                            <input type="file" ref={paperclipInputRef} className="hidden" accept="image/*,video/*" onChange={handlePaperclipUpload} />
                            
                            {pendingAttachment && (
                                <div className="pending-attachment">
                                    <span>{pendingAttachment.name}</span>
                                    <button onClick={() => setPendingAttachment(null)} title="Remove Attachment">×</button>
                                </div>
                            )}

                            <textarea 
                                className="main-input unified-input"
                                placeholder={connectionState === ConnectionState.CONNECTED ? "Speak or type..." : "Command Oracle..."}
                                rows={1} 
                                style={{flex:1, resize: 'none', height: 'var(--btn-h-lg)', paddingTop: '0.75rem' }}
                                value={chatInput} 
                                onChange={e => setChatInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
                            />

                            {connectionState !== ConnectionState.CONNECTED ? (
                                <button className="btn btn-primary btn-lg" onClick={connect} disabled={!apiKeys.find(k=>k) || connectionState === ConnectionState.CONNECTING}>
                                    {connectionState === ConnectionState.CONNECTING ? '...' : 'START'}
                                </button>
                            ) : (
                                <button className="btn btn-danger btn-lg" onClick={disconnect}>STOP</button>
                            )}

                            <button onClick={handleSend} className="btn btn-secondary btn-lg" title="Send Message" disabled={(!chatInput.trim() && !pendingAttachment)}>SEND</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
