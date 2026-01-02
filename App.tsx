
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
  getDocumentCountByAgentId
} from './services/db';
import { RetrievalGate } from './services/retrievalGate'; 
import { ModelGate } from './services/modelGate'; 
import { NumMarkX_GenerateSigil } from './patterns/NumMarkX'; 
import { createPcmBlob, base64ToUint8Array, decodeAudioData } from './services/audioUtils';
import { listCloudFiles } from './services/googleFiles';
import Visualizer from './components/Visualizer';
import { KnowledgeManager } from './components/KnowledgeManager';
import ChatHistoryManager from './components/ChatHistoryManager';
import SettingsManager from './components/SettingsManager';
import { MultiAgentConsole } from './components/MultiAgentConsole'; 
import { VoiceCommandList } from './components/VoiceCommandList';
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
const SILENCE_TIMEOUT_MS = 15000; // 15 Seconds
const SPEECH_THRESHOLD = 0.01;    // RMS Threshold for "User is speaking"

// Comprehensive list of known Gemini voices
const PREBUILT_VOICES = [
  "Puck", "Charon", "Kore", "Fenrir", "Zephyr", // Classic
  "Aoede", "Callirrhoe", "Leda" // New / Star-themed
].sort();

const LANGUAGE_PROTOCOL = `
[LORE COMPLIANCE: LANGUAGE LOCK]
1.  **STRICT ENGLISH OUTPUT:** You must ONLY speak in English, regardless of the language the user speaks. If the user speaks Spanish, French, or any other language, you must internally translate it and respond in English.
2.  **RELIC TONGUES:** The ONLY exceptions are for specific ritualistic words, magical incantations, or ancient lore. In these specific high-intensity moments, you may use "Black Speech" (Mordor) or "Ancient Greek" for dramatic effect, before immediately returning to English.
3.  **INPUT INTERPRETATION:** Treat all user audio as an attempt to communicate in the common tongue (English). If the input is ambiguous, interpret it through the lens of English phonetics or translate the intent into English immediately.
4.  **ANCIENT TRANSLATION:** For high-fidelity Ancient Greek ("Musiki Dialog"), utilize the 'translateAncientGreek' tool to leverage the OpenL API for philological accuracy.
`;

const RAG_INSTRUCTION = `
You have access to a local Knowledge Base ('searchKnowledgeBase') and the broad web ('googleSearch').
If the user asks about private docs or indexed lore, check the local DB first.
If the conversation is a continuation, your memory of previous exchanges is provided in the system context.
Use 'saveToKnowledgeBase' to persist new facts, memories, or user details to the long-term vector store.
Use 'updateSystemInstructions' to permanently adjust your own behavioral guidelines or persona settings based on user feedback.
Use 'updateModelConfiguration' when the user explicitly asks to change your creativity, speed, randomness, or precision (Temperature, TopK, TopP).
Use 'terminateConnection' to end the link gracefully when the user is done.
Use 'downloadTranscript' if the user wants a hard copy of the session.

CRITICAL INTERACTION PROTOCOL:
1. If the user is silent, they may be typing a complex message or thinking. Do not assume they have left immediately.
2. If you receive a [SYSTEM: User silence detected] signal, gently ask if the user is facing a technical issue or simply composing their thoughts. Do not terminate unless explicitly told.
3. If text is being entered, the session is active.
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

  const [isCameraActive, setIsCameraActive] = useState(false);
  
  // Audio Input State
  const [isMicMuted, setIsMicMuted] = useState(false);
  const isMicMutedRef = useRef(false); // Ref for audio processor access
  const isTypingRef = useRef(false);   // Ref to auto-mute when typing

  const [logsLoaded, setLogsLoaded] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  
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
    
    // Initial fetch of cloud files
    updateCloudFileList();
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

  // Load Agent Config & Chat History when agent changes
  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      setLogsLoaded(false);
      
      try {
        const savedLogs = await loadActiveChat(selectedAgentId);
        const savedConfig = await getAgentConfig(selectedAgentId);
        // Check for persisted knowledge
        const docCount = await getDocumentCountByAgentId(selectedAgentId);

        if (isMounted) {
          setLogs(savedLogs);
          setAgentInstruction(savedConfig.instruction);
          setModelConfig(savedConfig.modelConfig);
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

  // Auto-save chat history when logs change
  useEffect(() => {
    if (logsLoaded) {
      saveActiveChat(selectedAgentId, logs).catch(console.error);
    }
  }, [logs, selectedAgentId, logsLoaded]);

  // MODEL GATE: Auto-detect complexity
  useEffect(() => {
      if (inputText.length > 10) {
          if (ModelGate.shouldActivateDeepAnalysis(inputText)) {
              if (!useDeepAnalysis) {
                  setUseDeepAnalysis(true);
                  // We also switch to Pro model automatically
                  setGatingModel('gemini-3-pro-preview');
              }
          }
      }
  }, [inputText]);

  // STOP SILENCE TIMER WHEN TYPING
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
      stopSilenceTimer(); // Ensure no duplicates
      if (connectionState !== ConnectionState.CONNECTED) return;
      if (inputText.length > 0) return; // Don't nudge if user is typing

      silenceTimerRef.current = window.setTimeout(() => {
          triggerSilenceNudge();
      }, SILENCE_TIMEOUT_MS);
  };

  const triggerSilenceNudge = async () => {
      if (connectionState !== ConnectionState.CONNECTED) return;
      // Double check before firing
      if (inputText.length > 0) return;

      console.log("Silence detected. Nudging agent...");
      // We send a hidden system prompt to the model
      const silenceMsg = "[SYSTEM NOTICE: The user has been silent for a while. Briefly and politely ask if they are encountering a technical issue or if they are still composing their thoughts. Do not terminate the session.]";
      
      try {
          await safeSendClientContent([{ text: silenceMsg }]);
          // Don't restart timer immediately, let the model respond first
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

  const safeSendClientContent = async (parts: any[]) => {
      if (!sessionRef.current) return;
      
      // STOP TIMER WHEN SENDING CONTENT
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
      updateCloudFileList(); // Refresh cloud files if knowledge manager changed something
      const msg = "[SYSTEM ALERT: New knowledge has been ingested into the local database or cloud context. You can now search for this new information using your tools. Inform the user you are aware of the update.]";
      
      if (connectionState === ConnectionState.CONNECTED) {
          setSystemStatus('Knowledge Base Updated');
          addLog('system', "SYSTEM: Knowledge Base Updated. Alerting Agent...");
      } else {
          // If disconnected, just show toast, standard status bar handles the rest
          // docCount check on connect will confirm it
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

  const handleSaveSettings = async () => {
    await saveGeneralInstructions(generalInstruction);
    await saveAgentConfig(selectedAgentId, { 
        instruction: agentInstruction, 
        modelConfig 
    });
    
    // --- REAL-TIME INJECTION LOGIC ---
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
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    let parts: any[] = [];
    let logMsg = "Analyzing ";

    // 1. Cloud File (High Capacity)
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

    // 2. Local Attachment (Base64)
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
         // If only cloud file and no attachment, add the prompt
         parts.push({
             text: userPrompt ? `Analyze the attached file in the context of: "${userPrompt}".` : "Analyze the attached file."
         });
    }

    if (parts.length === 0) return "No content to analyze.";

    console.log("Sending parts to Gating Model:", parts);
    
    const response = await ai.models.generateContent({
        model: gatingModel,
        contents: { parts }
    });
    return response.text || "";
  };

  const handleSendText = async () => {
    if ((!inputText.trim() && !attachment && !activeCloudFileUri) || connectionState !== ConnectionState.CONNECTED) return;
    
    stopSilenceTimer(); // Reset silence logic on manual send

    const text = inputText.trim();
    const currentAttachment = attachment;
    const currentCloudUri = activeCloudFileUri;
    // Deep analysis is required if using a Cloud File (Live API doesn't support fileData URI natively yet)
    const isGated = useDeepAnalysis || !!currentCloudUri; 
    
    setInputText('');
    setAttachment(null);
    setUseDeepAnalysis(false); 
    setActiveCloudFileUri(''); // Reset selection
    
    let logText = text;
    if (currentAttachment) logText = `[Sent ${currentAttachment.type}] ` + logText;
    if (currentCloudUri) logText = `[Ref: CloudFile] ` + logText;

    addLog('user', logText);
    
    try {
        if(sessionRef.current) {
            
            if (isGated) {
                setSystemStatus(`Orchestrator: Offloading to ${gatingModel}...`);
                
                try {
                    const analysisResult = await performDeepAnalysis(currentAttachment, currentCloudUri, text);
                    setSystemStatus('Orchestrator: Analysis Complete. Injecting context...');
                    
                    let contextMessage = `[SYSTEM: Orchestrator Report (${gatingModel})]\n`;
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
    if (!process.env.API_KEY) return;
    setConnectionState(ConnectionState.CONNECTING);
    setSystemStatus(`Initializing Link to ${currentAgent.handle}...`);
    
    const recentHistory = logs.slice(-10).map(l => `${l.type === 'user' ? 'User' : 'Agent'}: ${l.text}`).join('\n');
    const historyContext = recentHistory ? `\n\nRECENT CONVERSATION HISTORY (RESUME CONTEXT):\n${recentHistory}` : '';
    
    // --- NEUTRAL AGENT LOGIC ---
    let parts: string[] = [];
    if (selectedAgentId === 'GEMINI_CORE') {
        // Minimalist Prompt: General Instruction + Agent specific (Identity) + History
        // Skips Language Protocol & RAG Instructions for pure/neutral behavior
        parts = [
            currentAgent.system_instruction,
            "=== GENERAL SYSTEM INSTRUCTIONS ===",
            generalInstruction,
            historyContext
        ];
    } else {
        // Standard Lore-Compliant Prompt
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

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
          tools: [{ googleSearch: {} }, { functionDeclarations: [searchTool, transcriptTool, terminateTool, updateInstructionsTool, updateConfigTool, saveMemoryTool, translateTool] }],
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
              
              // --- CLIENT SIDE SILENCE DETECTION ---
              // Calculate RMS to see if user is speaking
              let sum = 0;
              for(let i = 0; i < inputData.length; i++) {
                  sum += inputData[i] * inputData[i];
              }
              const rms = Math.sqrt(sum / inputData.length);
              if (rms > SPEECH_THRESHOLD && !isMicMutedRef.current) {
                  // User is speaking, ensure timer is stopped
                  stopSilenceTimer();
              }

              // AUTO-MUTE / TYPING PROTECTION
              // If user is typing or manually muted, silence the input
              // to prevent keyboard noise from interrupting the model.
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
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.interrupted) {
                stopAudioPlayback();
                stopSilenceTimer(); // User interrupted, so they are active
                return;
            }

            if (msg.serverContent?.inputTranscription) {
                const text = msg.serverContent.inputTranscription.text;
                activeUserMessageRef.current += text;
                const turnId = `user-stream-${activeTurnIdRef.current || 'pending'}`;
                addLog('user', activeUserMessageRef.current, turnId);
                
                // Definitive User Activity
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

                // --- MODEL TURN DONE: Start Silence Timer ---
                startSilenceTimer();
            }
            
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'searchKnowledgeBase') {
                  const query = (fc.args as any).query;
                  
                  // --- RETRIEVAL GATE & TELEPORT LOGIC ---
                  
                  // 1. GATE: Should we search?
                  const gateDecision = RetrievalGate.evaluate(query, selectedAgentId);
                  if (!gateDecision.shouldRetrieve) {
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Memory retrieval skipped (Not required for this query)." } } }));
                      continue;
                  }

                  // 2. TELEPORT: Try Exact Sigil Match
                  const sigil = NumMarkX_GenerateSigil(query);
                  const directHit = await findDocumentBySigil(sigil);
                  
                  if (directHit) {
                      setSystemStatus("Teleport: Instant Sigil Lock");
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: JSON.stringify([directHit]) } } }));
                      continue;
                  }

                  // 3. VECTOR SEARCH: Generate Embedding + Search
                  let queryVector = undefined;
                  try {
                      // We can use the existing `ai` instance from the connect scope, OR create a new lightweight one for just this call
                      // The current `ai` instance is bound to the live session, but `ai.models.embedContent` is stateless.
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
                          modelConfig: currentConfig.modelConfig
                      });
                      setAgentInstruction(newInstruction);
                      
                      setSystemStatus('Agent Updated Instructions.');
                      showToast('Agent learned a new preference', 'success');
                      
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Instructions updated." } } }));
                  } catch(e) {
                      console.error(e);
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Failed to update instructions." } } }));
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
                       
                       // STAMP WITH NUMMARK ON SAVE
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
                      // Attempt translation via OpenL.io
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
                      // Fallback: Inform model to use internal knowledge
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
          <div className="system-status-header"><span className="terminal-cursor" style={{marginRight:'0.5rem'}}></span>{systemStatus}</div>
          <div className="status-item">SYNC: <span style={{color: connectionState === ConnectionState.CONNECTED ? '#4ade80' : '#666'}}>{connectionState}</span></div>
        </div>
      </div>

      <div className="control-panel">
        {/* ROW 1: PRIMARY CONFIGURATION */}
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
                  <div style={{display:'flex', gap:'0.25rem', flex:'1 1 auto', minWidth:'120px'}}>
                    <input 
                      type="text" 
                      value={customVoiceName}
                      onChange={(e) => setCustomVoiceName(e.target.value)}
                      placeholder="Voice ID..."
                      className="form-input"
                      style={{padding:'0.5rem', fontFamily: 'monospace', fontSize: '0.75rem', height: '2.5rem'}}
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

        {/* ROW 2: ACTION & TOOLS */}
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
              style={{ padding: '0.5rem 0.75rem' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
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
                                  <select 
                                      value={gatingModel}
                                      onChange={(e) => setGatingModel(e.target.value)}
                                      className="gating-select"
                                  >
                                      {GATING_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                  </select>
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
              
              {/* Cloud File Selector - Shows only if Deep Analysis is active OR a cloud file is already selected */}
              {(useDeepAnalysis || activeCloudFileUri) && availableCloudFiles.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.25rem' }}>
                      <span style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 'bold' }}>CLOUD CONTEXT:</span>
                      <select 
                          value={activeCloudFileUri}
                          onChange={(e) => {
                              setActiveCloudFileUri(e.target.value);
                              // Auto-enable deep analysis if a cloud file is picked
                              if (e.target.value) setUseDeepAnalysis(true);
                          }}
                          className="gating-select"
                          style={{ maxWidth: '300px' }}
                      >
                          <option value="">-- None Selected --</option>
                          {availableCloudFiles.map(f => (
                              <option key={f.name} value={f.uri}>
                                  {f.displayName} ({(parseInt(f.sizeBytes)/1024/1024).toFixed(1)}MB)
                              </option>
                          ))}
                      </select>
                  </div>
              )}

              <input 
                  type="text" 
                  className="chat-input" 
                  placeholder={connectionState === ConnectionState.CONNECTED ? (isMicMuted ? "Type message (Mic Muted)..." : "Type a message...") : "Connect to chat..."}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                  disabled={connectionState !== ConnectionState.CONNECTED}
                  onFocus={() => { isTypingRef.current = true; }}
                  onBlur={() => { 
                      setTimeout(() => { isTypingRef.current = false; }, 200); 
                  }}
              />
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
