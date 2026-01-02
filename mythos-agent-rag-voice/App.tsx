

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
  saveActiveChat, 
  loadActiveChat,
  saveChatSession,
  getGeneralInstructions,
  saveGeneralInstructions,
  getAgentConfig,
  saveAgentConfig
} from './services/db';
import { createPcmBlob, base64ToUint8Array, decodeAudioData } from './services/audioUtils';
import Visualizer from './components/Visualizer';
import KnowledgeManager from './components/KnowledgeManager';
import ChatHistoryManager from './components/ChatHistoryManager';
import SettingsManager from './components/SettingsManager';
import { ConnectionState, LogMessage, ModelConfig, DEFAULT_MODEL_CONFIG } from './types';
import { AGENTS, Agent } from './agents';
import { GATING_MODELS } from './models';

// Comprehensive list of known Gemini voices
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

interface Attachment {
  file: File;
  type: 'image' | 'text';
  preview: string; // Base64 for image, Snippet for text
  content: string; // Base64 data or Raw Text
  mimeType: string;
}

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [systemStatus, setSystemStatus] = useState<string>("System Initialized. Awaiting Link Authorization.");
  
  const [selectedAgentId, setSelectedAgentId] = useState<string>(AGENTS[0].id);
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  
  // Gating / Orchestration State
  const [useDeepAnalysis, setUseDeepAnalysis] = useState(false);

  // Settings State
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [generalInstruction, setGeneralInstruction] = useState<string>('');
  const [agentInstruction, setAgentInstruction] = useState<string>('');
  
  // Voice State
  const [selectedVoice, setSelectedVoice] = useState<string>(AGENTS[0].voice);
  const [isCustomVoice, setIsCustomVoice] = useState(false);
  const [customVoiceName, setCustomVoiceName] = useState('');

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [logsLoaded, setLogsLoaded] = useState(false);
  
  // Refs
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Load General Instructions on Mount
  useEffect(() => {
    const loadGeneral = async () => {
        const gen = await getGeneralInstructions();
        setGeneralInstruction(gen);
    };
    loadGeneral();
  }, []);

  // Load Agent Config & Chat History when agent changes
  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      // Note: We intentionally DO NOT set logsLoaded(false) here because
      // we handle it in the onChange handler to prevent race conditions during render.
      // However, we set it here again just in case.
      setLogsLoaded(false);
      
      try {
        // Load Chat
        const savedLogs = await loadActiveChat(selectedAgentId);
        // Load Config
        const savedConfig = await getAgentConfig(selectedAgentId);

        if (isMounted) {
          setLogs(savedLogs);
          setAgentInstruction(savedConfig.instruction);
          setModelConfig(savedConfig.modelConfig);
          setLogsLoaded(true); // Enable saving only after data is fully loaded
        }
      } catch (e) {
        console.error("Error loading agent data", e);
        if(isMounted) {
            setLogs([]); 
            setLogsLoaded(true);
        }
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, [selectedAgentId]);

  // Auto-save chat history when logs change
  useEffect(() => {
    if (logsLoaded) {
      saveActiveChat(selectedAgentId, logs).catch(console.error);
    }
  }, [logs, selectedAgentId, logsLoaded]);

  const addLog = (type: LogMessage['type'], text: string, id?: string) => {
    const logId = id || crypto.randomUUID();
    setLogs(prev => {
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

  const handleLoreUpdate = async () => {
      const msg = "[SYSTEM ALERT: New knowledge has been ingested into the local database. You can now search for this new information using your tools. Inform the user you are aware of the update.]";
      setSystemStatus('Knowledge Base Updated: New Data Available');
      // Visual log for user
      addLog('system', "SYSTEM: Knowledge Base Updated. Alerting Agent...");
      
      // Alert the agent if connected
      if (connectionState === ConnectionState.CONNECTED && sessionRef.current) {
          try {
              // Inject a system message as a user turn
              await sessionRef.current.send({
                  clientContent: {
                      turns: [{
                          role: 'user',
                          parts: [{ text: msg }]
                      }],
                      turnComplete: true
                  }
              });
          } catch (e) {
              console.error("Failed to notify agent of update", e);
              addLog('system', "SYSTEM ERROR: Failed to inject update alert to Agent.");
          }
      }
  };

  const handleSaveSettings = async () => {
    await saveGeneralInstructions(generalInstruction);
    await saveAgentConfig(selectedAgentId, { 
        instruction: agentInstruction, 
        modelConfig 
    });
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const isImage = file.type.startsWith('image/');
      const isText = file.type === 'application/json' || file.name.endsWith('.md') || file.name.endsWith('.txt');

      if (!isImage && !isText) {
          alert("Unsupported file type. Please upload images, .txt, .md, or .json");
          return;
      }

      const reader = new FileReader();
      
      reader.onload = (event) => {
        const result = event.target?.result as string;
        
        if (isImage) {
            // result is "data:image/png;base64,....."
            const base64 = result.split(',')[1];
            setAttachment({
                file,
                type: 'image',
                preview: result,
                content: base64,
                mimeType: file.type
            });
        } else {
            // Text content
            setAttachment({
                file,
                type: 'text',
                preview: '📄 ' + file.name,
                content: result,
                mimeType: 'text/plain'
            });
        }
      };
      
      if (isImage) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearAttachment = () => {
    setAttachment(null);
  };

  // Gating / Analysis Logic
  const performDeepAnalysis = async (att: Attachment, userPrompt: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    let parts: any[] = [];
    
    if (att.type === 'image') {
        parts = [
            {
                inlineData: {
                    mimeType: att.mimeType,
                    data: att.content
                }
            },
            {
                text: userPrompt ? `Analyze this image in the context of: "${userPrompt}". Provide deep insight for the voice agent.` : "Analyze this image in detail for the voice agent."
            }
        ];
    } else {
        // Text
        parts = [
            {
                text: `Analyze the following file content (${att.file.name}) and provide a detailed summary and insight for the voice agent.\n\nFILE CONTENT:\n${att.content}\n\nUSER CONTEXT: ${userPrompt}`
            }
        ];
    }
    
    const response = await ai.models.generateContent({
        model: modelConfig.gatingModelName,
        contents: { parts }
    });
    return response.text || "";
  };

  const handleSendText = async () => {
    if ((!inputText.trim() && !attachment) || connectionState !== ConnectionState.CONNECTED) return;
    
    const text = inputText.trim();
    const currentAttachment = attachment;
    const isGated = useDeepAnalysis && currentAttachment;
    
    // Clear Input
    setInputText('');
    setAttachment(null);
    setUseDeepAnalysis(false); // Reset toggle after send
    
    // Add visual log
    const logText = currentAttachment 
        ? (text ? `[Sent ${currentAttachment.type === 'image' ? 'Image' : 'File'}] ${text}` : `[Sent ${currentAttachment.type === 'image' ? 'Image' : 'File'}]`)
        : text;
    addLog('user', logText);
    
    try {
        if(sessionRef.current) {
            
            // PATH A: DEEP ANALYSIS GATING
            if (isGated) {
                setSystemStatus(`Orchestrator: Offloading task to ${modelConfig.gatingModelName}...`);
                
                try {
                    const analysisResult = await performDeepAnalysis(currentAttachment, text);
                    
                    setSystemStatus('Orchestrator: Analysis Complete. Injecting context...');
                    
                    // Inject the analysis as a system/context turn
                    const contextMessage = `[SYSTEM: The user uploaded '${currentAttachment.file.name}'. It was analyzed by the Orchestrator (${modelConfig.gatingModelName}).]\n\nANALYSIS RESULT:\n${analysisResult}\n\nUSER COMMENT: ${text}`;
                    
                    await sessionRef.current.send({
                        clientContent: {
                            turns: [{
                                role: 'user',
                                parts: [{ text: contextMessage }]
                            }],
                            turnComplete: true
                        }
                    });
                    
                } catch (analysisErr) {
                    console.error("Deep analysis failed", analysisErr);
                    setSystemStatus('Orchestrator: Analysis Failed. Falling back to direct stream.');
                    // Fallback to direct send if analysis fails
                }
            } 
            
            // PATH B: DIRECT STREAM (Default or Fallback)
            if (!isGated) {
                // 1. Handle Image: Use sendRealtimeInput (Native Multimodal)
                if (currentAttachment && currentAttachment.type === 'image') {
                    // Fix: sendRealtimeInput expects { media: { ... } } object, not an array
                    await sessionRef.current.sendRealtimeInput({
                        media: {
                            mimeType: currentAttachment.mimeType,
                            data: currentAttachment.content
                        }
                    });
                    // Brief delay to ensure image processes before text triggers turn
                    await new Promise(r => setTimeout(r, 150));
                }

                // 2. Handle Text Content
                let textParts = [];
                if (currentAttachment && currentAttachment.type === 'text') {
                    textParts.push(`[System: User uploaded file '${currentAttachment.file.name}']\n\nCONTENT:\n${currentAttachment.content}\n\n`);
                }
                if (text) textParts.push(text);

                // If only image was sent (no text), we still need to trigger a turn for the model to "see" it and respond.
                if (textParts.length === 0 && currentAttachment && currentAttachment.type === 'image') {
                    textParts.push("I have uploaded an image.");
                }

                if (textParts.length > 0) {
                    await sessionRef.current.send({
                        clientContent: {
                            turns: [{
                                role: 'user',
                                parts: [{ text: textParts.join('') }]
                            }],
                            turnComplete: true
                        }
                    });
                }
            }
        }
    } catch(e) {
        console.error("Error sending message:", e);
        setSystemStatus('Error sending text/image message. Check console.');
        addLog('system', `SYSTEM ERROR: Failed to send message (${e instanceof Error ? e.message : 'Unknown Error'})`);
    }
  };

  const connect = async () => {
    if (!process.env.API_KEY) return;
    setConnectionState(ConnectionState.CONNECTING);
    setSystemStatus(`Initializing Link to ${currentAgent.handle}...`);
    
    // Context Injection
    const recentHistory = logs.slice(-10).map(l => `${l.type === 'user' ? 'User' : 'Agent'}: ${l.text}`).join('\n');
    const historyContext = recentHistory ? `\n\nRECENT CONVERSATION HISTORY (RESUME CONTEXT):\n${recentHistory}` : '';
    
    // Prompt Construction
    const parts = [
        currentAgent.system_instruction, // Hardcoded Role
        RAG_INSTRUCTION,                 // Tool Rules
        "=== GENERAL USER INSTRUCTIONS ===",
        generalInstruction,
        `=== ${currentAgent.handle.toUpperCase()} SPECIFIC INSTRUCTIONS ===`,
        agentInstruction,
        historyContext
    ];
    
    const fullInstruction = parts.filter(p => p.trim()).join('\n\n');

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
        model: modelConfig.liveModelName,
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
            setSystemStatus(`Link Established: ${currentAgent.handle} is online (Voice: ${voiceName}).`);

            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = inputCtx.createMediaStreamSource(micStream);
            
            await inputCtx.audioWorklet.addModule('audioProcessor.js');
            const processor = new AudioWorkletNode(inputCtx, 'audio-processor');
            
            processor.port.onmessage = (e) => {
              const inputData = e.data;
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
                if (activeUserMessageRef.current) {
                    addLog('user', activeUserMessageRef.current);
                    activeUserMessageRef.current = '';
                }
                if (activeModelMessageRef.current) {
                    addLog('model', activeModelMessageRef.current);
                    activeModelMessageRef.current = '';
                }
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
                } else if (fc.name === 'downloadTranscript') {
                  const history = await loadActiveChat(selectedAgentId);
                  const text = history.map(l => `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.type.toUpperCase()}: ${l.text}`).join('\n');
                  const blob = new Blob([text], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${currentAgent.handle}_Transcript_${new Date().toISOString()}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                  sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Transcript downloaded." } } }));
                } else if (fc.name === 'terminateConnection') {
                  disconnect();
                }
              }
            }

            // Play Audio Chunks
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
      setSystemStatus("Connection Failed.");
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
    setSystemStatus('Link Terminated.');
  };

  return (
    <div className="main-container">
      <div className="header-container">
        <h1 className="header-title animate-pulse">MYTHOS : : COMMS : : HYPERVISOR</h1>
        <div className="status-bar">
          <div className="status-item">CORE: <span style={{color:'#fff'}}>{currentAgent.handle}</span></div>
          <div className="system-status-header"><span className="terminal-cursor" style={{marginRight:'0.5rem'}}></span>{systemStatus}</div>
          <div className="status-item">SYNC: <span style={{color: connectionState === ConnectionState.CONNECTED ? '#4ade80' : '#666'}}>{connectionState}</span></div>
        </div>
      </div>

      <div className="section-panel" style={{display:'flex', gap:'1rem', alignItems:'center'}}>
        <select 
            value={selectedAgentId} 
            onChange={e => {
                // Critical: Reset state immediately to prevent race conditions in auto-save logic
                // when switching agents.
                setLogsLoaded(false); 
                setLogs([]); 
                setSelectedAgentId(e.target.value);
            }} 
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
        
        <KnowledgeManager 
            currentAgentId={selectedAgentId} 
            onUpdate={handleLoreUpdate}
            embeddingModelName={modelConfig.embeddingModelName} 
        />
        <ChatHistoryManager currentLogs={logs} onLoadSession={setLogs} />
        <SettingsManager 
            modelConfig={modelConfig} 
            setModelConfig={setModelConfig} 
            disabled={connectionState !== ConnectionState.DISCONNECTED} 
            generalInstruction={generalInstruction}
            setGeneralInstruction={setGeneralInstruction}
            agentInstruction={agentInstruction}
            setAgentInstruction={setAgentInstruction}
            agentName={currentAgent.handle}
            onSave={handleSaveSettings}
        />
      </div>

      <div style={{display: 'grid', gridTemplateColumns: isCameraActive ? '1fr 1fr' : '1fr', gap:'1rem'}}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="section-panel">
                <div className="section-header"><span className="section-header-title">Resonator Output</span></div>
                <Visualizer analyser={analyserRef.current} isActive={connectionState === ConnectionState.CONNECTED} />
            </div>
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
        {logs.map(log => {
          // Now rendering system messages in chat
          if (log.type === 'system') {
              return (
                <div key={log.id} className="chat-message-system animate-pulse">
                    {log.text}
                </div>
              );
          }
          const name = log.type === 'user' ? 'USER' : 'AGENT';
          return (
            <div key={log.id} className={`chat-message-base chat-message-${log.type} ${log.id.includes('-stream-') ? 'animate-pulse' : ''}`}>
              <div style={{fontSize: '0.7rem', marginBottom: '0.2rem', opacity: 0.8, fontWeight: 'bold'}}>
                {name} <span style={{opacity:0.5, marginLeft: '0.2rem', fontWeight: 'normal'}}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
              </div>
              {log.text}
            </div>
          );
        })}
        <div ref={logsEndRef} />
      </div>

      <div className="chat-input-container">
          <input 
              type="file" 
              accept="image/*,.txt,.md,.json" 
              ref={fileInputRef} 
              className="hidden" 
              onChange={handleFileSelect} 
          />
          <button 
              className="btn btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={connectionState !== ConnectionState.CONNECTED}
              title="Attach File (Image, TXT, MD, JSON)"
          >
            📎
          </button>
          
          <div className="chat-input-wrapper">
              {attachment && (
                  <div className="attachment-preview">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {attachment.type === 'image' ? (
                              <img src={attachment.preview} alt="preview" className="attachment-thumb" />
                          ) : (
                              <span style={{ fontSize: '0.75rem', color: '#a3a3a3' }}>{attachment.preview}</span>
                          )}
                          
                          {/* GATING CONTROLS */}
                          <div className="gating-controls">
                              <label className="gating-toggle" title="Perform Deep Reasoning before sending to Voice Agent">
                                  <input 
                                      type="checkbox" 
                                      checked={useDeepAnalysis}
                                      onChange={(e) => setUseDeepAnalysis(e.target.checked)}
                                  />
                                  <span>Deep Analysis</span>
                              </label>
                              {useDeepAnalysis && (
                                  <input 
                                      type="text"
                                      value={modelConfig.gatingModelName}
                                      onChange={(e) => setModelConfig(prev => ({...prev, gatingModelName: e.target.value}))}
                                      className="gating-select"
                                  />
                              )}
                          </div>
                      </div>

                      <button 
                          onClick={clearAttachment}
                          style={{background:'none', border:'none', color:'#f87171', cursor:'pointer', fontWeight:'bold'}}
                      >
                          X
                      </button>
                  </div>
              )}
              <input 
                  type="text" 
                  className="chat-input" 
                  placeholder={connectionState === ConnectionState.CONNECTED ? "Type a message..." : "Connect to chat..."}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                  disabled={connectionState !== ConnectionState.CONNECTED}
              />
          </div>
          
          <button 
              className="btn btn-secondary" 
              onClick={handleSendText}
              disabled={connectionState !== ConnectionState.CONNECTED || (!inputText.trim() && !attachment)}
          >
              SEND
          </button>
      </div>
    </div>
  );
};

export default App;
