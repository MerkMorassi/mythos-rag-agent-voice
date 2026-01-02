
import React, { useState, useEffect, useRef } from 'react';
import { MultiAgentMessage } from '../types';
import { MultiAgentService } from '../services/multiAgent';
import { AGENTS } from '../agents';
import { getGeneralInstructions, getDocumentCountByAgentId } from '../services/db';

interface MultiAgentConsoleProps {
    onClose: () => void;
}

export const MultiAgentConsole: React.FC<MultiAgentConsoleProps> = ({ onClose }) => {
    const [messages, setMessages] = useState<MultiAgentMessage[]>([]);
    const [input, setInput] = useState('');
    
    // Initial state includes all, but useEffect will prune empty ones
    const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set(AGENTS.map(a => a.id))); 
    
    const [agentCounts, setAgentCounts] = useState<Record<string, number>>({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [generalInstructions, setGeneralInstructions] = useState('');
    
    // Auto-scroll
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        getGeneralInstructions().then(setGeneralInstructions);
        addMessage('SYSTEM', 'SYSTEM', 'Conference Room Initialized. Verifying LorePacks...');

        // Verify LorePacks
        const verifyAgents = async () => {
            const counts: Record<string, number> = {};
            let onlineCount = 0;
            
            for (const agent of AGENTS) {
                const count = await getDocumentCountByAgentId(agent.id);
                counts[agent.id] = count;
                if (count > 0) onlineCount++;
            }
            setAgentCounts(counts);

            // Prune agents without lore from the active set
            setActiveAgents(prev => {
                const next = new Set(prev);
                AGENTS.forEach(a => {
                    if ((counts[a.id] || 0) === 0) {
                        next.delete(a.id);
                    }
                });
                return next;
            });

            if (onlineCount === 0) {
                addMessage('SYSTEM', 'WARNING', 'No agents have LorePacks loaded. Please return to Uplink and ingest knowledge.');
            } else {
                addMessage('SYSTEM', 'SYSTEM', `${onlineCount} Agents Online & Ready.`);
            }
        };

        verifyAgents();
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const addMessage = (senderId: string, senderName: string, text: string, isThinking = false) => {
        const msg: MultiAgentMessage = {
            id: crypto.randomUUID(),
            senderId,
            senderName,
            text,
            timestamp: Date.now(),
            isThinking
        };
        setMessages(prev => [...prev, msg]);
        return msg.id;
    };

    const updateMessage = (id: string, text: string) => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, text, isThinking: false } : m));
    };

    const toggleAgent = (id: string) => {
        // Prevent enabling agents with no memory
        if ((agentCounts[id] || 0) === 0) return;

        setActiveAgents(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAllCapable = () => {
        const capable = AGENTS.filter(a => (agentCounts[a.id] || 0) > 0).map(a => a.id);
        setActiveAgents(new Set(capable));
    };

    const handleBroadcast = async () => {
        if (!input.trim() || isProcessing) return;
        
        const userText = input.trim();
        setInput('');
        addMessage('USER', 'DIRECTOR', userText);
        
        setIsProcessing(true);

        // 1. Identify Target Agents (Active Ones)
        const targets = AGENTS.filter(a => activeAgents.has(a.id));
        
        if (targets.length === 0) {
            addMessage('SYSTEM', 'SYSTEM', 'No active agents available to respond.');
            setIsProcessing(false);
            return;
        }

        // 2. Create Placeholders
        const promiseMap = new Map<string, string>(); // AgentId -> MessageId
        targets.forEach(agent => {
            const msgId = addMessage(agent.id, agent.handle, 'Thinking...', true);
            promiseMap.set(agent.id, msgId);
        });

        // 3. Parallel Execution with Stagger
        const executions = targets.map((agent, index) => {
            return new Promise<void>(resolve => {
                setTimeout(async () => {
                    const response = await MultiAgentService.queryAgent(
                        agent, 
                        userText, 
                        messages, // Pass current history
                        generalInstructions
                    );
                    
                    const msgId = promiseMap.get(agent.id);
                    if (msgId) {
                        if (response.error) {
                            updateMessage(msgId, `[CONNECTION LOST: ${response.error}]`);
                        } else {
                            updateMessage(msgId, response.text);
                        }
                    }
                    resolve();
                }, index * 200); 
            });
        });

        await Promise.all(executions);
        setIsProcessing(false);
    };

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', height: '100%', gap: '1rem' }}>
            
            {/* LEFT: ROSTER (Narrower) */}
            <div className="section-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', overflow: 'hidden', padding: '0.75rem' }}>
                <div className="section-header" style={{ marginBottom: '0.5rem' }}><span className="section-header-title">ROSTER ({activeAgents.size})</span></div>
                <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {AGENTS.map(agent => {
                        const hasLore = (agentCounts[agent.id] || 0) > 0;
                        const isActive = activeAgents.has(agent.id);
                        
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
                                    background: hasLore ? (isActive ? '#4ade80' : '#666') : '#f87171' 
                                }} />
                                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                    <span style={{ fontWeight: 'bold', fontSize: '0.7rem', color: '#eee', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{agent.handle}</span>
                                    {/* Optional: Show doc count tiny */}
                                    <span style={{ fontSize: '0.55rem', color: hasLore ? '#666' : '#f87171' }}>{hasLore ? 'ONLINE' : 'OFFLINE'}</span>
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

            {/* RIGHT: CHAT */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
                
                <div className="section-header" style={{ marginBottom: 0, paddingBottom: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
                    <span className="section-header-title">CONFERENCE TRANSCRIPT</span>
                    <button onClick={onClose} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize:'0.7rem', width: 'auto' }}>EXIT TO UPLINK</button>
                </div>

                <div className="chat-history-container" style={{ flex: 1 }}>
                    {messages.map(msg => (
                        <div key={msg.id} className={`chat-message-base ${msg.senderId === 'USER' ? 'chat-message-user' : msg.senderId === 'SYSTEM' ? 'chat-message-system' : 'chat-message-model'}`}>
                            <div style={{ fontSize: '0.7rem', marginBottom: '0.2rem', opacity: 0.8, fontWeight: 'bold', color: msg.senderId === 'USER' ? '#aaddff' : '#a78bfa' }}>
                                {msg.senderName.toUpperCase()} <span style={{ opacity: 0.5, fontWeight: 'normal', marginLeft: '0.5rem' }}>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap', opacity: msg.isThinking ? 0.5 : 1 }}>
                                {msg.text}
                            </div>
                        </div>
                    ))}
                    <div ref={endRef} />
                </div>

                <div className="chat-input-container">
                    <div className="chat-input-wrapper">
                        <input 
                            type="text" 
                            className="chat-input" 
                            placeholder={isProcessing ? "Agents are responding..." : "Broadcast message to active agents..."}
                            value={input} 
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleBroadcast()}
                            disabled={isProcessing}
                        />
                    </div>
                    <button 
                        className="btn btn-secondary" 
                        onClick={handleBroadcast}
                        disabled={isProcessing || !input.trim()}
                        style={{ width: 'auto', padding: '0 2rem' }}
                    >
                        BROADCAST
                    </button>
                </div>
            </div>

        </div>
    );
};
