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
    const [isPlaying, setIsPlaying] = useState(false);

    // Audio Contexts
    const audioContextRef = useRef<AudioContext | null>(null);
    const inputContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const activeSourcesCountRef = useRef(0);
    
    // Disconnect Flag to suppress "Cancelled" errors during teardown
    const isIntentionalDisconnect = useRef(false);

    // Config Refs to prevent stale closures in callbacks
    const configRef = useRef({ apiKey, modelName, systemInstruction, voiceName, tools, isMicOn });
    useEffect(() => {
        configRef.current = { apiKey, modelName, systemInstruction, voiceName, tools, isMicOn };
    }, [apiKey, modelName, systemInstruction, voiceName, tools, isMicOn]);

    // Callback Ref to prevent stale closures
    const callbackRef = useRef({ onLog, onToolCall });
    useEffect(() => {
        callbackRef.current = { onLog, onToolCall };
    }, [onLog, onToolCall]);


    const connect = useCallback(async () => {
        if (!configRef.current.apiKey) return;
        
        // Reset state
        isIntentionalDisconnect.current = false;
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
                        callbackRef.current.onLog({ id: crypto.randomUUID(), type: 'system', text: 'Live Session Connected', timestamp: Date.now() });
                        
                        // Start Mic Stream
                        if (inputContextRef.current) {
                            const source = inputContextRef.current.createMediaStreamSource(stream);
                            const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
                            
                            processor.onaudioprocess = (e) => {
                                // STOP sending if we are disconnecting to prevent race conditions
                                if (isIntentionalDisconnect.current) return;
                                if (!configRef.current.isMicOn) return;
                                
                                const inputData = e.inputBuffer.getChannelData(0);
                                const pcmBlob = createPcmBlob(inputData);
                                
                                sessionPromise.then(session => {
                                    // Guard against sending to closed session
                                    if (isIntentionalDisconnect.current) return;
                                    session.sendRealtimeInput({ media: pcmBlob });
                                }).catch(err => {
                                    // Swallow errors during disconnect
                                    if(!isIntentionalDisconnect.current) console.warn("Input Send Error:", err);
                                });
                            };
                            
                            source.connect(processor);
                            processor.connect(inputContextRef.current.destination);
                        }
                    },
                    onmessage: async (msg: LiveServerMessage) => {
                        if (isIntentionalDisconnect.current) return;

                        // A. Tool Handling
                        if (msg.toolCall && callbackRef.current.onToolCall) {
                            setIsThinking(true);
                            try {
                                const responses = await callbackRef.current.onToolCall(msg.toolCall);
                                if (responses.length > 0 && !isIntentionalDisconnect.current) {
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
                            
                            source.onended = () => {
                                sourcesRef.current.delete(source);
                                activeSourcesCountRef.current--;
                                if (activeSourcesCountRef.current <= 0) {
                                    activeSourcesCountRef.current = 0;
                                    setIsPlaying(false);
                                }
                            };
                            
                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration;
                            
                            sourcesRef.current.add(source);
                            activeSourcesCountRef.current++;
                            setIsPlaying(true);
                        }

                        // C. Transcripts (Text Logs)
                        if (msg.serverContent?.inputTranscription?.text) {
                            callbackRef.current.onLog({ id: crypto.randomUUID(), type: 'user', text: msg.serverContent.inputTranscription.text, timestamp: Date.now(), isStreaming: true });
                        }
                        if (msg.serverContent?.outputTranscription?.text) {
                            callbackRef.current.onLog({ id: crypto.randomUUID(), type: 'model', text: msg.serverContent.outputTranscription.text, timestamp: Date.now(), isStreaming: true });
                        }
                        if (msg.serverContent?.turnComplete) {
                           setIsThinking(false);
                        }
                        if (msg.serverContent?.interrupted) {
                            sourcesRef.current.forEach(s => s.stop());
                            sourcesRef.current.clear();
                            nextStartTimeRef.current = 0;
                            activeSourcesCountRef.current = 0;
                            setIsPlaying(false);
                            callbackRef.current.onLog({ id: crypto.randomUUID(), type: 'system', text: '[Interrupted]', timestamp: Date.now() });
                        }
                    },
                    onclose: () => {
                        setConnectionState(ConnectionState.DISCONNECTED);
                        activeSourcesCountRef.current = 0;
                        setIsPlaying(false);
                        callbackRef.current.onLog({ id: crypto.randomUUID(), type: 'system', text: 'Disconnected', timestamp: Date.now() });
                    },
                    onerror: (err: any) => {
                        // Suppress expected errors during teardown
                        if (isIntentionalDisconnect.current) return;
                        
                        // Suppress generic streaming cancellation errors which happen often
                        if (err.message?.includes('cancelled') || err.message?.includes('streaming context')) return;

                        console.error(err);
                        setConnectionState(ConnectionState.ERROR);
                        activeSourcesCountRef.current = 0;
                        setIsPlaying(false);
                        callbackRef.current.onLog({ id: crypto.randomUUID(), type: 'system', text: `Error: ${err.message}`, timestamp: Date.now() });
                    }
                }
            });
            
            sessionPromiseRef.current = sessionPromise;

        } catch (e: any) {
            console.error(e);
            setConnectionState(ConnectionState.ERROR);
            activeSourcesCountRef.current = 0;
            setIsPlaying(false);
            callbackRef.current.onLog({ id: crypto.randomUUID(), type: 'system', text: `Connection Failed: ${e.message}`, timestamp: Date.now() });
        }
    }, []);

    const disconnect = useCallback(async () => {
        // 1. Mark intentional to suppress "Thread Cancelled" errors
        isIntentionalDisconnect.current = true;
        
        // 2. Stop Audio/Input Contexts immediately to prevent new data sending
        if (inputContextRef.current) {
            await inputContextRef.current.close();
            inputContextRef.current = null;
        }
        if (audioContextRef.current) {
            await audioContextRef.current.close();
            audioContextRef.current = null;
        }

        // 3. Close Session safely
        if (sessionPromiseRef.current) {
            try {
                const session = await sessionPromiseRef.current;
                if (session && session.close) {
                    session.close();
                }
            } catch(e) {
                console.warn("Session close error suppressed:", e);
            }
            sessionPromiseRef.current = null;
        }
        
        setConnectionState(ConnectionState.DISCONNECTED);
        activeSourcesCountRef.current = 0;
        setIsPlaying(false);
    }, []);

    const sendText = useCallback(async (text: string) => {
        if (sessionPromiseRef.current && !isIntentionalDisconnect.current) {
            try {
                const session = await sessionPromiseRef.current;
                session.sendRealtimeInput({
                    turns: [{ role: 'user', parts: [{ text }] }]
                });
            } catch(e) {
                if(!isIntentionalDisconnect.current) console.error("Send Text Error:", e);
            }
        }
    }, []);

    const sendRealtimeInput = useCallback(async (input: any) => {
        if (sessionPromiseRef.current && !isIntentionalDisconnect.current) {
            try {
                const session = await sessionPromiseRef.current;
                session.sendRealtimeInput(input);
            } catch(e) {
                // Silently fail if session is busy/closed
            }
        }
    }, []);

    const stopPlayback = useCallback(() => {
        sourcesRef.current.forEach(s => {
            try {
                s.stop();
            } catch (e) {
                // Ignore errors if source is already stopped
            }
        });
        sourcesRef.current.clear();
        nextStartTimeRef.current = 0;
        activeSourcesCountRef.current = 0;
        setIsPlaying(false);
        callbackRef.current.onLog({ id: crypto.randomUUID(), type: 'system', text: '[Playback Interrupted by User Action]', timestamp: Date.now() });
    }, []);

    return {
        connect,
        disconnect,
        connectionState,
        analyser: analyserRef.current,
        sendText,
        sendRealtimeInput,
        stopPlayback,
        isMicOn,
        setIsMicOn,
        isThinking,
        isPlaying // Exposed for UI visualization and queue logic
    };
}
