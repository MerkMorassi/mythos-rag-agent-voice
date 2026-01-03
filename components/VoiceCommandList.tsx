
import React, { useState } from 'react';

export const VoiceCommandList: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);

    if (!isOpen) {
        return (
            <button 
                onClick={() => setIsOpen(true)}
                className="btn btn-secondary btn-icon"
                title="View Voice Commands"
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 17 10 11 4 5"></polyline>
                    <line x1="12" y1="19" x2="20" y2="19"></line>
                </svg>
            </button>
        );
    }

    return (
        <div className="modal-overlay">
            <div className="modal-content animate-slide-in-right" style={{ maxWidth: '40rem' }}>
                
                <div className="modal-header-area">
                    <div className="flex-group">
                        <span className="modal-section-title" style={{ color: '#4ade80' }}>VOICE COMMAND REFERENCE</span>
                    </div>
                    <button onClick={() => setIsOpen(false)} className="close-btn">[ESC]</button>
                </div>

                <div className="modal-body-area">
                    
                    {/* SOMA PERMISSIONS */}
                    <div className="flex-col">
                        <span className="section-header-title" style={{ color: '#f87171' }}>SOMA: MEMORY OPERATIONS (CRUD)</span>
                        <div className="section-panel" style={{ padding: '0.75rem', borderColor: '#f87171' }}>
                            <p style={{ fontSize: '0.65rem', color: '#ccc', marginBottom: '0.5rem' }}>
                                Requires 'MODIFY_LORE' permission (e.g., Archivax).
                            </p>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                                <tbody>
                                    <tr style={{ borderBottom: '1px dashed #333' }}>
                                        <td style={{ padding: '0.5rem', color: '#eee' }}>CREATE</td>
                                        <td style={{ padding: '0.5rem', color: '#f87171' }}>"Save this fact to memory: [Content]"</td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px dashed #333' }}>
                                        <td style={{ padding: '0.5rem', color: '#eee' }}>UPDATE</td>
                                        <td style={{ padding: '0.5rem', color: '#f87171' }}>"Append to the note about [Topic]: [New Info]"</td>
                                    </tr>
                                    <tr>
                                        <td style={{ padding: '0.5rem', color: '#eee' }}>DELETE</td>
                                        <td style={{ padding: '0.5rem', color: '#f87171' }}>"Delete the memory about [Topic]"</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* PROMPT ENGINEERING (NEW) */}
                    <div className="flex-col">
                        <span className="section-header-title" style={{ color: '#4ade80' }}>PROMPT ENGINEERING</span>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #333', textAlign: 'left', color: '#666' }}>
                                    <th style={{ padding: '0.5rem' }}>COMMAND</th>
                                    <th style={{ padding: '0.5rem' }}>VOICE TRIGGER (EXAMPLE)</th>
                                    <th style={{ padding: '0.5rem' }}>EFFECT</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr style={{ borderBottom: '1px dashed #222' }}>
                                    <td style={{ padding: '0.5rem', color: '#eee' }}>OPTIMIZE</td>
                                    <td style={{ padding: '0.5rem', color: '#4ade80' }}>"Optimize prompt: You are a coding wizard."</td>
                                    <td style={{ padding: '0.5rem', color: '#888' }}>Rewrites prompt using AI best practices & updates settings.</td>
                                </tr>
                                <tr>
                                    <td style={{ padding: '0.5rem', color: '#eee' }}>SAVE PROMPT</td>
                                    <td style={{ padding: '0.5rem', color: '#4ade80' }}>"Save prompt as 'Python Expert'."</td>
                                    <td style={{ padding: '0.5rem', color: '#888' }}>Saves current agent instructions to library.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* NEURAL CONFIGURATION */}
                    <div className="flex-col">
                        <span className="section-header-title" style={{ color: '#a78bfa' }}>NEURAL CONFIGURATION</span>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                            <tbody>
                                <tr style={{ borderBottom: '1px dashed #222' }}>
                                    <td style={{ padding: '0.5rem', color: '#eee', width: '20%' }}>TEMP</td>
                                    <td style={{ padding: '0.5rem', color: '#a78bfa' }}>"Set temperature to 1.5"</td>
                                    <td style={{ padding: '0.5rem', color: '#888' }}>0.0 (Robotic) to 2.0 (Wild)</td>
                                </tr>
                                <tr style={{ borderBottom: '1px dashed #222' }}>
                                    <td style={{ padding: '0.5rem', color: '#eee' }}>TOP P</td>
                                    <td style={{ padding: '0.5rem', color: '#a78bfa' }}>"Set Top P to 0.9"</td>
                                    <td style={{ padding: '0.5rem', color: '#888' }}>Nucleus Sampling (0.0 - 1.0)</td>
                                </tr>
                                <tr>
                                    <td style={{ padding: '0.5rem', color: '#eee' }}>TOP K</td>
                                    <td style={{ padding: '0.5rem', color: '#a78bfa' }}>"Set Top K to 40"</td>
                                    <td style={{ padding: '0.5rem', color: '#888' }}>Token Pool Size (1 - 40)</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* MEMORY & UTILITIES */}
                    <div className="flex-col">
                        <span className="section-header-title" style={{ color: '#facc15' }}>UTILITIES</span>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            <div className="section-panel" style={{ padding: '0.5rem' }}>
                                <div style={{ color: '#38bdf8', fontWeight: 'bold', fontSize: '0.7rem' }}>DOWNLOAD</div>
                                <div style={{ color: '#666', fontSize: '0.65rem' }}>"Download transcript."</div>
                            </div>
                            <div className="section-panel" style={{ padding: '0.5rem' }}>
                                <div style={{ color: '#f87171', fontWeight: 'bold', fontSize: '0.7rem' }}>TERMINATE</div>
                                <div style={{ color: '#666', fontSize: '0.65rem' }}>"Terminate connection."</div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};
