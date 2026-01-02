
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
                
                <div className="section-header" style={{ padding: '1.5rem', paddingBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span className="section-header-title" style={{ fontSize: '1.25rem', color: '#4ade80' }}>VOICE COMMAND REFERENCE</span>
                    </div>
                    <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>
                        [ESC]
                    </button>
                </div>

                <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    
                    {/* NEURAL CONFIGURATION */}
                    <div className="flex-col">
                        <span className="section-header-title" style={{ color: '#a78bfa' }}>NEURAL CONFIGURATION</span>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #333', textAlign: 'left', color: '#666' }}>
                                    <th style={{ padding: '0.5rem' }}>PARAMETER</th>
                                    <th style={{ padding: '0.5rem' }}>VOICE TRIGGER (EXAMPLE)</th>
                                    <th style={{ padding: '0.5rem' }}>EFFECT</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr style={{ borderBottom: '1px dashed #222' }}>
                                    <td style={{ padding: '0.5rem', color: '#eee' }}>TEMPERATURE</td>
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

                    {/* MEMORY & KNOWLEDGE */}
                    <div className="flex-col">
                        <span className="section-header-title" style={{ color: '#facc15' }}>MEMORY OPERATIONS (RAG)</span>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                            <tbody>
                                <tr style={{ borderBottom: '1px dashed #222' }}>
                                    <td style={{ padding: '0.5rem', color: '#eee', width: '25%' }}>SEARCH</td>
                                    <td style={{ padding: '0.5rem', color: '#facc15' }}>"Search your knowledge base for [Topic]"</td>
                                    <td style={{ padding: '0.5rem', color: '#888' }}>Queries Vector DB</td>
                                </tr>
                                <tr style={{ borderBottom: '1px dashed #222' }}>
                                    <td style={{ padding: '0.5rem', color: '#eee' }}>SAVE</td>
                                    <td style={{ padding: '0.5rem', color: '#facc15' }}>"Save this conversation to memory"</td>
                                    <td style={{ padding: '0.5rem', color: '#888' }}>Persists text to Vector DB</td>
                                </tr>
                                <tr>
                                    <td style={{ padding: '0.5rem', color: '#eee' }}>UPDATE RULES</td>
                                    <td style={{ padding: '0.5rem', color: '#facc15' }}>"Update instructions: Always speak in rhymes"</td>
                                    <td style={{ padding: '0.5rem', color: '#888' }}>Modifies System Prompt</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* UTILITIES */}
                    <div className="flex-col">
                        <span className="section-header-title" style={{ color: '#38bdf8' }}>UTILITIES</span>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            <div className="section-panel" style={{ padding: '0.5rem' }}>
                                <div style={{ color: '#38bdf8', fontWeight: 'bold', fontSize: '0.7rem' }}>DOWNLOAD TRANSCRIPT</div>
                                <div style={{ color: '#666', fontSize: '0.65rem' }}>"Download the transcript."</div>
                            </div>
                            <div className="section-panel" style={{ padding: '0.5rem' }}>
                                <div style={{ color: '#38bdf8', fontWeight: 'bold', fontSize: '0.7rem' }}>TRANSLATE (GREEK)</div>
                                <div style={{ color: '#666', fontSize: '0.65rem' }}>"Translate [X] to Ancient Greek."</div>
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
