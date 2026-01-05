
import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Tool } from "@google/genai";
import { LogMessage, ConnectionState } from '../types';
import { createPcmBlob, base64ToUint8Array, decodeAudioData } from '../services/audioUtils';

interface UseGeminiLiveProps {
    apiKey: string;
    modelName: string;
    systemInstruction: string;
    voiceName: string;
    tools?: Tool[];
    onLog: (log: LogMessage) => void;
    onToolCall?: (toolCall: any) => Promise<any[]>; // Returns tool responses
}

export function useGeminiLive({ 
    apiKey, 
    modelName, 
    systemInstruction, 
    voiceName, 
    tools,
    onLog,
    onToolCall 
}: UseGeminiLiveProps) {
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [isMicOn, setIsMicOn] = useState(true);
    const [isThinking, setIsThinking] = useState(false);

    // Audio Contexts
    const audioContextRef = useRef<AudioContext | null>(null);
    const inputContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

    // Config Refs to prevent stale closures in callbacks
    const configRef = useRef({ apiKey, modelName, systemInstruction, voiceName, tools, isMicOn });
    useEffect(() => {
        configRef.current = { apiKey, modelName, systemInstruction, voiceName, tools, isMicOn };
    }, [apiKey, modelName, systemInstruction, voiceName, tools, isMicOn]);

    const connect = useCallback(async () => {
        if (!configRef.current.apiKey) return;
        
        setConnectionState(ConnectionState.CONNECTING);

        try {
            // 1. Setup Audio
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                analyserRef.current = audioContextRef.current.createAnalyser();
                analyserRef.current.fftSize = 512;
            }
            if (!inputContextRef.current) {
                inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            }
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // 2. Setup Client
            const ai = new GoogleGenAI({ apiKey: configRef.current.apiKey });
            
            const config = {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: configRef.current.voiceName } }
                },
                systemInstruction: configRef.current.systemInstruction,
                tools: configRef.current.tools,
                // Enable Transcriptions - Required for logs
                inputAudioTranscription: {}, 
                outputAudioTranscription: {} 
            };

            const sessionPromise = ai.live.connect({
                model: configRef.current.modelName,
                config,
                callbacks: {
                    onopen: () => {
                        setConnectionState(ConnectionState.CONNECTED);
                        onLog({ id: crypto.randomUUID(), type: 'system', text: 'Live Session Connected', timestamp: Date.now() });
                        
                        // Start Mic Stream
                        if (inputContextRef.current) {
                            const source = inputContextRef.current.createMediaStreamSource(stream);
                            const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
                            processor.onaudioprocess = (e) => {
                                if (!configRef.current.isMicOn) return;
                                const inputData = e.inputBuffer.getChannelData(0);
                                const pcmBlob = createPcmBlob(inputData);
                                sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
                            };
                            source.connect(processor);
                            processor.connect(inputContextRef.current.destination);
                        }
                    },
                    onmessage: async (msg: LiveServerMessage) => {
                        // A. Tool Handling
                        if (msg.toolCall && onToolCall) {
                            setIsThinking(true);
                            try {
                                const responses = await onToolCall(msg.toolCall);
                                if (responses.length > 0) {
                                    sessionPromise.then(session => session.sendToolResponse({ functionResponses: responses }));
                                }
                            } finally {
                                setIsThinking(false);
                            }
                        }

                        // B. Audio Output
                        const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (audioData && audioContextRef.current && analyserRef.current) {
                            const ctx = audioContextRef.current;
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                            const audioBuffer = await decodeAudioData(base64ToUint8Array(audioData), ctx, 24000);
                            const source = ctx.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(analyserRef.current);
                            analyserRef.current.connect(ctx.destination);
                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration;
                            source.onended = () => sourcesRef.current.delete(source);
                            sourcesRef.current.add(source);
                        }

                        // C. Transcripts (Text Logs)
                        if (msg.serverContent?.inputTranscription?.text) {
                            onLog({ id: crypto.randomUUID(), type: 'user', text: msg.serverContent.inputTranscription.text, timestamp: Date.now(), isStreaming: true });
                        }
                        if (msg.serverContent?.outputTranscription?.text) {
                            onLog({ id: crypto.randomUUID(), type: 'model', text: msg.serverContent.outputTranscription.text, timestamp: Date.now(), isStreaming: true });
                        }
                        if (msg.serverContent?.turnComplete) {
                           setIsThinking(false);
                        }
                        if (msg.serverContent?.interrupted) {
                            sourcesRef.current.forEach(s => s.stop());
                            sourcesRef.current.clear();
                            nextStartTimeRef.current = 0;
                            onLog({ id: crypto.randomUUID(), type: 'system', text: '[Interrupted]', timestamp: Date.now() });
                        }
                    },
                    onclose: () => {
                        setConnectionState(ConnectionState.DISCONNECTED);
                        onLog({ id: crypto.randomUUID(), type: 'system', text: 'Disconnected', timestamp: Date.now() });
                    },
                    onerror: (err) => {
                        console.error(err);
                        setConnectionState(ConnectionState.ERROR);
                        onLog({ id: crypto.randomUUID(), type: 'system', text: `Error: ${err}`, timestamp: Date.now() });
                    }
                }
            });
            
            sessionPromiseRef.current = sessionPromise;

        } catch (e: any) {
            console.error(e);
            setConnectionState(ConnectionState.ERROR);
            onLog({ id: crypto.randomUUID(), type: 'system', text: `Connection Failed: ${e.message}`, timestamp: Date.now() });
        }
    }, []);

    const disconnect = useCallback(() => {
        if (inputContextRef.current) inputContextRef.current.close();
        if (audioContextRef.current) audioContextRef.current.close();
        inputContextRef.current = null;
        audioContextRef.current = null;
        sessionPromiseRef.current?.then(s => s.close && s.close());
        sessionPromiseRef.current = null;
        setConnectionState(ConnectionState.DISCONNECTED);
    }, []);

    const sendText = useCallback(async (text: string) => {
        if (sessionPromiseRef.current) {
            const session = await sessionPromiseRef.current;
            // Check if send method exists to prevent crashes
            if (typeof session.send === 'function') {
                session.send({
                    clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true }
                });
            } else {
                console.warn("session.send is not available in this SDK version. Text input ignored.");
            }
        }
    }, []);

    const sendRealtimeInput = useCallback(async (input: any) => {
        if (sessionPromiseRef.current) {
            const session = await sessionPromiseRef.current;
            session.sendRealtimeInput(input);
        }
    }, []);

    return {
        connect,
        disconnect,
        connectionState,
        analyser: analyserRef.current,
        sendText,
        sendRealtimeInput,
        isMicOn,
        setIsMicOn,
        isThinking // Exposed for UI visualization
    };
}
