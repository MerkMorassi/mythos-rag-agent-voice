
import React, { useState, useEffect } from 'react';
import { Agent, SomaActionType } from '../types';
import { AccessControl } from '../services/accessControl';
import { Tool } from '@google/genai';
import { ExternalRouter, ExternalToolConfig } from '../services/externalRouter';

interface ToolManagerProps {
    isOpen: boolean;
    onClose: () => void;
    allTools: Record<string, Tool>;
    enabledToolIds: string[];
    setEnabledToolIds: (ids: string[]) => void;
    currentAgent: Agent | undefined;
    currentAccessLevel: string;
}

const TOOL_DESCRIPTIONS: Record<string, string> = {
    retrieval: "Search the local knowledge base (RAG).",
    mediaGallery: "Search and display images/videos from the Media Gallery.",
    googleMaps: "Access Google Maps for location search and directions.",
    holodeck: "Read from and write to the shared visual canvas.",
    python: "Execute sandboxed Python code for calculations and logic.",
    filesystem: "Read, write, and list files on the host system.",
    analyzeFile: "Perform deep analysis on media files (images, video).",
    selfConfig: "Allow the agent to modify its own configuration."
};

export const ToolManager: React.FC<ToolManagerProps> = ({ 
    isOpen, 
    onClose, 
    allTools, 
    enabledToolIds, 
    setEnabledToolIds, 
    currentAgent, 
    currentAccessLevel 
}) => {
    
    // External Tools State
    const [externalTools, setExternalTools] = useState<Record<string, ExternalToolConfig>>({});
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<ExternalToolConfig>({ name: '', description: '', url: '' });

    useEffect(() => {
        if (isOpen) {
            refreshTools();
        }
    }, [isOpen]);

    const refreshTools = () => {
        setExternalTools(ExternalRouter.getToolRegistry());
    };

    const handleToggle = (toolId: string) => {
        const newSet = new Set(enabledToolIds);
        if (newSet.has(toolId)) {
            newSet.delete(toolId);
        } else {
            newSet.add(toolId);
        }
        setEnabledToolIds(Array.from(newSet));
    };

    const isPermitted = (toolId: string): boolean => {
        if (!currentAgent) return false;
        
        const actionMap: Record<string, SomaActionType> = {
            python: SomaActionType.EXEC_CODE,
            filesystem: SomaActionType.EXEC_CODE,
            routeRequest: SomaActionType.ROUTE_REQUEST,
            googleMaps: SomaActionType.ROUTE_REQUEST, // Also a form of routing
            selfConfig: SomaActionType.SYSTEM_ADMIN // Requires high privilege
        };

        const action = actionMap[toolId];
        if (action) {
            return AccessControl.canPerform(currentAccessLevel, action);
        }
        return true; // Assume permitted if not in map
    };

    // --- TOOL CARD ACTIONS ---

    const handleEditClick = (key: string, config: ExternalToolConfig) => {
        setEditingId(key);
        setEditForm({ ...config });
    };

    const handleSaveEdit = (key: string) => {
        ExternalRouter.updateToolConfig(key, editForm);
        setEditingId(null);
        refreshTools();
    };

    const handleReset = (key: string) => {
        if (window.confirm("Reset this tool to factory defaults?")) {
            ExternalRouter.resetToolConfig(key);
            refreshTools();
        }
    };

    if (!isOpen) return null;
    
    return (
        <div className="modal-overlay">
            <div className="modal-content animate-slide-in-right">
                <div className="modal-header-area">
                    <div className="flex-group">
                        <span className="modal-section-title" style={{ color: '#38bdf8' }}>TOOL MANAGER</span>
                    </div>
                    <button onClick={onClose} className="close-btn" title="Close">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <div className="modal-body-area">
                    {/* STANDARD SYSTEM TOOLS */}
                    <span className="section-header-title" style={{color: '#eee'}}>SYSTEM TOOLS</span>
                    {Object.keys(allTools).filter(id => id !== 'routeRequest').map(toolId => {
                        const isEnabled = enabledToolIds.includes(toolId);
                        const canUse = isPermitted(toolId);

                        return (
                            <div key={toolId} className="section-panel" style={{ transition: 'opacity 0.3s', marginBottom: '0.75rem', padding: '0.75rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                                    <div style={{ flex: 1, opacity: canUse ? 1 : 0.5 }}>
                                        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '4px'}}>
                                            <h4 style={{ margin: 0, color: '#eee', textTransform: 'uppercase' }}>{toolId}</h4>
                                            <span style={{ fontSize: '0.6rem', padding: '1px 5px', borderRadius: '4px', border: `1px solid ${canUse ? '#4ade80' : '#f87171'}`, color: canUse ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>
                                                {canUse ? 'PERMITTED' : 'DENIED'}
                                            </span>
                                        </div>
                                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#888' }}>
                                            {TOOL_DESCRIPTIONS[toolId] || "No description available."}
                                        </p>
                                    </div>
                                    <label className="toggle-switch">
                                        <input 
                                            type="checkbox" 
                                            checked={isEnabled} 
                                            onChange={() => handleToggle(toolId)} 
                                            disabled={!canUse} 
                                        />
                                        <span className="slider"></span>
                                    </label>
                                </div>
                            </div>
                        );
                    })}

                    {/* EXTERNAL TOOLS CONFIGURATION */}
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #333' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span className="section-header-title" style={{color: '#facc15', marginBottom: '4px'}}>EXTERNAL TOOL CARDS</span>
                                <span style={{ fontSize: '0.7rem', color: '#888' }}>Managed via 'routeRequest' tool</span>
                            </div>
                            <label className="toggle-switch">
                                <input 
                                    type="checkbox" 
                                    checked={enabledToolIds.includes('routeRequest')} 
                                    onChange={() => handleToggle('routeRequest')} 
                                    disabled={!isPermitted('routeRequest')} 
                                />
                                <span className="slider"></span>
                            </label>
                        </div>

                        {!isPermitted('routeRequest') && (
                            <div className="status-banner status-error">
                                ⚠ Agent Access Level Restricted. Cannot use Router.
                            </div>
                        )}

                        <div className="flex-col" style={{ gap: '1rem' }}>
                            {Object.entries(externalTools).filter(([key]) => key !== 'DOLPHIN_LLM').map(([key, config]: [string, ExternalToolConfig]) => {
                                const isEditing = editingId === key;
                                const isModified = !config.isDefault;

                                return (
                                    <div 
                                        key={key} 
                                        className="section-panel" 
                                        style={{ 
                                            borderColor: isModified ? '#facc15' : '#333',
                                            backgroundColor: isEditing ? '#111' : 'transparent',
                                            position: 'relative'
                                        }}
                                    >
                                        {/* STATUS INDICATOR DOT */}
                                        {enabledToolIds.includes('routeRequest') && isPermitted('routeRequest') && (
                                            <div style={{ position: 'absolute', top: '10px', right: '10px', width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 5px #4ade80' }} title="Router Active" />
                                        )}

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                            <span style={{ fontSize: '0.7rem', color: '#666', fontFamily: 'monospace' }}>ID: {key}</span>
                                            {isModified && <span style={{ fontSize: '0.6rem', color: '#facc15', border: '1px solid #facc15', padding: '1px 4px', borderRadius: '2px' }}>CUSTOM</span>}
                                        </div>

                                        {isEditing ? (
                                            <div className="flex-col" style={{ gap: '0.5rem' }}>
                                                <div>
                                                    <label className="form-label">NAME</label>
                                                    <input 
                                                        className="form-input" 
                                                        value={editForm.name} 
                                                        onChange={e => setEditForm({...editForm, name: e.target.value})}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="form-label">ENDPOINT URL</label>
                                                    <input 
                                                        className="form-input" 
                                                        value={editForm.url} 
                                                        onChange={e => setEditForm({...editForm, url: e.target.value})} 
                                                        style={{ fontFamily: 'monospace', color: '#facc15' }}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="form-label">DESCRIPTION</label>
                                                    <textarea 
                                                        className="form-input" 
                                                        value={editForm.description} 
                                                        onChange={e => setEditForm({...editForm, description: e.target.value})}
                                                        style={{ height: '4rem', resize: 'vertical' }}
                                                    />
                                                </div>
                                                <div className="flex-group">
                                                    <button onClick={() => handleSaveEdit(key)} className="btn btn-primary btn-sm" style={{ flex: 1 }}>SAVE CARD</button>
                                                    <button onClick={() => setEditingId(null)} className="btn btn-secondary btn-sm" style={{ flex: 1 }}>CANCEL</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: '#eee' }}>{config.name}</h3>
                                                <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: '#aaa', lineHeight: '1.4' }}>{config.description}</p>
                                                
                                                <div style={{ background: '#000', padding: '0.5rem', borderRadius: '4px', border: '1px solid #222', marginBottom: '0.75rem' }}>
                                                    <div style={{ fontSize: '0.65rem', color: '#444', marginBottom: '2px' }}>ENDPOINT:</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#facc15', fontFamily: 'monospace', wordBreak: 'break-all' }}>{config.url}</div>
                                                </div>

                                                <div className="flex-group">
                                                    <button 
                                                        onClick={() => handleEditClick(key, config)} 
                                                        className="btn btn-secondary btn-xs"
                                                        style={{ flex: 1 }}
                                                    >
                                                        EDIT
                                                    </button>
                                                    {isModified && (
                                                        <button 
                                                            onClick={() => handleReset(key)} 
                                                            className="btn btn-secondary btn-xs"
                                                            style={{ color: '#f87171', borderColor: '#f87171' }}
                                                        >
                                                            RESET
                                                        </button>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
