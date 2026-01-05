
import React, { useState, useEffect, useRef } from 'react';
import { MultiAgentMessage, LogMessage, KnowledgeDoc, ChatSession } from '../types';
import { MultiAgentService, AgentAttachment } from '../services/multiAgent';
import { AGENTS } from '../agents';
import { 
    getGeneralInstructions, 
    getDocumentCountByAgentId, 
    saveActiveChat, 
    loadActiveChat,
    getLorePacksByAgentId,
    bulkAddDocuments,
    saveChatSession
} from '../services/db';
import { RoomFocusService } from '../services/roomFocus';
import { IngestionService } from '../services/ingestion';

interface MultiAgentConsoleProps {
    onExit: () => void;
}

const CONFERENCE_ID = 'CONFERENCE_MAIN';
const ARCHIVAX_ID = 'ARCHIVAX';

// Agents for conference - All active agents
const CONFERENCE_AGENTS = AGENTS;

export const MultiAgentConsole: React.FC<MultiAgentConsoleProps> = ({ onExit }) => {
    const [messages, setMessages] = useState<MultiAgentMessage[]>([]);
    const [input, setInput] = useState('');
    
    const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set(CONFERENCE_AGENTS.map(a => a.id))); 
    const [initializingAgents, setInitializingAgents] = useState<Set<string>>(new Set());
    
    // Tracks agents currently being hydrated from DB or File
    const [loadingAgents, setLoadingAgents] = useState<Set<string>>(new Set());
    
    const [agentCounts, setAgentCounts] = useState<Record<string, number>>({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [generalInstructions, setGeneralInstructions] = useState('');
    
    const [attachment, setAttachment] = useState<AgentAttachment | null>(null);
    const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
    
    // Modal State for Missing Lore
    const [missingLoreModal, setMissingLoreModal] = useState<{ isOpen: boolean, missingIds: string[] }>({ isOpen: false, missingIds: [] });
    // Tracks which agent we are currently uploading for
    const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const loreUploadRef = useRef<HTMLInputElement>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    
    // Ref to access current messages state in async callbacks
    const messagesRef = useRef<MultiAgentMessage[]>([]);

    // --- INITIALIZATION ---
    useEffect(() => {
        getGeneralInstructions().then(setGeneralInstructions);
        
        const initRoom = async () => {
            const counts: Record<string, number> = {};
            let onlineCount = 0;

            setActiveAgents(new Set()); 

            for (const agent of CONFERENCE_AGENTS) {
                setInitializingAgents(prev => new Set(prev).add(agent.id));
                await new Promise(r => setTimeout(r, 50));
                
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
                        addMessage('SYSTEM', 'WARNING', 'No agents have LorePacks loaded. Click agents to restore from library.', 'system');
                    } else {
                        addMessage('SYSTEM', 'ARCHIVAX', `Link Established. Focus: ${focus.title.toUpperCase()}. ${onlineCount} Agents Online.`, 'system');
                    }
                }
            } catch (e) {
                console.error("Failed to load conference history", e);
            }
        };

        initRoom();
    }, []);

    // Sync Ref
    useEffect(() => {
        messagesRef.current = messages;
        
        // Auto-save active state
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

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
        }
    }, [input]);

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

    // --- PERSISTENCE ---
    const handlePersistSession = async (title: string) => {
        try {
            const logs: LogMessage[] = messagesRef.current.map(m => ({
                id: m.id,
                type: m.senderId === 'USER' ? 'user' : (m.senderId === 'SYSTEM' ? 'system' : 'model'),
                text: m.senderId === 'USER' || m.senderId === 'SYSTEM' 
                    ? m.text 
                    : `[${m.senderName}]: ${m.text}`, // Prefix agent name for flat log compatibility
                timestamp: m.timestamp,
                attachment: m.attachment,
                attachmentType: m.attachment ? 'image' : undefined
            }));

            const session: ChatSession = {
                id: crypto.randomUUID(),
                title: title,
                timestamp: Date.now(),
                logs: logs
            };

            await saveChatSession(session);
            addMessage('SYSTEM', 'ARCHIVAX', `SESSION ARCHIVED: "${title}"`, 'system');
        } catch (e) {
            console.error("Failed to save session", e);
            addMessage('SYSTEM', 'ERROR', `Failed to archive session.`, 'system');
        }
    };

    // --- AGENT & LORE LOADING LOGIC ---

    const attemptRestoreLore = async (agentId: string): Promise<boolean> => {
        const packs = await getLorePacksByAgentId(agentId);
        if (packs.length > 0) {
            // Find most recent pack
            const latest = packs.sort((a,b) => b.header.timestamp - a.header.timestamp)[0];
            
            // Re-stamp timestamps to bring them to current context
            const docs = latest.sacred_archive.map(d => ({
                ...d,
                agentId: agentId,
                timestamp: Date.now()
            }));
            
            await bulkAddDocuments(docs);
            return true;
        }
        return false;
    };

    const handleAgentClick = async (id: string) => {
        const currentCount = agentCounts[id] || 0;
        
        // 1. If Online, Toggle Off/On in Active Set
        if (currentCount > 0) {
            setActiveAgents(prev => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            });
            return;
        }

        // 2. If Offline, Try to Restore
        setLoadingAgents(prev => new Set(prev).add(id));
        
        try {
            const restored = await attemptRestoreLore(id);
            if (restored) {
                // Update Counts and Activate
                const newCount = await getDocumentCountByAgentId(id);
                setAgentCounts(prev => ({ ...prev, [id]: newCount }));
                setActiveAgents(prev => new Set(prev).add(id));
                addMessage('SYSTEM', 'SYSTEM', `Restored knowledge for ${id}.`, 'system');
            } else {
                // Not found in DB, add to missing list for manual load
                setMissingLoreModal({ isOpen: true, missingIds: [id] });
            }
        } finally {
            setLoadingAgents(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    const handleSelectAll = async () => {
        const missing: string[] = [];
        
        // Sequential to avoid race conditions on DB or UI
        for (const agent of CONFERENCE_AGENTS) {
            const count = agentCounts[agent.id] || 0;
            
            if (count > 0) {
                setActiveAgents(prev => new Set(prev).add(agent.id));
            } else {
                // Try restore
                setLoadingAgents(prev => new Set(prev).add(agent.id));
                const restored = await attemptRestoreLore(agent.id);
                if (restored) {
                    const newCount = await getDocumentCountByAgentId(agent.id);
                    setAgentCounts(prev => ({ ...prev, [agent.id]: newCount }));
                    setActiveAgents(prev => new Set(prev).add(agent.id));
                } else {
                    missing.push(agent.id);
                }
                setLoadingAgents(prev => { const n = new Set(prev); n.delete(agent.id); return n; });
            }
        }

        if (missing.length > 0) {
            setMissingLoreModal({ isOpen: true, missingIds: missing });
        }
    };

    // --- EXTERNAL LORE UPLOAD ---

    const initiateUpload = (agentId: string) => {
        setUploadTargetId(agentId);
        if(loreUploadRef.current) loreUploadRef.current.click();
    };

    const handleExternalLoreLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !uploadTargetId) return;

        // Don't close modal yet, we might error.
        
        const targetId = uploadTargetId;
        
        // Show loading state for target
        setLoadingAgents(new Set([targetId]));
        addMessage('SYSTEM', 'SYSTEM', `Validating LorePack for: ${targetId}...`, 'system');

        try {
            // Stream ingestion with Validation
            let batch: KnowledgeDoc[] = [];
            const BATCH_SIZE = 100;
            let count = 0;
            let headerChecked = false;

            for await (const obj of IngestionService.streamLorePack(file)) {
                
                // HEADER VALIDATION
                if (!headerChecked) {
                    // Check if object looks like a header or first node
                    const fileAgentId = obj.agentId || obj.header?.agentId;
                    
                    if (fileAgentId && fileAgentId !== targetId) {
                        throw new Error(`SECURITY ALERT: LorePack belongs to [${fileAgentId}], but you are attempting to upload to [${targetId}]. Operation Aborted.`);
                    }
                    headerChecked = true;
                }

                // Force assignment to targetId to be safe, but we validated above.
                const doc = IngestionService.normalizeNode(obj, targetId, count);
                batch.push(doc);
                count++;

                if (batch.length >= BATCH_SIZE) {
                    await bulkAddDocuments(batch);
                    batch = [];
                }
            }
            
            if (batch.length > 0) await bulkAddDocuments(batch);

            // Refresh Count
            const newCount = await getDocumentCountByAgentId(targetId);
            setAgentCounts(prev => ({ ...prev, [targetId]: newCount }));
            if (newCount > 0) setActiveAgents(prev => new Set(prev).add(targetId));
            
            // Remove from missing list if successful
            setMissingLoreModal(prev => ({
                ...prev,
                missingIds: prev.missingIds.filter(id => id !== targetId),
                isOpen: prev.missingIds.length > 1 // Close if this was the last one
            }));

            addMessage('SYSTEM', 'SUCCESS', `Ingested ${count} nodes for ${targetId}.`, 'system');

        } catch (err: any) {
            addMessage('SYSTEM', 'ERROR', `Lore Load Failed: ${err.message}`, 'system');
            alert(err.message);
        } finally {
            setLoadingAgents(new Set());
            setUploadTargetId(null);
            if (loreUploadRef.current) loreUploadRef.current.value = '';
        }
    };

    // --- FILE ATTACHMENTS ---

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const isImage = file.type.startsWith('image/');
            const isVideo = file.type.startsWith('video/');
            const isText = file.type === 'application/json' || file.name.endsWith('.md') || file.name.endsWith('.txt');

            if (!isImage && !isText && !isVideo) {
                alert("Unsupported file type. Use Image, Video, TXT, MD, or JSON");
                return;
            }

            const reader = new FileReader();
            reader.onload = (event) => {
                const result = event.target?.result as string;
                if (isImage) {
                    const base64 = result.split(',')[1];
                    setAttachment({ type: 'image', content: base64, mimeType: file.type, name: file.name });
                    setAttachmentPreview(result);
                } else if (isVideo) {
                    const base64 = result.split(',')[1];
                    setAttachment({ type: 'video', content: base64, mimeType: file.type, name: file.name });
                    setAttachmentPreview(result); // Video src can be data URL
                } else {
                    setAttachment({ type: 'text', content: result, mimeType: 'text/plain', name: file.name });
                    setAttachmentPreview('DOC: ' + file.name);
                }
            };
            
            if (isImage || isVideo) reader.readAsDataURL(file);
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
        if (textareaRef.current) textareaRef.current.style.height = '3.5rem'; // Reset height
        setAttachment(null);
        setAttachmentPreview(null);

        const displayAttachment = currentAttachment?.type === 'image' || currentAttachment?.type === 'video' ? currentPreview : undefined;
        let logText = userText;
        if (currentAttachment?.type === 'text') logText = `[FILE: ${currentAttachment.name}] ${logText}`;
        if (currentAttachment?.type === 'video') logText = `[VIDEO: ${currentAttachment.name}] ${logText}`;
        
        const userMentions = parseMentions(userText);
        let targetIds: string[] = [];
        
        if (userMentions.length > 0) {
            targetIds = userMentions;
        } else {
            targetIds = CONFERENCE_AGENTS.filter(a => activeAgents.has(a.id)).map(a => a.id);
        }

        addMessage('USER', 'DIRECTOR', logText, 'utterance', false, displayAttachment || undefined, targetIds);
        
        setIsProcessing(true);
        
        if (targetIds.length === 0) {
            addMessage('SYSTEM', 'SYSTEM', 'No capable agents available/targeted.', 'system');
            setIsProcessing(false);
            return;
        }

        const focus = RoomFocusService.getActive();
        const focusContext = `
=== ROOM FOCUS: ${focus.title.toUpperCase()} ===
SUMMARY: ${focus.summary}
RULES:
${focus.rules.map(r => "- " + r).join('\n')}
`;

        const currentRoster = CONFERENCE_AGENTS.filter(a => activeAgents.has(a.id));

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
                messagesRef.current, // Use Ref to get latest state including self
                generalInstructions,
                focusContext, 
                currentRoster,
                currentAttachment,
                0, // Initial Depth
                // VISUAL CALLBACK FOR DELEGATION
                (delegatedTarget) => {
                    updateMessage(msgId, `[SYNAPSE ACTIVE] Consulting ${delegatedTarget}...`);
                }
            );

            if (response.error) {
                updateMessage(msgId, `[CONNECTION LOST: ${response.error}]`);
            } else {
                updateMessage(msgId, response.text);
                
                // CHECK FOR SAVE COMMAND
                // Regex looks for [ACTION: SAVE_SESSION | title="..."]
                const saveMatch = response.text.match(/\[ACTION:\s*SAVE_SESSION\s*\|\s*title=['"](.*?)['"]\]/i);
                if (saveMatch) {
                    const title = saveMatch[1] || `Session-${Date.now()}`;
                    await handlePersistSession(title);
                }

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
        <div className="council-layout">
            {/* MISSING LORE MODAL */}
            {missingLoreModal.isOpen && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="section-panel" style={{ width: '500px', padding: '1.5rem', background: '#0a0a0a', border: '1px solid #facc15' }}>
                        <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
                            <div style={{ color: '#facc15', fontWeight: 'bold', marginBottom: '0.5rem', letterSpacing: '1px' }}>MISSING KNOWLEDGE DETECTED</div>
                            <p style={{ fontSize: '0.8rem', color: '#ccc' }}>
                                The following agents require authorization to initialize their LorePacks.
                            </p>
                        </div>
                        
                        {/* Hidden Input for Specific Uploads */}
                        <input 
                            type="file" 
                            accept=".json" 
                            className="hidden" 
                            onChange={handleExternalLoreLoad} 
                            ref={loreUploadRef}
                        />

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '300px', overflowY: 'auto' }}>
                            {missingLoreModal.missingIds.map(id => (
                                <div key={id} className="section-panel" style={{ padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: '#333' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <div className="agent-avatar" style={{ width: '24px', height: '24px', fontSize: '0.6rem' }}>
                                            {id.substring(0,2)}
                                        </div>
                                        <span style={{ fontWeight: 'bold', color: '#eee' }}>{id}</span>
                                    </div>
                                    <button 
                                        onClick={() => initiateUpload(id)}
                                        className="btn btn-xs btn-accent"
                                        title={`Upload LorePack specific to ${id}`}
                                    >
                                        UPLOAD PACK
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div className="flex-group" style={{ marginTop: '1.5rem' }}>
                            <button 
                                onClick={() => setMissingLoreModal({ isOpen: false, missingIds: [] })} 
                                className="btn btn-secondary"
                                style={{ flex: 1 }}
                            >
                                CANCEL
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="council-sidebar">
                <div style={{ paddingBottom: '1rem', borderBottom: '1px solid #333' }}>
                    <div className="section-header-title" style={{ marginBottom: '0.5rem', color: '#38bdf8' }}>COUNCIL ROSTER</div>
                    <div className="flex-group">
                        <button className="btn btn-secondary btn-xs" style={{ flex: 1 }} onClick={handleSelectAll}>SELECT ALL</button>
                        <button className="btn btn-secondary btn-xs" style={{ flex: 1 }} onClick={() => setActiveAgents(new Set())}>NONE</button>
                    </div>
                </div>
                
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {CONFERENCE_AGENTS.map(agent => {
                        const count = agentCounts[agent.id] || 0;
                        const hasLore = count > 0;
                        const isActive = activeAgents.has(agent.id);
                        const isInit = initializingAgents.has(agent.id);
                        const isLoading = loadingAgents.has(agent.id);
                        
                        return (
                            <div 
                                key={agent.id} 
                                onClick={() => !isLoading && handleAgentClick(agent.id)}
                                className={`agent-card ${isActive ? 'active' : ''} ${!hasLore && !isLoading ? 'disabled' : ''} ${isLoading ? 'loading' : ''}`}
                            >
                                <div className="agent-avatar">
                                    {isInit || isLoading ? <span className="animate-pulse">●</span> : agent.handle.substring(0,2).toUpperCase()}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#eee' }}>{agent.handle}</div>
                                    <div style={{ fontSize: '0.65rem', color: isLoading ? '#facc15' : (hasLore ? (isActive ? '#4ade80' : '#666') : '#f87171') }}>
                                        {isLoading ? 'RESTORING...' : (hasLore ? `${count} DOCS` : 'OFFLINE')}
                                    </div>
                                </div>
                                {isActive && <span style={{ color: '#4ade80', fontSize: '0.7rem' }}>●</span>}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="council-main">
                <div className="council-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontSize: '1rem', fontWeight: 'bold', color: '#eee', letterSpacing: '2px' }}>MYTHOS PROTOCOL</span>
                        <span style={{ fontSize: '0.7rem', color: '#666', border: '1px solid #333', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                            FOCUS: {RoomFocusService.getActive().id}
                        </span>
                    </div>
                    <div className="flex-group">
                        <button onClick={handleClearHistory} className="btn btn-danger btn-xs">CLEAR TRANSCRIPT</button>
                        <button onClick={onExit} className="btn btn-secondary btn-xs" style={{ borderColor: '#facc15', color: '#facc15' }}>EXIT TO UPLINK</button>
                    </div>
                </div>

                <div className="council-transcript">
                    {messages.map(msg => (
                        <div key={msg.id} className={`council-msg ${msg.senderId === 'USER' ? 'user' : (msg.senderId === 'SYSTEM' ? 'system' : 'agent')}`}>
                            {msg.senderId !== 'SYSTEM' && (
                                <span className="council-sender" style={{ color: msg.senderId === 'USER' ? '#38bdf8' : '#a78bfa' }}>
                                    {msg.senderName} 
                                    {msg.targets && msg.targets.length > 0 && <span style={{ opacity: 0.5, marginLeft: '0.5rem', fontWeight: 'normal', fontSize: '0.65rem' }}>to {msg.targets.length} agents</span>}
                                </span>
                            )}
                            
                            {msg.attachment && msg.attachment.startsWith('data:image') && (
                                <img src={msg.attachment} alt="Attachment" style={{ maxWidth: '100%', borderRadius: '4px', border: '1px solid #333', marginBottom: '0.5rem' }} />
                            )}
                            
                            {msg.attachment && msg.attachment.startsWith('data:video') && (
                                <video controls src={msg.attachment} style={{ maxWidth: '100%', borderRadius: '4px', border: '1px solid #333', marginBottom: '0.5rem' }} />
                            )}
                            
                            <div style={{ whiteSpace: 'pre-wrap', opacity: msg.isThinking ? 0.6 : 1 }}>{msg.text}</div>
                        </div>
                    ))}
                    <div ref={endRef} />
                </div>

                <div className="council-input-area">
                    <input type="file" accept="image/*,video/*,.txt,.md,.json" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
                    
                    <button 
                        className="btn btn-secondary btn-icon btn-xl" 
                        onClick={() => fileInputRef.current?.click()} 
                        disabled={isProcessing}
                        title="Attach File (Image, Video, Text)"
                        style={{ marginRight: '0.5rem' }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                    </button>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {attachment && (
                            <div className="section-panel" style={{ padding: '0.25rem 0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: '#4ade80' }}>
                                <span style={{ fontSize: '0.75rem', color: '#4ade80' }}>
                                    ATTACHED: {attachment.name || attachment.type.toUpperCase()}
                                </span>
                                <button onClick={clearAttachment} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontWeight: 'bold' }}>×</button>
                            </div>
                        )}
                        <textarea 
                            ref={textareaRef}
                            className="auto-expand-textarea" 
                            placeholder={isProcessing ? "Agents are deliberating..." : "Broadcast to Council (or use @AgentName)..."} 
                            value={input} 
                            onChange={e => setInput(e.target.value)} 
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleBroadcast();
                                }
                            }} 
                            disabled={isProcessing} 
                        />
                    </div>

                    <button 
                        className="btn btn-primary btn-xl" 
                        onClick={handleBroadcast} 
                        disabled={isProcessing || (!input.trim() && !attachment)} 
                        style={{ fontWeight: 'bold', fontSize: '0.9rem', marginLeft: '0.5rem' }}
                    >
                        {isProcessing ? 'PROCESSING' : 'BROADCAST'}
                    </button>
                </div>
            </div>
        </div>
    );
};
