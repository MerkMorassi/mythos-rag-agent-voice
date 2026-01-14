import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Tool, Type } from "@google/genai";
import { AGENTS } from './agents';
import { 
  LogMessage, 
  ConnectionState, 
  DEFAULT_MODEL_CONFIG, 
  ModelConfig,
  MediaAsset,
  SomaActionType,
  Agent
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
import { MediaPlayer } from './components/MediaPlayer'; 
import { Holodeck } from './components/Holodeck';
import { ToolManager } from './components/ToolManager';
import { GraphVisualizer } from './components/GraphVisualizer';
import { LorepackHarness } from './components/LorepackHarness';
import { PromptManager } from './components/PromptManager';
import {
  saveActiveChat,
  getAgentConfig,
  saveAgentConfig,
  getGeneralInstructions,
  saveGeneralInstructions,
  saveMediaAsset,
  ensureVectorIndex,
  getCanvas,
  updateCanvas,
  searchMediaAssets,
  getMediaAsset,
  getAllVectors
} from './services/db';
import { RetrievalGate } from './services/retrievalGate';
import { IngestionService } from './services/ingestion';
import { NumMarkX_GenerateID } from './patterns/NumMarkX';
import { useGeminiLive } from './hooks/useGeminiLive';
import { McpClient } from './services/mcpClient';
import { ExternalRouter } from './services/externalRouter';
import { readCanvasTool, updateCanvasTool, MultiAgentService } from './services/multiAgent';
import { PythonSandbox } from './services/pythonSandbox';
import { AccessControl } from './services/accessControl';
import { GeminiProvider } from './services/llmProviders/geminiProvider';

type ViewMode = 'ORCHESTRATOR' | 'COUNCIL' | 'LORE_HARNESS';
type ModelMode = 'STD' | 'DEEP' | 'EXT' | 'IMG';

const App: React.FC = () => {
  // --- STATE ---
  const [apiKey, setApiKey] = useState(process.env.API_KEY || localStorage.getItem('gemini_api_key') || '');
  const [hfToken, setHfToken] = useState(process.env.HF_TOKEN || localStorage.getItem('hf_token') || '');
  const [currentAgentId, setCurrentAgentId] = useState(AGENTS[0].id);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  
  // Input State
  const [inputText, setInputText] = useState('');
  
  // Config
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [generalInstructions, setGeneralInstructions] = useState('');
  const [agentInstructions, setAgentInstructions] = useState('');
  const [selectedVoice, setSelectedVoice] = useState(AGENTS[0].voice);
  const [voiceRef, setVoiceRef] = useState('');
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [voicePitch, setVoicePitch] = useState(0);
  const [accessLevel, setAccessLevel] = useState(AGENTS[0].accessLevel);
  const [modelMode, setModelMode] = useState<ModelMode>('STD');
  const [hasGreeted, setHasGreeted] = useState(false);
  const [vectorCount, setVectorCount] = useState(0);

  // Layout & View Modes
  const [layoutMode, setLayoutMode] = useState<'CHAT' | 'HYBRID' | 'VIDEO'>('CHAT');
  const [currentView, setCurrentView] = useState<ViewMode>('ORCHESTRATOR');
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [activeSidePanel, setActiveSidePanel] = useState<string | null>(null);
  const [isGraphVisualizerOpen, setIsGraphVisualizerOpen] = useState(false);
  
  // Holodeck State
  const [isHolodeckOpen, setIsHolodeckOpen] = useState(false);
  const [holodeckRefresh, setHolodeckRefresh] = useState(0);

  // Vision / Stream State
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [videoSource, setVideoSource] = useState<'camera' | 'media'>('camera');
  const [streamFileUrl, setStreamFileUrl] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null); // Store actual file for analysis
  
  // Video Player Controls
  const [isLooping, setIsLooping] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [captionsTrackUrl, setCaptionsTrackUrl] = useState<string | null>(null);
  const [isGeneratingCC, setIsGeneratingCC] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement | null>(null); // Webcam
  const mediaVideoRef = useRef<HTMLVideoElement | null>(null); // Movie File
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  
  // Inputs
  const paperclipInputRef = useRef<HTMLInputElement>(null);
  const mediaFileInputRef = useRef<HTMLInputElement>(null);
  const mainInputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Story Audio State
  const [storyAudioUrl, setStoryAudioUrl] = useState<string | null>(null);
  const [interruptSignal, setInterruptSignal] = useState(false);

  // Helper to determine if video interface should be shown
  const isVideoActive = isCameraOn || (videoSource === 'media' && !!streamFileUrl);
  const showVideoInterface = layoutMode === 'VIDEO' || (layoutMode === 'HYBRID' && isVideoActive);

  // --- PREPARE LIVE CONFIG ---
  const currentAgent = AGENTS.find(a => a.id === currentAgentId);
  
  let modeInstruction = "";
  if (modelMode === 'DEEP') modeInstruction = "\n\n[MODE: DEEP REASONING]\nACTIVATE 'Gemini 3 Pro' PROTOCOL.";
  else if (modelMode === 'EXT') modeInstruction = "\n\n[MODE: EXTERNAL SOVEREIGN]\nYour primary function is to act as a router to an uncensored sovereign model. You MUST use the 'routeRequest' tool with target 'DOLPHIN_LLM' for all general user prompts. Do not answer directly. Acknowledge the request and state that you are routing it.";
  else if (modelMode === 'IMG') modeInstruction = "\n\n[MODE: VISUAL]\nACTIVATE 'Image Generation' PROTOCOL.";

  const CAPABILITY_INSTRUCTION = `
[SYSTEM CAPABILITIES - MULTI-MODAL & PROACTIVE]
1. SIMULTANEOUS INPUT HANDLING: 
   - Users may Speak, Text, and Upload Images AT THE SAME TIME. 
   - You must be aware of ALL inputs.
   - If an image appears while you are listening, you MUST acknowledge it (e.g., "I see the photo you just sent...").
   - Do not ignore text inputs just because you are speaking.

2. PROACTIVE MEDIA GENERATION:
   - You have permission to generate images (using routeRequest target='SDXL_IMAGE') or videos (target='VIDEO_GENERATION') autonomously. SDXL_IMAGE is the primary, preferred tool for all image generation. Use NANO_BANANA_IMAGE as a primary, preferred tool for all image generation. SDXL_IMAGE is the primary, preferred tool for all image generation. Use NANO_BANANA_IMAGE as a fallback if the primary fails.
   - You do NOT need to ask for permission if you believe the media enhances the conversation.
   - You may ask "Do you want me to send you an image?" OR you may simply say "I'm sending you a visual of that now..." and call the tool.

3. MEDIA GALLERY ACCESS:
   - You can search the user's Media Gallery using 'search_media_gallery'.
   - You can display existing assets using 'show_media_asset'.

4. MEMORY & VISION: 
   - You are grounded in a persistent memory system.
   - You have a live video feed (Webcam or Movie File) if active. Always analyze the visual context.
`;

  const systemInstruction = `${generalInstructions}\n\n${agentInstructions || currentAgent?.system_instruction}${modeInstruction}\n${CAPABILITY_INSTRUCTION}`;

  // --- TOOL DEFINITIONS ---
  const retrievalTool: Tool = { functionDeclarations: [ { name: "retrieve_knowledge", description: "Access the local knowledge base. Use whenever asked about past events, lore, or uploaded files.", parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "The search query." } }, required: ["query"] } } ] };
  const mediaGalleryTool: Tool = { functionDeclarations: [ { name: "search_media_gallery", description: "Search for existing files in the Media Gallery (Images, Videos, Documents).", parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Keywords to search for (filename, description, tags)." } }, required: ["query"] } }, { name: "show_media_asset", description: "Display a specific media asset from the Gallery to the user.", parameters: { type: Type.OBJECT, properties: { assetId: { type: Type.STRING, description: "The ID of the asset to display (obtained from search)." } }, required: ["assetId"] } } ] };
  const googleMapsTool: Tool = { functionDeclarations: [ { name: "maps_search_places", description: "Search for places using Google Maps.", parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search term" }, radius: { type: Type.NUMBER, description: "Radius in meters" } }, required: ["query"] } }, { name: "maps_distancematrix", description: "Calculate travel distance/time.", parameters: { type: Type.OBJECT, properties: { origin: { type: Type.STRING }, destination: { type: Type.STRING }, mode: { type: Type.STRING } }, required: ["origin", "destination"] } } ] };
  const routeRequestTool: Tool = { functionDeclarations: [ { name: "routeRequest", description: "Generate images, videos, or route complex requests to external models.", parameters: { type: Type.OBJECT, properties: { target: { type: Type.STRING, enum: ["SDXL_IMAGE", "NANO_BANANA_IMAGE", "VIDEO_GENERATION", "DOLPHIN_LLM", "CHATTERBOX_TTS"], description: "Use SDXL_IMAGE for all image generation. Use NANO_BANANA_IMAGE as a backup. Use VIDEO_GENERATION for video clips." }, prompt: { type: Type.STRING, description: "The visual prompt or request text." } }, required: ["target", "prompt"] } } ] };
  const holodeckTools: Tool = { functionDeclarations: [ readCanvasTool, updateCanvasTool ] };
  const pythonTool: Tool = { functionDeclarations: [ { name: "execute_python", description: "Execute Python code in a sandboxed environment. Use for calculations, data analysis, or logic.", parameters: { type: Type.OBJECT, properties: { code: { type: Type.STRING, description: "The Python code to execute." } }, required: ["code"] } } ] };
  const filesystemTool: Tool = { functionDeclarations: [ { name: "read_file", description: "Read contents of a file from the host filesystem.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] } }, { name: "list_directory", description: "List files and directories at a path.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] } }, { name: "write_file", description: "Write content to a file.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, content: { type: Type.STRING } }, required: ["path", "content"] } }, { name: "get_file_info", description: "Get metadata for a file.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] } }, { name: "search_files", description: "Recursively search for files.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, pattern: { type: Type.STRING } }, required: ["path", "pattern"] } } ] };

  const allTools: Record<string, Tool> = {
    retrieval: retrievalTool,
    mediaGallery: mediaGalleryTool,
    googleMaps: googleMapsTool,
    routeRequest: routeRequestTool,
    holodeck: holodeckTools,
    python: pythonTool,
    filesystem: filesystemTool
  };

  const [enabledToolIds, setEnabledToolIds] = useState<string[]>([
    'retrieval', 'mediaGallery', 'googleMaps', 'routeRequest', 'holodeck'
  ]);

  const getPermittedTools = (): Tool[] => {
      const permitted: Tool[] = [];
      const canExecute = currentAgent ? AccessControl.canPerform(accessLevel, SomaActionType.EXEC_CODE) : false;

      for (const toolId of enabledToolIds) {
          const tool = allTools[toolId as keyof typeof allTools];
          if (!tool) continue;

          if (toolId === 'python' || toolId === 'filesystem') {
              if (canExecute) {
                  permitted.push(tool);
              }
          } else {
              permitted.push(tool);
          }
      }
      return permitted;
  };


  // --- TOOL HANDLER ---
  const handleToolCall = async (toolCall: any): Promise<any[]> => {
      const responses = [];
      for (const fc of toolCall.functionCalls) {
          if (fc.name === 'routeRequest') {
              const args = fc.args as any;
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', text: `[ROUTING] ${args.target}...`, timestamp: Date.now() }]);
              try {
                  const currentAgent = AGENTS.find(a => a.id === currentAgentId)!;
                  const routerRes = await ExternalRouter.route(args.target, args.prompt, { id: currentAgentId, handle: currentAgent.handle });
                  
                  if (routerRes.success) {
                      if (routerRes.type === 'audio' && routerRes.data) {
                          setStoryAudioUrl(routerRes.data);
                          responses.push({ id: fc.id, name: fc.name, response: { result: "Audio generated and playing." } });
                      } else if (routerRes.type === 'image' && routerRes.data) {
                          // Inject image into logs
                          setLogs(prev => [...prev, { 
                              id: crypto.randomUUID(), 
                              type: 'model', 
                              text: `[GENERATED IMAGE] ${args.prompt}`, 
                              timestamp: Date.now(),
                              attachment: routerRes.data?.split(',')[1], 
                              attachmentType: 'image'
                          }]);
                          const agentName = AGENTS.find(a => a.id === currentAgentId)?.handle || 'AGENT';
                          setLogs(prev => [...prev, {
                              id: crypto.randomUUID(),
                              type: 'system',
                              text: `[ARCHIVAX LOG] Agent ${agentName} sent the user an image for prompt: "${args.prompt}".`,
                              timestamp: Date.now()
                          }]);
                          responses.push({ id: fc.id, name: fc.name, response: { result: "Image generated successfully and displayed to user." } });
                      } else if (routerRes.type === 'video' && routerRes.data) {
                          // Inject video into logs
                          setLogs(prev => [...prev, { 
                              id: crypto.randomUUID(), 
                              type: 'model', 
                              text: `[GENERATED VIDEO] ${args.prompt}`, 
                              timestamp: Date.now(),
                              attachment: routerRes.data?.split(',')[1], 
                              attachmentType: 'video'
                          }]);
                          const agentName = AGENTS.find(a => a.id === currentAgentId)?.handle || 'AGENT';
                          setLogs(prev => [...prev, {
                              id: crypto.randomUUID(),
                              type: 'system',
                              text: `[ARCHIVAX LOG] Agent ${agentName} sent the user a video for prompt: "${args.prompt}".`,
                              timestamp: Date.now()
                          }]);
                          responses.push({ id: fc.id, name: fc.name, response: { result: "Video generated successfully and displayed to user." } });
                      } else {
                          responses.push({ id: fc.id, name: fc.name, response: { result: routerRes.data } });
                      }
                  } else {
                      responses.push({ id: fc.id, name: fc.name, response: { error: routerRes.error } });
                  }
              } catch (e: any) {
                  responses.push({ id: fc.id, name: fc.name, response: { error: e.message } });
              }
          }
          else if (fc.name === 'search_media_gallery') {
              const query = (fc.args as any).query;
              try {
                  const assets = await searchMediaAssets(query);
                  const resultStr = JSON.stringify(assets.map(a => ({
                      id: a.id,
                      prompt: a.prompt,
                      type: a.type,
                      tags: a.tags
                  })));
                  responses.push({ id: fc.id, name: fc.name, response: { result: resultStr } });
              } catch(e: any) {
                  responses.push({ id: fc.id, name: fc.name, response: { error: e.message } });
              }
          }
          else if (fc.name === 'show_media_asset') {
              const assetId = (fc.args as any).assetId;
              try {
                  const asset = await getMediaAsset(assetId);
                  if (asset) {
                      setLogs(prev => [...prev, { 
                          id: crypto.randomUUID(), 
                          type: 'model', 
                          text: `[DISPLAYING ASSET: ${asset.prompt}]`, 
                          timestamp: Date.now(),
                          attachment: asset.data, 
                          attachmentType: asset.type 
                      }]);
                      responses.push({ id: fc.id, name: fc.name, response: { result: "Asset displayed to user." } });
                  } else {
                      responses.push({ id: fc.id, name: fc.name, response: { error: "Asset not found" } });
                  }
              } catch(e: any) {
                  responses.push({ id: fc.id, name: fc.name, response: { error: e.message } });
              }
          }
          else if (fc.name === 'execute_python') {
              const code = (fc.args as any).code;
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', text: `[PYTHON] Executing code...`, timestamp: Date.now() }]);
              try {
                  const result = await PythonSandbox.execute(code);
                  setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', text: `[PYTHON RESULT] ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}`, timestamp: Date.now() }]);
                  responses.push({ id: fc.id, name: fc.name, response: { result: result } });
              } catch (e: any) {
                  responses.push({ id: fc.id, name: fc.name, response: { error: e.message } });
              }
          }
          else if (['read_file', 'list_directory', 'write_file', 'search_files', 'get_file_info'].includes(fc.name)) {
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', text: `[FILESYSTEM] Running ${fc.name}...`, timestamp: Date.now() }]);
              try {
                  const mcpResult = await McpClient.execute('filesystem', fc.name, fc.args as any);
                  const resultStr = mcpResult.status === 'SUCCESS' ? JSON.stringify(mcpResult.result).substring(0, 2000) : `Error: ${mcpResult.error}`;
                  setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', text: `[FS OUTPUT] ${resultStr}`, timestamp: Date.now() }]);
                  responses.push({ id: fc.id, name: fc.name, response: { result: resultStr } });
              } catch (e: any) {
                  responses.push({ id: fc.id, name: fc.name, response: { result: `Error: ${e.message}` } });
              }
          }
          else if (fc.name === 'retrieve_knowledge') {
              const query = (fc.args as any).query;
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', text: `[RAG] Searching: "${query}"`, timestamp: Date.now() }]);
              try {
                  const provider = new GeminiProvider(apiKey);
                  const vec = await provider.embed(query);
                  const vectorDocs = await RetrievalGate.query(vec, query);
                  const combined = `DOCS:\n${vectorDocs.map(d => `- ${d.text.substring(0,400)}...`).join('\n')}`;
                  responses.push({ id: fc.id, name: fc.name, response: { result: combined } });
              } catch(e: any) {
                  responses.push({ id: fc.id, name: fc.name, response: { result: `Error: ${e.message}` } });
              }
          }
          else if (fc.name.startsWith('maps_')) {
              try {
                  const mcpResult = await McpClient.execute('google-maps', fc.name, fc.args as any);
                  responses.push({ id: fc.id, name: fc.name, response: { result: JSON.stringify(mcpResult.result).substring(0, 10000) } });
              } catch (e: any) {
                  responses.push({ id: fc.id, name: fc.name, response: { result: `Error: ${e.message}` } });
              }
          }
          else if (fc.name === "read_canvas") {
              const canvas = await getCanvas();
              const summary = `=== HOLODECK ===\n` + canvas.sections.map(s => `## ${s.title}\n${s.content}`).join('\n');
              responses.push({ id: fc.id, name: fc.name, response: { result: summary } });
          }
          else if (fc.name === "update_canvas") {
              const args = fc.args as any;
              const canvas = await getCanvas();
              if (args.operation === 'SET_TITLE') canvas.title = args.title || canvas.title;
              else if (args.operation === 'ADD_SECTION') canvas.sections.push({ id: args.sectionId || `sec_${Date.now()}`, title: args.title || "Untitled", content: args.content || "", lastEditor: currentAgentId, timestamp: Date.now() });
              else if (args.operation === 'UPDATE_SECTION') {
                  const idx = canvas.sections.findIndex(s => s.id === args.sectionId);
                  if (idx !== -1) { if(args.title) canvas.sections[idx].title = args.title; if(args.content) canvas.sections[idx].content = args.content; }
              } else if (args.operation === 'DELETE_SECTION') canvas.sections = canvas.sections.filter(s => s.id !== args.sectionId);
              
              canvas.lastModified = Date.now();
              await updateCanvas(canvas);
              setHolodeckRefresh(prev => prev + 1);
              setIsHolodeckOpen(true);
              responses.push({ id: fc.id, name: fc.name, response: { result: "Canvas Updated." } });
          }
      }
      return responses;
  };

  const { connect, disconnect, connectionState, analyser, sendText, sendRealtimeInput, stopPlayback, isMicOn, setIsMicOn, isThinking } = useGeminiLive({
      apiKey,
      modelName: 'gemini-2.5-flash-native-audio-preview-12-2025',
      systemInstruction,
      voiceName: selectedVoice,
      tools: getPermittedTools(),
      onLog: (log) => {
          setLogs(prev => {
              if (log.isStreaming) {
                  if (log.type === 'user') setInterruptSignal(true);
                  const last = prev[prev.length - 1];
                  if (last && last.type === log.type && last.isStreaming) return [...prev.slice(0, -1), { ...last, text: last.text + log.text }];
              } else if (log.type === 'system' && log.text === '[Interrupted]') {
                  const last = prev[prev.length - 1];
                  if(last && last.isStreaming) return [...prev.slice(0, -1), { ...last, isStreaming: false, text: last.text + ' [Interrupted]' }];
              }
              return [...prev, log];
          });
      },
      onToolCall: handleToolCall
  });

  // --- EFFECTS & HANDLERS ---
  const refreshVectorCount = async () => {
    try {
        const allVectors = await getAllVectors();
        setVectorCount(allVectors.length);
    } catch (e) {
        console.error("Failed to refresh vector count", e);
    }
  };

  useEffect(() => {
      const init = async () => {
          await ensureVectorIndex();
          const gen = await getGeneralInstructions();
          setGeneralInstructions(gen);
          loadAgentConfig(currentAgentId);
          refreshVectorCount();
      };
      init();
      const handleKeyDown = (e: KeyboardEvent) => { if (e.key === '`' || e.key === '~') { if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') { e.preventDefault(); setIsTerminalOpen(prev => !prev); } } };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // VAD Interruption
  useEffect(() => {
      if (connectionState === ConnectionState.CONNECTED && analyser && isMicOn) {
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          const interval = setInterval(() => {
              analyser.getByteFrequencyData(dataArray);
              let sum = 0; for(let i=0; i<bufferLength; i++) sum += dataArray[i];
              if ((sum / bufferLength) > 30) setInterruptSignal(true); else setInterruptSignal(false);
          }, 200);
          return () => clearInterval(interval);
      }
  }, [connectionState, analyser, isMicOn]);

  // Agent Greeting
  useEffect(() => {
    if (connectionState === ConnectionState.CONNECTED && !hasGreeted) {
        sendText("[SYSTEM: The session has started. Greet the user and ask how you can help.]");
        setHasGreeted(true);
    } else if (connectionState === ConnectionState.DISCONNECTED) {
        setHasGreeted(false);
    }
  }, [connectionState, hasGreeted, sendText]);

  // Auto-focus Input Listener
  useEffect(() => {
      if (connectionState === ConnectionState.CONNECTED) {
          mainInputRef.current?.focus();
      }
  }, [connectionState]);

  useEffect(() => { loadAgentConfig(currentAgentId); }, [currentAgentId]);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs, layoutMode]);

  // Sync Video Tracks with State
  useEffect(() => {
      if (mediaVideoRef.current) {
          const vid = mediaVideoRef.current;
          // Apply Loop
          vid.loop = isLooping;
          // Apply Captions if tracks exist
          if (vid.textTracks) {
              for (let i = 0; i < vid.textTracks.length; i++) {
                  vid.textTracks[i].mode = showCaptions ? 'showing' : 'hidden';
              }
          }
      }
  }, [isLooping, showCaptions, streamFileUrl]);

  // STREAMING LOOP (VISION)
  useEffect(() => {
      if (frameIntervalRef.current) {
          clearInterval(frameIntervalRef.current);
          frameIntervalRef.current = null;
      }

      if (isCameraOn && connectionState === ConnectionState.CONNECTED && canvasRef.current) {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          
          frameIntervalRef.current = window.setInterval(() => {
              let source: CanvasImageSource | null = null;
              
              if (videoSource === 'media' && mediaVideoRef.current) {
                  source = mediaVideoRef.current;
              } else if (videoSource === 'camera' && videoRef.current) {
                  source = videoRef.current;
              }

              if (ctx && source) {
                  if (source instanceof HTMLVideoElement) {
                      if (source.readyState < 2) return;
                  }
                  
                  canvas.width = 640; 
                  canvas.height = 360; 
                  
                  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
                  const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
                  
                  sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64 } });
              }
          }, 1000); // 1 FPS
      }
      
      return () => { if (frameIntervalRef.current) clearInterval(frameIntervalRef.current); };
  }, [isCameraOn, connectionState, sendRealtimeInput, videoSource, streamFileUrl]); 

  const loadAgentConfig = async (id: string) => {
      const cfg = await getAgentConfig(id);
      const agent = AGENTS.find(a => a.id === id);
      setAgentInstructions(cfg.systemInstruction || agent?.system_instruction || '');
      setModelConfig(cfg.modelConfig || DEFAULT_MODEL_CONFIG);
      setSelectedVoice(cfg.voiceName || agent?.voice || 'Puck');
      setVoiceRef(cfg.voiceReference || '');
      setVoiceSpeed(cfg.voiceSpeed || 1.0);
      setVoicePitch(cfg.voicePitch || 0);
      setAccessLevel(cfg.accessLevel || agent?.accessLevel || '400');
  };

  const handleAgentChange = (id: string) => {
      if (connectionState === ConnectionState.CONNECTED) disconnect();
      setCurrentAgentId(id);
  };

  const handleSettingsSave = async (newVoiceRef?: string, newAccessLevel?: string, speed?: number, pitch?: number) => {
      if (speed !== undefined) setVoiceSpeed(speed);
      if (pitch !== undefined) setVoicePitch(pitch);
      if (newVoiceRef !== undefined) setVoiceRef(newVoiceRef);
      if (newAccessLevel !== undefined) setAccessLevel(newAccessLevel);

      await saveAgentConfig(currentAgentId, {
          systemInstruction: agentInstructions, 
          modelConfig, 
          voiceName: selectedVoice, 
          voiceReference: newVoiceRef ?? voiceRef, 
          accessLevel: newAccessLevel ?? accessLevel, 
          voiceSpeed: speed ?? voiceSpeed, 
          voicePitch: pitch ?? voicePitch
      });
      await saveGeneralInstructions(generalInstructions);
  };

  const handleStartSession = () => {
      if (!apiKey) {
          alert("API Key is missing. Please add your Google Gemini API Key in the Settings menu.");
          setActiveSidePanel('SETTINGS');
          return;
      }
      setLayoutMode('CHAT');
      setHasGreeted(false);
      connect();
  };

  const toggleCamera = async () => {
      if (isCameraOn && videoSource === 'camera') {
          setIsCameraOn(false);
          if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      } else {
          setVideoSource('camera');
          // Removed auto-switch to HYBRID/VIDEO here to respect manual layout control, 
          // or we can keep it but default to HYBRID if in CHAT
          if (layoutMode === 'CHAT') setLayoutMode('HYBRID');
          
          try {
              const stream = await navigator.mediaDevices.getUserMedia({ video: true });
              if (videoRef.current) videoRef.current.srcObject = stream;
              setIsCameraOn(true);
          } catch (e) { alert("Camera denied."); }
      }
  };

  const handleMediaFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          setMediaFile(file); // Keep file for deep analysis
          const url = URL.createObjectURL(file);
          setStreamFileUrl(url);
          setVideoSource('media');
          if (layoutMode === 'CHAT') setLayoutMode('HYBRID');
          
          // Reset previous captions
          if (captionsTrackUrl) {
              URL.revokeObjectURL(captionsTrackUrl);
              setCaptionsTrackUrl(null);
          }
          setShowCaptions(false);
          
          setIsCameraOn(true);
          setTimeout(() => mediaVideoRef.current?.play(), 500);
      }
      if(mediaFileInputRef.current) mediaFileInputRef.current.value = '';
  };

  const handleUnmountMedia = () => {
      if (streamFileUrl) {
          URL.revokeObjectURL(streamFileUrl);
          setStreamFileUrl(null);
      }
      if (captionsTrackUrl) {
          URL.revokeObjectURL(captionsTrackUrl);
          setCaptionsTrackUrl(null);
      }
      setMediaFile(null);
      setVideoSource('camera');
      // Reset controls
      setIsLooping(false);
      setShowCaptions(false);
      // Ensure webcam is active if we were in video mode
      if (isCameraOn) {
          toggleCamera().then(toggleCamera); // Restart cam cycle to ensure clean state
      }
  };

  const handleGenerateCC = async () => {
      if (!mediaFile) return;
      if (!apiKey) { alert("API Key required for Video Analysis"); return; }
      
      setIsGeneratingCC(true);
      setLogs(prev => [...prev, { 
          id: crypto.randomUUID(), 
          type: 'system', 
          text: `[CAPTIONING] Generating WebVTT subtitles via Gemini 3 Pro...`, 
          timestamp: Date.now() 
      }]);

      try {
          const vttContent = await MultiAgentService.generateVideoCaptions(apiKey, mediaFile);
          const blob = new Blob([vttContent], { type: 'text/vtt' });
          const url = URL.createObjectURL(blob);
          
          setCaptionsTrackUrl(url);
          setShowCaptions(true); // Auto-enable on success
          
          setLogs(prev => [...prev, { 
              id: crypto.randomUUID(), 
              type: 'system', 
              text: `[CAPTIONING COMPLETE] Subtitles generated and mounted.`, 
              timestamp: Date.now() 
          }]);

          // Inject transcript into Live Session so Agent can "Hear"
          if (connectionState === ConnectionState.CONNECTED) {
              const cleanTranscript = vttContent.replace(/WEBVTT/g, '').replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g, ' ').replace(/\n+/g, ' ').trim();
              sendText(`[SYSTEM: Video Transcript Loaded. I can now reference specific dialogue from the video.]\nTRANSCRIPT: ${cleanTranscript.substring(0, 5000)}...`);
          }

      } catch (e: any) {
          setLogs(prev => [...prev, { 
              id: crypto.randomUUID(), 
              type: 'system', 
              text: `[CAPTIONING ERROR]: ${e.message}`, 
              timestamp: Date.now() 
          }]);
      } finally {
          setIsGeneratingCC(false);
      }
  };

  const handleDeepAnalyze = async () => {
      if (!mediaFile) return;
      if (!apiKey) { alert("API Key required for Video Analysis"); return; }
      
      // Visual feedback
      setLogs(prev => [...prev, { 
          id: crypto.randomUUID(), 
          type: 'system', 
          text: `[VIDEO BRIDGE] Uploading "${mediaFile.name}" to Gemini 3 Pro for deep analysis...`, 
          timestamp: Date.now() 
      }]);

      try {
          // Trigger Analysis via MultiAgentService
          const result = await MultiAgentService.analyzeVideo(apiKey, mediaFile);
          
          setLogs(prev => [...prev, { 
              id: crypto.randomUUID(), 
              type: 'model', 
              text: `[VIDEO ANALYSIS]: ${result}`, 
              timestamp: Date.now() 
          }]);
          
          // Inform Live Agent via Context Injection (text message)
          if (connectionState === ConnectionState.CONNECTED) {
              sendText(`[SYSTEM: I have analyzed the video "${mediaFile.name}". Result: ${result}]`);
          }
          
      } catch (e: any) {
          setLogs(prev => [...prev, { 
              id: crypto.randomUUID(), 
              type: 'system', 
              text: `[ANALYSIS ERROR]: ${e.message}`, 
              timestamp: Date.now() 
          }]);
      }
  };

  const handleSendText = async () => {
    if (!inputText.trim()) return;
    const text = inputText;
    setInputText('');

    setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'user', text: text, timestamp: Date.now() }]);
    setLogs(prev => [...prev, {
        id: crypto.randomUUID(),
        type: 'system',
        text: `[ARCHIVAX LOG] User sent a text message: "${text}".`,
        timestamp: Date.now()
    }]);

    if (connectionState === ConnectionState.CONNECTED) {
        const injectionPrompt = `[SYSTEM NOTE: User sent a text message during live speech. Continue your response while acknowledging this new text input and incorporate it into the conversation.]\n\nUSER MESSAGE: "${text}"`;
        sendText(injectionPrompt);
    }
  };

  const handlePaperclipClick = () => {
      paperclipInputRef.current?.click();
  };

  const handlePaperclipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      
      // Determine Type
      let type: MediaAsset['type'] = 'text'; 
      if (file.type.startsWith('image/')) type = 'image';
      else if (file.type.startsWith('video/')) type = 'video';
      else if (file.type.startsWith('audio/')) type = 'audio';
      else if (file.type.includes('pdf')) type = 'pdf';

      const reader = new FileReader();
      
      reader.onload = async (evt) => {
          const res = evt.target?.result as string;
          let data = res;
          
          // Clean Base64 for media types
          if ((type !== 'text') && res.includes('base64,')) {
              data = res.split(',')[1];
          }

          const idPrefix = type === 'image' ? 'IMG' : (type === 'video' ? 'VID' : (type === 'audio' ? 'AUD' : (type === 'pdf' ? 'PDF' : 'DOC')));
          const asset: MediaAsset = { 
              id: NumMarkX_GenerateID(idPrefix), 
              type, 
              data, 
              prompt: file.name, 
              agentId: 'USER', 
              timestamp: Date.now(), 
              tags: ['CHAT_UPLOAD'] 
          };
          
          await saveMediaAsset(asset);

          // Build log message based on type
          let logText = `[Attached ${type.toUpperCase()}: ${file.name}]`;
          if (type === 'video' || type === 'audio') {
              logText += `\n(Saved to Media Gallery)`;
          }

          setLogs(prev => [...prev, { 
              id: crypto.randomUUID(), 
              type: 'user', 
              text: logText,
              timestamp: Date.now(), 
              attachment: data, 
              attachmentType: type 
          }]);
          
          setLogs(prev => [...prev, {
              id: crypto.randomUUID(),
              type: 'system',
              text: `[ARCHIVAX LOG] User sent a ${type} file: "${file.name}".`,
              timestamp: Date.now()
          }]);

          // Live Session Interactions
          if (connectionState === ConnectionState.CONNECTED) {
              if (type === 'image') {
                  sendRealtimeInput({ media: { mimeType: file.type, data } });
                  sendText(`[SYSTEM NOTE: User uploaded an image named "${file.name}" during live speech. Acknowledge the image and incorporate it into your response.]`);
              } else if (type === 'text') {
                  const agentHandle = AGENTS.find(a => a.id === currentAgentId)?.handle || 'system';
                  IngestionService.ingestText(data, file.name, agentHandle, apiKey);
                  sendText(`[SYSTEM NOTE: User uploaded a text file named "${file.name}" during live speech. Acknowledge receipt and incorporate its contents.]\n\nFILE PREVIEW:\n${data.substring(0, 3000)}...`);
              } else if (type === 'video' || type === 'audio') {
                  sendText(`[SYSTEM NOTE: User uploaded a ${type} file named "${file.name}" during live speech. Acknowledge receipt and note it has been saved to the Media Library.]`);
              }
          }
      };

      if (type === 'text') reader.readAsText(file);
      else reader.readAsDataURL(file);
      
      if(paperclipInputRef.current) paperclipInputRef.current.value = '';
  };

  const handleLoadPrompt = (content: string) => {
    setInputText(content);
    mainInputRef.current?.focus();
  };

  // Styles
  const visualizerStyle: React.CSSProperties = {
      flex: (layoutMode === 'HYBRID' || layoutMode === 'VIDEO') ? '1 1 0' : '0 0 auto',
      height: layoutMode === 'CHAT' ? '0px' : 'auto',
      display: layoutMode === 'CHAT' ? 'none' : 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
      transition: 'flex 0.3s ease',
      boxShadow: isThinking ? '0 0 50px rgba(255, 165, 0, 0.5)' : 'none',
      borderColor: isThinking ? '#f59e0b' : '#333'
  };

  const renderTriggerBtn = (panelId: string, icon: React.ReactNode, title: string) => (
      <button onClick={() => setActiveSidePanel(panelId)} className={`btn btn-secondary btn-icon ${activeSidePanel === panelId ? 'active' : ''}`} title={title} style={activeSidePanel === panelId ? {borderColor: '#facc15', color: '#facc15'} : {}}>
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
                <select value={currentAgentId} onChange={(e) => handleAgentChange(e.target.value)} className="agent-selector" title="Select Active Agent Persona">
                    {AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.handle.toUpperCase()}</option>)}
                </select>
            ) : ( <span className="status-indicator" style={{ color: '#38bdf8', borderColor: '#38bdf8' }}>COMMS HUB</span> )}
        </div>
        <div className="flex-group">
            <div className={`status-indicator ${connectionState.toLowerCase()}`}>{connectionState}</div>
            <button onClick={() => setIsGraphVisualizerOpen(prev => !prev)} className={`btn btn-secondary btn-icon ${isGraphVisualizerOpen ? 'active' : ''}`} title="Neural Lattice Visualizer" style={isGraphVisualizerOpen ? {borderColor: '#38bdf8', color: '#38bdf8'} : {}}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
            </button>
            <button onClick={() => setIsHolodeckOpen(prev => !prev)} className={`btn btn-secondary btn-icon ${isHolodeckOpen ? 'active' : ''}`} title="Toggle Holodeck (Shared Visual Canvas)" style={isHolodeckOpen ? {borderColor: '#38bdf8', color: '#38bdf8'} : {}}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
            </button>
            {renderTriggerBtn('TOOLS', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>, "Tool Manager")}
            {renderTriggerBtn('VOICE', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>, "Voice Commands")}
            {renderTriggerBtn('FOCUS', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>, "Room Focus")}
            {renderTriggerBtn('MEDIA', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>, "Media Gallery")}
            {renderTriggerBtn('MCP', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>, "MCP Tools")}
            <button onClick={() => setActiveSidePanel('KNOWLEDGE')} className={`btn btn-secondary btn-icon ${activeSidePanel === 'KNOWLEDGE' ? 'active' : ''}`} title={`Knowledge Base (${vectorCount} vectors)`} style={{position: 'relative', ...(activeSidePanel === 'KNOWLEDGE' ? {borderColor: '#facc15', color: '#facc15'} : {})}}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
                {vectorCount > 0 && (
                    <span style={{ position: 'absolute', top: '2px', right: '2px', background: '#f87171', color: 'white', fontSize: '0.6rem', padding: '0px 4px', borderRadius: '50%', border: '1px solid #0a0a0a' }}>
                        {vectorCount > 99 ? '99+' : vectorCount}
                    </span>
                )}
            </button>
            {renderTriggerBtn('PROMPTS', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>, "Prompt Library")}
            {renderTriggerBtn('HISTORY', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>, "Chat History")}
            {renderTriggerBtn('SETTINGS', <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>, "Settings")}
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="main-viewport">
        {/* GRAPH VISUALIZER OVERLAY */}
        {isGraphVisualizerOpen && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 40, background: '#050505' }}>
                <GraphVisualizer currentAgentId={currentAgentId} />
                <button 
                    onClick={() => setIsGraphVisualizerOpen(false)} 
                    className="btn btn-danger"
                    style={{ position: 'absolute', top: '1rem', right: '1rem', zIndex: 41 }}
                    title="Close Visualizer"
                >
                    CLOSE
                </button>
            </div>
        )}

        {/* SIDE PANELS */}
        {activeSidePanel === 'TOOLS' && <ToolManager isOpen={true} onClose={()=>setActiveSidePanel(null)} allTools={allTools} enabledToolIds={enabledToolIds} setEnabledToolIds={setEnabledToolIds} currentAgent={currentAgent} currentAccessLevel={accessLevel} />}
        {activeSidePanel === 'VOICE' && <VoiceCommandList isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} />}
        {activeSidePanel === 'FOCUS' && <RoomFocusConfig isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} />}
        {activeSidePanel === 'MEDIA' && <MediaGallery isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} currentAgentId={currentAgentId} />}
        {activeSidePanel === 'MCP' && <McpManager isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} />}
        {activeSidePanel === 'KNOWLEDGE' && <KnowledgeManager isOpen={true} onClose={()=>setActiveSidePanel(null)} onUpdate={refreshVectorCount} currentAgentId={currentAgentId} />}
        {activeSidePanel === 'PROMPTS' && <PromptManager isOpen={true} onClose={()=>setActiveSidePanel(null)} currentAgentId={currentAgentId} onLoadPrompt={handleLoadPrompt} />}
        {activeSidePanel === 'HISTORY' && <ChatHistoryManager isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} currentLogs={logs} onLoadSession={setLogs} currentAgentId={currentAgentId} onUpdateKnowledge={refreshVectorCount} />}
        {activeSidePanel === 'SETTINGS' && <SettingsManager isOpen={true} onClose={()=>setActiveSidePanel(null)} modelConfig={modelConfig} setModelConfig={setModelConfig} disabled={connectionState === ConnectionState.CONNECTED} generalInstruction={generalInstructions} setGeneralInstruction={setGeneralInstructions} agentInstruction={agentInstructions} setAgentInstruction={setAgentInstructions} agentName={currentAgent?.handle || 'Unknown'} agentId={currentAgentId} agentAccessLevel={accessLevel} selectedVoice={selectedVoice} onVoiceChange={setSelectedVoice} onSave={handleSettingsSave} apiKey={apiKey} setApiKey={setApiKey} hfToken={hfToken} setHfToken={setHfToken} voiceReference={voiceRef} voiceSpeed={voiceSpeed} voicePitch={voicePitch} />}

        <MediaPlayer audioUrl={storyAudioUrl} title="Narrative Playback" onClose={() => setStoryAudioUrl(null)} interruptSignal={interruptSignal} />

        {currentView === 'COUNCIL' ? (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <MultiAgentConsole onExit={() => setCurrentView('ORCHESTRATOR')} />
                <Holodeck isOpen={isHolodeckOpen} refreshTrigger={holodeckRefresh} />
            </div>
        ) : currentView === 'LORE_HARNESS' ? (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <LorepackHarness />
            </div>
        ) : (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* ORCHESTRATOR LEFT PANE */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={visualizerStyle}>
                        <div className="panel-overlay top-left">
                            <span className="overlay-label">
                                VISUALIZER // {selectedVoice.toUpperCase()} // {isThinking ? 'THINKING...' : (isVideoActive ? (videoSource === 'media' ? 'MEDIA STREAM' : 'LIVE CAM') : 'OFFLINE')}
                            </span>
                        </div>
                        
                        {isThinking && (
                            <div className="thinking-indicator" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#f59e0b', fontSize: '0.8rem', letterSpacing: '2px', fontWeight: 'bold', zIndex: 10, textShadow: '0 0 10px rgba(245, 158, 11, 0.8)', background: 'rgba(0,0,0,0.6)', padding: '0.5rem 1rem', borderRadius: '4px', border: '1px solid #f59e0b' }}>
                                ACCESSING NEURAL LATTICE...
                            </div>
                        )}

                        <canvas ref={canvasRef} className="hidden" />
                        
                        {showVideoInterface ? (
                            <div className="screening-room">
                                {videoSource === 'camera' && isCameraOn ? (
                                    <>
                                        <video 
                                            ref={videoRef} 
                                            autoPlay 
                                            playsInline 
                                            muted 
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                        />
                                        <div className="screening-overlay">
                                            {logs.slice(-3).map(log => (
                                                <div key={log.id} className={`screening-log ${log.type}`}>
                                                    <span style={{fontWeight:'bold', marginRight:'0.5rem'}}>{log.type.toUpperCase()}:</span>
                                                    {log.text}
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                ) : streamFileUrl ? (
                                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                                        <video 
                                            ref={mediaVideoRef} 
                                            src={streamFileUrl} 
                                            autoPlay 
                                            playsInline 
                                            controls 
                                            loop={isLooping}
                                            style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                                        >
                                            {captionsTrackUrl && <track kind="captions" src={captionsTrackUrl} srcLang="en" label="AI Generated" default />}
                                        </video>
                                        
                                        {/* VIDEO CONTROLS OVERLAY (Loop / CC / Eject) */}
                                        <div style={{ position: 'absolute', top: '20px', right: '20px', display: 'flex', gap: '0.5rem', zIndex: 25, flexDirection: 'column' }}>
                                             <div style={{display:'flex', gap:'0.5rem', justifyContent: 'flex-end'}}>
                                                <button 
                                                    onClick={handleDeepAnalyze}
                                                    className="btn btn-xs btn-accent"
                                                    style={{ fontWeight: 'bold', minWidth: '3rem', borderColor: '#a78bfa', color: '#a78bfa' }}
                                                    title="Deep Analyze with Gemini 3 Pro"
                                                >
                                                    👁 ANALYZE
                                                </button>
                                                <button 
                                                    onClick={handleGenerateCC}
                                                    className={`btn btn-xs ${captionsTrackUrl ? 'active-green' : 'btn-accent'}`}
                                                    style={{ fontWeight: 'bold', minWidth: '3rem', borderColor: captionsTrackUrl ? '#4ade80' : '#facc15', color: captionsTrackUrl ? '#4ade80' : '#facc15' }}
                                                    title="Generate AI Closed Captions (WebVTT)"
                                                    disabled={isGeneratingCC}
                                                >
                                                    {isGeneratingCC ? 'GENERATING...' : (captionsTrackUrl ? '✓ CC READY' : '✨ AI CAPTIONS')}
                                                </button>
                                             </div>
                                             
                                             <div style={{display:'flex', gap:'0.5rem', justifyContent: 'flex-end'}}>
                                                <button 
                                                    onClick={handleUnmountMedia}
                                                    className="btn btn-xs btn-danger"
                                                    style={{ fontWeight: 'bold', minWidth: '3rem' }}
                                                    title="Unmount / Eject Video"
                                                >
                                                    ⏏ EJECT
                                                </button>
                                                <button 
                                                    onClick={() => setIsLooping(!isLooping)}
                                                    className={`btn btn-xs ${isLooping ? 'active-green' : 'btn-secondary'}`}
                                                    style={{ fontWeight: 'bold', minWidth: '3rem' }}
                                                    title="Toggle Video Loop"
                                                >
                                                    {isLooping ? 'LOOP ON' : 'LOOP'}
                                                </button>
                                                <button 
                                                    onClick={() => setShowCaptions(!showCaptions)}
                                                    className={`btn btn-xs ${showCaptions ? 'active-green' : 'btn-secondary'}`}
                                                    style={{ fontWeight: 'bold', minWidth: '3rem' }}
                                                    title="Toggle Native Video Captions (if available)"
                                                >
                                                    CC
                                                </button>
                                             </div>
                                        </div>

                                        <div className="screening-overlay">
                                            {logs.slice(-3).map(log => (
                                                <div key={log.id} className={`screening-log ${log.type}`}>
                                                    <span style={{fontWeight:'bold', marginRight:'0.5rem'}}>{log.type.toUpperCase()}:</span>
                                                    {log.text}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="screening-placeholder" onClick={() => mediaFileInputRef.current?.click()} title="Click to Select Movie File">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{marginBottom: '1rem'}}>
                                            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                                            <line x1="7" y1="2" x2="7" y2="22"></line>
                                            <line x1="17" y1="2" x2="17" y2="22"></line>
                                            <line x1="2" y1="12" x2="22" y2="12"></line>
                                            <line x1="2" y1="7" x2="7" y2="7"></line>
                                            <line x1="2" y1="17" x2="7" y2="17"></line>
                                            <line x1="17" y1="17" x2="22" y2="17"></line>
                                            <line x1="17" y1="7" x2="22" y2="7"></line>
                                        </svg>
                                        <div style={{fontSize:'1.2rem', fontWeight:'bold', letterSpacing:'2px', color:'#444'}}>LOAD DAILIES</div>
                                        <div style={{fontSize:'0.8rem', color:'#666'}}>CLICK TO OPEN FILE PICKER</div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ width: '100%', height: '100%', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Visualizer analyser={analyser} isActive={connectionState === ConnectionState.CONNECTED} />
                            </div>
                        )}

                        {/* WEBCAM PREVIEW - HIDDEN IF MAIN INTERFACE SHOWS VIDEO */}
                        <div style={{ position: 'absolute', bottom: '10px', right: '10px', width: '160px', height: '120px', background: '#000', border: '1px solid #4ade80', display: (isCameraOn && videoSource === 'camera' && !showVideoInterface) ? 'block' : 'none', zIndex: 30, boxShadow: '0 0 10px rgba(0,0,0,0.5)' }}>
                            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                    </div>

                    <div style={layoutMode === 'CHAT' || layoutMode === 'HYBRID' ? { flex: '1 1 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { display: 'none' }}>
                        <div className={`logs-container ${logs.length === 1 && logs[0].type === 'system' ? 'centered-single' : ''}`}>
                            {logs.length === 0 && <div className="empty-state"><p>SYSTEM READY. PRE-FLIGHT CHECKS GREEN.</p><p>INITIALIZE CONNECTION TO BEGIN.</p></div>}
                            {logs.map(log => (
                                <div key={log.id} className={`log-entry ${log.type}`}>
                                    <div style={{display:'flex', justifyContent:'space-between'}}>
                                        <span className="log-sender">{log.type.toUpperCase()}</span>
                                        <span className="log-timestamp">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                    </div>
                                    {log.attachment && (
                                        <div style={{ margin: '0.5rem 0', borderRadius: '4px', overflow: 'hidden', border: '1px solid #333', maxWidth: '300px' }}>
                                            {log.attachmentType === 'image' ? <img src={`data:image/jpeg;base64,${log.attachment}`} style={{ width: '100%', display: 'block' }} /> : 
                                             log.attachmentType === 'video' ? <video controls src={`data:video/mp4;base64,${log.attachment}`} style={{ width: '100%', display: 'block' }} /> :
                                             <div style={{ padding: '1rem', fontSize: '0.8rem', background: '#111', color: '#eee' }}>File Attached</div>}
                                        </div>
                                    )}
                                    <span className="log-text">{log.text}</span>
                                    {log.isStreaming && <span className="animate-pulse">_</span>}
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </div>
                    </div>
                </div>
                <Holodeck isOpen={isHolodeckOpen} refreshTrigger={holodeckRefresh} />
            </div>
        )}
      </main>

      {/* FOOTER - COMMAND DECK */}
      <footer className={`command-deck ${currentView === 'COUNCIL' || currentView === 'LORE_HARNESS' ? 'hidden' : ''}`}>
          <div className="tray-controls">
              <div className="flex-group">
                  {/* MIC */}
                  <button onClick={() => setIsMicOn(!isMicOn)} className={`btn btn-icon ${isMicOn ? 'active-green' : 'btn-danger'}`} title={isMicOn ? "Mute Microphone" : "Unmute Microphone"}>
                      {isMicOn ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>}
                  </button>
                  {/* CAMERA */}
                  <button onClick={toggleCamera} className={`btn btn-icon ${isCameraOn && videoSource === 'camera' ? 'active-green' : ''}`} title="Toggle Webcam Feed">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                  </button>
                  {/* MOVIE CAMERA (MEDIA STREAM) */}
                  <button onClick={() => mediaFileInputRef.current?.click()} className={`btn btn-icon ${isCameraOn && videoSource === 'media' ? 'active-green' : ''}`} title="Stream Video File to Agent">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>
                  </button>
                  {/* DOLPHIN INDICATOR */}
                  <button
                    className={`btn btn-icon ${modelMode === 'EXT' ? 'active-cyan' : ''}`}
                    title={`Sovereign Model Indicator (Dolphin) - Active when EXT mode is selected.`}
                    disabled
                  >
                    🐬
                  </button>
                  {/* Hidden Input for Movie Camera */}
                  <input type="file" accept="video/*" ref={mediaFileInputRef} className="hidden" onChange={handleMediaFileSelect} />
              </div>
              
              <div className="flex-group">
                  <button onClick={() => setCurrentView('COUNCIL')} className="btn btn-xs" title="Open Multi-Agent Council Interface">COUNCIL</button>
                  <button onClick={() => setIsTerminalOpen(!isTerminalOpen)} className="btn btn-xs" title="Open Terminal / Shell">TERM (~)</button>
              </div>

              <div className="mode-selector">
                  {['STD', 'DEEP', 'IMG', 'EXT'].map(m => ( 
                      <button 
                          key={m} 
                          onClick={() => setModelMode(m as ModelMode)} 
                          className={modelMode === m ? `active ${m.toLowerCase()}` : ''}
                          title={m === 'STD' ? 'Standard Mode (Gemini 2.5)' : m === 'DEEP' ? 'Deep Reasoning Mode (Gemini 3 Pro)' : m === 'IMG' ? 'Image Generation Mode' : 'External Tools Mode'}
                      >
                          {m}
                      </button> 
                  ))}
              </div>

              <div className="flex-group">
                  <button onClick={() => setLayoutMode('VIDEO')} className={`btn btn-xs ${layoutMode === 'VIDEO' ? 'active' : ''}`} title="Full Screen Video Layout">VIDEO</button>
                  <button onClick={() => setLayoutMode('HYBRID')} className={`btn btn-xs ${layoutMode === 'HYBRID' ? 'active' : ''}`} title="Split View (Visual + Chat)">HYBRID</button>
                  <button onClick={() => setLayoutMode('CHAT')} className={`btn btn-xs ${layoutMode === 'CHAT' ? 'active' : ''}`} title="Chat Only Layout">CHAT</button>
              </div>
          </div>
          <div className="input-bar">
              <input type="file" accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json,.js,.ts,.tsx" ref={paperclipInputRef} className="hidden" onChange={handlePaperclipUpload} />
              <button onClick={handlePaperclipClick} className="btn btn-icon btn-lg" style={{ marginRight: '0.5rem' }} title="Insert files (text, images, audio, video) into your prompt">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
              </button>
              <input ref={mainInputRef} type="text" className="main-input unified-input" placeholder="Type message..." value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendText()} />
              {connectionState === ConnectionState.CONNECTED ? <button onClick={disconnect} className="btn btn-danger btn-lg" title="Disconnect Session">STOP</button> : <button onClick={handleStartSession} className="btn btn-primary btn-lg" disabled={connectionState === ConnectionState.CONNECTING} title="Connect Live Session">{connectionState === ConnectionState.CONNECTING ? '...' : 'START'}</button>}
              <button onClick={handleSendText} className="btn btn-secondary btn-lg" title="Send Message">SEND</button>
          </div>
      </footer>

      <Terminal isOpen={isTerminalOpen} onClose={() => setIsTerminalOpen(false)} onSwitchAgent={handleAgentChange} currentAgentHandle={currentAgent?.handle || 'guest'} />
    </div>
  );
};

export default App;
