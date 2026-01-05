
import React, { useState, useEffect } from 'react';
import { VoiceCommandService, CommandSection, CommandItem } from '../services/voiceCommandService';

interface VoiceCommandListProps {
    isOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
}

export const VoiceCommandList: React.FC<VoiceCommandListProps> = ({ isOpen, onOpen, onClose }) => {
    const [sections, setSections] = useState<CommandSection[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [forceUpdate, setForceUpdate] = useState(0); // Trigger re-render

    useEffect(() => {
        if (isOpen) {
            refresh();
        }
    }, [isOpen, forceUpdate]);

    const refresh = () => {
        setSections(VoiceCommandService.getAll());
    };

    const handleAddSection = () => {
        const newSection: CommandSection = {
            id: crypto.randomUUID(),
            title: 'NEW SECTION',
            color: '#ffffff',
            createdBy: 'USER',
            authorized: true,
            timestamp: Date.now(),
            items: []
        };
        VoiceCommandService.addSection(newSection);
        refresh();
        setIsEditing(true);
    };

    const handleUpdateSection = (section: CommandSection) => {
        VoiceCommandService.updateSection(section);
        refresh();
    };

    const handleDeleteSection = (id: string) => {
        if (window.confirm("Delete this entire voice command card?")) {
            VoiceCommandService.deleteSection(id);
            refresh();
        }
    };

    const handleAddItem = (sectionId: string) => {
        const section = sections.find(s => s.id === sectionId);
        if (!section) return;
        
        const newItem: CommandItem = {
            id: crypto.randomUUID(),
            label: 'CMD',
            trigger: '"..."',
            description: 'Description'
        };
        
        const updated = { ...section, items: [...section.items, newItem] };
        VoiceCommandService.updateSection(updated);
        refresh();
    };

    const handleToggleAuth = (section: CommandSection) => {
        VoiceCommandService.authorizeSection(section.id, !section.authorized);
        refresh();
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content animate-slide-in-right" style={{ maxWidth: '40rem' }}>
                
                <div className="modal-header-area">
                    <div className="flex-group">
                        <span className="modal-section-title" style={{ color: '#4ade80' }}>VOICE COMMAND REFERENCE</span>
                    </div>
                    <div className="flex-group">
                        <button 
                            onClick={() => setIsEditing(!isEditing)} 
                            className="btn btn-secondary"
                            style={{ 
                                fontSize: '0.7rem', 
                                padding: '0.25rem 0.75rem', 
                                borderColor: isEditing ? '#facc15' : '#333',
                                color: isEditing ? '#facc15' : '#888'
                            }}
                            title="Toggle Edit Mode"
                        >
                            {isEditing ? 'DONE EDITING' : 'EDIT CARDS'}
                        </button>
                        <button onClick={onClose} className="close-btn" title="Close">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>

                <div className="modal-body-area">
                    
                    {isEditing && (
                        <div style={{ marginBottom: '1rem', textAlign: 'center' }}>
                            <button onClick={handleAddSection} className="btn btn-primary" style={{ width: '100%', borderStyle: 'dashed', opacity: 0.8 }} title="Add a new command section">+ CREATE NEW COMMAND CARD</button>
                        </div>
                    )}

                    {sections.length === 0 && (
                         <div className="empty-state">
                             <p>NO COMMAND CARDS DEFINED.</p>
                         </div>
                    )}

                    {sections.map(section => (
                        <div key={section.id} className="flex-col" style={{ marginBottom: '1.5rem' }}>
                            {/* HEADER ROW */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                                    {isEditing ? (
                                        <input 
                                            value={section.title} 
                                            onChange={(e) => handleUpdateSection({ ...section, title: e.target.value })}
                                            className="form-input"
                                            style={{ height: '2rem', fontSize: '0.9rem', fontWeight: 'bold', color: section.color, borderColor: section.color, width: '100%' }}
                                        />
                                    ) : (
                                        <span className="section-header-title" style={{ color: section.color, fontSize: '0.9rem' }}>{section.title}</span>
                                    )}
                                    
                                    {/* STATUS BADGES */}
                                    {!isEditing && section.createdBy !== 'USER' && section.createdBy !== 'SYSTEM' && (
                                        <span style={{ 
                                            fontSize: '0.6rem', 
                                            border: '1px solid', 
                                            borderColor: section.authorized ? '#4ade80' : '#f87171',
                                            color: section.authorized ? '#4ade80' : '#f87171',
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            fontWeight: 'bold',
                                            cursor: 'pointer'
                                        }}
                                        onClick={() => handleToggleAuth(section)}
                                        title="Click to toggle Authorization"
                                        >
                                            {section.authorized ? 'AUTH' : 'UNAUTH'}
                                        </span>
                                    )}
                                </div>

                                {isEditing && (
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginLeft: '1rem' }}>
                                        <input 
                                            type="color" 
                                            value={section.color} 
                                            onChange={(e) => handleUpdateSection({ ...section, color: e.target.value })}
                                            style={{ width: '24px', height: '24px', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} 
                                            title="Card Color"
                                        />
                                        <button 
                                            onClick={() => handleDeleteSection(section.id)} 
                                            className="btn btn-danger btn-xs"
                                            title="Delete Card"
                                        >
                                            DELETE
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* CARD CONTENT */}
                            <div className="section-panel" style={{ padding: '0', borderColor: section.authorized ? section.color : '#333', opacity: section.authorized ? 1 : 0.6 }}>
                                {!section.authorized && (
                                    <div style={{ padding: '0.5rem', background: 'rgba(248, 113, 113, 0.1)', color: '#f87171', fontSize: '0.7rem', textAlign: 'center', borderBottom: '1px solid #333', fontWeight: 'bold' }}>
                                        ⚠ PENDING AUTHORIZATION
                                    </div>
                                )}
                                <div style={{ padding: '0.5rem' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                        {(section.authorized || isEditing) && (
                                            <tbody>
                                                {section.items.map((item, idx) => (
                                                    <tr key={item.id} style={{ borderBottom: idx < section.items.length - 1 ? '1px dashed #333' : 'none' }}>
                                                        <td style={{ padding: '0.5rem', color: '#eee', width: '25%', verticalAlign: 'top' }}>
                                                            {isEditing ? (
                                                                <input 
                                                                    value={item.label}
                                                                    onChange={(e) => {
                                                                        const newItems = [...section.items];
                                                                        newItems[idx] = { ...item, label: e.target.value };
                                                                        handleUpdateSection({ ...section, items: newItems });
                                                                    }}
                                                                    className="form-input"
                                                                    style={{ height: '1.5rem', fontSize: '0.75rem', padding: '0 0.25rem' }}
                                                                />
                                                            ) : (
                                                                <span style={{ fontWeight: 'bold' }}>{item.label}</span>
                                                            )}
                                                        </td>
                                                        <td style={{ padding: '0.5rem', color: section.color, width: '40%', verticalAlign: 'top', fontFamily: 'monospace' }}>
                                                            {isEditing ? (
                                                                <input 
                                                                    value={item.trigger}
                                                                    onChange={(e) => {
                                                                        const newItems = [...section.items];
                                                                        newItems[idx] = { ...item, trigger: e.target.value };
                                                                        handleUpdateSection({ ...section, items: newItems });
                                                                    }}
                                                                    className="form-input"
                                                                    style={{ height: '1.5rem', fontSize: '0.75rem', padding: '0 0.25rem', color: section.color }}
                                                                />
                                                            ) : item.trigger}
                                                        </td>
                                                        <td style={{ padding: '0.5rem', color: '#888', verticalAlign: 'top' }}>
                                                            {isEditing ? (
                                                                <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                                    <input 
                                                                        value={item.description}
                                                                        onChange={(e) => {
                                                                            const newItems = [...section.items];
                                                                            newItems[idx] = { ...item, description: e.target.value };
                                                                            handleUpdateSection({ ...section, items: newItems });
                                                                        }}
                                                                        className="form-input"
                                                                        style={{ height: '1.5rem', fontSize: '0.75rem', padding: '0 0.25rem', flex: 1 }}
                                                                    />
                                                                    <button 
                                                                        onClick={() => {
                                                                            const newItems = section.items.filter(i => i.id !== item.id);
                                                                            handleUpdateSection({ ...section, items: newItems });
                                                                        }}
                                                                        style={{ color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', lineHeight: '1rem' }}
                                                                        title="Remove Item"
                                                                    >
                                                                        ×
                                                                    </button>
                                                                </div>
                                                            ) : item.description}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        )}
                                    </table>
                                    {isEditing && (
                                        <button 
                                            onClick={() => handleAddItem(section.id)}
                                            className="btn btn-ghost"
                                            style={{ width: '100%', padding: '0.5rem', marginTop: '0.5rem', fontSize: '0.75rem', border: '1px dashed #333' }}
                                            title="Add a new voice trigger"
                                        >
                                            + ADD COMMAND ITEM
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}

                </div>
            </div>
        </div>
    );
};
