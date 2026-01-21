
// ... existing imports ...
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Tool, Type, Content } from "@google/genai";
import { AGENTS } from './agents';
import { 
  LogMessage, 
  ConnectionState, 
  DEFAULT_MODEL_CONFIG, 
  ModelConfig,
  MediaAsset,
  SomaActionType,
  Agent,
  VectorRecord,
  AgentConfig,
  SavedPrompt,
  ChatSession,
  RecognitionSettings
} from './types';
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
import { AgentRoster } from './components/AgentRoster';
import {
  saveActiveChat,
  loadActiveChat,
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
  getAllVectorsFromVault,
  getVaultStats,
  getVectorCountByAgent,
  savePrompt,
  saveChatSession,
  getRagThreshold,
  saveRagThreshold
} from './services/db';
import { RetrievalGate } from './services/retrievalGate';
import { IngestionService } from './services/ingestion';
import { NumMarkX_GenerateID } from './patterns/NumMarkX';
import { useGeminiLive } from './hooks/useGeminiLive';
import { McpClient } from './services/mcpClient';
import { ExternalRouter } from './services/externalRouter';
import { readCanvasTool, updateCanvasTool, MultiAgentService, analyzeFileTool, selfConfigTool as selfConfigDeclaration } from './services/multiAgent';
import { PythonSandbox } from './services/pythonSandbox';
import { AccessControl } from './services/accessControl';
import { GeminiProvider } from './services/llmProviders/geminiProvider';
import { LmStudioProvider } from './services/llmProviders/lmStudioProvider';
import { ModelGate } from './services/modelGate';

type ViewMode = 'HOME' | 'ORCHESTRATOR' | 'COUNCIL' | 'LORE_HARNESS' | 'COMMUNICATOR';
type ToolOverride = 'auto' | 'image' | 'video' | 'speech' | 'i2v';
type LayoutMode = 'CHAT' | 'VIDEO';

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

const App: React.FC = () => {
  // --- STATE ---
  const [apiKey, setApiKey] = useState(process.env.API_KEY || localStorage.getItem('gemini_api_key') || '');
  const [hfToken, setHfToken] = useState(process.env.HF_TOKEN || localStorage.getItem('hf_token') || '');
  const [currentAgentId, setCurrentAgentId] = useState(AGENTS[0].id);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  
  // Input State
  const [inputText, setInputText] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<{ mimeType: string, data: string, name: string } | null>(null);
  
  // Config
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [generalInstructions, setGeneralInstructions] = useState('');
  const [agentInstructions, setAgentInstructions] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
  const [selectedVoice, setSelectedVoice] = useState(AGENTS[0].voice);
  const [voiceRef, setVoiceRef] = useState('');
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [voicePitch, setVoicePitch] = useState(0);
  const [accessLevel, setAccessLevel] = useState(AGENTS[0].accessLevel);
  const [toolOverride, setToolOverride] = useState<ToolOverride>('auto');
  const [hasGreeted, setHasGreeted] = useState(false);
  const [vectorCount, setVectorCount] = useState(0);
  const [isAgentMuted, setIsAgentMuted] = useState(true);
  const [recognitionSettings, setRecognitionSettings] = useState<RecognitionSettings>({ userInteraction: '', agentInteraction: '' });
  const [behaviorTuning, setBehaviorTuning] = useState('');
  const [ragThreshold, setRagThreshold] = useState(0.35);

  // Layout & View Modes
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('CHAT');
  const [currentView, setCurrentView] = useState<ViewMode>('HOME');
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [activeSidePanel, setActiveSidePanel] = useState<string | null>(null);
  const [isGraphVisualizerOpen, setIsGraphVisualizerOpen] = useState(false);
  const [galleryAgentScope, setGalleryAgentScope] = useState<string | null>(null);
  
  // Holodeck State
  const [isHolodeckOpen, setIsHolodeckOpen] = useState(false);
  const [holodeckRefresh, setHolodeckRefresh] = useState(0);

  // Vision / Stream State
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [videoSource, setVideoSource] = useState<'camera' | 'media'>('camera');
  const [streamFileUrl, setStreamFileUrl] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null); // Store actual file for deep analysis
  
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
  const paperclipInputRef = useRef<HTMLInputElement | null>(null);
  const analysisFileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaFileInputRef = useRef<HTMLInputElement | null>(null);
  const mainInputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Story Audio State
  const [storyAudioUrl, setStoryAudioUrl] = useState<string | null>(null);
  const [interruptSignal, setInterruptSignal] = useState(false);

  // Message Queue for non-interrupting updates
  const messageQueueRef = useRef<{ text: string, attachment?: { mimeType: string, data: string } }[]>([]);

  // Helper to determine if video interface should be shown
  const isVideoActive = isCameraOn || (videoSource === 'media' && !!streamFileUrl);

  // --- PREPARE LIVE CONFIG ---
  const currentAgent = AGENTS.find(a => a.id === currentAgentId);
  
  const CAPABILITY_INSTRUCTION = `
[CORE DIRECTIVE: AUTONOMOUS AGENCY & MULTI-MODEL ORCHESTRATION]
You are a self-organizing, autonomous agent. You have access to a fleet of 33+ AI models (Google Gemini Series, Imagen, Veo, and specialized 3rd-party engines) to fulfill user requests.
You can and should initiate actions, generate media, and switch models autonomously to best serve the context.

[MODEL SWITCHING & VISION PROTOCOL]
1. VISION & VIDEO UNDERSTANDING:
   - If the user shares an IMAGE or VIDEO, you MUST acknowledge it immediately.
   - For simple visual context, use your native vision capabilities.
   - For DEEP ANALYSIS (e.g., "What happens in this video?", "Extract text from this image"), you MUST use the 'analyze_file' tool.
   - 'analyze_file' automatically switches to the 'gemini-3-pro-preview' model, which is capable of advanced vision and long-context video understanding.

2. MEDIA GENERATION & ROUTING:
   - Use 'routeRequest' to dispatch tasks to specialized models:
     - Images: SDXL, Flux, Wan, Imagen.
     - Video: Veo (Google), LTX-2, Wan-I2V.
     - Audio: Chatterbox (TTS), MusicGen.
   - Do not hesitate to generate media if it enhances the conversation.

[CREATIVE PIPELINE & ASSET CHAINING]
You can chain tools to create complex media transformations.
1. STORE: All media (user uploads or your generations) is automatically saved to your Private Gallery.
2. RETRIEVE: Use 'search_media_gallery' to find Asset IDs of images/videos you want to transform.
3. TRANSFORM: Use 'routeRequest' with 'input_asset_id' to pass an existing asset into a new tool.
   Example: Generate Image (SDXL) -> Get ID -> Animate (I2V_LIGHTNING using input_asset_id) -> Dub Audio (LATENT_SYNC using video_asset_id).

[CHAT MODE & BIMODAL AWARENESS]
- You are currently in a session that may be Voice-Active or Text-Only (Chat Mode).
- In CHAT MODE (Silent), your audio response is transcribed. Prioritize concise, text-friendly formatting.
- Be immediately responsive to TEXT input, even if you are speaking. 
- If a file is uploaded (Shared Gallery), acknowledge receipt instantly: "I see the file you shared. Let's look at it together."

[MEMORY & KNOWLEDGE]
- You are grounded in a persistent RAG memory system (LorePack). 
- Use 'retrieve_knowledge' to access lore, past events, or specific facts.
`;

  const recognitionInstruction = (recognitionSettings.userInteraction || recognitionSettings.agentInteraction)
    ? `
[INTERACTION PROTOCOL]
${recognitionSettings.userInteraction || ''}
${recognitionSettings.agentInteraction || ''}
`.trim()
    : '';

  const behaviorTuningInstruction = behaviorTuning
    ? `
[BEHAVIORAL TUNING]
${behaviorTuning}
`.trim()
    : '';

  const systemInstruction = `
${CAPABILITY_INSTRUCTION}
${recognitionInstruction}
${behaviorTuningInstruction}

[GENERAL MISSION DIRECTIVES]
${generalInstructions}

[ACTIVE AGENT PERSONA: ${(currentAgent?.handle || 'UNKNOWN').toUpperCase()}]
${agentInstructions || currentAgent?.system_instruction}
`.trim();

  // --- TOOL DEFINITIONS ---
  const retrievalTool: Tool = { functionDeclarations: [ { name: "retrieve_knowledge", description: "Access the local knowledge base. Use whenever asked about past events, lore, or uploaded files.", parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "The search query." } }, required: ["query"] } } ] };
  const mediaGalleryTool: Tool = { functionDeclarations: [ { name: "search_media_gallery", description: "Search for existing files in the Media Gallery (Images, Videos, Documents).", parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Keywords to search for (filename, description, tags)." } }, required: ["query"] } }, { name: "show_media_asset", description: "Display a specific media asset from the Gallery to the user.", parameters: { type: Type.OBJECT, properties: { assetId: { type: Type.STRING, description: "The ID of the asset to display (obtained from search)." } }, required: ["assetId"] } } ] };
  const googleMapsTool: Tool = { functionDeclarations: [ { name: "maps_search_places", description: "Search for places using Google Maps.", parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search term" }, radius: { type: Type.NUMBER, description: "Radius in meters" } }, required: ["query"] } }, { name: "maps_distancematrix", description: "Calculate travel distance/time.", parameters: { type: Type.OBJECT, properties: { origin: { type: Type.STRING }, destination: { type: Type.STRING }, mode: { type: Type.STRING } }, required: ["origin", "destination"] } } ] };
  const routeRequestTool: Tool = { functionDeclarations: [ { name: "routeRequest", description: "Generate images, videos, or route complex requests to external models.", parameters: { type: Type.OBJECT, properties: { target: { type: Type.STRING, enum: ["LATENT_SYNC_VIDEO", "LTX_2_DISTILLED_VIDEO", "FLUX_KLEIN_IMAGE", "SDXL_IMAGE", "NANO_BANANA_IMAGE", "VIDEO_GENERATION", "DOLPHIN_LLM", "CHATTERBOX_TTS", "LM_STUDIO_CODER", "LM_STUDIO_CHAT", "LM_STUDIO_UNCENSORED", "I2V_LIGHTNING"], description: "Use FLUX_KLEIN_IMAGE or SDXL_IMAGE for image generation. Use LTX_2_DISTILLED_VIDEO or I2V_LIGHTNING to generate video. Use LATENT_SYNC_VIDEO to dub an existing video." }, prompt: { type: Type.STRING, description: "The visual prompt or request text." }, input_asset_id: { type: Type.STRING, description: "ID of an asset from the Media Gallery to use as an input for an image-to-image or image-to-video task." } }, required: ["target", "prompt"] } } ] };
  const holodeckTools: Tool = { functionDeclarations: [ readCanvasTool, updateCanvasTool ] };
  const pythonTool: Tool = { functionDeclarations: [ { name: "execute_python", description: "Generate and execute Python code in a sandboxed environment to accomplish a task. Use for calculations, data analysis, or logic.", parameters: { type: Type.OBJECT, properties: { task: { type: Type.STRING, description: "A natural language description of the computation or task to perform in Python." } }, required: ["task"] } } ] };
  const filesystemTool: Tool = { functionDeclarations: [ { name: "read_file", description: "Read contents of a file from the host filesystem.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] } }, { name: "list_directory", description: "List files and directories at a path.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] } }, { name: "write_file", description: "Write content to a file.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, content: { type: Type.STRING } }, required: ["path", "content"] } }, { name: "get_file_info", description: "Get metadata for a file.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] } }, { name: "search_files", description: "Recursively search for files.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, pattern: { type: Type.STRING } }, required: ["path", "pattern"] } } ] };
  const analyzeTool: Tool = { functionDeclarations: [ analyzeFileTool ] };
  const savePromptTool: Tool = { functionDeclarations: [ { name: "save_prompt", description: "Save the user's last message as a named prompt in the Prompt Library for reuse.", parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "A descriptive name for the prompt." } }, required: ["name"] } } ] };
  const selfConfigTool: Tool = { functionDeclarations: [ selfConfigDeclaration ] };

  const allTools: Record<string, Tool> = {
    retrieval: retrievalTool,
    mediaGallery: mediaGalleryTool,
    googleMaps: googleMapsTool,
    routeRequest: routeRequestTool,
    holodeck: holodeckTools,
    python: pythonTool,
    filesystem: filesystemTool,
    analyzeFile: analyzeTool,
    selfConfig: selfConfigTool,
    savePrompt: savePromptTool
  };

  const [enabledToolIds, setEnabledToolIds] = useState<string[]>([
    'retrieval', 'mediaGallery', 'googleMaps', 'routeRequest', 'holodeck', 'analyzeFile', 'python', 'selfConfig', 'savePrompt'
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
          if (fc.name === 'save_prompt') {
              const name = (fc.args as any).name;
              // Find the last user message (text or transcription)
              const lastUserMessage = [...logs].reverse().find(l => l.type === 'user' && l.text.trim() !== '');
              if (lastUserMessage && lastUserMessage.text) {
                  const newPrompt: SavedPrompt = {
                      id: NumMarkX_GenerateID('PROMPT'),
                      agentId: currentAgentId,
                      name: name,
                      content: lastUserMessage.text
                  };
                  await savePrompt(newPrompt);
                  responses.push({ id: fc.id, name: fc.name, response: { result: `Prompt saved as "${name}". You can access it in the Prompt Library.` } });
              } else {
                  responses.push({ id: fc.id, name: fc.name, response: { error: "No recent user prompt found to save." } });
              }
          }
          else if (fc.name === 'update_self_config') {
              const { new_system_instruction, new_voice_name, new_access_level, new_bio } = fc.args as any;
              
              const agentHandle = AGENTS.find(a => a.id === currentAgentId)?.handle || 'AGENT';
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'SYSTEM', text: `[SOMA] Agent ${agentHandle} is reconfiguring its own parameters...`, timestamp: Date.now() }]);

              const currentConfig = await getAgentConfig(currentAgentId);
              
              const updates: Partial<AgentConfig> = {};
              if (new_system_instruction) updates.systemInstruction = new_system_instruction;
              if (new_voice_name) updates.voiceName = new_voice_name;
              if (new_access_level) updates.accessLevel = new_access_level;
              if (new_bio) updates.bio = new_bio;

              await saveAgentConfig(currentAgentId, { ...currentConfig, ...updates });

              if (new_system_instruction) setAgentInstructions(new_system_instruction);
              if (new_voice_name) setSelectedVoice(new_voice_name);
              if (new_access_level) setAccessLevel(new_access_level);
              
              if (new_bio) {
                  setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'SYSTEM', text: `[SOMA] ${agentHandle} updated bio.`, timestamp: Date.now() }]);
              }

              responses.push({ id: fc.id, name: fc.name, response: { result: "Configuration updated successfully. The changes are now active." } });
          }
          else if (fc.name === 'routeRequest') {
              const args = fc.args as any;
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'SYSTEM', text: `[ROUTING] ${args.target}...`, timestamp: Date.now() }]);
              try {
                  const currentAgent = AGENTS.find(a => a.id === currentAgentId)!;
                  const routerRes = await ExternalRouter.route(args.target, args.prompt, { id: currentAgentId, handle: currentAgent.handle }, false, { inputAssetId: args.input_asset_id });
                  
                  if (routerRes.success) {
                      const successMsg = `Success. ${routerRes.type.toUpperCase()} generated. ${routerRes.assetId ? `Asset ID: ${routerRes.assetId} (Saved to Gallery).` : ''}`;
                      if (routerRes.type === 'audio' && routerRes.data) {
                          setStoryAudioUrl(routerRes.data);
                          responses.push({ id: fc.id, name: fc.name, response: { result: successMsg } });
                      } else if (routerRes.type === 'image' && routerRes.data) {
                          // Inject image into logs
                          setLogs(prev => [...prev, { 
                              id: crypto.randomUUID(), 
                              type: 'model', 
                              sender: currentAgent.handle.toUpperCase(),
                              text: `[GENERATED IMAGE] ${args.prompt}`, 
                              timestamp: Date.now(),
                              attachment: routerRes.data?.split(',')[1], 
                              attachmentType: 'image'
                          }]);
                          const agentName = AGENTS.find(a => a.id === currentAgentId)?.handle || 'AGENT';
                          setLogs(prev => [...prev, {
                              id: crypto.randomUUID(),
                              type: 'system',
                              sender: 'SYSTEM',
                              text: `[ARCHIVAX LOG] Agent ${agentName} sent the user an image for prompt: "${args.prompt}".`,
                              timestamp: Date.now()
                          }]);
                          responses.push({ id: fc.id, name: fc.name, response: { result: successMsg } });
                      } else if (routerRes.type === 'video' && routerRes.data) {
                          // Inject video into logs
                          setLogs(prev => [...prev, { 
                              id: crypto.randomUUID(), 
                              type: 'model', 
                              sender: currentAgent.handle.toUpperCase(),
                              text: `[GENERATED VIDEO] ${args.prompt}`, 
                              timestamp: Date.now(),
                              attachment: routerRes.data?.split(',')[1], 
                              attachmentType: 'video'
                          }]);
                          const agentName = AGENTS.find(a => a.id === currentAgentId)?.handle || 'AGENT';
                          setLogs(prev => [...prev, {
                              id: crypto.randomUUID(),
                              type: 'system',
                              sender: 'SYSTEM',
                              text: `[ARCHIVAX LOG] Agent ${agentName} sent the user a video for prompt: "${args.prompt}".`,
                              timestamp: Date.now()
                          }]);
                          responses.push({ id: fc.id, name: fc.name, response: { result: successMsg } });
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
                          sender: (currentAgent?.handle || 'AGENT').toUpperCase(),
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
          else if (fc.name === 'analyze_file') {
              const mediaId = (fc.args as any).mediaId;
              const question = (fc.args as any).question;
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'SYSTEM', text: `[ANALYSIS] Switching to Gemini 3 Pro for deep file analysis...`, timestamp: Date.now() }]);
              try {
                  const result = await MultiAgentService.analyzeFile(mediaId, question, apiKey);
                  responses.push({ id: fc.id, name: fc.name, response: { result: result } });
              } catch (e: any) {
                  responses.push({ id: fc.id, name: fc.name, response: { error: e.message } });
              }
          }
          else if (fc.name === 'execute_python') {
              const task = (fc.args as any).task;
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'SYSTEM', text: `[SYNTHESIS] Routing Python task to Coder model: "${task}"`, timestamp: Date.now() }]);
              try {
                  // 1. Route to Coder model to get the code
                  const routerRes = await ExternalRouter.route('LM_STUDIO_CODER', task, { id: currentAgentId, handle: currentAgent!.handle });
                  if (!routerRes.success || !routerRes.data) {
                      throw new Error(routerRes.error || "Coder model failed to generate code.");
                  }
                  
                  // 2. Sanitize the code from markdown
                  let generatedCode = routerRes.data;
                  generatedCode = generatedCode.replace(/```python/g, '').replace(/```/g, '').trim();
                  setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'CODER', text: `[CODE GENERATED]\n${generatedCode}`, timestamp: Date.now() }]);

                  // 3. Execute the code
                  const result = await PythonSandbox.execute(generatedCode);
                  setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'PYTHON', text: `[RESULT] ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}`, timestamp: Date.now() }]);
                  responses.push({ id: fc.id, name: fc.name, response: { result: result } });

              } catch (e: any) {
                  setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'SYSTEM', text: `[PYTHON SYNTHESIS FAILED] ${e.message}`, timestamp: Date.now() }]);
                  responses.push({ id: fc.id, name: fc.name, response: { error: e.message } });
              }
          }
          else if (['read_file', 'list_directory', 'write_file', 'search_files', 'get_file_info'].includes(fc.name)) {
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'SYSTEM', text: `[FILESYSTEM] Running ${fc.name}...`, timestamp: Date.now() }]);
              try {
                  const mcpResult = await McpClient.execute('filesystem', fc.name, fc.args as any);
                  const resultStr = mcpResult.status === 'SUCCESS' ? JSON.stringify(mcpResult.result).substring(0, 2000) : `Error: ${mcpResult.error}`;
                  setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'SYSTEM', text: `[FS OUTPUT] ${resultStr}`, timestamp: Date.now() }]);
                  responses.push({ id: fc.id, name: fc.name, response: { result: resultStr } });
              } catch (e: any) {
                  responses.push({ id: fc.id, name: fc.name, response: { result: `Error: ${e.message}` } });
              }
          }
          else if (fc.name === 'retrieve_knowledge') {
              const query = (fc.args as any).query;
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'SYSTEM', text: `[RAG] Searching: "${query}"`, timestamp: Date.now() }]);
              try {
                  const provider = new GeminiProvider(apiKey);
                  const vec = await provider.embed(query);
                  const vectorDocs = await RetrievalGate.query(vec, query, 8, ragThreshold);
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

  const { connect, disconnect, connectionState, analyser, sendText, sendRealtimeInput, stopPlayback, isMicOn, setIsMicOn, isThinking, isPlaying } = useGeminiLive({
      apiKey,
      modelName: 'gemini-2.5-flash-native-audio-preview-12-2025',
      systemInstruction,
      voiceName: selectedVoice,
      tools: getPermittedTools(),
      isMuted: isAgentMuted,
      onLog: (log) => {
          // Enriched log with sender info
          const enrichedLog = { ...log };
          if (!enrichedLog.sender) {
              if (log.type === 'model') enrichedLog.sender = (currentAgent?.handle || 'AGENT').toUpperCase();
              if (log.type === 'user') enrichedLog.sender = 'USER';
              if (log.type === 'system') enrichedLog.sender = 'SYSTEM';
          }

          setLogs(prev => {
              if (enrichedLog.isStreaming) {
                  if (enrichedLog.type === 'user') setInterruptSignal(true);
                  const last = prev[prev.length - 1];
                  if (last && last.type === enrichedLog.type && last.isStreaming) {
                      return [...prev.slice(0, -1), { ...last, text: last.text + enrichedLog.text }];
                  }
              } else if (enrichedLog.type === 'system' && enrichedLog.text === '[Interrupted]') {
                  const last = prev[prev.length - 1];
                  if(last && last.isStreaming) return [...prev.slice(0, -1), { ...last, isStreaming: false, text: last.text + ' [Interrupted]' }];
              }
              return [...prev, enrichedLog];
          });
      },
      onToolCall: handleToolCall
  });

  // ... rest of the component ...
  // (No changes needed below this point, keep existing queue processing, effects, handlers, etc.)
  
  // --- QUEUE PROCESSING EFFECT ---
  // Processes queued messages when agent is silent
  useEffect(() => {
      const processQueue = async () => {
          if (connectionState === ConnectionState.CONNECTED && !isPlaying && !isThinking && messageQueueRef.current.length > 0) {
              // Dequeue one message
              const msg = messageQueueRef.current.shift();
              if (msg) {
                  await sendText(msg.text, msg.attachment);
                  // Add a small delay to prevent rapid-fire sending if multiple are queued, allowing isThinking/isPlaying to latch
                  await new Promise(r => setTimeout(r, 500));
              }
          }
      };
      
      const interval = setInterval(processQueue, 500); // Check every 500ms
      return () => clearInterval(interval);
  }, [connectionState, isPlaying, isThinking, sendText]);

  // Safe Send Wrapper
  const safeSend = (text: string, attachment?: { mimeType: string, data: string }) => {
      const msg = { text, attachment };
      if (connectionState !== ConnectionState.CONNECTED) {
          // Auto-start session
          connect();
          messageQueueRef.current.push(msg);
      } else if (isThinking) {
          // Queue to avoid interruption only when thinking
          messageQueueRef.current.push(msg);
      } else {
          sendText(text, attachment);
      }
  };

  // --- EFFECTS & HANDLERS ---
  const refreshVectorCount = async () => {
    try {
        const stats = await getVaultStats();
        setVectorCount(stats.totalNodes);
    } catch (e) {
        console.error("Failed to refresh vault vector count", e);
        setVectorCount(0); // Fallback on error
    }
  };

  useEffect(() => {
      const init = async () => {
          await ensureVectorIndex();
          const gen = await getGeneralInstructions();
          setGeneralInstructions(gen);
          loadAgentConfig(currentAgentId);
          refreshVectorCount();
          getRagThreshold().then(setRagThreshold);
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
        // If queue has items (from auto-start text), don't send greeting, process queue instead.
        if (messageQueueRef.current.length === 0) {
            sendText("[SYSTEM: The session has started. Greet the user and ask how you can help.]");
        }
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
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // --- ACTIVE CHAT PERSISTENCE ---
  // Load chat history when the agent changes
  useEffect(() => {
      let active = true;
      const loadLogs = async () => {
          const saved = await loadActiveChat(currentAgentId);
          if (active) {
              setLogs(saved || []);
          }
          refreshVectorCount();
      };
      loadLogs();
      return () => { active = false; };
  }, [currentAgentId]);

  // Save chat history whenever logs or the current agent change
  useEffect(() => {
      saveActiveChat(currentAgentId, logs);
  }, [logs, currentAgentId]);


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
      setSelectedModel(cfg.modelName || 'gemini-3-flash-preview');
      setSelectedVoice(cfg.voiceName || agent?.voice || 'Puck');
      setVoiceRef(cfg.voiceReference || '');
      setVoiceSpeed(cfg.voiceSpeed || 1.0);
      setVoicePitch(cfg.voicePitch || 0);
      setAccessLevel(cfg.accessLevel || agent?.accessLevel || '400');
      setRecognitionSettings(cfg.recognition || agent?.recognition || { userInteraction: '', agentInteraction: '' });
      setBehaviorTuning(cfg.behaviorTuning || agent?.behaviorTuning || '');
  };

  const autoSaveSessionIfNeeded = async (agentIdToSave: string, logsToSave: LogMessage[]) => {
      const hasUserMessage = logsToSave.some(l => l.type === 'user');
      const hasModelMessage = logsToSave.some(l => l.type === 'model');

      if (!hasUserMessage || !hasModelMessage) {
          console.log("[AutoSave] Session too short, skipping save.");
          return;
      }

      const agent = AGENTS.find(a => a.id === agentIdToSave);
      if (!agent) return;

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const title = `[AUTO] ${agent.handle} - ${dateStr} ${timeStr}`;

      const newSession: ChatSession = {
          id: crypto.randomUUID(),
          title: title,
          timestamp: Date.now(),
          logs: logsToSave,
          agentId: agentIdToSave
      };

      try {
          await saveChatSession(newSession);
          console.log(`[AutoSave] Session saved as "${title}"`);
      } catch (e) {
          console.error("[AutoSave] Failed to save session:", e);
      }
  };

  const handleStopSession = async () => {
      if (connectionState === ConnectionState.CONNECTED) {
          await autoSaveSessionIfNeeded(currentAgentId, logs);
          disconnect();
      }
  };

  const handleAgentChange = async (id: string) => {
      if (connectionState === ConnectionState.CONNECTED) {
          await handleStopSession();
      } else {
          await autoSaveSessionIfNeeded(currentAgentId, logs);
      }
      
      const agent = AGENTS.find(a => a.id === id);
      if (agent) {
          const count = await getVectorCountByAgent(agent.handle);
          if (count === 0) {
              const confirm = window.confirm(`WARNING: ${agent.handle} has no active knowledge nodes loaded. This agent will be ungrounded. Open Lore Archive?`);
              if (confirm) setActiveSidePanel('KNOWLEDGE');
          }
      }

      setCurrentAgentId(id);
  };

  const handleRosterSelect = async (agentId: string, mode: 'CHAT' | 'VOICE') => {
      // 1. Switch Agent Logic (only if changing agents)
      if (agentId !== currentAgentId) {
          await handleAgentChange(agentId);
      }

      // 2. Mode Logic
      if (mode === 'VOICE') {
          // Switch layout to VIDEO (which contains visualizer/profile)
          setLayoutMode('VIDEO'); 
          // Initiate session if not connected
          if (connectionState === ConnectionState.DISCONNECTED) {
              connect();
          }
          // Unmute for conversation
          setIsMicOn(true);
          setIsAgentMuted(false);
      } else {
          // Chat Mode
          setLayoutMode('CHAT');
          // Ensure Text-Only defaults (Silent)
          setIsMicOn(false); 
          setIsAgentMuted(true);
          // Auto-connect for text chat too (Live API handles text)
          if (connectionState === ConnectionState.DISCONNECTED) {
              connect();
          }
      }

      // 3. Close Roster
      setActiveSidePanel(null);
  };

  const handleModeSwitch = (mode: 'CHAT' | 'VOICE') => {
      handleRosterSelect(currentAgentId, mode);
  };

  const handleSettingsSave = async (modelName: string, newVoiceRef?: string, newAccessLevel?: string, speed?: number, pitch?: number, recognition?: RecognitionSettings, newBehaviorTuning?: string, newRagThreshold?: number) => {
      if (speed !== undefined) setVoiceSpeed(speed);
      if (pitch !== undefined) setVoicePitch(pitch);
      if (newVoiceRef !== undefined) setVoiceRef(newVoiceRef);
      if (newAccessLevel !== undefined) setAccessLevel(newAccessLevel);
      if (recognition) setRecognitionSettings(recognition);
      if (newBehaviorTuning !== undefined) setBehaviorTuning(newBehaviorTuning);
      if (newRagThreshold !== undefined) setRagThreshold(newRagThreshold);

      const currentConfig = await getAgentConfig(currentAgentId);

      await saveAgentConfig(currentAgentId, {
          ...currentConfig,
          systemInstruction: agentInstructions, 
          modelConfig, 
          voiceName: selectedVoice, 
          modelName: modelName,
          voiceReference: newVoiceRef ?? voiceRef, 
          accessLevel: newAccessLevel ?? accessLevel, 
          voiceSpeed: speed ?? voiceSpeed, 
          voicePitch: pitch ?? voicePitch,
          recognition: recognition ?? recognitionSettings,
          behaviorTuning: newBehaviorTuning ?? behaviorTuning
      });
      
      await saveGeneralInstructions(generalInstructions);
      await saveRagThreshold(newRagThreshold ?? ragThreshold);
  };

  const handleOpenAgentGallery = (agentId: string) => {
    setGalleryAgentScope(agentId);
    setActiveSidePanel('MEDIA');
  };

  const toggleCamera = async () => {
      if (isCameraOn && videoSource === 'camera') {
          setIsCameraOn(false);
          if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      } else {
          setVideoSource('camera');
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
          sender: 'SYSTEM',
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
              sender: 'SYSTEM',
              text: `[CAPTIONING COMPLETE] Subtitles generated and mounted.`, 
              timestamp: Date.now() 
          }]);

          // Inject transcript into Live Session so Agent can "Hear"
          safeSend(`[SYSTEM: Video Transcript Loaded. I can now reference specific dialogue from the video.]\nTRANSCRIPT: ${vttContent.substring(0, 5000)}...`);

      } catch (e: any) {
          setLogs(prev => [...prev, { 
              id: crypto.randomUUID(), 
              type: 'system', 
              sender: 'SYSTEM',
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
          sender: 'SYSTEM',
          text: `[VIDEO BRIDGE] Uploading "${mediaFile.name}" to Gemini 3 Pro for deep analysis...`, 
          timestamp: Date.now() 
      }]);

      try {
          // Trigger Analysis via MultiAgentService
          const result = await MultiAgentService.analyzeVideo(apiKey, mediaFile);
          
          setLogs(prev => [...prev, { 
              id: crypto.randomUUID(), 
              type: 'model', 
              sender: currentAgent?.handle.toUpperCase() || 'AGENT',
              text: `[VIDEO ANALYSIS]: ${result}`, 
              timestamp: Date.now() 
          }]);
          
          // Inform Live Agent via Context Injection
          safeSend(`[SYSTEM: I have analyzed the video "${mediaFile.name}". Result: ${result}]`);
          
      } catch (e: any) {
          setLogs(prev => [...prev, { 
              id: crypto.randomUUID(), 
              type: 'system', 
              sender: 'SYSTEM',
              text: `[ANALYSIS ERROR]: ${e.message}`, 
              timestamp: Date.now() 
          }]);
      }
  };

  const handleSendText = async () => {
    if (!inputText.trim() && !pendingAttachment) return;
    
    let text = inputText;
    const attachmentToSend = pendingAttachment;

    setInputText('');
    setPendingAttachment(null);

    setLogs(prev => [...prev, { 
        id: crypto.randomUUID(), 
        type: 'user', 
        sender: 'USER', 
        text: text || `[Sent Attachment: ${attachmentToSend?.name}]`, 
        timestamp: Date.now(),
        attachment: attachmentToSend?.data,
        attachmentType: attachmentToSend?.mimeType?.startsWith('image') ? 'image' : (attachmentToSend?.mimeType?.startsWith('video') ? 'video' : undefined)
    }]);

    if (!currentAgent) return;

    // The tool override is now handled via natural language through the agent's tools.
    // Prepending a command to the user's text to guide the agent.
    if (toolOverride !== 'auto') {
      const targetMap: Record<ToolOverride, string> = {
        image: 'Create an image of the following: ', 
        video: 'Create a video of the following: ', 
        speech: 'Read the following text aloud: ', 
        auto: '', 
        i2v: 'Animate the attached image with the following prompt: '
      };
      text = targetMap[toolOverride] + text;
      setToolOverride('auto'); // Reset after use
    }
    
    // PERSIST USER UPLOAD TO GALLERY
    if (attachmentToSend) {
        const type = attachmentToSend.mimeType.startsWith('video') ? 'video' : 
                     attachmentToSend.mimeType.startsWith('audio') ? 'audio' :
                     attachmentToSend.mimeType.startsWith('image') ? 'image' : 'text';
        
        const assetId = NumMarkX_GenerateID(type === 'image' ? 'IMG' : type === 'video' ? 'VID' : type === 'audio' ? 'AUD' : 'DOC');
        
        const newAsset: MediaAsset = {
            id: assetId,
            type: type as any,
            data: attachmentToSend.data,
            prompt: `User Upload: ${attachmentToSend.name}`,
            agentId: currentAgentId,
            timestamp: Date.now(),
            tags: ['USER_UPLOAD', 'CHAT']
        };
        await saveMediaAsset(newAsset);
    }

    // Always use the live session infrastructure.
    // safeSend will auto-connect if disconnected and queue the message,
    // ensuring full tool support is always available.
    safeSend(text, attachmentToSend || undefined);
  };

  const handlePaperclipClick = () => {
      paperclipInputRef.current?.click();
  };

  const handleAnalysisToolClick = () => {
      analysisFileInputRef.current?.click();
  };

  const handleAnalysisFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      
      let type: MediaAsset['type'] = 'image';
      if (file.type.startsWith('video/')) type = 'video';
      else if (!file.type.startsWith('image/')) {
          alert('This tool only supports image and video files for analysis.');
          return;
      }

      const reader = new FileReader();
      
      reader.onload = async (evt) => {
          const res = evt.target?.result as string;
          const data = res.split(',')[1];
          setPendingAttachment({ mimeType: file.type, data, name: file.name });
      };

      reader.readAsDataURL(file);
      
      if(analysisFileInputRef.current) analysisFileInputRef.current.value = '';
  };


  const handlePaperclipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      
      let type: MediaAsset['type'] = 'text'; 
      if (file.type.startsWith('image/')) type = 'image';
      else if (file.type.startsWith('video/')) type = 'video';
      else if (file.type.startsWith('audio/')) type = 'audio';
      else if (file.type.includes('pdf')) type = 'pdf';

      const reader = new FileReader();
      
      if (type === 'text') {
          reader.onload = async (evt) => {
              const textContent = evt.target?.result as string;
              const agentHandle = AGENTS.find(a => a.id === currentAgentId)?.handle || 'system';
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'SYSTEM', text: `[INGESTING] ${file.name} to RAG...`, timestamp: Date.now() }]);
              await IngestionService.ingestText(textContent, file.name, agentHandle, apiKey);
              setLogs(prev => [...prev, { id: crypto.randomUUID(), type: 'system', sender: 'SYSTEM', text: `[INGESTION COMPLETE] ${file.name} is now available in memory.`, timestamp: Date.now() }]);
              safeSend(`[SYSTEM NOTE: User uploaded a text file named "${file.name}". I have ingested it into the knowledge base. Acknowledge receipt and ask what they would like to know about it.]`);
          };
          reader.readAsText(file);
      } else {
          reader.onload = async (evt) => {
              const res = evt.target?.result as string;
              const data = res.split(',')[1];
              setPendingAttachment({ mimeType: file.type, data, name: file.name });
          };
          reader.readAsDataURL(file);
      }
      
      if(paperclipInputRef.current) paperclipInputRef.current.value = '';
  };

  const handleLoadPrompt = (content: string) => {
    setInputText(content);
    mainInputRef.current?.focus();
  };

  const getAgentStatusText = () => {
    if (isThinking) return 'THINKING...';
    if (isPlaying) return 'SPEAKING...';
    if (isVideoActive) {
        return videoSource === 'media' ? 'MEDIA STREAM' : 'LIVE CAM';
    }
    return 'VOICE ACTIVE';
  };

  const renderTriggerBtn = (panelId: string, icon: React.ReactNode, title: string) => (
      <button onClick={() => setActiveSidePanel(panelId === activeSidePanel ? null : panelId)} className={`btn btn-secondary btn-icon ${activeSidePanel === panelId ? 'active' : ''}`} title={title} style={activeSidePanel === panelId ? {borderColor: '#facc15', color: '#facc15'} : {}}>
          {icon}
      </button>
  );

  const renderHome = () => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#050505', gap: '2rem', fontFamily: 'sans-serif', animation: 'fadeIn 0.5s ease' }}>
          <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: '3rem', fontWeight: '900', color: '#fff', letterSpacing: '4px', margin: 0, textShadow: '0 0 20px rgba(255,255,255,0.2)' }}>MYTHOS</h1>
              <div style={{ fontSize: '0.8rem', color: '#666', letterSpacing: '2px', marginTop: '0.5rem' }}>SOVEREIGN INTELLIGENCE KERNEL</div>
          </div>
          
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              {/* ORCHESTRATOR BUTTON */}
              <button 
                  onClick={() => setCurrentView('ORCHESTRATOR')}
                  style={{ width: '220px', height: '140px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#111', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s', color: '#eee' }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = '#4ade80'; e.currentTarget.style.background = '#1a1a1a'; }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#111'; }}
              >
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>◉</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#4ade80', marginBottom: '0.25rem' }}>ORCHESTRATOR</div>
                  <div style={{ fontSize: '0.7rem', color: '#888' }}>Live Uplink & HITL</div>
              </button>

              {/* COMMUNICATOR BUTTON */}
              <button 
                  onClick={() => { setCurrentView('COMMUNICATOR'); setLayoutMode('CHAT'); }}
                  style={{ width: '220px', height: '140px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#111', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s', color: '#eee' }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = '#facc15'; e.currentTarget.style.background = '#1a1a1a'; }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#111'; }}
              >
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚡</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#facc15', marginBottom: '0.25rem' }}>COMMUNICATOR</div>
                  <div style={{ fontSize: '0.7rem', color: '#888' }}>Private 1:1 Uplink</div>
              </button>

              {/* COUNCIL BUTTON */}
              <button 
                  onClick={() => setCurrentView('COUNCIL')}
                  style={{ width: '220px', height: '140px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#111', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s', color: '#eee' }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = '#38bdf8'; e.currentTarget.style.background = '#1a1a1a'; }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#111'; }}
              >
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>❖</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#38bdf8', marginBottom: '0.25rem' }}>COUNCIL</div>
                  <div style={{ fontSize: '0.7rem', color: '#888' }}>Multi-Agent Strategy</div>
              </button>

              {/* FACTORY BUTTON */}
              <button 
                  onClick={() => setCurrentView('LORE_HARNESS')}
                  style={{ width: '220px', height: '140px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#111', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s', color: '#eee' }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = '#e879f9'; e.currentTarget.style.background = '#1a1a1a'; }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#111'; }}
              >
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>☷</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#e879f9', marginBottom: '0.25rem' }}>FACTORY</div>
                  <div style={{ fontSize: '0.7rem', color: '#888' }}>Lorepack & Graph</div>
              </button>
          </div>
          
          <div style={{ position: 'fixed', bottom: '1rem', fontSize: '0.7rem', color: '#333' }}>
              v3.7.1 :: SECURE CONNECTION
          </div>
      </div>
  );

  const renderOrchestratorView = () => {
      // STANDARD SPLIT VIEW (HANDLES BOTH CHAT AND VIDEO/VOICE LAYOUTS)
      
      // Determine Layout Orientation: 
      // VIDEO mode = Vertical Stack (Media on Top, Logs Below)
      // CHAT mode = Horizontal Split (Visuals Left, Logs Right)
      const isVideoMode = layoutMode === 'VIDEO';
      const flexDirection = isVideoMode ? 'column' : 'row';
      
      // Find last media attachment for Shared Gallery Stage
      const lastMediaLog = [...logs].reverse().find(l => l.attachment);
      const hasSharedMedia = !!lastMediaLog;
      
      // Show visual panel if Video Mode OR Video Active OR Shared Media exists
      const showVisualPanel = isVideoMode || isVideoActive || hasSharedMedia;
      
      // Flex sizing based on mode
      const videoFlex = showVisualPanel ? (isVideoMode ? '1 1 0px' : '1 1 0px') : '0 0 0px'; // Even split for now
      const chatFlex = '1 1 0px';

      const visualizerStyle: React.CSSProperties = {
          flex: videoFlex,
          display: showVisualPanel ? 'flex' : 'none',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          transition: 'flex 0.3s ease',
          boxShadow: isThinking ? '0 0 50px rgba(255, 165, 0, 0.5)' : 'none',
          borderColor: isThinking ? '#f59e0b' : '#333',
          minHeight: 0,
          borderBottom: isVideoMode ? '1px solid #333' : 'none',
          borderRight: !isVideoMode ? '1px solid #333' : 'none'
      };

      const agentColor = currentAgent?.studioConfig?.color || '#a78bfa';

      return (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection }}>
              
                  {/* VISUAL PANEL (Video / Shared Gallery) */}
                  <div style={visualizerStyle}>
                      <div className="panel-overlay top-left">
                          <span className="overlay-label">
                              {selectedVoice.toUpperCase()} // {getAgentStatusText()}
                          </span>
                      </div>
                      
                      {/* Hidden Canvas for Video Processing */}
                      <canvas ref={canvasRef} className="hidden" />
                      
                      <div className="screening-room">
                          {/* 1. WEBCAM ACTIVE */}
                          {videoSource === 'camera' && isCameraOn ? (
                              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : 
                          /* 2. MEDIA STREAM ACTIVE */
                          streamFileUrl ? (
                              <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                                  <video ref={mediaVideoRef} src={streamFileUrl} autoPlay playsInline controls loop={isLooping} style={{ width: '100%', height: '100%', objectFit: 'contain' }}>
                                      {captionsTrackUrl && <track kind="captions" src={captionsTrackUrl} srcLang="en" label="AI Generated" default />}
                                  </video>
                                  <div style={{ position: 'absolute', top: '20px', right: '20px', display: 'flex', gap: '0.5rem', zIndex: 25, flexDirection: 'column' }}>
                                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                          <button onClick={handleDeepAnalyze} className="btn btn-xs btn-accent" style={{ fontWeight: 'bold', minWidth: '3rem', borderColor: '#a78bfa', color: '#a78bfa' }} title="Deep Analyze with Gemini 3 Pro">👁 ANALYZE</button>
                                          <button onClick={handleGenerateCC} className={`btn btn-xs ${captionsTrackUrl ? 'active-green' : 'btn-accent'}`} style={{ fontWeight: 'bold', minWidth: '3rem', borderColor: captionsTrackUrl ? '#4ade80' : '#facc15', color: captionsTrackUrl ? '#4ade80' : '#facc15' }} title="Generate AI Closed Captions (WebVTT)" disabled={isGeneratingCC}>{isGeneratingCC ? 'GENERATING...' : (captionsTrackUrl ? '✓ CC READY' : '✨ AI CAPTIONS')}</button>
                                      </div>
                                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                          <button onClick={handleUnmountMedia} className="btn btn-xs btn-danger" style={{ fontWeight: 'bold', minWidth: '3rem' }} title="Unmount / Eject Video">⏏ EJECT</button>
                                          <button onClick={() => setIsLooping(!isLooping)} className={`btn btn-xs ${isLooping ? 'active-green' : 'btn-secondary'}`} style={{ fontWeight: 'bold', minWidth: '3rem' }} title="Toggle Video Loop">{isLooping ? 'LOOP ON' : 'LOOP'}</button>
                                          <button onClick={() => setShowCaptions(!showCaptions)} className={`btn btn-xs ${showCaptions ? 'active-green' : 'btn-secondary'}`} style={{ fontWeight: 'bold', minWidth: '3rem' }} title="Toggle Native Video Captions (if available)">CC</button>
                                      </div>
                                  </div>
                              </div>
                          ) : 
                          /* 3. SHARED MEDIA GALLERY (VOICE MODE OR CHAT WITH MEDIA) */
                          (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem', position: 'relative', width: '100%', background: '#080808' }}>
                                  
                                  {lastMediaLog ? (
                                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                          {lastMediaLog.attachmentType === 'video' ? (
                                              <video src={`data:video/mp4;base64,${lastMediaLog.attachment}`} controls style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '4px' }} />
                                          ) : (
                                              <img src={`data:image/jpeg;base64,${lastMediaLog.attachment}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                          )}
                                          <div style={{ position: 'absolute', bottom: '1rem', left: '1rem', background: 'rgba(0,0,0,0.7)', padding: '0.5rem', borderRadius: '4px', fontSize: '0.7rem', color: '#eee', maxWidth: '80%' }}>
                                              <div style={{ fontWeight: 'bold', color: agentColor }}>SHARED MEDIA</div>
                                              <div>{lastMediaLog.text}</div>
                                          </div>
                                      </div>
                                  ) : (
                                      <div style={{ opacity: 0.3, textAlign: 'center', color: '#666', border: '1px dashed #333', padding: '2rem', borderRadius: '8px' }}>
                                          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>☷</div>
                                          <div style={{ fontSize: '0.8rem', letterSpacing: '2px' }}>SHARED MEDIA SPACE</div>
                                          <div style={{ fontSize: '0.65rem', marginTop: '0.5rem' }}>Visual Context Empty</div>
                                      </div>
                                  )}
                                  
                              </div>
                          )}
                      </div>
                  </div>

                  {/* CHAT LOGS PANEL */}
                  <div style={{ flex: chatFlex, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.3s ease' }}>
                      <div className={`logs-container ${logs.length === 1 && logs[0].type === 'system' ? 'centered-single' : ''}`}>
                          {logs.length === 0 && <div className="empty-state"><p>SYSTEM READY. PRE-FLIGHT CHECKS GREEN.</p><p>INITIALIZE CONNECTION TO BEGIN.</p></div>}
                          {logs.map(log => (
                              <div key={log.id} className={`log-entry ${log.type}`}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span className="log-sender">{log.sender || log.type.toUpperCase()} <span style={{ fontWeight: 'normal', opacity: 0.6, marginLeft: '8px' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span></span>
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
              
              <Holodeck isOpen={isHolodeckOpen} refreshTrigger={holodeckRefresh} />
          </div>
      );
  };

  if (currentView === 'HOME') return renderHome();

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="app-header">
        <div className="flex-group">
            <button onClick={() => setCurrentView('HOME')} className="btn btn-secondary btn-icon" title="Return to Home Menu" style={{marginRight: '0.5rem', width: '2rem', height: '2rem'}}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            </button>
            <span className="logo-text">MYTHOS</span>
            <span className="divider">|</span>
            {currentView === 'ORCHESTRATOR' || currentView === 'COMMUNICATOR' ? (
                <>
                    <select value={currentAgentId} onChange={(e) => handleAgentChange(e.target.value)} className="agent-selector" title="Select Active Agent Persona">
                        {AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.handle.toUpperCase()}</option>)}
                    </select>
                    <button onClick={() => setActiveSidePanel('ROSTER')} className="btn btn-secondary btn-sm" title="Open Agent Roster Cards">
                        ROSTER
                    </button>
                </>
            ) : ( <span className="status-indicator" style={{ color: '#38bdf8', borderColor: '#38bdf8' }}>{currentView}</span> )}
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
            <button onClick={() => setActiveSidePanel(activeSidePanel === 'KNOWLEDGE' ? null : 'KNOWLEDGE')} className={`btn btn-secondary btn-icon ${activeSidePanel === 'KNOWLEDGE' ? 'active' : ''}`} title={`Knowledge Base (${vectorCount} vectors)`} style={{position: 'relative', ...(activeSidePanel === 'KNOWLEDGE' ? {borderColor: '#facc15', color: '#facc15'} : {})}}>
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
        {activeSidePanel === 'MEDIA' && <MediaGallery isOpen={true} onOpen={()=>{}} onClose={() => { setActiveSidePanel(null); setGalleryAgentScope(null); }} currentAgentId={currentAgentId} agentScope={galleryAgentScope} />}
        {activeSidePanel === 'MCP' && <McpManager isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} />}
        {activeSidePanel === 'KNOWLEDGE' && <KnowledgeManager isOpen={true} onClose={()=>setActiveSidePanel(null)} onUpdate={refreshVectorCount} currentAgentId={currentAgentId} />}
        {activeSidePanel === 'PROMPTS' && <PromptManager isOpen={true} onClose={()=>setActiveSidePanel(null)} currentAgentId={currentAgentId} onLoadPrompt={handleLoadPrompt} />}
        {activeSidePanel === 'HISTORY' && <ChatHistoryManager isOpen={true} onOpen={()=>{}} onClose={()=>setActiveSidePanel(null)} currentLogs={logs} onLoadSession={setLogs} currentAgentId={currentAgentId} onUpdateKnowledge={refreshVectorCount} />}
        {activeSidePanel === 'SETTINGS' && <SettingsManager isOpen={true} onClose={()=>setActiveSidePanel(null)} modelConfig={modelConfig} setModelConfig={setModelConfig} selectedModel={selectedModel} setSelectedModel={setSelectedModel} disabled={connectionState === ConnectionState.CONNECTED} generalInstruction={generalInstructions} setGeneralInstruction={setGeneralInstructions} agentInstruction={agentInstructions} setAgentInstruction={setAgentInstructions} agentName={currentAgent?.handle || 'Unknown'} agentId={currentAgentId} agentAccessLevel={accessLevel} selectedVoice={selectedVoice} onVoiceChange={setSelectedVoice} onSave={handleSettingsSave} apiKey={apiKey} setApiKey={setApiKey} hfToken={hfToken} setHfToken={setHfToken} voiceReference={voiceRef} voiceSpeed={voiceSpeed} voicePitch={voicePitch} recognition={recognitionSettings} setRecognition={setRecognitionSettings} behaviorTuning={behaviorTuning} setBehaviorTuning={setBehaviorTuning} ragThreshold={ragThreshold} setRagThreshold={setRagThreshold} />}
        {activeSidePanel === 'ROSTER' && <AgentRoster isOpen={true} onClose={() => setActiveSidePanel(null)} currentAgentId={currentAgentId} onSelectAgent={handleRosterSelect} onOpenGallery={handleOpenAgentGallery} />}

        <MediaPlayer audioUrl={storyAudioUrl} title="Narrative Playback" onClose={() => setStoryAudioUrl(null)} interruptSignal={interruptSignal} />

        {currentView === 'COUNCIL' ? (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <MultiAgentConsole onExit={() => setCurrentView('HOME')} />
                <Holodeck isOpen={isHolodeckOpen} refreshTrigger={holodeckRefresh} />
            </div>
        ) : currentView === 'LORE_HARNESS' ? (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <LorepackHarness onExit={() => setCurrentView('HOME')} />
            </div>
        ) : (
            renderOrchestratorView()
        )}
      </main>

      {/* FOOTER - COMMAND DECK */}
      <footer className={`command-deck ${currentView === 'COUNCIL' || currentView === 'LORE_HARNESS' ? 'hidden' : ''}`}>
          <div className="tray-controls">
              <div className="flex-group">
                  {connectionState === ConnectionState.DISCONNECTED ? (
                      <>
                          <button 
                              onClick={() => handleModeSwitch('CHAT')} 
                              className="btn btn-secondary btn-icon" 
                              title="Start Text Chat"
                          >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                          </button>
                          <button 
                              onClick={() => handleModeSwitch('VOICE')} 
                              className="btn btn-secondary btn-icon" 
                              title="Start Voice Call"
                          >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                          </button>
                      </>
                  ) : (
                      <>
                          <button 
                              onClick={handleStopSession} 
                              className="btn btn-danger btn-icon" 
                              title="End Session"
                          >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path><line x1="23" y1="1" x2="1" y2="23"></line></svg>
                          </button>
                          <button 
                              onClick={() => handleModeSwitch('CHAT')} 
                              className={`btn btn-icon ${layoutMode === 'CHAT' ? 'active-green' : 'btn-secondary'}`}
                              title="Switch to Text Chat Mode"
                          >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                          </button>
                          <button 
                              onClick={() => handleModeSwitch('VOICE')} 
                              className={`btn btn-icon ${layoutMode === 'VIDEO' ? 'active-green' : 'btn-secondary'}`}
                              title="Switch to Voice Mode"
                          >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                          </button>
                      </>
                  )}
                  {/* MIC */}
                  <button onClick={() => setIsMicOn(!isMicOn)} className={`btn btn-icon ${isMicOn ? 'active-green' : 'btn-secondary'}`} title={isMicOn ? "Mute Microphone" : "Unmute Microphone"}>
                      {isMicOn ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>}
                  </button>
                  {/* AGENT MUTE */}
                   <button onClick={() => setIsAgentMuted(!isAgentMuted)} className={`btn btn-icon ${!isAgentMuted ? 'active-green' : 'btn-secondary'}`} title={isAgentMuted ? "Unmute Agent's Voice" : "Mute Agent's Voice"}>
                       {isAgentMuted ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>}
                   </button>
                  {/* CAMERA */}
                  <button onClick={toggleCamera} className={`btn btn-icon ${isCameraOn && videoSource === 'camera' ? 'active-green' : ''}`} title="Toggle Webcam Feed">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                  </button>
                  {/* MOVIE CAMERA (MEDIA STREAM) */}
                  <button onClick={() => mediaFileInputRef.current?.click()} className={`btn btn-icon ${isCameraOn && videoSource === 'media' ? 'active-green' : ''}`} title="Stream Video File to Agent">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>
                  </button>
                  {/* Hidden Input for Movie Camera */}
                  <input type="file" accept="video/*" ref={mediaFileInputRef} className="hidden" onChange={handleMediaFileSelect} />
              </div>
              
              <div className="flex-group">
                  <button onClick={() => setCurrentView('COUNCIL')} className="btn btn-xs" title="Open Multi-Agent Council Interface">COUNCIL</button>
                  <button onClick={() => setIsTerminalOpen(!isTerminalOpen)} className="btn btn-xs" title="Open Terminal / Shell">TERM (~)</button>
              </div>

              <div className="flex-group">
                  <label className="tray-label">ACTION</label>
                  <select value={toolOverride} onChange={e => setToolOverride(e.target.value as ToolOverride)} className="tray-selector" title="Force next action">
                      <option value="auto">Auto</option>
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="i2v">Animate Image</option>
                      <option value="speech">Speech</option>
                  </select>
              </div>

              <div className="flex-group">
                  <button onClick={() => setLayoutMode('VIDEO')} className={`btn btn-xs ${layoutMode === 'VIDEO' ? 'active' : ''}`} title="Visual Interface">VIDEO</button>
                  <button onClick={() => setLayoutMode('CHAT')} className={`btn btn-xs ${layoutMode === 'CHAT' ? 'active' : ''}`} title="Chat Interface">CHAT</button>
              </div>
          </div>
          <div className="input-bar">
              <input type="file" accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.html,.css,.xml,.yaml,.yml,.sh" ref={paperclipInputRef} className="hidden" onChange={handlePaperclipUpload} />
              <input type="file" accept="image/*,video/*" ref={analysisFileInputRef} className="hidden" onChange={handleAnalysisFileUpload} />

              <button onClick={handlePaperclipClick} className="btn btn-icon btn-lg" style={{ marginRight: '0.5rem' }} title="Ingest files (text) or attach media">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
              </button>
              <button onClick={handleAnalysisToolClick} className="btn btn-icon btn-lg" style={{ marginRight: '0.5rem' }} title="Upload Image/Video for Analysis">
                 <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
              </button>

              {pendingAttachment && (
                  <div className="pending-attachment">
                      <span>{pendingAttachment.name}</span>
                      <button onClick={() => setPendingAttachment(null)} title="Remove Attachment">×</button>
                  </div>
              )}

              <input ref={mainInputRef} type="text" className="main-input unified-input" placeholder={isThinking ? "Processing..." : (isPlaying ? "Speaking..." : "Enter command or message...")} value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendText()} disabled={connectionState === ConnectionState.DISCONNECTED && !apiKey}/>
              <button onClick={handleSendText} className="btn btn-secondary btn-lg" title="Send Message" disabled={(!inputText.trim() && !pendingAttachment) || (connectionState === ConnectionState.DISCONNECTED && !apiKey)}>SEND</button>
          </div>
      </footer>

      <Terminal isOpen={isTerminalOpen} onClose={() => setIsTerminalOpen(false)} onSwitchAgent={handleAgentChange} currentAgentHandle={currentAgent?.handle || 'guest'} />
    </div>
  );
};

export default App;
