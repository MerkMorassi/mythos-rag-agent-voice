import React from 'react';
import { Agent, SomaActionType } from '../types';
import { AccessControl } from '../services/accessControl';
import { Tool } from '@google/genai';

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
    routeRequest: "Generate images/videos or route requests to specialized external models.",
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
                        const isEnabled = enabledToolIds.includes(toolId);
                        const canUse = isPermitted(toolId);

                        return (
                            <div key={toolId} className="section-panel" style={{ opacity: canUse ? 1 : 0.5, transition: 'opacity 0.3s' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                                    <div style={{ flex: 1 }}>
                                        <h4 style={{ margin: 0, color: canUse ? '#eee' : '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>{toolId}</h4>
                                        <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#888' }}>
                                            {TOOL_DESCRIPTIONS[toolId]}
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
                </div>
            </div>
        </div>
    );
};
