
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { AGENTS } from './agents';
import { 
  LogMessage, 
  ConnectionState, 
  DEFAULT_MODEL_CONFIG, 
  ModelConfig 
} from './types';
import Visualizer from './components/Visualizer';
import ChatHistoryManager from './components/ChatHistoryManager';
import { KnowledgeManager } from './components/KnowledgeManager';
import SettingsManager from './components/SettingsManager';
import { MultiAgentConsole } from './components/MultiAgentConsole';
import { VoiceCommandList } from './components/VoiceCommandList';
import { RoomFocusConfig } from './components/RoomFocusConfig';
import { McpManager } from './components/McpManager';
import { Terminal } from './components/Terminal';
import {
  saveActiveChat,
  getAgentConfig,
  saveAgentConfig,
  getGeneralInstructions,
  saveGeneralInstructions
} from './services/db';
import {
  base64ToUint8Array,
  createPcmBlob,
  decodeAudioData
} from './services/audioUtils';

const SAMPLE_RATE = 24000;
const INPUT_SAMPLE_RATE = 16000;

type ViewMode = 'ORCHESTRATOR' | 'COUNCIL';

const App: React.FC = () => {
  // --- STATE ---
  const [apiKey, setApiKey] = useState(process.env.API_KEY || localStorage.getItem('gemini_api_key') || '');
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [currentAgentId, setCurrentAgentId] = useState(AGENTS[0].id);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  
  // Input State
  const [inputText, setInputText] = useState('');
  
  // Config
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [generalInstructions, setGeneralInstructions] = useState('');
  const [agentInstructions, setAgentInstructions] = useState('');
  const [selectedVoice, setSelectedVoice] = useState(AGENTS[0].voice);
  const [accessLevel, setAccessLevel] = useState(AGENTS[0].accessLevel);

  // Layout & View Modes
  const [layoutMode, setLayoutMode] = useState<'AUDIO' | 'CHAT' | 'HYBRID' | 'VIDEO'>('HYBRID');
  const [currentView, setCurrentView] = useState<ViewMode>('ORCHESTRATOR');
  
  // Tools and Panels
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  
  // Sidebar State Management (For minimizing footer)
  const [activeSidePanel, setActiveSidePanel] = useState<string | null>(null);

  // Media State
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(false);
  // Refs for State Access inside Closures
  const isMicOnRef = useRef(true);
  const isCameraOnRef = useRef(false);

  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Video Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<number | null>(null);

  // Scroll ref
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      // Auto-load config
      const init = async () => {
          const gen = await getGeneralInstructions();
          setGeneralInstructions(gen);
          loadAgentConfig(currentAgentId);
      };
      init();

      const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === '`' || e.key === '~') {
              if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                  e.preventDefault();
                  setIsTerminalOpen(prev => !prev);
              }
          }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    loadAgentConfig(currentAgentId);
  }, [currentAgentId]);

  useEffect(() => {
    if (logEndRef.current) {
        logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, layoutMode]);

  // Sync State Refs
  useEffect(() => { isMicOnRef.current = isMicOn; }, [isMicOn]);
  useEffect(() => { isCameraOnRef.current = isCameraOn; }, [isCameraOn]);

  // Video Stream Logic
  useEffect(() => {
      if (isCameraOn && videoRef.current && canvasRef.current && connectionState === ConnectionState.CONNECTED) {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          
          if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);

          // Stream Frames at 1 FPS for basic presence (optimize as needed)
          frameIntervalRef.current = window.setInterval(() => {
              if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
                  canvas.width = video.videoWidth;
                  canvas.height = video.videoHeight;
                  ctx.drawImage(video, 0, 0);
                  
                  const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                  
                  if (sessionPromiseRef.current) {
                      sessionPromiseRef.current.then(session => {
                          // Only send if camera is still logically on
                          if (isCameraOnRef.current) {
                              session.sendRealtimeInput({ 
                                  media: { mimeType: 'image/jpeg', data: base64 } 
                              });
                          }
                      });
                  }
              }
          }, 1000); 
      }

      return () => {
          if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      };
  }, [isCameraOn, connectionState]);

  const loadAgentConfig = async (id: string) => {
      const cfg = await getAgentConfig(id);
      const agent = AGENTS.find(a => a.id === id);
      setAgentInstructions(cfg.instruction || agent?.system_instruction || '');
      setModelConfig(cfg.modelConfig || DEFAULT_MODEL_CONFIG);
      setSelectedVoice(cfg.voiceName || agent?.voice || 'Puck');
      setAccessLevel(cfg.accessLevel || agent?.accessLevel || '400');
  };

  const handleAgentChange = (id: string) => {
      if (connectionState === ConnectionState.CONNECTED) {
          disconnect();
      }
      setCurrentAgentId(id);
  };

  const handleSettingsSave = async (voiceRef?: string, newAccessLevel?: string, speed?: number, pitch?: number) => {
      await saveAgentConfig(currentAgentId, {
          instruction: agentInstructions,
          modelConfig,
          voiceName: selectedVoice,
          voiceReference: voiceRef,
          accessLevel: newAccessLevel,
          voiceSpeed: speed,
          voicePitch: pitch
      });
      await saveGeneralInstructions(generalInstructions);
      setAccessLevel(newAccessLevel || '400');
  };

  const toggleCamera = async () => {
      if (isCameraOn) {
          // Turn Off
          setIsCameraOn(false);
          if (videoRef.current && videoRef.current.srcObject) {
              const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
              tracks.forEach(t => t.stop());
              videoRef.current.srcObject = null;
          }
      } else {
          // Turn On
          try {
              const stream = await navigator.mediaDevices.getUserMedia({ video: true });
              if (videoRef.current) {
                  videoRef.current.srcObject = stream;
              }
              setIsCameraOn(true);
          } catch (e) {
              console.error("Camera access denied", e);
              alert("Camera access denied or unavailable.");
          }
      }
  };

  const connect = async () => {
      const keyToUse = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
      if (!keyToUse) {
          alert("API Key required. Check Settings.");
          return;
      }
      setApiKey(keyToUse);

      try {
          setConnectionState(ConnectionState.CONNECTING);
          
          // 1. Audio Output Context
          if (!audioContextRef.current) {
              audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE });
              analyserRef.current = audioContextRef.current.createAnalyser();
              analyserRef.current.fftSize = 512;
              nextStartTimeRef.current = 0;
          }

          // 2. Audio Input Context & Stream
          if (!inputContextRef.current) {
              inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
          }
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          
          const ai = new GoogleGenAI({ apiKey: keyToUse });
          const currentAgent = AGENTS.find(a => a.id === currentAgentId);
          
          const config = {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } }
              },
              systemInstruction: `${generalInstructions}\n\n${agentInstructions || currentAgent?.system_instruction}`,
              // Enable Both Input (User) and Output (Model) Transcription
              inputAudioTranscription: {}, 
              outputAudioTranscription: {}, 
          };

          const sessionPromise = ai.live.connect({
              model: 'gemini-2.5-flash-native-audio-preview-09-2025',
              config,
              callbacks: {
                  onopen: () => {
                      setConnectionState(ConnectionState.CONNECTED);
                      setLogs(prev => [...prev, {
                          id: crypto.randomUUID(),
                          type: 'system',
                          text: `Connected to ${currentAgent?.handle}`,
                          timestamp: Date.now()
                      }]);

                      // Start Mic Stream
                      if (inputContextRef.current) {
                          const source = inputContextRef.current.createMediaStreamSource(stream);
                          const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
                          
                          processor.onaudioprocess = (e) => {
                              // Use REF to check mic state inside closure
                              if (!isMicOnRef.current) return;

                              const inputData = e.inputBuffer.getChannelData(0);
                              const pcmBlob = createPcmBlob(inputData);
                              
                              if (sessionPromiseRef.current) {
                                  sessionPromiseRef.current.then(session => {
                                      session.sendRealtimeInput({ media: pcmBlob });
                                  });
                              }
                          };
                          
                          source.connect(processor);
                          processor.connect(inputContextRef.current.destination);
                      }
                  },
                  onmessage: async (msg: LiveServerMessage) => {
                      // 1. Handle Audio (Model Speech)
                      const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                      if (audioData && audioContextRef.current && analyserRef.current) {
                          const ctx = audioContextRef.current;
                          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                          
                          const audioBuffer = await decodeAudioData(
                              base64ToUint8Array(audioData),
                              ctx,
                              SAMPLE_RATE
                          );
                          
                          const source = ctx.createBufferSource();
                          source.buffer = audioBuffer;
                          source.connect(analyserRef.current);
                          analyserRef.current.connect(ctx.destination);
                          
                          source.start(nextStartTimeRef.current);
                          nextStartTimeRef.current += audioBuffer.duration;
                          
                          source.onended = () => sourcesRef.current.delete(source);
                          sourcesRef.current.add(source);
                      }

                      // 2. Handle User Input Transcription (Streaming)
                      const inputTranscript = msg.serverContent?.inputTranscription?.text;
                      if (inputTranscript) {
                          setLogs(prev => {
                              const lastLog = prev[prev.length - 1];
                              // If the last log is a streaming user message, append to it
                              if (lastLog && lastLog.type === 'user' && lastLog.isStreaming) {
                                  return [...prev.slice(0, -1), { ...lastLog, text: lastLog.text + inputTranscript }];
                              }
                              // Otherwise, create a new streaming user message
                              return [...prev, {
                                  id: crypto.randomUUID(),
                                  type: 'user',
                                  text: inputTranscript,
                                  timestamp: Date.now(),
                                  isStreaming: true
                              }];
                          });
                      }

                      // 3. Handle Model Output Transcription (Streaming)
                      const outputTranscript = msg.serverContent?.outputTranscription?.text;
                      if (outputTranscript) {
                          setLogs(prev => {
                              // Ensure any streaming User log is marked as complete when Model starts
                              const fixedPrev = prev.map(l => 
                                  (l.type === 'user' && l.isStreaming) 
                                  ? { ...l, isStreaming: false } 
                                  : l
                              );

                              const lastLog = fixedPrev[fixedPrev.length - 1];
                              // Append to current streaming model message
                              if (lastLog && lastLog.type === 'model' && lastLog.isStreaming) {
                                  return [...fixedPrev.slice(0, -1), { ...lastLog, text: lastLog.text + outputTranscript }];
                              }
                              // Start new model message
                              return [...fixedPrev, { 
                                  id: crypto.randomUUID(), 
                                  type: 'model', 
                                  text: outputTranscript, 
                                  timestamp: Date.now(),
                                  isStreaming: true 
                              }];
                          });
                      }

                      // 4. Handle Turn Complete
                      if (msg.serverContent?.turnComplete) {
                           setLogs(prev => {
                              const lastLog = prev[prev.length - 1];
                              // If model was streaming, finalize it
                              if (lastLog && lastLog.type === 'model' && lastLog.isStreaming) {
                                  return [...prev.slice(0, -1), { ...lastLog, isStreaming: false }];
                              }
                              // Also finalize user if they were streaming (edge case)
                              if (lastLog && lastLog.type === 'user' && lastLog.isStreaming) {
                                  return [...prev.slice(0, -1), { ...lastLog, isStreaming: false }];
                              }
                              return prev;
                           });
                      }

                      // 5. Handle Interruption
                      if (msg.serverContent?.interrupted) {
                          sourcesRef.current.forEach(s => s.stop());
                          sourcesRef.current.clear();
                          nextStartTimeRef.current = 0;
                          
                          setLogs(prev => {
                              const lastLog = prev[prev.length - 1];
                              if (lastLog && lastLog.isStreaming) {
                                  return [...prev.slice(0, -1), { ...lastLog, isStreaming: false, text: lastLog.text + ' [Interrupted]' }];
                              }
                              return [...prev, { id: crypto.randomUUID(), type: 'system', text: '[Interrupted]', timestamp: Date.now() }];
                          });
                      }
                      
                      // 6. Handle Fallback Text (e.g. Tool Outputs)
                      // Only if transcription didn't handle it
                      if (!outputTranscript && msg.serverContent?.modelTurn?.parts?.[0]?.text) {
                          const text = msg.serverContent.modelTurn.parts[0].text;
                          setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'model', text: text, timestamp: Date.now() }]);
                      }
                  },
                  onclose: () => {
                      setConnectionState(ConnectionState.DISCONNECTED);
                      setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', text: 'Connection Closed', timestamp: Date.now() }]);
                  },
                  onerror: (err) => {
                      console.error(err);
                      setConnectionState(ConnectionState.ERROR);
                      setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', text: `Error: ${err}`, timestamp: Date.now() }]);
                  }
              }
          });
          
          sessionPromiseRef.current = sessionPromise;

      } catch (e) {
          console.error(e);
          setConnectionState(ConnectionState.ERROR);
      }
  };

  const disconnect = () => {
      if (inputContextRef.current) inputContextRef.current.close();
      if (audioContextRef.current) audioContextRef.current.close();
      inputContextRef.current = null;
      audioContextRef.current = null;
      
      // Stop Camera
      if (videoRef.current && videoRef.current.srcObject) {
          const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
          tracks.forEach(t => t.stop());
          videoRef.current.srcObject = null;
      }
      setIsCameraOn(false);
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);

      setConnectionState(ConnectionState.DISCONNECTED);
      sessionPromiseRef.current?.then(s => s.close && s.close());
      sessionPromiseRef.current = null;
  };

  const handleSendText = async () => {
      if (!inputText.trim() || !sessionPromiseRef.current) return;
      
      const text = inputText;
      setInputText('');
      setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'user', text: text, timestamp: Date.now() }]);

      try {
          const session = await sessionPromiseRef.current;
          // Send as clientContent (Text Injection)
          await session.send({
              clientContent: {
                  turns: [{ role: 'user', parts: [{ text }] }],
                  turnComplete: true
              }
          });
      } catch (e) {
          console.error("Failed to send text", e);
      }
  };

  // --- LAYOUT STYLES ---
  
  const visualizerStyle: React.CSSProperties = {
      flex: (layoutMode === 'AUDIO' || layoutMode === 'HYBRID' || layoutMode === 'VIDEO') ? '1 1 0' : '0 0 auto',
      height: layoutMode === 'CHAT' ? '0px' : 'auto',
      display: layoutMode === 'CHAT' ? 'none' : 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
      transition: 'flex 0.3s ease'
  };

  const chatStyle: React.CSSProperties = {
      flex: (layoutMode === 'CHAT' || layoutMode === 'HYBRID') ? '1 1 0' : '0 0 auto',
      height: (layoutMode === 'AUDIO' || layoutMode === 'VIDEO') ? '0px' : 'auto',
      display: (layoutMode === 'AUDIO' || layoutMode === 'VIDEO') ? 'none' : 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transition: 'flex 0.3s ease'
  };

  const currentAgent = AGENTS.find(a => a.id === currentAgentId);

  const closeSidePanel = () => setActiveSidePanel(null);

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="app-header">
        <div className="flex-group">
            <span className="logo-text">MYTHOS</span>
            <span className="divider">|</span>
            {currentView === 'ORCHESTRATOR' ? (
                <select 
                    value={currentAgentId} 
                    onChange={(e) => handleAgentChange(e.target.value)}
                    className="agent-selector"
                >
                    {AGENTS.map(agent => (
                        <option key={agent.id} value={agent.id}>{agent.handle.toUpperCase()}</option>
                    ))}
                </select>
            ) : (
                <span className="status-indicator" style={{ color: '#38bdf8', borderColor: '#38bdf8' }}>MULTI-AGENT COUNCIL</span>
            )}
        </div>

        <div className="flex-group">
            <div className={`status-indicator ${connectionState.toLowerCase()}`}>
                {connectionState}
            </div>
            
            <VoiceCommandList 
                isOpen={activeSidePanel === 'VOICE'}
                onOpen={() => setActiveSidePanel('VOICE')}
                onClose={closeSidePanel}
            />
            <RoomFocusConfig 
                isOpen={activeSidePanel === 'FOCUS'}
                onOpen={() => setActiveSidePanel('FOCUS')}
                onClose={closeSidePanel}
            />
            <McpManager 
                isOpen={activeSidePanel === 'MCP'}
                onOpen={() => setActiveSidePanel('MCP')}
                onClose={closeSidePanel}
            />
            <KnowledgeManager 
                onUpdate={() => {}} 
                currentAgentId={currentAgentId} 
                isOpen={activeSidePanel === 'KNOWLEDGE'}
                onOpen={() => setActiveSidePanel('KNOWLEDGE')}
                onClose={closeSidePanel}
            />
            <ChatHistoryManager 
                currentLogs={logs} 
                onLoadSession={setLogs} 
                currentAgentId={currentAgentId}
                onUpdateKnowledge={() => {}}
                isOpen={activeSidePanel === 'HISTORY'}
                onOpen={() => setActiveSidePanel('HISTORY')}
                onClose={closeSidePanel}
            />
            <SettingsManager 
                modelConfig={modelConfig}
                setModelConfig={setModelConfig}
                disabled={connectionState === ConnectionState.CONNECTED}
                generalInstruction={generalInstructions}
                setGeneralInstruction={setGeneralInstructions}
                agentInstruction={agentInstructions}
                setAgentInstruction={setAgentInstructions}
                agentName={currentAgent?.handle || 'Unknown'}
                agentId={currentAgentId}
                agentAccessLevel={accessLevel}
                selectedVoice={selectedVoice}
                onVoiceChange={setSelectedVoice}
                onSave={handleSettingsSave}
                isOpen={activeSidePanel === 'SETTINGS'}
                onOpen={() => setActiveSidePanel('SETTINGS')}
                onClose={closeSidePanel}
            />
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="main-viewport">
        {currentView === 'COUNCIL' ? (
            <MultiAgentConsole onExit={() => setCurrentView('ORCHESTRATOR')} />
        ) : (
            <>
                {/* ORCHESTRATOR / LIVE VIEW */}
                <div style={visualizerStyle}>
                    <div className="panel-overlay top-left">
                        <span className="overlay-label">
                            VISUALIZER // {selectedVoice.toUpperCase()} // {isCameraOn ? 'CAM ON' : 'CAM OFF'} {layoutMode === 'VIDEO' ? '// VIDEO MODE' : ''}
                        </span>
                    </div>
                    <canvas ref={canvasRef} className="hidden" />
                    <div style={{ 
                        position: 'absolute', bottom: '10px', right: '10px', width: '160px', height: '120px', 
                        background: '#000', border: '1px solid #4ade80', display: isCameraOn ? 'block' : 'none', 
                        zIndex: 30, boxShadow: '0 0 10px rgba(0,0,0,0.5)'
                    }}>
                        <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <Visualizer analyser={analyserRef.current} isActive={connectionState === ConnectionState.CONNECTED} />
                </div>

                <div style={chatStyle}>
                    <div className="logs-container">
                        {logs.length === 0 && (
                            <div className="empty-state">
                                <p>SYSTEM READY.</p>
                                <p>INITIALIZE CONNECTION TO BEGIN.</p>
                            </div>
                        )}
                        {logs.map(log => (
                            <div key={log.id} className={`log-entry ${log.type}`}>
                                <div style={{display:'flex', justifyContent:'space-between'}}>
                                    <span className="log-sender">{log.type.toUpperCase()}</span>
                                    <span className="log-timestamp">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                </div>
                                <span className="log-text">{log.text}</span>
                                {log.isStreaming && <span className="animate-pulse">_</span>}
                            </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>
                </div>
            </>
        )}
      </main>

      {/* COMMAND DECK (Footer) - Hidden in Council Mode */}
      <footer className={`command-deck ${activeSidePanel ? 'minimized' : ''} ${currentView === 'COUNCIL' ? 'hidden' : ''}`}>
          {/* TRAY */}
          <div className="tray-controls">
              <div className="flex-group">
                  <button 
                    onClick={() => setIsMicOn(!isMicOn)} 
                    className={`btn btn-icon ${isMicOn ? 'active-green' : 'btn-danger'}`}
                    title={isMicOn ? "Microphone Active" : "Microphone Muted"}
                  >
                      {isMicOn ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                      ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                      )}
                  </button>
                  <button 
                    onClick={toggleCamera} 
                    className={`btn btn-icon ${isCameraOn ? 'active-green' : ''}`}
                    title="Toggle Camera"
                  >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                  </button>
              </div>

              <div className="flex-group">
                  <button onClick={() => setCurrentView('COUNCIL')} className="btn btn-xs" title="Open Multi-Agent Console">COUNCIL</button>
                  <button onClick={() => setIsTerminalOpen(!isTerminalOpen)} className="btn btn-xs" title="Open Terminal">TERM (~)</button>
              </div>

              <div className="flex-group">
                  <button onClick={() => setLayoutMode('VIDEO')} className={`btn btn-xs ${layoutMode === 'VIDEO' ? 'active' : ''}`}>VIDEO</button>
                  <button onClick={() => setLayoutMode('AUDIO')} className={`btn btn-xs ${layoutMode === 'AUDIO' ? 'active' : ''}`}>AUDIO</button>
                  <button onClick={() => setLayoutMode('HYBRID')} className={`btn btn-xs ${layoutMode === 'HYBRID' ? 'active' : ''}`}>HYBRID</button>
                  <button onClick={() => setLayoutMode('CHAT')} className={`btn btn-xs ${layoutMode === 'CHAT' ? 'active' : ''}`}>CHAT</button>
              </div>
          </div>

          {/* INPUT: Text & Actions */}
          <div className="input-bar">
              <input 
                  type="text" 
                  className="main-input"
                  placeholder={connectionState === ConnectionState.CONNECTED ? "Type message to agent..." : "Connect to start conversation..."}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                  disabled={connectionState !== ConnectionState.CONNECTED}
              />
              {connectionState === ConnectionState.CONNECTED ? (
                 <button onClick={disconnect} className="btn btn-danger" style={{ fontWeight: 'bold' }}>STOP</button>
              ) : (
                 <button onClick={connect} className="btn btn-primary" disabled={connectionState === ConnectionState.CONNECTING}>
                     {connectionState === ConnectionState.CONNECTING ? '...' : 'START'}
                 </button>
              )}
              <button onClick={handleSendText} className="btn btn-secondary" disabled={!inputText.trim() || connectionState !== ConnectionState.CONNECTED}>SEND</button>
          </div>
      </footer>

      {/* OVERLAYS */}
      <Terminal 
        isOpen={isTerminalOpen} 
        onClose={() => setIsTerminalOpen(false)} 
        onSwitchAgent={handleAgentChange}
        currentAgentHandle={currentAgent?.handle || 'guest'}
      />

    </div>
  );
};

export default App;
