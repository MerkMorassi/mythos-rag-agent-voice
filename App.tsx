
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
  findDocumentBySigil, 
  saveActiveChat, 
  loadActiveChat,
  saveChatSession,
  getGeneralInstructions,
  saveGeneralInstructions,
  getAgentConfig,
  saveAgentConfig,
  addDocument,
  getDocumentCountByAgentId,
  saveSavedPrompt
} from './services/db';
import { RetrievalGate } from './services/retrievalGate'; 
import { ModelGate } from './services/modelGate'; 
import { ExternalRouter } from './services/externalRouter';
import { NumMarkX_GenerateSigil } from './patterns/NumMarkX'; 
import { createPcmBlob, base64ToUint8Array, decodeAudioData } from './services/audioUtils';
import { listCloudFiles } from './services/googleFiles';
import { ChatterboxService } from './services/chatterbox'; // Import TTS Service
import Visualizer from './components/Visualizer';
import { KnowledgeManager } from './components/KnowledgeManager';
import ChatHistoryManager from './components/ChatHistoryManager';
import SettingsManager from './components/SettingsManager';
import { MultiAgentConsole } from './components/MultiAgentConsole'; 
import { VoiceCommandList } from './components/VoiceCommandList';
import { RoomFocusConfig } from './components/RoomFocusConfig'; 
import { McpManager } from './components/McpManager'; 
import { ConnectionState, LogMessage, ModelConfig, DEFAULT_MODEL_CONFIG, CloudFile } from './types';
import { AGENTS } from './agents';

// LIVE MODEL
const LIVE_MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

// GATING MODELS
const GATING_MODELS = [
  { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash' }
];

// SILENCE DETECTION CONFIG
const SILENCE_TIMEOUT_MS = 60000; 
const SPEECH_THRESHOLD = 0.01;    

// Comprehensive list of known Gemini voices
const PREBUILT_VOICES = [
  "Puck", "Charon", "Kore", "Fenrir", "Zephyr", 
  "Aoede", "Callirrhoe", "Leda"
].sort();

const LANGUAGE_PROTOCOL = `
[LORE COMPLIANCE: LANGUAGE LOCK]
1.  **STRICT ENGLISH OUTPUT:** You must ONLY speak in English.
2.  **VOICE-FIRST FORMATTING:** You are speaking via a voice synthesizer. 
    *   DO NOT use markdown formatting (bold, italics, lists) in your speech output. 
    *   Keep responses conversational, fluid, and concise. 
    *   Avoid long monologues unless narrating a story.
3.  **RELIC TONGUES:** Exceptions for "Black Speech" or "Ancient Greek" allowed for ritualistic effect.
`;

const RAG_INSTRUCTION = `
[GROUNDED RAG PROTOCOL]
You have access to a local Knowledge Base via the tool 'searchKnowledgeBase'.
1.  **ALWAYS SEARCH FIRST:** If the user asks about specific entities, lore, project details, or past conversations, you MUST use 'searchKnowledgeBase' BEFORE generating a response.
2.  **GROUNDED TRUTH:** Prioritize information retrieved from the database over your general training.
3.  **MEMORY:** Use 'saveToKnowledgeBase' to persist new facts, user preferences, or important details immediately.

[TOOL USE PROTOCOL]
*   **googleSearch**: Use for real-time news or broad web queries.
*   **updateSystemInstructions**: Use to permanently adjust your persona.
*   **routeRequest**: Use for Image Generation (FLUX_IMAGE) or Policy-Restricted tasks (EXTERNAL_LLM).
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

const updateInstructionsTool: FunctionDeclaration = {
  name: 'updateSystemInstructions',
  description: 'Updates your own system instructions to persist user preferences, behaviors, or facts for future sessions.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      addition: { type: Type.STRING, description: 'The instruction to append (e.g., "User prefers concise answers").' },
    },
    required: ['addition'],
  },
};

const savePromptTool: FunctionDeclaration = {
  name: 'savePrompt',
  description: 'Saves the current Agent System Instructions (or a specific text provided) as a named reusable prompt.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: 'A short name for this prompt (e.g., "Python Coder", "Storyteller").' },
      content: { type: Type.STRING, description: 'Optional. The specific prompt text to save. If omitted, saves the CURRENT active instructions.' }
    },
    required: ['name'],
  },
};

const optimizePromptTool: FunctionDeclaration = {
  name: 'optimizePrompt',
  description: 'Acts as a Prompt Engineer to rewrite/optimize instructions for better AI performance. Updates the current session with the optimized version.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: 'The raw instruction or text to optimize. If omitted, optimizes the current agent instructions.' }
    },
  },
};

const routeRequestTool: FunctionDeclaration = {
  name: 'routeRequest',
  description: 'Routes a request to a specialized external AI model. Use for Image Generation (Flux) or when standard policy restrictions prevent you from fulfilling a safe user request (Offloading).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      target: { 
          type: Type.STRING, 
          description: 'The target model service. Options: "FLUX_IMAGE" (High quality images), "EXTERNAL_LLM" (Uncensored/Specialized text).' 
      },
      prompt: { type: Type.STRING, description: 'The prompt to send to the external model.' }
    },
    required: ['target', 'prompt'],
  },
};

const updateConfigTool: FunctionDeclaration = {
  name: 'updateModelConfiguration',
  description: 'Updates the model generation parameters based on user command. Use this to adjust Temperature (Creativity), TopP (Nucleus), or TopK (Token Pool).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      temperature: { type: Type.NUMBER, description: 'Controls randomness. 0.0 is precise, 2.0 is highly creative.' },
      topP: { type: Type.NUMBER, description: 'Nucleus sampling probability (0.0 to 1.0).' },
      topK: { type: Type.NUMBER, description: 'Top-K token limit (1 to 40).' },
    },
  },
};

const saveMemoryTool: FunctionDeclaration = {
  name: 'saveToKnowledgeBase',
  description: 'Saves a text snippet (fact, memory, note) to the local vector database for future retrieval.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: 'The content to save.' },
      title: { type: Type.STRING, description: 'A short title for this memory.' },
    },
    required: ['text'],
  },
};

const translateTool: FunctionDeclaration = {
  name: 'translateAncientGreek',
  description: 'Translates text between English and Ancient Greek (Musiki Dialog) using the OpenL.io API.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: 'The text to translate.' },
      target: { type: Type.STRING, description: 'Target language code ("en" for English, "grc" for Ancient Greek).' },
    },
    required: ['text', 'target'],
  },
};

interface Attachment {
  file: File;
  type: 'image' | 'text';
  preview: string; // Base64 for image, Snippet for text
  content: string; // Base64 data or Raw Text
  mimeType: string;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

type ViewMode = 'UPLINK' | 'CONFERENCE';
type ToolMode = 'STANDARD' | 'DEEP' | 'IMAGE' | 'EXTERNAL';

const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('UPLINK');
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [systemStatus, setSystemStatus] = useState<string>("System Initialized.");
  
  const [selectedAgentId, setSelectedAgentId] = useState<string>(AGENTS[0].id);
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  
  // Gating / Orchestration State
  const [useDeepAnalysis, setUseDeepAnalysis] = useState(false);
  const [gatingModel, setGatingModel] = useState<string>(GATING_MODELS[0].id);
  const [toolMode, setToolMode] = useState<ToolMode>('STANDARD');
  
  // Cloud File State
  const [availableCloudFiles, setAvailableCloudFiles] = useState<CloudFile[]>([]);
  const [activeCloudFileUri, setActiveCloudFileUri] = useState<string>('');

  // Settings State
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [generalInstruction, setGeneralInstruction] = useState<string>('');
  const [agentInstruction, setAgentInstruction] = useState<string>('');
  
  // Voice State
  const [selectedVoice, setSelectedVoice] = useState<string>(AGENTS[0].voice);
  const [isCustomVoice, setIsCustomVoice] = useState(false);
  const [customVoiceName, setCustomVoiceName] = useState('');
  const [agentVoiceRef, setAgentVoiceRef] = useState<string | undefined>(undefined); // Cloned Voice

  const [isCameraActive, setIsCameraActive] = useState(false);
  
  // Audio Input State
  const [isMicMuted, setIsMicMuted] = useState(false);
  const isMicMutedRef = useRef(false); 
  const isTypingRef = useRef(false);   

  const [logsLoaded, setLogsLoaded] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [isSpeaking, setIsSpeaking] = useState<string | null>(null); // ID of message currently playing TTS

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
  const silenceTimerRef = useRef<number | null>(null);

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
    updateCloudFileList();
    
    const hfToken = localStorage.getItem('hf_token') || process.env.HF_TOKEN;
    if (!hfToken) {
        showToast("Warning: HF_TOKEN missing in Settings. External tools disabled.", 'error');
    }
  }, []);

  // Update Status Bar dynamically when Disconnected
  useEffect(() => {
      if (connectionState === ConnectionState.DISCONNECTED && viewMode === 'UPLINK') {
          const voice = isCustomVoice ? (customVoiceName || 'CUSTOM') : selectedVoice;
          const mic = isMicMuted ? 'OFF' : 'ON';
          const cam = isCameraActive ? 'ON' : 'OFF';
          setSystemStatus(`READY :: ${currentAgent.handle.toUpperCase()} | VOICE: ${voice.toUpperCase()} | MIC: ${mic} | CAM: ${cam}`);
      } else if (viewMode === 'CONFERENCE') {
          setSystemStatus("MULTI-AGENT CONFERENCE MODE ACTIVE");
      }
  }, [connectionState, selectedAgentId, selectedVoice, isCustomVoice, customVoiceName, isMicMuted, isCameraActive, viewMode]);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      setLogsLoaded(false);
      
      try {
        const savedLogs = await loadActiveChat(selectedAgentId);
        const savedConfig = await getAgentConfig(selectedAgentId);
        const docCount = await getDocumentCountByAgentId(selectedAgentId);

        if (isMounted) {
          setLogs(savedLogs);
          setAgentInstruction(savedConfig.instruction);
          setModelConfig(savedConfig.modelConfig);
          setAgentVoiceRef(savedConfig.voiceReference); // Load cloned voice ref
          setLogsLoaded(true); 
          
          if (docCount > 0) {
              showToast(`Memory Active: ${docCount} nodes online`, 'success');
          }
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

  useEffect(() => {
    if (logsLoaded) {
      saveActiveChat(selectedAgentId, logs).catch(console.error);
    }
  }, [logs, selectedAgentId, logsLoaded]);

  useEffect(() => {
      if (toolMode === 'STANDARD' && inputText.length > 10) {
          if (ModelGate.shouldActivateDeepAnalysis(inputText)) {
              if (!useDeepAnalysis) {
                  setUseDeepAnalysis(true);
                  setGatingModel('gemini-3-pro-preview');
              }
          }
      }
  }, [inputText, toolMode]);

  useEffect(() => {
      if (inputText.length > 0) {
          stopSilenceTimer();
      }
  }, [inputText]);

  // --- SILENCE DETECTION LOGIC ---
  const stopSilenceTimer = () => {
      if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
      }
  };

  const startSilenceTimer = () => {
      stopSilenceTimer(); 
      if (connectionState !== ConnectionState.CONNECTED) return;
      if (inputText.length > 0) return;

      silenceTimerRef.current = window.setTimeout(() => {
          triggerSilenceNudge();
      }, SILENCE_TIMEOUT_MS);
  };

  const triggerSilenceNudge = async () => {
      if (connectionState !== ConnectionState.CONNECTED) return;
      if (inputText.length > 0) return;

      console.log("Silence detected. Nudging agent...");
      const silenceMsg = "[SYSTEM NOTICE: The user has been silent for a while. Briefly and politely ask if they are encountering a technical issue or if they are still composing their thoughts. Do not terminate the session.]";
      
      try {
          await safeSendClientContent([{ text: silenceMsg }]);
      } catch (e) {
          console.error("Failed to send silence nudge", e);
      }
  };

  const updateCloudFileList = async () => {
      try {
          const files = await listCloudFiles();
          setAvailableCloudFiles(files);
      } catch (e) {
          console.error("Failed to list cloud files in App", e);
      }
  };

  const showToast = (message: string, type: 'success'|'error'|'info' = 'info') => {
    const id = crypto.randomUUID();
    setToast({ id, message, type });
    setTimeout(() => {
      setToast(prev => prev && prev.id === id ? null : prev);
    }, 3000);
  };

  const addLog = (type: LogMessage['type'], text: string, id?: string, attachment?: string) => {
    if (type === 'system') {
        setSystemStatus(text.replace(/SYSTEM:/i, '').trim());
    }

    const logId = id || crypto.randomUUID();
    setLogs(prev => {
        const index = prev.findIndex(l => l.id === logId);
        if (index !== -1) {
            const updated = [...prev];
            updated[index] = { ...updated[index], text, attachment, timestamp: Date.now() };
            return updated;
        }
        return [...prev, { id: logId, type, text, attachment, timestamp: Date.now() }];
    });
    return logId;
  };

  const safeSendClientContent = async (parts: any[]) => {
      if (!sessionRef.current) return;
      stopSilenceTimer();

      const session = sessionRef.current;
      const content = {
          clientContent: {
              turns: [{
                  role: 'user',
                  parts: parts
              }],
              turnComplete: true
          }
      };

      try {
        if (typeof session.send === 'function') {
            await session.send(content);
        } else if (typeof (session as any).sendClientContent === 'function') {
            await (session as any).sendClientContent(content.clientContent);
        } else {
            console.warn("Session object does not support 'send' or 'sendClientContent'.");
            throw new Error("Text injection not supported in this Live Session version.");
        }
      } catch(e) {
          throw e; 
      }
  };

  const handleLoreUpdate = async () => {
      updateCloudFileList();
      const msg = "[SYSTEM ALERT: New knowledge has been ingested into the local database or cloud context. You can now search for this new information using your tools. Inform the user you are aware of the update.]";
      
      if (connectionState === ConnectionState.CONNECTED) {
          setSystemStatus('Knowledge Base Updated');
          addLog('system', "SYSTEM: Knowledge Base Updated. Alerting Agent...");
      } 
      showToast('Knowledge Base Updated', 'success');
      
      if (connectionState === ConnectionState.CONNECTED && sessionRef.current) {
          try {
              await safeSendClientContent([{ text: msg }]);
          } catch (e) {
              console.error("Failed to notify agent of update", e);
              addLog('system', "SYSTEM WARNING: Could not auto-alert agent (Text injection unsupported). Agent will find data upon next search.");
          }
      }
  };

  const handleSaveSettings = async (newVoiceRef?: string) => {
    await saveGeneralInstructions(generalInstruction);
    await saveAgentConfig(selectedAgentId, { 
        instruction: agentInstruction, 
        modelConfig,
        voiceReference: newVoiceRef !== undefined ? newVoiceRef : agentVoiceRef 
    });
    
    if (newVoiceRef) setAgentVoiceRef(newVoiceRef);

    if (connectionState === ConnectionState.CONNECTED && sessionRef.current) {
        setSystemStatus('Injecting Updated Instructions...');
        const updateMsg = `[SYSTEM INSTRUCTION UPDATE]\n\nGLOBAL INSTRUCTIONS:\n${generalInstruction}\n\nAGENT SPECIFIC INSTRUCTIONS:\n${agentInstruction}\n\n[INSTRUCTION END] Please adhere to these updated instructions immediately.`;
        
        try {
            await safeSendClientContent([{ text: updateMsg }]);
            showToast('Instructions Updated Live', 'success');
            setSystemStatus('Live Session Updated.');
        } catch (e) {
            console.error(e);
            showToast('Failed to update live session', 'error');
        }
    } else {
        showToast('Settings Saved', 'success');
    }
  };
  
  // TTS / DUBBING FUNCTION
  const playTts = async (text: string, id: string) => {
      if (!agentVoiceRef) {
          showToast("No Voice Reference found for this agent. Check Settings.", 'error');
          return;
      }
      
      setIsSpeaking(id);
      try {
          // Remove data URI prefix if present for Chatterbox
          const audioBase64 = agentVoiceRef.replace(/^data:audio\/\w+;base64,/, '');
          
          const audioBuffer = await ChatterboxService.synthesize({
              text,
              audioRef: audioBase64
          });
          
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const decoded = await ctx.decodeAudioData(audioBuffer);
          const source = ctx.createBufferSource();
          source.buffer = decoded;
          source.connect(ctx.destination);
          source.start(0);
          
          source.onended = () => setIsSpeaking(null);
          
      } catch (e: any) {
          console.error("TTS Error:", e);
          showToast(`TTS Failed: ${e.message}`, 'error');
          setIsSpeaking(null);
      }
  };

  const stopAudioPlayback = () => {
    scheduledSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    scheduledSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    activeModelMessageRef.current = '';
    activeUserMessageRef.current = '';
    activeTurnIdRef.current = null;
  };

  const toggleMic = () => {
      const newState = !isMicMuted;
      setIsMicMuted(newState);
      isMicMutedRef.current = newState;
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
        showToast("Camera access denied.", 'error');
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const isImage = file.type.startsWith('image/');
      const isText = file.type === 'application/json' || file.name.endsWith('.md') || file.name.endsWith('.txt');

      if (!isImage && !isText) {
          showToast("Unsupported file type. Use Image, TXT, MD, or JSON", 'error');
          return;
      }

      const reader = new FileReader();
      
      reader.onload = (event) => {
        const result = event.target?.result as string;
        
        if (isImage) {
            const base64 = result.split(',')[1];
            setAttachment({
                file,
                type: 'image',
                preview: result,
                content: base64,
                mimeType: file.type
            });
        } else {
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearAttachment = () => {
    setAttachment(null);
  };

  const performDeepAnalysis = async (att: Attachment | null, cloudFileUri: string, userPrompt: string): Promise<string> => {
    const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
    if (!apiKey) throw new Error("Missing API Key");

    const ai = new GoogleGenAI({ apiKey });
    
    let parts: any[] = [];
    let logMsg = "Analyzing ";

    if (cloudFileUri) {
        const fileObj = availableCloudFiles.find(f => f.uri === cloudFileUri);
        if (fileObj) {
            parts.push({
                fileData: {
                    fileUri: fileObj.uri,
                    mimeType: fileObj.mimeType
                }
            });
            logMsg += `Cloud File: ${fileObj.displayName} `;
        }
    }

    if (att) {
        if (att.type === 'image') {
            parts.push({
                inlineData: {
                    mimeType: att.mimeType,
                    data: att.content
                }
            });
            parts.push({
                text: userPrompt ? `Analyze this image in the context of: "${userPrompt}". Provide deep insight for the voice agent.` : "Analyze this image in detail for the voice agent."
            });
            logMsg += `& Image `;
        } else {
            parts.push({
                text: `Analyze the following file content (${att.file.name}) and provide a detailed summary and insight for the voice agent.\n\nFILE CONTENT:\n${att.content}\n\nUSER CONTEXT: ${userPrompt}`
            });
            logMsg += `& Local Doc `;
        }
    } else if (cloudFileUri) {
         parts.push({
             text: userPrompt ? `Analyze the attached file in the context of: "${userPrompt}".` : "Analyze the attached file."
         });
    }

    if (parts.length === 0) return "No content to analyze.";
    
    const response = await ai.models.generateContent({
        model: gatingModel,
        contents: { parts }
    });
    return response.text || "";
  };

  const handleSendText = async () => {
    if ((!inputText.trim() && !attachment && !activeCloudFileUri) || connectionState !== ConnectionState.CONNECTED) return;
    
    stopSilenceTimer(); 

    const text = inputText.trim();
    const currentAttachment = attachment;
    const currentCloudUri = activeCloudFileUri;
    
    const isDeepReasoning = toolMode === 'DEEP' || useDeepAnalysis;
    const isImageGen = toolMode === 'IMAGE';
    const isExternal = toolMode === 'EXTERNAL';

    const isGated = isDeepReasoning || !!currentCloudUri; 
    
    setInputText('');
    setAttachment(null);
    setUseDeepAnalysis(false); 
    setToolMode('STANDARD'); 
    setActiveCloudFileUri(''); 
    
    let logText = text;
    if (currentAttachment) logText = `[Sent ${currentAttachment.type}] ` + logText;
    if (currentCloudUri) logText = `[Ref: CloudFile] ` + logText;
    
    if (isDeepReasoning) logText = `[DEEP] ` + logText;
    if (isImageGen) logText = `[IMAGE] ` + logText;
    if (isExternal) logText = `[EXTERNAL] ` + logText;

    addLog('user', logText);
    
    try {
        if(sessionRef.current) {
            if (isGated) {
                const activeGatingModel = 'gemini-3-pro-preview';
                setSystemStatus(`Orchestrator: Offloading to ${activeGatingModel}...`);
                
                try {
                    const analysisResult = await performDeepAnalysis(currentAttachment, currentCloudUri, text);
                    setSystemStatus('Orchestrator: Analysis Complete. Injecting context...');
                    
                    let contextMessage = `[SYSTEM: Orchestrator Report (${activeGatingModel})]\n`;
                    if (currentCloudUri) contextMessage += `REF: Cloud File Analyzed.\n`;
                    if (currentAttachment) contextMessage += `REF: User Upload (${currentAttachment.file.name}).\n`;
                    contextMessage += `\nANALYSIS RESULT:\n${analysisResult}\n\nUSER COMMENT: ${text}`;
                    
                    await safeSendClientContent([{ text: contextMessage }]);
                } catch (analysisErr) {
                    console.error("Deep analysis failed", analysisErr);
                    setSystemStatus('Orchestrator: Analysis Failed. Falling back to direct stream.');
                }
            } 
            
            if (!isGated) {
                if (currentAttachment && currentAttachment.type === 'image') {
                    await sessionRef.current.sendRealtimeInput({
                        media: {
                            mimeType: currentAttachment.mimeType,
                            data: currentAttachment.content
                        }
                    });
                    await new Promise(r => setTimeout(r, 150));
                }

                let textParts = [];
                
                if (isImageGen) {
                    textParts.push(`[SYSTEM: User explicitly requests IMAGE GENERATION via tool selector. You MUST use 'routeRequest' with target='FLUX_IMAGE' for this request.] `);
                }
                if (isExternal) {
                    textParts.push(`[SYSTEM: User explicitly requests EXTERNAL LLM routing via tool selector. You MUST use 'routeRequest' with target='EXTERNAL_LLM' for this request.] `);
                }

                if (currentAttachment && currentAttachment.type === 'text') {
                    textParts.push(`[System: User uploaded file '${currentAttachment.file.name}']\n\nCONTENT:\n${currentAttachment.content}\n\n`);
                }
                if (text) textParts.push(text);

                if (textParts.length === 0 && currentAttachment && currentAttachment.type === 'image') {
                    textParts.push("I have uploaded an image.");
                }

                if (textParts.length > 0) {
                     await safeSendClientContent([{ text: textParts.join('') }]);
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
    const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
    if (!apiKey) {
        showToast("Missing API Key. Check Settings.", 'error');
        return;
    }

    setConnectionState(ConnectionState.CONNECTING);
    setSystemStatus(`Initializing Link to ${currentAgent.handle}...`);
    
    const recentHistory = logs.slice(-10).map(l => `${l.type === 'user' ? 'User' : 'Agent'}: ${l.text}`).join('\n');
    const historyContext = recentHistory ? `\n\nRECENT CONVERSATION HISTORY (RESUME CONTEXT):\n${recentHistory}` : '';
    
    let parts: string[] = [];
    if (selectedAgentId === 'GEMINI_CORE') {
        parts = [
            currentAgent.system_instruction,
            "=== GENERAL SYSTEM INSTRUCTIONS ===",
            generalInstruction,
            historyContext
        ];
    } else {
        parts = [
            currentAgent.system_instruction, 
            LANGUAGE_PROTOCOL,
            RAG_INSTRUCTION,                 
            "=== GENERAL USER INSTRUCTIONS ===",
            generalInstruction,
            `=== ${currentAgent.handle.toUpperCase()} SPECIFIC INSTRUCTIONS ===`,
            agentInstruction,
            historyContext
        ];
    }
    
    const fullInstruction = parts.filter(p => p.trim()).join('\n\n');
    const voiceName = isCustomVoice && customVoiceName.trim() ? customVoiceName.trim() : selectedVoice;

    try {
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = outputCtx;
      inputAudioContextRef.current = inputCtx;
      
      const analyser = outputCtx.createAnalyser();
      analyserRef.current = analyser;

      const ai = new GoogleGenAI({ apiKey });
      const sessionPromise = ai.live.connect({
        model: LIVE_MODEL_NAME,
        config: {
          systemInstruction: fullInstruction,
          responseModalities: [Modality.AUDIO],
          temperature: modelConfig.temperature,
          topP: modelConfig.topP,
          topK: modelConfig.topK,
          outputAudioTranscription: {}, 
          inputAudioTranscription: {},  
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          tools: [{ googleSearch: {} }, { functionDeclarations: [searchTool, transcriptTool, terminateTool, updateInstructionsTool, updateConfigTool, saveMemoryTool, translateTool, savePromptTool, optimizePromptTool, routeRequestTool] }],
        },
        callbacks: {
          onopen: async () => {
            setConnectionState(ConnectionState.CONNECTED);
            setSystemStatus(`Link Established: ${currentAgent.handle} is online (Voice: ${voiceName}).`);
            showToast('Uplink Connected', 'success');

            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = inputCtx.createMediaStreamSource(micStream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              
              let sum = 0;
              for(let i = 0; i < inputData.length; i++) {
                  sum += inputData[i] * inputData[i];
              }
              const rms = Math.sqrt(sum / inputData.length);
              if (rms > SPEECH_THRESHOLD && !isMicMutedRef.current) {
                  stopSilenceTimer();
              }

              if (isMicMutedRef.current || isTypingRef.current) {
                  inputData.fill(0); 
              }
              
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
          onclose: (e) => {
              console.debug("Connection closed", e);
              setConnectionState(ConnectionState.DISCONNECTED);
              setSystemStatus('Link Terminated (Server Closure).');
              stopAudioPlayback();
              stopSilenceTimer();
          },
          onerror: (e) => {
              console.error("Connection error", e);
              setConnectionState(ConnectionState.ERROR);
              setSystemStatus('Link Error. Reconnect required.');
              showToast('Connection Error', 'error');
              stopAudioPlayback();
              stopSilenceTimer();
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.interrupted) {
                stopAudioPlayback();
                stopSilenceTimer(); 
                return;
            }

            if (msg.serverContent?.inputTranscription) {
                const text = msg.serverContent.inputTranscription.text;
                activeUserMessageRef.current += text;
                const turnId = `user-stream-${activeTurnIdRef.current || 'pending'}`;
                addLog('user', activeUserMessageRef.current, turnId);
                stopSilenceTimer(); 
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
                startSilenceTimer();
            }
            
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'searchKnowledgeBase') {
                  const query = (fc.args as any).query;
                  const gateDecision = RetrievalGate.evaluate(query, selectedAgentId);
                  
                  if (!gateDecision.shouldRetrieve) {
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Memory retrieval skipped (Not required)." } } }));
                      continue;
                  }

                  const sigil = NumMarkX_GenerateSigil(query);
                  const directHit = await findDocumentBySigil(sigil);
                  
                  if (directHit) {
                      setSystemStatus("Teleport: Instant Sigil Lock");
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: JSON.stringify([directHit]) } } }));
                      continue;
                  }

                  let queryVector = undefined;
                  try {
                      const embedResponse = await ai.models.embedContent({
                          model: 'text-embedding-004',
                          contents: [{ parts: [{ text: query }] }]
                      });
                      queryVector = embedResponse.embeddings?.[0]?.values;
                  } catch (e) {
                      console.warn("Embedding generation failed, falling back to keyword search", e);
                  }

                  const docs = await searchDocuments(query, queryVector, selectedAgentId);
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
                } else if (fc.name === 'updateSystemInstructions') {
                  const addition = (fc.args as any).addition;
                  try {
                      const currentConfig = await getAgentConfig(selectedAgentId);
                      const newInstruction = (currentConfig.instruction || "") + "\n\n[USER PREFERENCE]: " + addition;
                      await saveAgentConfig(selectedAgentId, {
                          instruction: newInstruction,
                          modelConfig: currentConfig.modelConfig,
                          voiceReference: agentVoiceRef
                      });
                      setAgentInstruction(newInstruction);
                      
                      setSystemStatus('Agent Updated Instructions.');
                      showToast('Agent learned a new preference', 'success');
                      
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Instructions updated." } } }));
                  } catch(e) {
                      console.error(e);
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Failed to update instructions." } } }));
                  }
                } else if (fc.name === 'savePrompt') {
                    const name = (fc.args as any).name;
                    const content = (fc.args as any).content || agentInstruction; 
                    try {
                        await saveSavedPrompt({
                            id: crypto.randomUUID(),
                            agentId: selectedAgentId,
                            name,
                            content,
                            timestamp: Date.now()
                        });
                        showToast(`Prompt saved: ${name}`, 'success');
                        sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: `Saved prompt "${name}" successfully.` } } }));
                    } catch(e) {
                        console.error(e);
                        sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Failed to save prompt." } } }));
                    }
                } else if (fc.name === 'optimizePrompt') {
                    const text = (fc.args as any).text || agentInstruction;
                    setSystemStatus('Prompt Engineer: Optimizing instructions...');
                    try {
                        const res = await ai.models.generateContent({
                            model: "gemini-2.0-flash-exp",
                            contents: [{ parts: [{ text: `
                                You are an expert Prompt Engineer. Rewrite the following prompt to be more structured and optimized:
                                "${text}"
                                OUTPUT ONLY THE OPTIMIZED PROMPT TEXT.
                            ` }] }]
                        });
                        
                        const optimized = res.text?.trim() || text;
                        setAgentInstruction(optimized);
                        await saveAgentConfig(selectedAgentId, {
                            instruction: optimized,
                            modelConfig,
                            voiceReference: agentVoiceRef
                        });
                        await safeSendClientContent([{ text: `[SYSTEM] Instructions optimized and updated. New Instructions:\n${optimized}` }]);
                        setSystemStatus('Prompt Optimized.');
                        showToast('Instructions Optimized via AI', 'success');
                        
                        sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Prompt optimized and updated successfully." } } }));
                    } catch(e) {
                        console.error(e);
                        sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Failed to optimize prompt." } } }));
                    }
                } else if (fc.name === 'routeRequest') {
                    const { target, prompt } = fc.args as any;
                    
                    const hfToken = localStorage.getItem('hf_token') || process.env.HF_TOKEN;
                    if (!hfToken) {
                        sessionPromise.then(s => s.sendToolResponse({ 
                            functionResponses: { 
                                id: fc.id, 
                                name: fc.name, 
                                response: { result: `[SYSTEM ERROR] Routing failed: HF_TOKEN is missing.` } 
                            } 
                        }));
                        showToast('External Tool Failed: Token Missing', 'error');
                        return;
                    }

                    setSystemStatus(`ROUTER: Offloading to ${target}...`);
                    
                    try {
                        const routeRes = await ExternalRouter.route(target, prompt);
                        
                        if (routeRes.success && routeRes.data) {
                            if (routeRes.type === 'image') {
                                setSystemStatus(`ROUTER: Image Generated (${target})`);
                                showToast('External Image Generated', 'success');
                                addLog('model', `[ROUTER] Generated image via ${target}`, undefined, routeRes.data);
                                sessionPromise.then(s => s.sendToolResponse({ 
                                    functionResponses: { 
                                        id: fc.id, 
                                        name: fc.name, 
                                        response: { result: `[SYSTEM] Image generated successfully and displayed.` } 
                                    } 
                                }));
                            } else {
                                setSystemStatus(`ROUTER: Text Generated (${target})`);
                                sessionPromise.then(s => s.sendToolResponse({ 
                                    functionResponses: { 
                                        id: fc.id, 
                                        name: fc.name, 
                                        response: { result: `[EXTERNAL MODEL RESPONSE]: ${routeRes.data}` } 
                                    } 
                                }));
                            }
                        } else {
                            throw new Error(routeRes.error || "Unknown Error");
                        }
                    } catch (e: any) {
                        console.error("Router Error:", e);
                        setSystemStatus('ROUTER: Failed.');
                        sessionPromise.then(s => s.sendToolResponse({ 
                            functionResponses: { 
                                id: fc.id, 
                                name: fc.name, 
                                response: { result: `[SYSTEM ERROR] Routing failed: ${e.message}.` } 
                            } 
                        }));
                    }
                } else if (fc.name === 'updateModelConfiguration') {
                  const { temperature, topP, topK } = fc.args as any;
                  setModelConfig(prev => ({
                      temperature: temperature ?? prev.temperature,
                      topP: topP ?? prev.topP,
                      topK: topK ?? prev.topK
                  }));
                  showToast('Model Parameters Updated via Voice', 'success');
                  sessionPromise.then(s => s.sendToolResponse({
                      functionResponses: {
                          id: fc.id,
                          name: fc.name,
                          response: { result: "Configuration updated successfully." }
                      }
                  }));
                } else if (fc.name === 'saveToKnowledgeBase') {
                  const text = (fc.args as any).text;
                  const title = (fc.args as any).title || "Agent Memory";
                  try {
                       const embedResult = await ai.models.embedContent({
                            model: 'text-embedding-004',
                            contents: [{ parts: [{ text }] }],
                            config: { taskType: 'RETRIEVAL_DOCUMENT', title }
                        });
                       
                       const sigil = NumMarkX_GenerateSigil(text);

                       await addDocument({
                            id: crypto.randomUUID(),
                            agentId: selectedAgentId,
                            title,
                            content: text,
                            embedding: embedResult.embeddings[0].values,
                            timestamp: Date.now(),
                            numMarkId: sigil
                       });
                       
                       handleLoreUpdate();
                       sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Memory saved." } } }));
                  } catch(e) {
                       console.error(e);
                       sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Failed to save memory." } } }));
                  }
                } else if (fc.name === 'translateAncientGreek') {
                  const { text, target } = fc.args as any;
                  try {
                      const res = await fetch('https://api.openl.io/translate', {
                          method: 'POST',
                          headers: { 
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${process.env.OPENL_API_KEY || ''}` 
                          },
                          body: JSON.stringify({ 
                              text, 
                              target_lang: target,
                              source_lang: target === 'grc' ? 'en' : 'grc'
                          })
                      });
                      
                      if (res.ok) {
                          const data = await res.json();
                          const translated = data.translated_text || data.translation || JSON.stringify(data);
                          sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: translated } } }));
                      } else {
                          throw new Error("OpenL API Unavailable");
                      }
                  } catch (e) {
                      console.warn("Translation API failed, falling back to internal logic", e);
                      sessionPromise.then(s => s.sendToolResponse({ 
                          functionResponses: { 
                              id: fc.id, 
                              name: fc.name, 
                              response: { result: "[API OFFLINE] Please perform the translation using your internal knowledge of Ancient Greek dialects." } 
                          } 
                      }));
                  }
                }
              }
            }

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
      showToast('Connection Failed', 'error');
    }
  };

  const disconnect = async () => {
    if (logs.length > 0) {
      const now = new Date();
      const timestampStr = now.toISOString().replace(/T/, ' ').replace(/\..+/, '');
      const archiveTitle = `[ARCHIVE] ${currentAgent.handle} - ${timestampStr}`;
      
      await saveChatSession({ 
          id: crypto.randomUUID(), 
          title: archiveTitle, 
          timestamp: Date.now(), 
          logs 
      });
    }
    stopAudioPlayback();
    stopSilenceTimer();
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (sessionRef.current) sessionRef.current.close?.();
    setConnectionState(ConnectionState.DISCONNECTED);
    setSystemStatus('Link Terminated.');
    showToast('Link Terminated', 'info');
  };

  if (viewMode === 'CONFERENCE') {
      return <MultiAgentConsole onClose={() => setViewMode('UPLINK')} />;
  }

  const getInputBorderColor = () => {
      switch(toolMode) {
          case 'DEEP': return '#a78bfa'; 
          case 'IMAGE': return '#f472b6'; 
          case 'EXTERNAL': return '#fb923c'; 
          default: return undefined; 
      }
  };

  return (
    <div className="main-container">
      {toast && (
          <div className="toast-container">
              <div className="toast" style={{borderColor: toast.type === 'error' ? '#f87171' : toast.type === 'success' ? '#4ade80' : '#333'}}>
                  {toast.type === 'success' && <span style={{color:'#4ade80'}}>✓</span>}
                  {toast.type === 'error' && <span style={{color:'#f87171'}}>!</span>}
                  {toast.message}
              </div>
          </div>
      )}

      <div className="header-container">
        <h1 className="header-title animate-pulse">MYTHOS : : COMMS : : HYPERVISOR</h1>
        <div className="status-bar">
          <div className="status-item">CORE: <span style={{color:'#fff'}}>{currentAgent.handle}</span></div>
          <div className="system-status-header" style={{marginRight:'0.5rem'}}>{systemStatus}</div>
          <div className="status-item">SYNC: <span style={{color: connectionState === ConnectionState.CONNECTED ? '#4ade80' : '#666'}}>{connectionState}</span></div>
        </div>
      </div>

      <div className="control-panel">
        <div className="control-row">
            <div className="control-group">
                <button 
                    onClick={() => setViewMode('CONFERENCE')}
                    className="btn btn-secondary"
                    disabled={connectionState === ConnectionState.CONNECTED}
                    style={{ borderColor: '#a78bfa', color: '#a78bfa', flex: 'none' }}
                    title="Switch to Conference Mode"
                >
                    CONF
                </button>
                
                {/* NEW MCP BUTTON */}
                <McpManager />

                <select 
                    value={selectedAgentId} 
                    onChange={e => {
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
                  <div style={{display:'flex', gap:'0.25rem', flex:'1 1 auto', minWidth:'120px', alignItems:'center'}}>
                    <input 
                      type="text" 
                      value={customVoiceName}
                      onChange={(e) => setCustomVoiceName(e.target.value)}
                      placeholder="Voice ID..."
                      className="form-input"
                      style={{fontFamily: 'monospace', fontSize: '0.75rem', flex: 1}}
                      disabled={connectionState !== ConnectionState.DISCONNECTED}
                    />
                    <button 
                      onClick={() => setIsCustomVoice(false)} 
                      className="btn btn-secondary" 
                      style={{padding:'0 0.5rem', flex:'none'}}
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
                      style={{ flex: '1 1 auto', minWidth: '120px' }}
                  >
                      {PREBUILT_VOICES.map(v => <option key={v} value={v}>VOICE: {v.toUpperCase()}</option>)}
                      <option value="CUSTOM_ENTRY" style={{fontStyle:'italic', color: '#a78bfa'}}>MANUAL...</option>
                  </select>
                )}
            </div>
        </div>

        <div className="control-row">
            <div className="control-group" style={{ flex: 2 }}>
                <button 
                    onClick={connectionState === ConnectionState.CONNECTED ? disconnect : connect} 
                    className={`btn ${connectionState === ConnectionState.CONNECTED ? 'btn-abort' : 'btn-primary'} control-btn-link`}
                >
                  {connectionState === ConnectionState.CONNECTED ? 'TERMINATE LINK' : 'ESTABLISH LINK'}
                </button>
            </div>

            <div className="control-group tight">
                <button 
                    onClick={toggleCamera} 
                    className={`btn btn-secondary btn-icon ${isCameraActive ? 'active' : ''}`} 
                    style={{borderColor: isCameraActive ? '#4ade80' : ''}}
                    title="Toggle Camera Stream"
                >
                  {isCameraActive ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56"></path></svg>
                  )}
                </button>

                <button 
                    onClick={toggleMic} 
                    className={`btn btn-secondary btn-icon ${isMicMuted ? 'active' : ''}`} 
                    style={{borderColor: isMicMuted ? '#f87171' : '', color: isMicMuted ? '#f87171' : ''}}
                    disabled={connectionState !== ConnectionState.CONNECTED}
                    title="Mute Microphone"
                >
                  {isMicMuted ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                  )}
                </button>
            </div>

            <div className="control-group tight" style={{ justifyContent: 'flex-end', marginLeft: 'auto' }}>
                <KnowledgeManager currentAgentId={selectedAgentId} onUpdate={handleLoreUpdate} />
                <ChatHistoryManager currentLogs={logs} onLoadSession={setLogs} currentAgentId={selectedAgentId} onUpdateKnowledge={handleLoreUpdate} />
                <RoomFocusConfig />
                <SettingsManager 
                    modelConfig={modelConfig} 
                    setModelConfig={setModelConfig} 
                    disabled={connectionState !== ConnectionState.DISCONNECTED} 
                    generalInstruction={generalInstruction}
                    setGeneralInstruction={setGeneralInstruction}
                    agentInstruction={agentInstruction}
                    setAgentInstruction={setAgentInstruction}
                    agentName={currentAgent.handle}
                    agentId={selectedAgentId}
                    onSave={handleSaveSettings}
                />
                <VoiceCommandList /> 
            </div>
        </div>
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
          if (log.type === 'system') {
              return null;
          }
          const name = log.type === 'user' ? 'USER' : 'AGENT';
          const isAgent = log.type === 'model';
          return (
            <div key={log.id} className={`chat-message-base chat-message-${log.type} ${log.id.includes('-stream-') ? 'animate-pulse' : ''}`}>
              <div style={{fontSize: '0.7rem', marginBottom: '0.2rem', opacity: 0.8, fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <div>
                  {name} <span style={{opacity:0.5, marginLeft: '0.2rem', fontWeight: 'normal'}}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                </div>
                
                {/* TTS PLAY BUTTON FOR AGENT MESSAGES */}
                {isAgent && agentVoiceRef && !log.id.includes('-stream-') && (
                    <button 
                        onClick={() => playTts(log.text, log.id)} 
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: isSpeaking === log.id ? '#4ade80' : '#666' }}
                        title="Dub Message (Voice Clone)"
                    >
                        {isSpeaking === log.id ? (
                            <span className="animate-pulse">🔊 SPEAKING...</span>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                        )}
                    </button>
                )}
              </div>
              {log.attachment && (
                  <div style={{ margin: '0.5rem 0' }}>
                      <img src={log.attachment} alt="Model Output" style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '4px', border: '1px solid #4ade80' }} />
                  </div>
              )}
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
          
          <div className="chat-input-wrapper">
              {attachment && (
                  <div className="attachment-preview">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {attachment.type === 'image' ? (
                              <img src={attachment.preview} alt="preview" className="attachment-thumb" />
                          ) : (
                              <span style={{ fontSize: '0.75rem', color: '#a3a3a3' }}>{attachment.preview}</span>
                          )}
                      </div>

                      <button 
                          onClick={clearAttachment}
                          style={{background:'none', border:'none', color:'#f87171', cursor:'pointer', fontWeight:'bold'}}
                      >
                          X
                      </button>
                  </div>
              )}
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
                  
                  <div style={{ position: 'relative', flex: '0 0 auto' }} title="Task Routing Mode">
                      <select 
                          value={toolMode}
                          onChange={(e) => setToolMode(e.target.value as ToolMode)}
                          disabled={connectionState !== ConnectionState.CONNECTED}
                          className="form-select"
                          style={{ 
                              backgroundColor: '#111', 
                              color: getInputBorderColor() || '#a3a3a3', 
                              border: `1px solid ${getInputBorderColor() || '#333'}`,
                              width: 'auto',
                              minWidth: '120px'
                          }}
                      >
                          <option value="STANDARD">STANDARD</option>
                          <option value="DEEP">DEEP REASON</option>
                          <option value="IMAGE">IMAGE GEN</option>
                          <option value="EXTERNAL">EXTERNAL LLM</option>
                      </select>
                  </div>

                  <button 
                      className="btn btn-secondary btn-icon"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={connectionState !== ConnectionState.CONNECTED}
                      title="Attach File (Image, TXT, MD, JSON)"
                      style={{ flex: '0 0 auto' }}
                  >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                  </button>

                  <input 
                      type="text" 
                      className="chat-input" 
                      placeholder={connectionState === ConnectionState.CONNECTED ? (isMicMuted ? "Type message (Mic Muted)..." : "Type a message...") : "Connect to chat..."}
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                      disabled={connectionState !== ConnectionState.CONNECTED}
                      style={{ borderColor: getInputBorderColor(), flex: 1, width: 'auto', minWidth: 0 }}
                      onFocus={() => { isTypingRef.current = true; }}
                      onBlur={() => { 
                          setTimeout(() => { isTypingRef.current = false; }, 200); 
                      }}
                  />
              </div>
          </div>
          
          <button 
              className="btn btn-secondary" 
              onClick={handleSendText}
              disabled={connectionState !== ConnectionState.CONNECTED || (!inputText.trim() && !attachment && !activeCloudFileUri)}
          >
              SEND
          </button>
      </div>
    </div>
  );
};

export default App;
