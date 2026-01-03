
import React, { useState, useEffect, useRef } from 'react';
import { MultiAgentMessage, LogMessage } from '../types';
import { MultiAgentService, AgentAttachment } from '../services/multiAgent';
import { AGENTS } from '../agents';
import { 
    getGeneralInstructions, 
    getDocumentCountByAgentId, 
    saveActiveChat, 
    loadActiveChat 
} from '../services/db';
import { RoomFocusService } from '../services/roomFocus';

interface MultiAgentConsoleProps {
    onClose: () => void;
}

const CONFERENCE_ID = 'CONFERENCE_MAIN';
const ARCHIVAX_ID = 'ARCHIVAX';

// Filter out Gemini Core for the Multi-Agent Conference
const CONFERENCE_AGENTS = AGENTS.filter(a => a.id !== 'GEMINI_CORE');

export const MultiAgentConsole: React.FC<MultiAgentConsoleProps> = ({ onClose }) => {
    const [messages, setMessages] = useState<MultiAgentMessage[]>([]);
    const [input, setInput] = useState('');
    
    const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set(CONFERENCE_AGENTS.map(a => a.id))); 
    const [initializingAgents, setInitializingAgents] = useState<Set<string>>(new Set());
    
    const [agentCounts, setAgentCounts] = useState<Record<string, number>>({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [generalInstructions, setGeneralInstructions] = useState('');
    
    const [attachment, setAttachment] = useState<AgentAttachment | null>(null);
    const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const endRef = useRef<HTMLDivElement>(null);

    // --- INITIALIZATION ---
    useEffect(() => {
        getGeneralInstructions().then(setGeneralInstructions);
        
        const initRoom = async () => {
            const counts: Record<string, number> = {};
            let onlineCount = 0;

            setActiveAgents(new Set()); 

            for (const agent of CONFERENCE_AGENTS) {
                setInitializingAgents(prev => new Set(prev).add(agent.id));
                await new Promise(r => setTimeout(r, 100));
                
                const count = await getDocumentCountByAgentId(agent.id);
                counts[agent.id] = count;
                
                if (count > 0) {
                    onlineCount++;
                    setActiveAgents(prev => new Set(prev).add(agent.id));
                }
                
                setInitializingAgents(prev => {
                    const next = new Set(prev);
                    next.delete(agent.id);
                    return next;
                });
            }
            setAgentCounts(counts);

            try {
                const savedLogs = await loadActiveChat(CONFERENCE_ID);
                if (savedLogs && savedLogs.length > 0) {
                    const restoredMessages: MultiAgentMessage[] = savedLogs.map(log => {
                        try {
                            return JSON.parse(log.text);
                        } catch {
                            return {
                                id: log.id,
                                senderId: log.type === 'user' ? 'USER' : 'SYSTEM',
                                senderName: log.type === 'user' ? 'DIRECTOR' : 'SYSTEM',
                                text: log.text,
                                timestamp: log.timestamp,
                                isThinking: false,
                                msgType: log.type === 'system' ? 'system' : 'utterance'
                            };
                        }
                    });
                    setMessages(restoredMessages);
                } else {
                    const focus = RoomFocusService.getActive();
                    if (onlineCount === 0) {
                        addMessage('SYSTEM', 'WARNING', 'No agents have LorePacks loaded. Please return to Uplink and ingest knowledge.', 'system');
                    } else {
                        addMessage('SYSTEM', 'ARCHIVAX', `Session Initialized. Focus: ${focus.title.toUpperCase()}. ${onlineCount} Agents Online.`, 'system');
                    }
                }
            } catch (e) {
                console.error("Failed to load conference history", e);
            }
        };

        initRoom();
    }, []);

    useEffect(() => {
        if (messages.length > 0) {
            const logsToSave: LogMessage[] = messages.map(m => ({
                id: m.id,
                type: m.senderId === 'USER' ? 'user' : (m.senderId === 'SYSTEM' ? 'system' : 'model'),
                text: JSON.stringify(m),
                timestamp: m.timestamp
            }));
            saveActiveChat(CONFERENCE_ID, logsToSave).catch(console.error);
            saveActiveChat(ARCHIVAX_ID, logsToSave).catch(console.error);
        }
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const addMessage = (
        senderId: string, 
        senderName: string, 
        text: string, 
        msgType: 'utterance' | 'action' | 'thought' | 'system' = 'utterance',
        isThinking = false, 
        msgAttachment?: string,
        targets?: string[]
    ) => {
        const msg: MultiAgentMessage = {
            id: crypto.randomUUID(),
            senderId,
            senderName,
            text,
            timestamp: Date.now(),
            isThinking,
            attachment: msgAttachment,
            targets,
            msgType
        };
        setMessages(prev => [...prev, msg]);
        return msg.id;
    };

    const updateMessage = (id: string, text: string) => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, text, isThinking: false } : m));
    };

    const handleClearHistory = async () => {
        if(!window.confirm("Clear current session history? This cannot be undone.")) return;
        setMessages([]);
        await saveActiveChat(CONFERENCE_ID, []);
        await saveActiveChat(ARCHIVAX_ID, []);
        addMessage('SYSTEM', 'ARCHIVAX', 'Chat Cleared. New session started.', 'system');
    };

    const toggleAgent = (id: string) => {
        if ((agentCounts[id] || 0) === 0) return; 
        setActiveAgents(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAllCapable = async () => {
        setActiveAgents(new Set());
        for (const agent of CONFERENCE_AGENTS) {
            if ((agentCounts[agent.id] || 0) > 0) {
                setInitializingAgents(prev => new Set(prev).add(agent.id));
                await new Promise(r => setTimeout(r, 50)); 
                setActiveAgents(prev => new Set(prev).add(agent.id));
                setInitializingAgents(prev => { const n = new Set(prev); n.delete(agent.id); return n; });
            }
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const isImage = file.type.startsWith('image/');
            const isText = file.type === 'application/json' || file.name.endsWith('.md') || file.name.endsWith('.txt');

            if (!isImage && !isText) {
                alert("Unsupported file type. Use Image, TXT, MD, or JSON");
                return;
            }

            const reader = new FileReader();
            reader.onload = (event) => {
                const result = event.target?.result as string;
                if (isImage) {
                    const base64 = result.split(',')[1];
                    setAttachment({ type: 'image', content: base64, mimeType: file.type, name: file.name });
                    setAttachmentPreview(result);
                } else {
                    setAttachment({ type: 'text', content: result, mimeType: 'text/plain', name: file.name });
                    setAttachmentPreview('DOC: ' + file.name);
                }
            };
            
            if (isImage) reader.readAsDataURL(file);
            else reader.readAsText(file);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const clearAttachment = () => {
        setAttachment(null);
        setAttachmentPreview(null);
    };

    const parseMentions = (text: string): string[] => {
        const mentions = new Set<string>();
        const regex = /@(\w+)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const name = match[1].toLowerCase();
            const agent = CONFERENCE_AGENTS.find(a => a.handle.toLowerCase() === name);
            if (agent && (agentCounts[agent.id] || 0) > 0) {
                mentions.add(agent.id);
            }
        }
        return Array.from(mentions);
    };

    const handleBroadcast = async () => {
        if ((!input.trim() && !attachment) || isProcessing) return;
        
        const userText = input.trim();
        const currentAttachment = attachment;
        const currentPreview = attachmentPreview; 

        setInput('');
        setAttachment(null);
        setAttachmentPreview(null);

        const displayAttachment = currentAttachment?.type === 'image' ? currentPreview : undefined;
        let logText = userText;
        if (currentAttachment?.type === 'text') logText = `[FILE: ${currentAttachment.name}] ${logText}`;
        
        const userMentions = parseMentions(userText);
        let targetIds: string[] = [];
        
        if (userMentions.length > 0) {
            targetIds = userMentions;
        } else {
            targetIds = CONFERENCE_AGENTS.filter(a => activeAgents.has(a.id)).map(a => a.id);
        }

        // ENVELOPE: Create user message with Explicit Targets
        addMessage('USER', 'DIRECTOR', logText, 'utterance', false, displayAttachment || undefined, targetIds);
        
        setIsProcessing(true);
        
        if (targetIds.length === 0) {
            addMessage('SYSTEM', 'SYSTEM', 'No capable agents available/targeted.', 'system');
            setIsProcessing(false);
            return;
        }

        // --- ROOM FOCUS INJECTION ---
        const focus = RoomFocusService.getActive();
        const focusContext = `
=== ROOM FOCUS: ${focus.title.toUpperCase()} ===
SUMMARY: ${focus.summary}
RULES:
${focus.rules.map(r => "- " + r).join('\n')}
`;

        const spokenSet = new Set<string>();
        const processingQueue = [...targetIds];

        while (processingQueue.length > 0) {
            const currentAgentId = processingQueue.shift()!;
            
            if (spokenSet.has(currentAgentId)) continue;
            spokenSet.add(currentAgentId);

            const agent = CONFERENCE_AGENTS.find(a => a.id === currentAgentId);
            if (!agent) continue;

            if (spokenSet.size > 1) await new Promise(r => setTimeout(r, 1500));

            const msgId = addMessage(agent.id, agent.handle, 'Thinking...', 'thought', true);

            const response = await MultiAgentService.queryAgent(
                agent, 
                userText, 
                messages, 
                generalInstructions,
                focusContext, // Pass focus context
                currentAttachment 
            );

            if (response.error) {
                updateMessage(msgId, `[CONNECTION LOST: ${response.error}]`);
            } else {
                updateMessage(msgId, response.text);
                
                const newMentions = parseMentions(response.text);
                for (const mentionedId of newMentions) {
                    if (!spokenSet.has(mentionedId) && !processingQueue.includes(mentionedId)) {
                        processingQueue.push(mentionedId);
                    }
                }
            }
        }

        setIsProcessing(false);
    };

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', height: '100%', gap: '1rem' }}>
            <div className="section-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', overflow: 'hidden', padding: '0.75rem' }}>
                <div className="section-header" style={{ marginBottom: '0.5rem' }}><span className="section-header-title">ROSTER ({activeAgents.size})</span></div>
                <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {CONFERENCE_AGENTS.map(agent => {
                        const hasLore = (agentCounts[agent.id] || 0) > 0;
                        const isActive = activeAgents.has(agent.id);
                        const isInit = initializingAgents.has(agent.id);
                        return (
                            <div 
                                key={agent.id} 
                                onClick={() => toggleAgent(agent.id)}
                                title={hasLore ? `${agentCounts[agent.id]} documents loaded` : "No LorePack loaded (Offline)"}
                                style={{ 
                                    padding: '0.4rem', 
                                    background: isActive ? '#111' : '#000',
                                    border: '1px solid',
                                    borderColor: isActive ? '#4ade80' : '#333',
                                    borderRadius: '4px',
                                    cursor: hasLore ? 'pointer' : 'not-allowed',
                                    opacity: hasLore ? (isActive ? 1 : 0.6) : 0.3,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <div style={{ 
                                    width:'6px', height:'6px', borderRadius:'50%', flexShrink: 0,
                                    background: isInit ? '#facc15' : (hasLore ? (isActive ? '#4ade80' : '#666') : '#f87171') 
                                }} className={isInit ? 'animate-pulse' : ''} />
                                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                    <span style={{ fontWeight: 'bold', fontSize: '0.7rem', color: '#eee', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{agent.handle}</span>
                                    <span style={{ fontSize: '0.55rem', color: isInit ? '#facc15' : (hasLore ? '#666' : '#f87171') }}>
                                        {isInit ? 'MOUNTING...' : (hasLore ? 'ONLINE' : 'OFFLINE')}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div style={{ paddingTop: '0.5rem', borderTop: '1px solid #333', display: 'flex', gap: '0.25rem' }}>
                    <button className="btn btn-secondary" style={{ flex: 1, padding: '0.25rem', fontSize:'0.65rem' }} onClick={selectAllCapable}>ALL</button>
                    <button className="btn btn-secondary" style={{ flex: 1, padding: '0.25rem', fontSize:'0.65rem' }} onClick={() => setActiveAgents(new Set())}>NONE</button>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
                <div className="section-header" style={{ marginBottom: 0, paddingBottom: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
                    <span className="section-header-title">CONFERENCE TRANSCRIPT [REC: ARCHIVAX]</span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={handleClearHistory} className="btn btn-danger" style={{ width: 'auto' }}>CLEAR CHAT</button>
                        <button onClick={onClose} className="btn btn-secondary" style={{ width: 'auto' }}>EXIT TO UPLINK</button>
                    </div>
                </div>

                <div className="chat-history-container" style={{ flex: 1 }}>
                    {messages.map(msg => (
                        <div key={msg.id} className={`chat-message-base ${msg.senderId === 'USER' ? 'chat-message-user' : msg.senderId === 'SYSTEM' ? 'chat-message-system' : 'chat-message-model'}`}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize: '0.7rem', marginBottom: '0.2rem', opacity: 0.8, fontWeight: 'bold', color: msg.senderId === 'USER' ? '#aaddff' : (msg.senderId === 'SYSTEM' ? '#4ade80' : '#a78bfa') }}>
                                <span>{msg.senderName.toUpperCase()} <span style={{ opacity: 0.5, fontWeight: 'normal', marginLeft: '0.5rem' }}>{new Date(msg.timestamp).toLocaleTimeString()}</span></span>
                                {msg.targets && msg.targets.length > 0 && (
                                    <span style={{ fontSize:'0.6rem', color:'#666', border:'1px solid #333', padding:'0 4px', borderRadius:'3px' }}>
                                        To: {msg.targets.length === CONFERENCE_AGENTS.length ? 'ALL' : msg.targets.join(', ')}
                                    </span>
                                )}
                            </div>
                            {msg.attachment && msg.attachment.startsWith('data:image') && (
                                <div style={{ margin: '0.5rem 0' }}>
                                    <img src={msg.attachment} alt="Attachment" style={{ maxWidth: '200px', borderRadius: '4px', border: '1px solid #4ade80' }} />
                                </div>
                            )}
                            <div style={{ whiteSpace: 'pre-wrap', opacity: msg.isThinking ? 0.5 : 1 }}>
                                {msg.text}
                            </div>
                        </div>
                    ))}
                    <div ref={endRef} />
                </div>

                <div className="chat-input-container">
                    <input type="file" accept="image/*,.txt,.md,.json" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
                    <button className="btn btn-secondary btn-icon" onClick={() => fileInputRef.current?.click()} disabled={isProcessing} title="Attach File to Conference">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                    </button>
                    <div className="chat-input-wrapper">
                        {attachment && (
                            <div className="attachment-preview" style={{ padding: '0.25rem 0.5rem', marginBottom: '0.25rem', fontSize: '0.75rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {attachment.type === 'image' ? <img src={attachmentPreview || ''} alt="preview" style={{ width: '20px', height: '20px', objectFit: 'cover' }} /> : <span>📄</span>}
                                    <span style={{ color: '#a3a3a3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachment.type === 'image' ? 'Image Attached' : attachmentPreview}</span>
                                </div>
                                <button onClick={clearAttachment} style={{background:'none', border:'none', color:'#f87171', cursor:'pointer', fontWeight:'bold'}}>X</button>
                            </div>
                        )}
                        <input type="text" className="chat-input" placeholder={isProcessing ? "Agents are deliberating..." : "Broadcast to active agents (or use @Name)..."} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleBroadcast()} disabled={isProcessing} />
                    </div>
                    <button className="btn btn-secondary" onClick={handleBroadcast} disabled={isProcessing || (!input.trim() && !attachment)} style={{ width: 'auto', padding: '0 2rem' }}>{isProcessing ? 'BUSY' : 'BROADCAST'}</button>
                </div>
            </div>
        </div>
    );
};
