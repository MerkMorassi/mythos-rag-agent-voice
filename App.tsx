
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Tool } from "@google/genai";
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
import { MediaPlayer } from './components/MediaPlayer'; // Import Player
import {
  saveActiveChat,
  getAgentConfig,
  saveAgentConfig,
  getGeneralInstructions,
  saveGeneralInstructions,
  saveMediaAsset,
  getGraphContext,
  searchDocuments,
  ensureVectorIndex
} from './services/db';
import { IngestionService } from './services/ingestion';
import { NumMarkX_GenerateID } from './patterns/NumMarkX';
import { useGeminiLive } from './hooks/useGeminiLive';
import { McpClient } from './services/mcpClient';
import { ExternalRouter } from './services/externalRouter';

type ViewMode = 'ORCHESTRATOR' | 'COUNCIL';
type ModelMode = 'STD' | 'DEEP' | 'EXT' | 'IMG';

const App: React.FC = () => {
  // --- STATE ---
  const [apiKey, setApiKey] = useState(process.env.API_KEY || localStorage.getItem('gemini_api_key') || '');
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
  const [modelMode, setModelMode] = useState<ModelMode>('STD');

  // Layout & View Modes - Default to VOICE for immersive experience
  const [layoutMode, setLayoutMode] = useState<'VOICE' | 'CHAT' | 'HYBRID' | 'VIDEO'>('VOICE');
  const [currentView, setCurrentView] = useState<ViewMode>('ORCHESTRATOR');
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [activeSidePanel, setActiveSidePanel] = useState<string | null>(null);

  // Video State
  const [isCameraOn, setIsCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const isCameraOnRef = useRef(false); // Sync ref

  // Story Audio State
  const [storyAudioUrl, setStoryAudioUrl] = useState<string | null>(null);
  const [interruptSignal, setInterruptSignal] = useState(false);

  // File Upload Ref
  const paperclipInputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // --- PREPARE LIVE CONFIG ---
  const currentAgent = AGENTS.find(a => a.id === currentAgentId);
  
  // Construct instructions based on mode
  let modeInstruction = "";
  if (modelMode === 'DEEP') {
      modeInstruction = "\n\n[OPERATIONAL MODE: DEEP REASONING]\nACTIVATE 'Gemini 3 Pro' SIMULATION PROTOCOL.\n- Prioritize complex analysis.\n- THINK before speaking.";
  } else if (modelMode === 'EXT') {
      modeInstruction = "\n\n[OPERATIONAL MODE: EXTERNAL TOOLING]\nACTIVATE 'Router' PROTOCOL.\n- Use tools aggressively.";
  } else if (modelMode === 'IMG') {
      modeInstruction = "\n\n[OPERATIONAL MODE: VISUALIZER]\nACTIVATE 'Image Generation' PROTOCOL.\n- Prioritize visual descriptions.";
  }

  const systemInstruction = `${generalInstructions}\n\n${agentInstructions || currentAgent?.system_instruction}${modeInstruction}`;

  // --- TOOL DEFINITIONS ---

  const retrievalTool: Tool = {
      functionDeclarations: [
          {
              name: "retrieve_knowledge",
              description: "Access the MythOS Knowledge Graph. Use whenever asked about past events, lore, or documents.",
              parameters: {
                  type: "OBJECT",
                  properties: { query: { type: "STRING", description: "The search query." } },
                  required: ["query"]
              }
          }
      ]
  };

  const googleMapsTool: Tool = {
      functionDeclarations: [
          {
              name: "maps_search_places",
              description: "Search for places using Google Maps. Returns POIs, addresses, and ratings.",
              parameters: {
                  type: "OBJECT",
                  properties: { 
                      query: { type: "STRING", description: "Search term (e.g. 'Coffee near Berlin')" },
                      radius: { type: "NUMBER", description: "Search radius in meters (optional, default 5000)" }
                  },
                  required: ["query"]
              }
          },
          {
              name: "maps_distancematrix",
              description: "Calculate travel distance and time between two points.",
              parameters: {
                  type: "OBJECT",
                  properties: { 
                      origin: { type: "STRING", description: "Starting address or location" },
                      destination: { type: "STRING", description: "Ending address or location" },
                      mode: { type: "STRING", description: "Travel mode: 'driving', 'walking', 'bicycling', 'transit'" }
                  },
                  required: ["origin", "destination"]
              }
          }
      ]
  };

  const routeRequestTool: Tool = {
      functionDeclarations: [
          {
              name: "routeRequest",
              description: "Route a complex request or image generation task to a specialized external model.",
              parameters: {
                  type: "OBJECT",
                  properties: {
                      target: {
                          type: "STRING",
                          description: "The target ID: 'FLUX_IMAGE' (Visuals), 'DOLPHIN_LLM' (NSFW/Uncensored Text), 'CHATTERBOX_TTS' (Audio Story).",
                          enum: ["FLUX_IMAGE", "DOLPHIN_LLM", "CHATTERBOX_TTS", "EXTERNAL_LLM"]
                      },
                      prompt: {
                          type: "STRING",
                          description: "The specific prompt or text content to send."
                      }
                  },
                  required: ["target", "prompt"]
              }
          }
      ]
  };

  // --- TOOL HANDLER (GraphRAG + MCP + External) ---
  const handleToolCall = async (toolCall: any): Promise<any[]> => {
      const responses = [];
      for (const fc of toolCall.functionCalls) {
          
          // 1. ROUTE REQUEST (External Models / TTS)
          if (fc.name === 'routeRequest') {
              const args = fc.args as any;
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', text: `[ROUTING] ${args.target}...`, timestamp: Date.now() }]);
              
              const currentAgent = AGENTS.find(a => a.id === currentAgentId);
              if(!currentAgent) return [];

              try {
                  const routerRes = await ExternalRouter.route(args.target, args.prompt, { id: currentAgentId, handle: currentAgent.handle });
                  
                  if (routerRes.success) {
                      if (routerRes.type === 'audio' && routerRes.data) {
                          // SET AUDIO URL TO PLAY
                          setStoryAudioUrl(routerRes.data);
                          responses.push({
                              id: fc.id, name: fc.name,
                              response: { result: "Audio generated and playing via Chatterbox Player." }
                          });
                      } else {
                          responses.push({
                              id: fc.id, name: fc.name,
                              response: { result: routerRes.data }
                          });
                      }
                  } else {
                      responses.push({
                          id: fc.id, name: fc.name,
                          response: { error: routerRes.error }
                      });
                  }
              } catch (e: any) {
                  responses.push({
                      id: fc.id, name: fc.name,
                      response: { error: e.message }
                  });
              }
          }

          // 2. NATIVE KNOWLEDGE RETRIEVAL
          else if (fc.name === 'retrieve_knowledge') {
              const query = (fc.args as any).query;
              
              setLogs(prev => [...prev, { 
                  id: crypto.randomUUID(), 
                  type: 'system', 
                  text: `[GRAPH ACCESS] Traversal: "${query}"`, 
                  timestamp: Date.now() 
              }]);

              try {
                  const embedAi = new GoogleGenAI({ apiKey });
                  const embedRes = await embedAi.models.embedContent({
                      model: 'text-embedding-004',
                      contents: [{ parts: [{ text: query }] }]
                  });
                  const vec = embedRes.embeddings?.[0]?.values;

                  // Hybrid Retrieval
                  const graphText = await getGraphContext(query, vec, currentAgentId);
                  const vectorDocs = await searchDocuments(query, vec, currentAgentId);
                  
                  const combinedContext = `### KNOWLEDGE GRAPH ###\n${graphText || "No direct graph connections found."}\n\n### RELEVANT DOCUMENTS ###\n${vectorDocs.map(d => `- ${d.content.substring(0,400)}...`).join('\n')}`;

                  responses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { result: combinedContext }
                  });
              } catch(e: any) {
                  console.error("Retrieval Failed", e);
                  responses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { result: `Error accessing knowledge base: ${e.message}` }
                  });
              }
          }
          // 3. GOOGLE MAPS MCP TOOLS
          else if (fc.name.startsWith('maps_')) {
              setLogs(prev => [...prev, { 
                  id: crypto.randomUUID(), 
                  type: 'system', 
                  text: `[MCP BRIDGE] Calling Google Maps: ${fc.name}`, 
                  timestamp: Date.now() 
              }]);

              try {
                  // Forward to local MCP bridge
                  const mcpResult = await McpClient.execute('google-maps', fc.name, fc.args as any);
                  
                  if (mcpResult.status === 'SUCCESS') {
                       responses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { result: JSON.stringify(mcpResult.result).substring(0, 10000) } // Truncate large map responses
                      });
                  } else {
                       throw new Error(mcpResult.error);
                  }
              } catch (e: any) {
                  console.error("MCP Execution Failed", e);
                  responses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { result: `Tool Execution Error: ${e.message}` }
                  });
              }
          }
      }
      return responses;
  };

  // --- USE GEMINI LIVE HOOK ---
  const { 
      connect, 
      disconnect, 
      connectionState, 
      analyser, 
      sendText, 
      sendRealtimeInput, 
      isMicOn, 
      setIsMicOn,
      isThinking // The "Amber Flash" Indicator state
  } = useGeminiLive({
      apiKey,
      modelName: 'gemini-2.5-flash-native-audio-preview-09-2025',
      systemInstruction,
      voiceName: selectedVoice,
      tools: [retrievalTool, googleMapsTool, routeRequestTool],
      onLog: (log) => {
          // Handle streaming log updates logic
          setLogs(prev => {
              if (log.isStreaming) {
                  // If user is speaking (streaming user log), we should interrupt story
                  if (log.type === 'user') {
                      setInterruptSignal(true);
                  }
                  
                  const last = prev[prev.length - 1];
                  if (last && last.type === log.type && last.isStreaming) {
                      return [...prev.slice(0, -1), { ...last, text: last.text + log.text }];
                  }
              } else if (log.type === 'system' && log.text === '[Interrupted]') {
                  // Mark previous streams as done
                  const last = prev[prev.length - 1];
                  if(last && last.isStreaming) return [...prev.slice(0, -1), { ...last, isStreaming: false, text: last.text + ' [Interrupted]' }];
              }
              return [...prev, log];
          });
      },
      onToolCall: handleToolCall
  });

  // --- EFFECTS ---

  useEffect(() => {
      // Auto-load config
      const init = async () => {
          await ensureVectorIndex(); // Migration check
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

  // Monitor mic input for interruption using Analyser
  useEffect(() => {
      if (connectionState === ConnectionState.CONNECTED && analyser && isMicOn) {
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          
          const checkVolume = () => {
              analyser.getByteFrequencyData(dataArray);
              let sum = 0;
              for(let i=0; i<bufferLength; i++) sum += dataArray[i];
              const avg = sum / bufferLength;
              
              // Simple VAD Threshold - if mic input is loud enough, interrupt story
              if (avg > 30) {
                  setInterruptSignal(true);
              } else {
                  // If we wanted to auto-resume, we could set false here, but better to let user say "Resume"
                  // or have a manual resume. But the Player component pauses on signal=true.
                  // We need to reset signal to false after a bit if volume drops? 
                  // No, because interruption is a state. We toggle it off when user stops talking?
                  // Actually, let's just trigger pause once.
                  setInterruptSignal(false); 
              }
          };
          
          // Poll volume every 200ms
          const interval = setInterval(checkVolume, 200);
          return () => clearInterval(interval);
      }
  }, [connectionState, analyser, isMicOn]);

  useEffect(() => {
    loadAgentConfig(currentAgentId);
  }, [currentAgentId]);

  useEffect(() => {
    if (logEndRef.current) {
        logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, layoutMode]);

  useEffect(() => { isCameraOnRef.current = isCameraOn; }, [isCameraOn]);

  // Video Stream Logic
  useEffect(() => {
      if (isCameraOn && videoRef.current && canvasRef.current && connectionState === ConnectionState.CONNECTED) {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          
          if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);

          // Stream Frames at 1 FPS
          frameIntervalRef.current = window.setInterval(() => {
              if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
                  canvas.width = video.videoWidth;
                  canvas.height = video.videoHeight;
                  ctx.drawImage(video, 0, 0);
                  const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                  sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64 } });
              }
          }, 1000); 
      }
      return () => {
          if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      };
  }, [isCameraOn, connectionState, sendRealtimeInput]);

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
      if (connectionState === ConnectionState.CONNECTED) disconnect();
      setCurrentAgentId(id);
  };

  const handleSettingsSave = async (voiceRef?: string, newAccessLevel?: string, speed?: number, pitch?: number) => {
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
          setIsCameraOn(false);
          if (videoRef.current && videoRef.current.srcObject) {
              (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
              videoRef.current.srcObject = null;
          }
      } else {
          try {
              const stream = await navigator.mediaDevices.getUserMedia({ video: true });
              if (videoRef.current) videoRef.current.srcObject = stream;
              setIsCameraOn(true);
          } catch (e) {
              alert("Camera access denied.");
          }
      }
  };

  const handleSendText = async () => {
      if (!inputText.trim()) return;
      const text = inputText;
      setInputText('');
      setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'user', text: text, timestamp: Date.now() }]);
      sendText(text);
  };

  // --- PAPERCLIP UPLOAD LOGIC ---
  const handlePaperclipClick = () => paperclipInputRef.current?.click();

  const handlePaperclipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      
      const reader = new FileReader();
      reader.onload = async (evt) => {
          const res = evt.target?.result as string;
          let data = res;
          let type: MediaAsset['type'] = 'text'; // Default
          
          if (file.type.startsWith('image/')) type = 'image';
          else if (file.type.includes('pdf')) type = 'pdf';
          
          if ((type === 'image' || type === 'pdf') && res.includes('base64,')) {
              data = res.split(',')[1];
          }

          // Save to Gallery
          const asset: MediaAsset = {
              id: NumMarkX_GenerateID('UP'),
              type,
              data,
              prompt: file.name,
              agentId: 'USER',
              timestamp: Date.now(),
              tags: ['CHAT_UPLOAD']
          };
          await saveMediaAsset(asset);

          setLogs(prev => [...prev, {
              id: crypto.randomUUID(),
              type: 'user',
              text: `[Attached ${type.toUpperCase()}: ${file.name}]`,
              timestamp: Date.now(),
              attachment: data,
              attachmentType: type
          }]);

          if (type === 'image') {
              sendRealtimeInput({ media: { mimeType: file.type, data } });
          } else if (type === 'text') {
              const content = await file.text();
              // Ingest full text
              IngestionService.ingestText(content, file.name, currentAgentId, apiKey);
              // Send truncated context
              const truncated = content.substring(0, 5000);
              sendText(`[USER UPLOADED FILE: ${file.name}]\n${truncated}... (Full text ingested)`);
          }
      };
      
      if (file.type.startsWith('image/') || file.type.includes('pdf')) reader.readAsDataURL(file);
      else reader.readAsText(file);
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
      transition: 'flex 0.3s ease',
      // VISUAL CUE FOR THINKING - UPDATED TO AMBER GLOW
      boxShadow: isThinking ? '0 0 50px rgba(255, 165, 0, 0.5)' : 'none',
      borderColor: isThinking ? '#f59e0b' : '#333'
  };

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
                <span className="status-indicator" style={{ color: '#38bdf8', borderColor: '#38bdf8' }}>COMMS HUB</span>
            )}
        </div>

        <div className="flex-group">
            <div className={`status-indicator ${connectionState.toLowerCase()}`}>
                {connectionState}
            </div>
            
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
        {activeSidePanel === 'VOICE' && <VoiceCommandList isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} />}
        {activeSidePanel === 'FOCUS' && <RoomFocusConfig isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} />}
        {activeSidePanel === 'MEDIA' && <MediaGallery isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} currentAgentId={currentAgentId} />}
        {activeSidePanel === 'MCP' && <McpManager isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} />}
        {activeSidePanel === 'KNOWLEDGE' && <KnowledgeManager isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} onUpdate={()=>{}} currentAgentId={currentAgentId} />}
        {activeSidePanel === 'HISTORY' && <ChatHistoryManager isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} currentLogs={logs} onLoadSession={setLogs} currentAgentId={currentAgentId} onUpdateKnowledge={()=>{}} />}
        {activeSidePanel === 'SETTINGS' && <SettingsManager isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} modelConfig={modelConfig} setModelConfig={setModelConfig} disabled={connectionState === ConnectionState.CONNECTED} generalInstruction={generalInstructions} setGeneralInstruction={setGeneralInstructions} agentInstruction={agentInstructions} setAgentInstruction={setAgentInstructions} agentName={currentAgent?.handle || 'Unknown'} agentId={currentAgentId} agentAccessLevel={accessLevel} selectedVoice={selectedVoice} onVoiceChange={setSelectedVoice} onSave={handleSettingsSave} />}

        {/* MEDIA PLAYER (Chatterbox) */}
        <MediaPlayer 
            audioUrl={storyAudioUrl} 
            title="Narrative Playback" 
            onClose={() => setStoryAudioUrl(null)} 
            interruptSignal={interruptSignal} 
        />

        {currentView === 'COUNCIL' ? (
            <MultiAgentConsole onExit={() => setCurrentView('ORCHESTRATOR')} />
        ) : (
            <>
                <div style={visualizerStyle}>
                    <div className="panel-overlay top-left">
                        <span className="overlay-label">
                            VISUALIZER // {selectedVoice.toUpperCase()} // {isThinking ? 'THINKING...' : (isCameraOn ? 'CAM ON' : 'CAM OFF')}
                        </span>
                    </div>
                    
                    {/* VISUAL INDICATOR FOR THINKING */}
                    {isThinking && (
                        <div className="thinking-indicator" style={{
                            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                            color: '#f59e0b', fontSize: '0.8rem', letterSpacing: '2px', fontWeight: 'bold',
                            zIndex: 10, textShadow: '0 0 10px rgba(245, 158, 11, 0.8)',
                            background: 'rgba(0,0,0,0.6)', padding: '0.5rem 1rem', borderRadius: '4px', border: '1px solid #f59e0b'
                        }}>
                            ACCESSING NEURAL LATTICE...
                        </div>
                    )}

                    <canvas ref={canvasRef} className="hidden" />
                    
                    {layoutMode === 'VIDEO' ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#333' }}>
                            <div className="animate-pulse" style={{ width: '100px', height: '100px', borderRadius: '50%', border: `2px dashed ${isThinking ? '#facc15' : '#333'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: '#111' }}></div>
                            </div>
                            <div style={{ marginTop: '1rem', fontSize: '0.7rem', letterSpacing: '2px', color: isThinking ? '#facc15' : '#444' }}>
                                {isThinking ? 'ACCESSING KNOWLEDGE GRAPH...' : 'VIDEO FEED STANDBY'}
                            </div>
                        </div>
                    ) : (
                        <Visualizer analyser={analyser} isActive={connectionState === ConnectionState.CONNECTED} />
                    )}

                    <div style={{ position: 'absolute', bottom: '10px', right: '10px', width: '160px', height: '120px', background: '#000', border: '1px solid #4ade80', display: isCameraOn ? 'block' : 'none', zIndex: 30, boxShadow: '0 0 10px rgba(0,0,0,0.5)' }}>
                        <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                </div>

                <div style={layoutMode === 'CHAT' || layoutMode === 'HYBRID' ? { flex: '1 1 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { display: 'none' }}>
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
                                        {log.attachmentType === 'image' ? (
                                            <img src={`data:image/jpeg;base64,${log.attachment}`} style={{ width: '100%', display: 'block' }} />
                                        ) : (
                                            <div style={{ padding: '1rem', fontSize: '0.8rem', background: '#111', color: '#eee' }}>File Attached</div>
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

      {/* FOOTER */}
      <footer className={`command-deck ${currentView === 'COUNCIL' ? 'hidden' : ''}`}>
          <div className="tray-controls">
              <div className="flex-group">
                  <button onClick={() => setIsMicOn(!isMicOn)} className={`btn btn-icon ${isMicOn ? 'active-green' : 'btn-danger'}`} title="Mic Toggle">
                      {isMicOn ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>}
                  </button>
                  <button onClick={toggleCamera} className={`btn btn-icon ${isCameraOn ? 'active-green' : ''}`} title="Cam Toggle">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                  </button>
              </div>
              
              <div className="flex-group">
                  <button onClick={() => setCurrentView('COUNCIL')} className="btn btn-xs">COUNCIL</button>
                  <button onClick={() => setIsTerminalOpen(!isTerminalOpen)} className="btn btn-xs">TERM (~)</button>
              </div>

              <div className="mode-selector">
                  {['STD', 'DEEP', 'IMG', 'EXT'].map(m => (
                      <button key={m} onClick={() => setModelMode(m as ModelMode)} className={modelMode === m ? `active ${m.toLowerCase()}` : ''}>{m}</button>
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
              <input type="file" ref={paperclipInputRef} className="hidden" onChange={handlePaperclipUpload} />
              <button onClick={handlePaperclipClick} className="btn btn-icon btn-lg" style={{ marginRight: '0.5rem' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
              </button>
              <input type="text" className="main-input" placeholder="Type message..." value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendText()} />
              {connectionState === ConnectionState.CONNECTED ? <button onClick={disconnect} className="btn btn-danger btn-lg">STOP</button> : <button onClick={connect} className="btn btn-primary btn-lg" disabled={connectionState === ConnectionState.CONNECTING}>{connectionState === ConnectionState.CONNECTING ? '...' : 'START'}</button>}
              <button onClick={handleSendText} className="btn btn-secondary btn-lg">SEND</button>
          </div>
      </footer>

      <Terminal isOpen={isTerminalOpen} onClose={() => setIsTerminalOpen(false)} onSwitchAgent={handleAgentChange} currentAgentHandle={currentAgent?.handle || 'guest'} />
    </div>
  );
};

export default App;
