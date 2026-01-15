
import React, { useState, useEffect } from 'react';
import { Agent } from '../types';
import { AGENTS } from '../agents';
import { getAgentConfig, saveAgentConfig } from '../services/db';

interface AgentRosterProps {
    isOpen: boolean;
    onClose: () => void;
    currentAgentId: string;
    onSelectAgent: (id: string) => void;
}

export const AgentRoster: React.FC<AgentRosterProps> = ({ isOpen, onClose, currentAgentId, onSelectAgent }) => {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    
    // Edit Form State
    const [editForm, setEditForm] = useState<{
        bio: string;
        system_instruction: string;
        voice: string;
        accessLevel: string;
    }>({ bio: '', system_instruction: '', voice: '', accessLevel: '' });

    useEffect(() => {
        if (isOpen) refreshAgents();
    }, [isOpen]);

    const refreshAgents = async () => {
        const hydratedAgents = await Promise.all(AGENTS.map(async (baseAgent) => {
            const config = await getAgentConfig(baseAgent.id);
            return {
                ...baseAgent,
                bio: config.bio || baseAgent.bio, 
                system_instruction: config.systemInstruction || baseAgent.system_instruction,
                voice: config.voiceName || baseAgent.voice,
                accessLevel: config.accessLevel || baseAgent.accessLevel
            };
        }));
        setAgents(hydratedAgents);
    };

    const handleEditClick = (agent: Agent) => {
        setEditingId(agent.id);
        setEditForm({
            bio: agent.bio,
            system_instruction: agent.system_instruction,
            voice: agent.voice,
            accessLevel: agent.accessLevel
        });
    };

    const handleSave = async (id: string) => {
        await saveAgentConfig(id, {
            systemInstruction: editForm.system_instruction,
            voiceName: editForm.voice,
            accessLevel: editForm.accessLevel,
            bio: editForm.bio 
        });
        setEditingId(null);
        await refreshAgents();
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content animate-slide-in-right large" style={{ maxWidth: '95vw', width: '95vw', background: '#050505' }}>
                <div className="modal-header-area" style={{ background: '#080808', borderBottom: '1px solid #333' }}>
                    <div className="flex-group">
                        <span className="modal-section-title" style={{ color: '#fff', letterSpacing: '2px' }}>PERSONNEL ROSTER // MYTHOS</span>
                    </div>
                    <button onClick={onClose} className="close-btn" title="Close">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <div className="modal-body-area" style={{ background: '#000', padding: '1.5rem' }}>
                    <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', 
                        gap: '1.5rem'
                    }}>
                        {agents.map(agent => {
                            const isEditing = editingId === agent.id;
                            const isCurrent = currentAgentId === agent.id;
                            const color = agent.studioConfig?.color || '#666';

                            return (
                                <div 
                                    key={agent.id} 
                                    style={{ 
                                        border: `1px solid ${isCurrent ? color : '#333'}`, 
                                        background: isCurrent ? `linear-gradient(180deg, ${color}0a 0%, #0a0a0a 100%)` : '#0a0a0a',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        minHeight: '380px',
                                        position: 'relative',
                                        borderRadius: '6px',
                                        overflow: 'hidden',
                                        boxShadow: isCurrent ? `0 0 20px ${color}1a` : 'none',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    {/* STATUS LIGHT */}
                                    {isCurrent && (
                                        <div style={{ position: 'absolute', top: '12px', right: '12px', width: '8px', height: '8px', borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }}></div>
                                    )}

                                    {/* COLOR BAR */}
                                    <div style={{ height: '4px', background: color, width: '100%', opacity: 0.8 }}></div>

                                    <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        
                                        {/* PROFILE HEADER */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <div style={{ 
                                                width: '56px', height: '56px', borderRadius: '50%', 
                                                background: `radial-gradient(circle at 30% 30%, ${color}44, transparent), #111`,
                                                color: color, 
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', 
                                                fontWeight: '900', fontSize: '1.4rem', border: `2px solid ${color}44`,
                                                textShadow: `0 0 10px ${color}66`
                                            }}>
                                                {agent.handle.substring(0, 1)}
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#fff', lineHeight: '1.1', marginBottom: '4px' }}>{agent.name}</div>
                                                <div style={{ fontSize: '0.75rem', color: '#888', display: 'flex', gap: '0.5rem', alignItems: 'center', fontFamily: 'monospace' }}>
                                                    <span style={{ color: color }}>@{agent.handle}</span>
                                                    {agent.pronouns && <span style={{ opacity: 0.5, borderLeft: '1px solid #444', paddingLeft: '0.5rem' }}>{agent.pronouns}</span>}
                                                </div>
                                            </div>
                                        </div>

                                        {/* METADATA BADGES */}
                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '0.65rem', fontWeight: 'bold', padding: '3px 8px', background: '#222', borderRadius: '4px', color: '#ccc', border: '1px solid #444', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                {agent.agentClass}
                                            </span>
                                            <span style={{ fontSize: '0.65rem', fontWeight: 'bold', padding: '3px 8px', background: `${color}15`, borderRadius: '4px', color: color, border: `1px solid ${color}44`, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                {agent.department}
                                            </span>
                                            <span style={{ fontSize: '0.65rem', fontWeight: 'bold', padding: '3px 8px', background: '#111', borderRadius: '4px', color: '#666', border: '1px solid #333', fontFamily: 'monospace' }}>
                                                LEVEL {agent.accessLevel}
                                            </span>
                                        </div>

                                        <hr style={{ borderColor: '#222', margin: 0 }} />

                                        {/* CONTENT BODY */}
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            
                                            {isEditing ? (
                                                <div className="flex-col" style={{ gap: '0.75rem', height: '100%' }}>
                                                    <div>
                                                        <label className="form-label" style={{color: color}}>BIO OVERRIDE</label>
                                                        <textarea 
                                                            className="form-input" 
                                                            value={editForm.bio} 
                                                            onChange={e => setEditForm({...editForm, bio: e.target.value})}
                                                            style={{ height: '4rem', fontSize: '0.8rem', resize: 'vertical', background: '#111' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="form-label" style={{color: color}}>SYSTEM DIRECTIVE</label>
                                                        <textarea 
                                                            className="form-input" 
                                                            value={editForm.system_instruction} 
                                                            onChange={e => setEditForm({...editForm, system_instruction: e.target.value})}
                                                            style={{ height: '6rem', fontSize: '0.75rem', background: '#111' }}
                                                        />
                                                    </div>
                                                    <div className="flex-group">
                                                        <div style={{ flex: 1 }}>
                                                            <label className="form-label" style={{color: color}}>VOICE</label>
                                                            <select 
                                                                className="form-select" 
                                                                value={editForm.voice} 
                                                                onChange={e => setEditForm({...editForm, voice: e.target.value})}
                                                                style={{ background: '#111' }}
                                                            >
                                                                <option value="Puck">Puck</option>
                                                                <option value="Charon">Charon</option>
                                                                <option value="Kore">Kore</option>
                                                                <option value="Fenrir">Fenrir</option>
                                                                <option value="Zephyr">Zephyr</option>
                                                                <option value="Aoede">Aoede</option>
                                                                <option value="Callirrhoe">Callirrhoe</option>
                                                                <option value="Leda">Leda</option>
                                                            </select>
                                                        </div>
                                                        <div style={{ flex: 1 }}>
                                                            <label className="form-label" style={{color: color}}>ACCESS</label>
                                                            <input 
                                                                className="form-input" 
                                                                value={editForm.accessLevel} 
                                                                onChange={e => setEditForm({...editForm, accessLevel: e.target.value})}
                                                                style={{ background: '#111', fontFamily: 'monospace' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <div>
                                                        <div style={{ fontSize: '0.75rem', color: color, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '1px' }}>
                                                            {agent.title}
                                                        </div>
                                                        <div style={{ fontSize: '0.85rem', color: '#ccc', fontStyle: 'italic', lineHeight: '1.5' }}>
                                                            "{agent.bio}"
                                                        </div>
                                                    </div>
                                                    
                                                    <div style={{ background: '#111', padding: '0.75rem', borderRadius: '4px', border: '1px solid #222', flex: 1, overflowY: 'auto', maxHeight: '120px' }}>
                                                        <div style={{ fontSize: '0.65rem', color: '#666', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Current Directive</div>
                                                        <div style={{ fontSize: '0.75rem', color: '#999', lineHeight: '1.4' }}>
                                                            {agent.system_instruction}
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: '#666', borderTop: '1px solid #222', paddingTop: '0.5rem' }}>
                                                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                            <span>VOICE:</span>
                                                            <span style={{ color: '#eee' }}>{agent.voice.toUpperCase()}</span>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                            <span>PERMS:</span>
                                                            <span style={{ color: '#eee', fontFamily: 'monospace' }}>{agent.permissions.length} CAPS</span>
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* FOOTER ACTIONS */}
                                    <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #222', background: '#080808' }}>
                                        {isEditing ? (
                                            <div className="flex-group">
                                                <button onClick={() => handleSave(agent.id)} className="btn btn-primary btn-sm" style={{ flex: 1 }}>SAVE CHANGES</button>
                                                <button onClick={() => setEditingId(null)} className="btn btn-secondary btn-sm" style={{ flex: 1 }}>CANCEL</button>
                                            </div>
                                        ) : (
                                            <div className="flex-group">
                                                <button 
                                                    onClick={() => {
                                                        onSelectAgent(agent.id);
                                                        onClose();
                                                    }} 
                                                    className={`btn btn-sm ${isCurrent ? 'active-green' : 'btn-secondary'}`} 
                                                    style={{ flex: 2, fontWeight: 'bold', letterSpacing: '1px' }}
                                                    disabled={isCurrent}
                                                >
                                                    {isCurrent ? '● ACTIVE AGENT' : 'ACTIVATE'}
                                                </button>
                                                <button onClick={() => handleEditClick(agent)} className="btn btn-secondary btn-sm" style={{ flex: 1 }} title="Modify Agent Profile">EDIT</button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};
