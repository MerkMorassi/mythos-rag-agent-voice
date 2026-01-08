import React from 'react';
import { Agent, SomaActionType } from '../types';
import { AccessControl } from '../services/accessControl';
import { Tool } from '@google/genai';
import { EXTERNAL_MODEL_ENDPOINTS } from '../services/externalRouter';

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
    filesystem: "Read, write, and list files on the host system."
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
        if (toolId === 'python' || toolId === 'filesystem') {
            return AccessControl.canPerform(currentAccessLevel, SomaActionType.EXEC_CODE);
        }
        if (toolId === 'routeRequest') {
            return AccessControl.canPerform(currentAccessLevel, SomaActionType.ROUTE_REQUEST);
        }
        // Add more specific permission checks if needed
        return true;
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
                    {Object.keys(allTools).map(toolId => {
                        if (toolId === 'routeRequest') {
                            return (
                                <div key="router-tools" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #333' }}>
                                    <span className="section-header-title" style={{color: '#facc15'}}>EXTERNAL MODELS (via routeRequest)</span>
                                    <p style={{ margin: '4px 0 1rem', fontSize: '0.8rem', color: '#888' }}>
                                        These are specialized models, often hosted on HuggingFace, accessed via the `routeRequest` tool. Toggling any of these enables/disables the entire routing tool.
                                    </p>
                                    {Object.entries(EXTERNAL_MODEL_ENDPOINTS).map(([targetId, endpoint]) => {
                                        const isEnabled = enabledToolIds.includes('routeRequest');
                                        const canUse = isPermitted('routeRequest');
                                        
                                        return (
                                            <div key={targetId} className="section-panel" style={{ opacity: canUse ? 1 : 0.5, marginBottom: '0.75rem', borderColor: canUse ? '#facc15' : '#333' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                                                    <div style={{ flex: 1 }}>
                                                        <h4 style={{ margin: 0, color: canUse ? '#eee' : '#888' }}>{endpoint.name}</h4>
                                                        <p style={{ margin: '4px 0 8px', fontSize: '0.8rem', color: '#888' }}>
                                                            {endpoint.description}
                                                        </p>
                                                        <div style={{ fontSize: '0.7rem', color: '#666', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                                            Endpoint: {endpoint.url}
                                                        </div>
                                                    </div>
                                                    <label className="toggle-switch">
                                                        <input 
                                                            type="checkbox" 
                                                            checked={isEnabled} 
                                                            onChange={() => handleToggle('routeRequest')} 
                                                            disabled={!canUse} 
                                                        />
                                                        <span className="slider"></span>
                                                    </label>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        }

                        const isEnabled = enabledToolIds.includes(toolId);
                        const canUse = isPermitted(toolId);

                        return (
                            <div key={toolId} className="section-panel" style={{ opacity: canUse ? 1 : 0.5, transition: 'opacity 0.3s', marginBottom: '0.75rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                                    <div style={{ flex: 1 }}>
                                        <h4 style={{ margin: 0, color: canUse ? '#eee' : '#888', textTransform: 'uppercase' }}>{toolId}</h4>
                                        <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#888' }}>
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
                                {!canUse && (
                                    <div style={{ fontSize: '0.7rem', color: '#f87171', marginTop: '0.5rem', borderTop: '1px dashed #333', paddingTop: '0.5rem' }}>
                                        Permission Denied (Requires Access Level: {toolId === 'python' || toolId === 'filesystem' ? '7xx' : 'x7x'})
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};