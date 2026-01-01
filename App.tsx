
import React, { useState, useEffect, useRef } from 'react';
import { 
  GoogleGenAI, 
  LiveServerMessage, 
  Modality, 
  FunctionDeclaration, 
  Type
} from '@google/genai';
import { 
  searchDocuments, 
  getSystemInstructions, 
  saveSystemInstructions,
  saveActiveChat, 
  loadActiveChat,
  saveChatSession 
} from './services/db';
import { createPcmBlob, base64ToUint8Array, decodeAudioData } from './services/audioUtils';
import Visualizer from './components/Visualizer';
import KnowledgeManager from './components/KnowledgeManager';
import ChatHistoryManager from './components/ChatHistoryManager';
import SettingsManager, { DEFAULT_CONFIG, ModelConfig } from './components/SettingsManager';
import { ConnectionState, LogMessage } from './types';
import { AGENTS, Agent } from './agents';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

// Comprehensive list of known Gemini voices (Removed Despina, Autonoe, Erinome, Gacrux, Laomedeia, Pulcherrima, Sulafat, Vindemiatrix, Achernar)
const PREBUILT_VOICES = [
  "Puck", "Charon", "Kore", "Fenrir", "Zephyr", // Classic
  "Aoede", "Callirrhoe", "Leda" // New / Star-themed
].sort();

const RAG_INSTRUCTION = `
You have access to a local Knowledge Base ('searchKnowledgeBase') and the broad web ('googleSearch').
If the user asks about private docs or indexed lore, check the local DB first.
If the conversation is a continuation, your memory of previous exchanges is provided in the system context.
Use 'terminateConnection' to end the link gracefully when the user is done.
Use 'downloadTranscript' if the user wants a hard copy of the session.
`;

const searchTool: FunctionDeclaration = {
  name: 'searchKnowledgeBase',
  description: 'Search the local vector database for agent-specific lore.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'The search keywords.' },
    },
    required: ['query'],
  },
};

const transcriptTool: FunctionDeclaration = {
  name: 'downloadTranscript',
  description: 'Triggers a local download of the chat transcript.',
};

const terminateTool: FunctionDeclaration = {
  name: 'terminateConnection',
  description: 'Terminates the live link.',
};

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [volume, setVolume] = useState<number>(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(AGENTS[0].id);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_CONFIG);
  const [systemInstruction, setSystemInstruction] = useState<string>('');
  
  // Voice State
  const [selectedVoice, setSelectedVoice] = useState<string>(AGENTS[0].voice);
  const [isCustomVoice, setIsCustomVoice] = useState(false);
  const [customVoiceName, setCustomVoiceName] = useState('');

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [logsLoaded, setLogsLoaded] = useState(false);
  
  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sessionRef = useRef<any | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Refs for streaming transcription
  const activeUserMessageRef = useRef<string>('');
  const activeModelMessageRef = useRef<string>('');
  const activeTurnIdRef = useRef<string | null>(null);

  const currentAgent = AGENTS.find(a => a.id === selectedAgentId) || AGENTS[0];

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Sync voice with selected agent
  useEffect(() => {
    const agent = AGENTS.find(a => a.id === selectedAgentId);
    if (agent) {
      setSelectedVoice(agent.voice);
      setIsCustomVoice(false);
      setCustomVoiceName('');
    }
  }, [selectedAgentId]);

  useEffect(() => {
    let isMounted = true;
    const loadChat = async () => {
      setLogsLoaded(false);
      try {
        const savedLogs = await loadActiveChat(selectedAgentId);
        if (isMounted) {
          setLogs(savedLogs);
          setLogsLoaded(true);
        }
      } catch (e) {
        setLogsLoaded(true);
      }
    };
    loadChat();
    return () => { isMounted = false; };
  }, [selectedAgentId]);

  useEffect(() => {
    const loadInstructions = async () => {
      try {
        const stored = await getSystemInstructions();
        setSystemInstruction(stored);
      } catch (e) {
        console.error("Failed to load system instructions", e);
      }
    };
    loadInstructions();
  }, []);

  useEffect(() => {
    if (logsLoaded) {
      saveActiveChat(selectedAgentId, logs).catch(console.error);
    }
  }, [logs, selectedAgentId, logsLoaded]);

  const addLog = (type: LogMessage['type'], text: string, id?: string) => {
    const logId = id || crypto.randomUUID();
    setLogs(prev => {
        // If we have an ID and it already exists, update it
        const index = prev.findIndex(l => l.id === logId);
        if (index !== -1) {
            const updated = [...prev];
            updated[index] = { ...updated[index], text, timestamp: Date.now() };
            return updated;
        }
        return [...prev, { id: logId, type, text, timestamp: Date.now() }];
    });
    return logId;
  };

  const handleSaveSystemInstruction = async () => {
    await saveSystemInstructions(systemInstruction);
  };

  const stopAudioPlayback = () => {
    scheduledSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    scheduledSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    activeModelMessageRef.current = '';
    activeUserMessageRef.current = '';
    activeTurnIdRef.current = null;
  };

  const toggleCamera = async () => {
    if (isCameraActive) {
      setIsCameraActive(false);
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setIsCameraActive(true);
        }
      } catch (err) {
        alert("Camera access denied.");
      }
    }
  };

  const connect = async () => {
    if (!process.env.API_KEY) return;
    setConnectionState(ConnectionState.CONNECTING);
    
    // Context Injection
    const recentHistory = logs.slice(-10).map(l => `${l.type === 'user' ? 'User' : 'Agent'}: ${l.text}`).join('\n');
    const historyContext = recentHistory ? `\n\nRECENT CONVERSATION HISTORY (RESUME CONTEXT):\n${recentHistory}` : '';
    const customInstructions = systemInstruction;
    const fullInstruction = `${currentAgent.system_instruction}\n${RAG_INSTRUCTION}${historyContext}\n${customInstructions}`;

    // Determine final voice name
    const voiceName = isCustomVoice && customVoiceName.trim() ? customVoiceName.trim() : selectedVoice;

    try {
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = outputCtx;
      inputAudioContextRef.current = inputCtx;
      
      const analyser = outputCtx.createAnalyser();
      analyserRef.current = analyser;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          systemInstruction: fullInstruction,
          responseModalities: [Modality.AUDIO],
          // Apply model config settings
          temperature: modelConfig.temperature,
          topP: modelConfig.topP,
          topK: modelConfig.topK,
          outputAudioTranscription: {}, // Live text stream
          inputAudioTranscription: {},  // User live text stream
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          tools: [{ googleSearch: {} }, { functionDeclarations: [searchTool, transcriptTool, terminateTool] }],
        },
        callbacks: {
          onopen: async () => {
            setConnectionState(ConnectionState.CONNECTED);
            addLog('system', `Link Established: ${currentAgent.handle} is online (Voice: ${voiceName}).`);

            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = inputCtx.createMediaStreamSource(micStream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              sessionPromise.then(s => s.sendRealtimeInput({ media: createPcmBlob(inputData) }));
            };
            source.connect(processor);
            processor.connect(inputCtx.destination);

            if (isCameraActive && videoRef.current && canvasRef.current) {
              const video = videoRef.current;
              const canvas = canvasRef.current;
              const ctx = canvas.getContext('2d');
              frameIntervalRef.current = window.setInterval(() => {
                if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
                  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                  const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
                  sessionPromise.then(s => s.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } }));
                }
              }, 1500);
            }
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.interrupted) {
                stopAudioPlayback();
                return;
            }

            // Handle Transcriptions (Streaming Feedback)
            if (msg.serverContent?.inputTranscription) {
                const text = msg.serverContent.inputTranscription.text;
                activeUserMessageRef.current += text;
                const turnId = `user-stream-${activeTurnIdRef.current || 'pending'}`;
                addLog('user', activeUserMessageRef.current, turnId);
            }

            if (msg.serverContent?.outputTranscription) {
                const text = msg.serverContent.outputTranscription.text;
                activeModelMessageRef.current += text;
                const turnId = `model-stream-${activeTurnIdRef.current || 'pending'}`;
                addLog('model', activeModelMessageRef.current, turnId);
            }

            if (msg.serverContent?.turnComplete) {
                // Finalize the current turn logs by giving them unique permanent IDs
                if (activeUserMessageRef.current) {
                    addLog('user', activeUserMessageRef.current);
                    activeUserMessageRef.current = '';
                }
                if (activeModelMessageRef.current) {
                    addLog('model', activeModelMessageRef.current);
                    activeModelMessageRef.current = '';
                }
                // Clear temporary turn IDs from log state to prevent duplicates
                setLogs(prev => prev.filter(l => !l.id.startsWith('user-stream-') && !l.id.startsWith('model-stream-')));
                activeTurnIdRef.current = null;
            }
            
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'searchKnowledgeBase') {
                  const query = (fc.args as any).query;
                  const docs = await searchDocuments(query, undefined, selectedAgentId);
                  const result = docs.length ? JSON.stringify(docs) : "No local documents found.";
                  sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result } } }));
                } else if (fc.name === 'terminateConnection') {
                  disconnect();
                }
              }
            }

            // Play Audio Chunks Immediately (Streaming)
            const modelTurn = msg.serverContent?.modelTurn;
            if (modelTurn?.parts && audioContextRef.current) {
                const ctx = audioContextRef.current;
                for (const part of modelTurn.parts) {
                    if (part.inlineData?.data) {
                        const audioData = base64ToUint8Array(part.inlineData.data);
                        const audioBuffer = await decodeAudioData(audioData, ctx);
                        
                        const source = ctx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(analyserRef.current!);
                        analyserRef.current!.connect(ctx.destination);

                        const now = ctx.currentTime;
                        // Schedule next chunk to start exactly when the previous one ends
                        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, now);
                        source.start(nextStartTimeRef.current);
                        nextStartTimeRef.current += audioBuffer.duration;
                        
                        scheduledSourcesRef.current.add(source);
                        source.onended = () => scheduledSourcesRef.current.delete(source);
                    }
                }
            }
          }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (e) {
      setConnectionState(ConnectionState.ERROR);
    }
  };

  const disconnect = async () => {
    if (logs.length > 0) {
      await saveChatSession({ id: crypto.randomUUID(), title: `Auto-Archive ${currentAgent.handle}`, timestamp: Date.now(), logs });
    }
    stopAudioPlayback();
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (sessionRef.current) sessionRef.current.close?.();
    setConnectionState(ConnectionState.DISCONNECTED);
    addLog('system', 'Link Terminated.');
  };

  return (
    <div className="main-container">
      <div className="header-container">
        <h1 className="header-title animate-pulse">MythOS :: Hypervisor</h1>
        <div className="status-bar">
          <div className="status-item">CORE: <span style={{color:'#fff'}}>{currentAgent.handle}</span></div>
          <div className="status-item">SYNC: <span style={{color: connectionState === ConnectionState.CONNECTED ? '#4ade80' : '#666'}}>{connectionState}</span></div>
        </div>
      </div>

      <div className="section-panel" style={{display:'flex', gap:'1rem', alignItems:'center'}}>
        <select 
            value={selectedAgentId} 
            onChange={e => setSelectedAgentId(e.target.value)} 
            disabled={connectionState !== ConnectionState.DISCONNECTED} 
            className="form-select control-select-agent"
        >
          {AGENTS.map(a => <option key={a.id} value={a.id}>{a.handle.toUpperCase()}</option>)}
        </select>

        {isCustomVoice ? (
          <div style={{display:'flex', gap:'0.25rem', flex:'none'}}>
            <input 
              type="text" 
              value={customVoiceName}
              onChange={(e) => setCustomVoiceName(e.target.value)}
              placeholder="Voice ID..."
              className="form-input"
              style={{width:'100px', padding:'0.75rem', fontFamily: 'monospace', fontSize: '0.75rem'}}
              disabled={connectionState !== ConnectionState.DISCONNECTED}
            />
            <button 
              onClick={() => setIsCustomVoice(false)} 
              className="btn btn-secondary" 
              style={{padding:'0 0.5rem'}}
              disabled={connectionState !== ConnectionState.DISCONNECTED}
            >
              X
            </button>
          </div>
        ) : (
          <select 
              value={selectedVoice} 
              onChange={(e) => {
                if (e.target.value === 'CUSTOM_ENTRY') {
                  setIsCustomVoice(true);
                  setCustomVoiceName('');
                } else {
                  setSelectedVoice(e.target.value);
                }
              }} 
              disabled={connectionState !== ConnectionState.DISCONNECTED} 
              className="form-select"
              style={{ width: '130px', flex: 'none' }}
          >
              {PREBUILT_VOICES.map(v => <option key={v} value={v}>VOICE: {v.toUpperCase()}</option>)}
              <option value="CUSTOM_ENTRY" style={{fontStyle:'italic', color: '#a78bfa'}}>MANUAL ENTRY...</option>
          </select>
        )}

        <button 
            onClick={connectionState === ConnectionState.CONNECTED ? disconnect : connect} 
            className={`btn ${connectionState === ConnectionState.CONNECTED ? 'btn-abort' : 'btn-primary'} control-btn-link`}
        >
          {connectionState === ConnectionState.CONNECTED ? 'TERMINATE' : 'LINK'}
        </button>
        
        <button 
            onClick={toggleCamera} 
            className={`btn btn-secondary ${isCameraActive ? 'active' : ''}`} 
            style={{borderColor: isCameraActive ? '#4ade80' : '', width: 'auto', flex: 'none'}}
        >
          {isCameraActive ? 'CAM ON' : 'CAM OFF'}
        </button>
        
        <KnowledgeManager currentAgentId={selectedAgentId} onUpdate={() => addLog('system', 'Lore Update Sync')} />
        <ChatHistoryManager currentLogs={logs} onLoadSession={setLogs} />
        <SettingsManager 
            config={modelConfig} 
            setConfig={setModelConfig} 
            disabled={connectionState !== ConnectionState.DISCONNECTED} 
            systemInstruction={systemInstruction}
            setSystemInstruction={setSystemInstruction}
            saveSystemInstruction={handleSaveSystemInstruction}
        />
      </div>

      <div style={{display: 'grid', gridTemplateColumns: isCameraActive ? '1fr 1fr' : '1fr', gap:'1rem'}}>
        <div className="section-panel">
          <div className="section-header"><span className="section-header-title">Resonator Output</span></div>
          <Visualizer analyser={analyserRef.current} isActive={connectionState === ConnectionState.CONNECTED} />
        </div>
        {isCameraActive && (
          <div className="section-panel" style={{overflow:'hidden', position:'relative'}}>
             <video ref={videoRef} autoPlay playsInline muted style={{width:'100%', height:'8rem', objectFit:'cover', filter:'grayscale(100%) brightness(0.8) contrast(1.2)'}} />
             <canvas ref={canvasRef} width="320" height="240" className="hidden" />
             <div style={{position:'absolute', inset:0, background:'repeating-linear-gradient(0deg, rgba(0,0,0,0.1) 0px, rgba(0,0,0,0.1) 1px, transparent 2px)', pointerEvents:'none'}} />
          </div>
        )}
      </div>

      <div className="chat-history-container" style={{backgroundColor: '#050505', backgroundImage: 'radial-gradient(#111 1px, transparent 0)', backgroundSize: '20px 20px'}}>
        {logs.length === 0 && (
            <div className="chat-message-system">System Initialized. Awaiting Link Authorization.</div>
        )}
        {logs.map(log => {
          const isSystem = log.type === 'system';
          const name = log.type === 'user' ? 'USER' : (log.type === 'model' ? currentAgent.handle.toUpperCase() : 'SYSTEM');
          
          return (
            <div key={log.id} className={`chat-message-base chat-message-${log.type} ${log.id.includes('-stream-') ? 'animate-pulse' : ''}`}>
              {!isSystem && (
                <div style={{fontSize: '0.7rem', marginBottom: '0.2rem', opacity: 0.8, fontWeight: 'bold'}}>
                  {name} <span style={{opacity:0.5, marginLeft: '0.2rem', fontWeight: 'normal'}}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                </div>
              )}
              {log.text}
            </div>
          );
        })}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

export default App;
