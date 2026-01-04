
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { AGENTS } from './agents';
import { 
  LogMessage, 
  ConnectionState, 
  DEFAULT_MODEL_CONFIG, 
  ModelConfig,
  MediaAsset
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
import { MediaGallery } from './components/MediaGallery';
import {
  saveActiveChat,
  getAgentConfig,
  saveAgentConfig,
  getGeneralInstructions,
  saveGeneralInstructions,
  saveMediaAsset
} from './services/db';
import {
  base64ToUint8Array,
  createPcmBlob,
  decodeAudioData
} from './services/audioUtils';
import { IngestionService } from './services/ingestion';
import { NumMarkX_GenerateID } from './patterns/NumMarkX';

const SAMPLE_RATE = 24000;
const INPUT_SAMPLE_RATE = 16000;

type ViewMode = 'ORCHESTRATOR' | 'COUNCIL';
type ModelMode = 'STD' | 'DEEP' | 'EXT' | 'IMG';

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
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [voicePitch, setVoicePitch] = useState(0);
  const [accessLevel, setAccessLevel] = useState(AGENTS[0].accessLevel);
  
  // Model Mode State
  const [modelMode, setModelMode] = useState<ModelMode>('STD');

  // Layout & View Modes
  const [layoutMode, setLayoutMode] = useState<'VOICE' | 'CHAT' | 'HYBRID' | 'VIDEO'>('HYBRID');
  const [currentView, setCurrentView] = useState<ViewMode>('ORCHESTRATOR');
  
  // Tools and Panels
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  
  // Sidebar State Management
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

  // File Upload Ref
  const paperclipInputRef = useRef<HTMLInputElement>(null);

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

          // Stream Frames at 1 FPS for basic presence
          frameIntervalRef.current = window.setInterval(() => {
              if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
                  canvas.width = video.videoWidth;
                  canvas.height = video.videoHeight;
                  ctx.drawImage(video, 0, 0);
                  
                  const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                  
                  if (sessionPromiseRef.current) {
                      sessionPromiseRef.current.then(session => {
                          if (isCameraOnRef.current && session && typeof session.sendRealtimeInput === 'function') {
                              session.sendRealtimeInput({ 
                                  media: { mimeType: 'image/jpeg', data: base64 } 
                              });
                          }
                      }).catch(() => {});
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
      setVoiceSpeed(cfg.voiceSpeed || 1.0);
      setVoicePitch(cfg.voicePitch || 0);
      setAccessLevel(cfg.accessLevel || agent?.accessLevel || '400');
  };

  const handleAgentChange = (id: string) => {
      if (connectionState === ConnectionState.CONNECTED) {
          disconnect();
      }
      setCurrentAgentId(id);
  };

  const handleSettingsSave = async (voiceRef?: string, newAccessLevel?: string, speed?: number, pitch?: number) => {
      // Update Local State for UI reflection immediately
      if (speed) setVoiceSpeed(speed);
      if (pitch) setVoicePitch(pitch);
      
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
          
          if (!audioContextRef.current) {
              audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE });
              analyserRef.current = audioContextRef.current.createAnalyser();
              analyserRef.current.fftSize = 512;
              nextStartTimeRef.current = 0;
          }

          if (!inputContextRef.current) {
              inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
          }
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          
          const ai = new GoogleGenAI({ apiKey: keyToUse });
          const currentAgent = AGENTS.find(a => a.id === currentAgentId);
          
          // CONSTRUCT MODE INSTRUCTIONS based on Selector
          let modeInstruction = "";
          if (modelMode === 'DEEP') {
              modeInstruction = "\n\n[OPERATIONAL MODE: DEEP REASONING]\nACTIVATE 'Gemini 3 Pro' SIMULATION PROTOCOL.\n- Prioritize complex analysis, detailed explanations, and nuance.\n- Do not simplify unless asked.\n- Use advanced vocabulary and structural depth.\n- THINK before speaking.";
          } else if (modelMode === 'EXT') {
              modeInstruction = "\n\n[OPERATIONAL MODE: EXTERNAL TOOLING]\nACTIVATE 'Router' PROTOCOL.\n- You are operating in a HIGH-LATENCY, HIGH-POWER environment.\n- AGGRESSIVELY use the 'routeRequest' tool for ANY task involving:\n  1. Image Generation (Target: FLUX_IMAGE)\n  2. Uncensored/NSFW topics (Target: EXTERNAL_LLM)\n  3. Coding/Scripting (Target: EXTERNAL_LLM)\n- Prioritize tool use over chat.";
          } else if (modelMode === 'IMG') {
              modeInstruction = "\n\n[OPERATIONAL MODE: VISUALIZER]\nACTIVATE 'Image Generation' PROTOCOL.\n- You are a visual artist and observer.\n- Prioritize visual descriptions and imagery.\n- Use 'routeRequest' with target='FLUX_IMAGE' when asked to generate, show, or create an image.\n- If a scene is described, offer to visualize it.";
          }

          const config = {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } }
              },
              systemInstruction: `${generalInstructions}\n\n${agentInstructions || currentAgent?.system_instruction}${modeInstruction}`,
              // Flattened Generation Config
              temperature: modelConfig.temperature,
              topP: modelConfig.topP,
              topK: modelConfig.topK,
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
                          text: `Connected to ${currentAgent?.handle} [MODE: ${modelMode}]`,
                          timestamp: Date.now()
                      }]);

                      if (inputContextRef.current) {
                          const source = inputContextRef.current.createMediaStreamSource(stream);
                          const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
                          
                          processor.onaudioprocess = (e) => {
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
                      const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                      if (audioData && audioContextRef.current && analyserRef.current) {
                          const ctx = audioContextRef.current;
                          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                          const audioBuffer = await decodeAudioData(base64ToUint8Array(audioData), ctx, SAMPLE_RATE);
                          const source = ctx.createBufferSource();
                          source.buffer = audioBuffer;
                          source.connect(analyserRef.current);
                          analyserRef.current.connect(ctx.destination);
                          source.start(nextStartTimeRef.current);
                          nextStartTimeRef.current += audioBuffer.duration;
                          source.onended = () => sourcesRef.current.delete(source);
                          sourcesRef.current.add(source);
                      }

                      const inputTranscript = msg.serverContent?.inputTranscription?.text;
                      if (inputTranscript) {
                          setLogs(prev => {
                              const lastLog = prev[prev.length - 1];
                              if (lastLog && lastLog.type === 'user' && lastLog.isStreaming) {
                                  return [...prev.slice(0, -1), { ...lastLog, text: lastLog.text + inputTranscript }];
                              }
                              return [...prev, {
                                  id: crypto.randomUUID(),
                                  type: 'user',
                                  text: inputTranscript,
                                  timestamp: Date.now(),
                                  isStreaming: true
                              }];
                          });
                      }

                      const outputTranscript = msg.serverContent?.outputTranscription?.text;
                      if (outputTranscript) {
                          setLogs(prev => {
                              const fixedPrev = prev.map(l => (l.type === 'user' && l.isStreaming) ? { ...l, isStreaming: false } : l);
                              const lastLog = fixedPrev[fixedPrev.length - 1];
                              if (lastLog && lastLog.type === 'model' && lastLog.isStreaming) {
                                  return [...fixedPrev.slice(0, -1), { ...lastLog, text: lastLog.text + outputTranscript }];
                              }
                              return [...fixedPrev, { 
                                  id: crypto.randomUUID(), 
                                  type: 'model', 
                                  text: outputTranscript, 
                                  timestamp: Date.now(),
                                  isStreaming: true 
                              }];
                          });
                      }

                      if (msg.serverContent?.turnComplete) {
                           setLogs(prev => {
                              const lastLog = prev[prev.length - 1];
                              if (lastLog && (lastLog.type === 'model' || lastLog.type === 'user') && lastLog.isStreaming) {
                                  return [...prev.slice(0, -1), { ...lastLog, isStreaming: false }];
                              }
                              return prev;
                           });
                      }

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
          
          if (session && typeof session.send === 'function') {
              await session.send({
                  clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true }
              });
          } else {
              console.error("Session not ready or 'send' method missing.");
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', text: 'Error: Session not ready.', timestamp: Date.now() }]);
          }
      } catch (e) {
          console.error("Failed to send text", e);
      }
  };

  // --- PAPERCLIP UPLOAD LOGIC ---
  const handlePaperclipClick = () => {
      if (paperclipInputRef.current) {
          paperclipInputRef.current.click();
      }
  };

  const handlePaperclipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      let type: MediaAsset['type'] = 'image';
      const lowerName = file.name.toLowerCase();

      if (file.type.includes('pdf')) type = 'pdf';
      else if (file.type.includes('video')) type = 'video';
      else if (file.type.includes('audio')) type = 'audio';
      else if (
          file.type.includes('text') || 
          lowerName.endsWith('.md') || 
          lowerName.endsWith('.json') ||
          lowerName.endsWith('.js') ||
          lowerName.endsWith('.ts') ||
          lowerName.endsWith('.tsx') ||
          lowerName.endsWith('.jsx') ||
          lowerName.endsWith('.py') ||
          lowerName.endsWith('.html') ||
          lowerName.endsWith('.css') ||
          lowerName.endsWith('.sh') ||
          lowerName.endsWith('.yml') ||
          lowerName.endsWith('.yaml')
      ) {
          type = 'text';
      }
      else if (!file.type.startsWith('image/')) {
          alert('Unsupported file type. Use Image, Video, Audio, PDF, Text, or Code.');
          return;
      }

      // 1. Read File
      const reader = new FileReader();
      reader.onload = async (evt) => {
          const res = evt.target?.result as string;
          let data = res;
          if ((type === 'image' || type === 'video' || type === 'audio' || type === 'pdf') && res.includes('base64,')) {
              data = res.split(',')[1];
          }

          // 2. Save to Gallery (Persistence)
          const asset: MediaAsset = {
              id: NumMarkX_GenerateID(type === 'image' ? 'IMG' : (type === 'video' ? 'VID' : (type === 'audio' ? 'AUD' : (type === 'text' ? 'CODE' : 'DOC')))),
              type: type,
              data: data,
              prompt: file.name,
              agentId: 'USER',
              timestamp: Date.now(),
              tags: ['CHAT_UPLOAD', type.toUpperCase()]
          };
          await saveMediaAsset(asset);

          // 3. Add to Chat Logs (Visual)
          setLogs(prev => [...prev, {
              id: crypto.randomUUID(),
              type: 'user',
              text: `[Attached ${type.toUpperCase()}: ${file.name}]`,
              timestamp: Date.now(),
              attachment: data,
              attachmentType: type
          }]);

          // 4. Send to Connected Session (Context)
          if (sessionPromiseRef.current) {
              const session = await sessionPromiseRef.current;
              
              if (session && typeof session.sendRealtimeInput === 'function') {
                  if (type === 'image') {
                      // Send Image Frame
                      session.sendRealtimeInput({
                          media: { mimeType: file.type, data: data }
                      });
                  } else if (type === 'text') {
                      // TRUNCATE TEXT for Live Context to avoid 40MB payload limits
                      // The full text is ingested into RAG separately below.
                      const MAX_CONTEXT_LENGTH = 20000; // ~20KB safe limit for direct context
                      const truncatedData = data.length > MAX_CONTEXT_LENGTH 
                          ? data.substring(0, MAX_CONTEXT_LENGTH) + "\n...[TRUNCATED FOR LIVE CONTEXT. FULL TEXT INGESTED TO MEMORY]..." 
                          : data;

                      if (typeof session.send === 'function') {
                          session.send({
                              clientContent: { turns: [{ role: 'user', parts: [{ text: `[USER UPLOADED TEXT/CODE FILE: ${file.name}]\n${truncatedData}` }] }], turnComplete: true }
                          });
                      }
                      
                      // --- AUTO-INGEST TEXT TO DB (FULL CONTENT) ---
                      const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
                      if (apiKey) {
                          IngestionService.ingestText(data, file.name, currentAgentId, apiKey)
                            .then(count => {
                                if (count > 0) {
                                    setLogs(prev => [...prev, {
                                        id: crypto.randomUUID(),
                                        type: 'system',
                                        text: `[SYSTEM] Auto-ingested ${count} chunks from ${file.name} into Knowledge Base.`,
                                        timestamp: Date.now()
                                    }]);
                                }
                            })
                            .catch(err => console.error("Auto-ingest failed", err));
                      }

                  } else if (type === 'pdf') {
                      if (typeof session.send === 'function') {
                          session.send({
                              clientContent: { turns: [{ role: 'user', parts: [{ text: `[USER UPLOADED PDF: ${file.name} to Media Gallery]` }] }], turnComplete: true }
                          });
                      }
                  } else if (type === 'video') {
                      if (typeof session.send === 'function') {
                          session.send({
                              clientContent: { turns: [{ role: 'user', parts: [{ text: `[USER UPLOADED VIDEO: ${file.name} to Media Gallery. Please analyze the context if possible.]` }] }], turnComplete: true }
                          });
                      }
                  } else if (type === 'audio') {
                      if (typeof session.send === 'function') {
                          session.send({
                              clientContent: { turns: [{ role: 'user', parts: [{ text: `[USER UPLOADED AUDIO: ${file.name} to Media Gallery. Please analyze audio content if able.]` }] }], turnComplete: true }
                          });
                      }
                  }
              }
          }
      };

      if (type === 'text') {
          reader.readAsText(file);
      } else {
          reader.readAsDataURL(file);
      }
      
      // Reset input
      if(paperclipInputRef.current) paperclipInputRef.current.value = '';
  };

  // --- LAYOUT STYLES ---
  const visualizerStyle: React.CSSProperties = {
      flex: (layoutMode === 'VOICE' || layoutMode === 'HYBRID' || layoutMode === 'VIDEO') ? '1 1 0' : '0 0 auto',
      height: layoutMode === 'CHAT' ? '0px' : 'auto',
      display: layoutMode === 'CHAT' ? 'none' : 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
      transition: 'flex 0.3s ease'
  };

  const chatStyle: React.CSSProperties = {
      flex: (layoutMode === 'CHAT' || layoutMode === 'HYBRID') ? '1 1 0' : '0 0 auto',
      height: (layoutMode === 'VOICE' || layoutMode === 'VIDEO') ? '0px' : 'auto',
      display: (layoutMode === 'VOICE' || layoutMode === 'VIDEO') ? 'none' : 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transition: 'flex 0.3s ease'
  };

  const currentAgent = AGENTS.find(a => a.id === currentAgentId);
  const closeSidePanel = () => setActiveSidePanel(null);

  // Helper for toggle buttons
  const renderTriggerBtn = (panelId: string, icon: React.ReactNode, title: string) => (
      <button 
          onClick={() => setActiveSidePanel(panelId)}
          className={`btn btn-secondary btn-icon ${activeSidePanel === panelId ? 'active' : ''}`}
          title={title}
          style={activeSidePanel === panelId ? {borderColor: '#facc15', color: '#facc15'} : {}}
      >
          {icon}
      </button>
  );

  return (
    <div className="app-container">
      {/* HEADER - Renders Only Triggers */}
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
                <span className="status-indicator" style={{ color: '#38bdf8', borderColor: '#38bdf8' }}>COMMS HUB</span>
            )}
        </div>

        <div className="flex-group">
            <div className={`status-indicator ${connectionState.toLowerCase()}`}>
                {connectionState}
            </div>
            
            {/* MANUAL TRIGGERS FOR SIDE PANELS */}
            {renderTriggerBtn('VOICE', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>, "Voice Commands")}
            
            {renderTriggerBtn('FOCUS', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>, "Room Focus")}
            
            {renderTriggerBtn('MEDIA', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>, "Media Gallery")}
            
            {renderTriggerBtn('MCP', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>, "MCP Tools")}
            
            {renderTriggerBtn('KNOWLEDGE', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>, "Knowledge Base")}
            
            {renderTriggerBtn('HISTORY', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>, "Chat History")}
            
            {renderTriggerBtn('SETTINGS', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>, "Settings")}
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="main-viewport">
        {/* Render Side Panels Here - They are absolutely positioned relative to viewport */}
        {activeSidePanel === 'VOICE' && <VoiceCommandList isOpen={true} onOpen={()=>{}} onClose={closeSidePanel} />}
        {activeSidePanel === 'FOCUS' && <RoomFocusConfig isOpen={true} onOpen={()=>{}} onClose={closeSidePanel} />}
        {activeSidePanel === 'MEDIA' && <MediaGallery isOpen={true} onOpen={()=>{}} onClose={closeSidePanel} currentAgentId={currentAgentId} />}
        {activeSidePanel === 'MCP' && <McpManager isOpen={true} onOpen={()=>{}} onClose={closeSidePanel} />}
        {activeSidePanel === 'KNOWLEDGE' && <KnowledgeManager isOpen={true} onOpen={()=>{}} onClose={closeSidePanel} onUpdate={()=>{}} currentAgentId={currentAgentId} />}
        {activeSidePanel === 'HISTORY' && <ChatHistoryManager isOpen={true} onOpen={()=>{}} onClose={closeSidePanel} currentLogs={logs} onLoadSession={setLogs} currentAgentId={currentAgentId} onUpdateKnowledge={()=>{}} />}
        {activeSidePanel === 'SETTINGS' && <SettingsManager isOpen={true} onOpen={()=>{}} onClose={closeSidePanel} modelConfig={modelConfig} setModelConfig={setModelConfig} disabled={connectionState === ConnectionState.CONNECTED} generalInstruction={generalInstructions} setGeneralInstruction={setGeneralInstructions} agentInstruction={agentInstructions} setAgentInstruction={setAgentInstructions} agentName={currentAgent?.handle || 'Unknown'} agentId={currentAgentId} agentAccessLevel={accessLevel} selectedVoice={selectedVoice} onVoiceChange={setSelectedVoice} onSave={handleSettingsSave} />}

        {currentView === 'COUNCIL' ? (
            <MultiAgentConsole onExit={() => setCurrentView('ORCHESTRATOR')} />
        ) : (
            <>
                <div style={visualizerStyle}>
                    <div className="panel-overlay top-left">
                        <span className="overlay-label">
                            VISUALIZER // {selectedVoice.toUpperCase()} // {isCameraOn ? 'CAM ON' : 'CAM OFF'} {layoutMode === 'VIDEO' ? '// VIDEO MODE' : ''}
                        </span>
                    </div>
                    <canvas ref={canvasRef} className="hidden" />
                    
                    {/* VIDEO MODE: Placeholder Container for future Agent Video Feed */}
                    {layoutMode === 'VIDEO' ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#333' }}>
                            <div className="animate-pulse" style={{ width: '100px', height: '100px', borderRadius: '50%', border: '2px dashed #333', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: '#111' }}></div>
                            </div>
                            <div style={{ marginTop: '1rem', fontSize: '0.7rem', letterSpacing: '2px', color: '#444' }}>VIDEO FEED STANDBY</div>
                        </div>
                    ) : (
                        <Visualizer analyser={analyserRef.current} isActive={connectionState === ConnectionState.CONNECTED} />
                    )}

                    <div style={{ position: 'absolute', bottom: '10px', right: '10px', width: '160px', height: '120px', background: '#000', border: '1px solid #4ade80', display: isCameraOn ? 'block' : 'none', zIndex: 30, boxShadow: '0 0 10px rgba(0,0,0,0.5)' }}>
                        <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                </div>

                <div style={chatStyle}>
                    <div className={`logs-container ${logs.length === 1 && logs[0].type === 'system' ? 'centered-single' : ''}`}>
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
                                
                                {log.attachment && (
                                    <div style={{ margin: '0.5rem 0', borderRadius: '4px', overflow: 'hidden', border: '1px solid #333', maxWidth: '300px' }}>
                                        {log.attachmentType === 'image' && (
                                            <img src={`data:image/jpeg;base64,${log.attachment}`} style={{ width: '100%', display: 'block' }} />
                                        )}
                                        {log.attachmentType === 'video' && (
                                            <video controls src={`data:video/mp4;base64,${log.attachment}`} style={{ width: '100%', display: 'block' }} />
                                        )}
                                        {log.attachmentType === 'audio' && (
                                            <audio controls src={`data:audio/wav;base64,${log.attachment}`} style={{ width: '100%', display: 'block' }} />
                                        )}
                                        {(log.attachmentType === 'text' || log.attachmentType === 'pdf') && (
                                            <div style={{ padding: '1rem', fontSize: '0.8rem', background: '#111', color: log.attachmentType === 'pdf' ? '#f87171' : '#eee' }}>
                                                {log.attachmentType === 'pdf' ? '📄 PDF Document' : '📝 Text File'}
                                            </div>
                                        )}
                                    </div>
                                )}

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

      {/* COMMAND DECK (Footer) - Sticky/Fixed at Bottom */}
      <footer className={`command-deck ${currentView === 'COUNCIL' ? 'hidden' : ''}`}>
          <div className="tray-controls">
              <div className="flex-group">
                  <button onClick={() => setIsMicOn(!isMicOn)} className={`btn btn-icon ${isMicOn ? 'active-green' : 'btn-danger'}`} title={isMicOn ? "Microphone Active" : "Microphone Muted"}>
                      {isMicOn ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>}
                  </button>
                  <button onClick={toggleCamera} className={`btn btn-icon ${isCameraOn ? 'active-green' : ''}`} title="Toggle Camera">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                  </button>
                  <button className="btn btn-icon" title="Streaming Video Player (Placeholder)">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 7l-7 5 7 5V7z"></path>
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                      </svg>
                  </button>
              </div>
              
              <div className="flex-group">
                  <button onClick={() => setCurrentView('COUNCIL')} className="btn btn-xs" title="Open Multi-Agent Console">COUNCIL</button>
                  <button onClick={() => setIsTerminalOpen(!isTerminalOpen)} className="btn btn-xs" title="Open Terminal">TERM (~)</button>
              </div>

              {/* MODEL MODE SELECTOR - RESTORED IN FOOTER */}
              <div className="mode-selector">
                  {['STD', 'DEEP', 'IMG', 'EXT'].map(m => (
                      <button
                          key={m}
                          onClick={() => setModelMode(m as ModelMode)}
                          disabled={connectionState === ConnectionState.CONNECTED}
                          className={modelMode === m ? `active ${m.toLowerCase()}` : ''}
                          title={
                              m === 'DEEP' ? "Pro Reasoning (Thinking)" : 
                              (m === 'EXT' ? "External Tools (Routing)" : 
                              (m === 'IMG' ? "Visualizer (Image Generation)" : "Standard Mode"))
                          }
                      >
                          {m}
                      </button>
                  ))}
              </div>

              <div className="flex-group">
                  <button onClick={() => setLayoutMode('VIDEO')} className={`btn btn-xs ${layoutMode === 'VIDEO' ? 'active' : ''}`}>VIDEO</button>
                  <button onClick={() => setLayoutMode('VOICE')} className={`btn btn-xs ${layoutMode === 'VOICE' ? 'active' : ''}`}>VOICE</button>
                  <button onClick={() => setLayoutMode('HYBRID')} className={`btn btn-xs ${layoutMode === 'HYBRID' ? 'active' : ''}`}>HYBRID</button>
                  <button onClick={() => setLayoutMode('CHAT')} className={`btn btn-xs ${layoutMode === 'CHAT' ? 'active' : ''}`}>CHAT</button>
              </div>
          </div>
          <div className="input-bar">
              {/* HIDDEN FILE INPUT FOR PAPERCLIP */}
              <input 
                  type="file" 
                  ref={paperclipInputRef} 
                  className="hidden" 
                  accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.html,.css,.xml,.yaml,.yml,.sh"
                  onChange={handlePaperclipUpload}
              />
              <button onClick={handlePaperclipClick} className="btn btn-icon btn-lg" style={{ marginRight: '0.5rem', flexShrink: 0 }} title="Attach File (Image, Video, Audio, Text, PDF, Code)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                  </svg>
              </button>
              <input type="text" className="main-input" placeholder={connectionState === ConnectionState.CONNECTED ? "Type message to agent..." : "Connect to start conversation..."} value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendText()} disabled={connectionState !== ConnectionState.CONNECTED} />
              {connectionState === ConnectionState.CONNECTED ? <button onClick={disconnect} className="btn btn-danger btn-lg" style={{ fontWeight: 'bold' }}>STOP</button> : <button onClick={connect} className="btn btn-primary btn-lg" disabled={connectionState === ConnectionState.CONNECTING}>{connectionState === ConnectionState.CONNECTING ? '...' : 'START'}</button>}
              <button onClick={handleSendText} className="btn btn-secondary btn-lg" disabled={!inputText.trim() || connectionState !== ConnectionState.CONNECTED}>SEND</button>
          </div>
      </footer>

      <Terminal isOpen={isTerminalOpen} onClose={() => setIsTerminalOpen(false)} onSwitchAgent={handleAgentChange} currentAgentHandle={currentAgent?.handle || 'guest'} />
    </div>
  );
};

export default App;
