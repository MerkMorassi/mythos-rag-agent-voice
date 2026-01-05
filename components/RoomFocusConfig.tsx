
import React, { useState, useEffect } from 'react';
import { RoomFocus, RoomFocusService, DEFAULT_FOCUS } from '../services/roomFocus';

interface RoomFocusConfigProps {
    isOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
}

export const RoomFocusConfig: React.FC<RoomFocusConfigProps> = ({ isOpen, onOpen, onClose }) => {
    const [focusList, setFocusList] = useState<RoomFocus[]>([]);
    const [selectedId, setSelectedId] = useState<string>('OPEN');
    const [activeId, setActiveId] = useState<string>('OPEN');
    
    // Form State
    const [formId, setFormId] = useState('');
    const [formTitle, setFormTitle] = useState('');
    const [formSummary, setFormSummary] = useState('');
    const [formRules, setFormRules] = useState('');

    useEffect(() => {
        if (isOpen) {
            refresh();
        }
    }, [isOpen]);

    const refresh = () => {
        const list = RoomFocusService.getAll();
        setFocusList(list);
        const active = RoomFocusService.getActive();
        setActiveId(active.id);
        
        // If we haven't selected anything, select the active one
        if (!list.find(f => f.id === selectedId)) {
            loadForm(active);
        }
    };

    const loadForm = (f: RoomFocus) => {
        setSelectedId(f.id);
        setFormId(f.id);
        setFormTitle(f.title);
        setFormSummary(f.summary);
        setFormRules(f.rules.join('\n'));
    };

    const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value;
        const f = focusList.find(i => i.id === id);
        if (f) loadForm(f);
    };

    const handleSave = () => {
        const id = formId.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        if (!id) return alert("Valid ID required (e.g. WRITERS)");
        
        const newFocus: RoomFocus = {
            id,
            title: formTitle,
            summary: formSummary,
            rules: formRules.split('\n').map(s => s.trim()).filter(Boolean)
        };
        
        RoomFocusService.save(newFocus);
        refresh();
        loadForm(newFocus);
    };

    const handleApply = () => {
        RoomFocusService.setActive(selectedId);
        setActiveId(selectedId);
    };
    
    const handleDelete = () => {
        if (selectedId === 'OPEN') return alert("Cannot delete Default Focus.");
        if (window.confirm(`Delete focus profile '${selectedId}'?`)) {
            RoomFocusService.delete(selectedId);
            const defaultFocus = DEFAULT_FOCUS;
            refresh();
            loadForm(defaultFocus);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content animate-slide-in-right">
                
                <div className="modal-header-area">
                    <div className="flex-group">
                        <span className="modal-section-title" style={{ color: '#facc15' }}>ROOM FOCUS PROTOCOL</span>
                    </div>
                    <button onClick={onClose} className="close-btn" title="Close">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <div className="modal-body-area">
                    
                    {/* ACTIVE STATUS PANEL */}
                    <div className="section-panel" style={{ borderColor: '#facc15' }}>
                        <div className="section-header" style={{ borderBottom: 'none', padding: 0, marginBottom: '0.5rem' }}>
                             <span className="section-header-title" style={{color: '#facc15'}}>CURRENT ACTIVE FOCUS</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <span style={{ fontSize: '1rem', fontWeight: 'bold', color: '#fff' }}>{activeId}</span>
                            <span style={{ fontSize: '0.8rem', color: '#ccc' }}>
                                {focusList.find(f => f.id === activeId)?.title || 'Unknown'}
                            </span>
                        </div>
                    </div>

                    <hr style={{ borderColor: '#333', margin: '0.5rem 0' }} />

                    <div className="flex-col">
                        <label className="section-header-title" style={{ color: '#eee' }}>SELECT / EDIT PROFILE</label>
                        <select 
                            value={selectedId} 
                            onChange={handleSelectChange} 
                            className="form-select"
                            style={{ width: '100%', padding: '0.5rem', background: '#000', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}
                        >
                            {focusList.map(f => (
                                <option key={f.id} value={f.id}>{f.id} — {f.title}</option>
                            ))}
                        </select>
                    </div>

                    <div className="section-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{display:'flex', gap:'1rem'}}>
                            <div style={{flex:1}}>
                                <label style={{fontSize:'0.7rem', color:'#888', display:'block', marginBottom:'0.25rem'}}>ID (UPPERCASE)</label>
                                <input className="form-input" value={formId} onChange={e => setFormId(e.target.value)} placeholder="WRITERS" style={{ fontFamily: 'monospace' }} />
                            </div>
                            <div style={{flex:2}}>
                                <label style={{fontSize:'0.7rem', color:'#888', display:'block', marginBottom:'0.25rem'}}>TITLE</label>
                                <input className="form-input" value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Creative Writing" />
                            </div>
                        </div>
                        
                        <div>
                            <label style={{fontSize:'0.7rem', color:'#888', display:'block', marginBottom:'0.25rem'}}>SUMMARY</label>
                            <input className="form-input" value={formSummary} onChange={e => setFormSummary(e.target.value)} placeholder="Goal of the session..." />
                        </div>

                        <div>
                            <label style={{fontSize:'0.7rem', color:'#888', display:'block', marginBottom:'0.25rem'}}>RULES (ONE PER LINE)</label>
                            <textarea 
                                className="form-input" 
                                style={{height:'8rem', resize:'vertical', lineHeight: '1.4'}} 
                                value={formRules} 
                                onChange={e => setFormRules(e.target.value)}
                                placeholder="- Stay in character&#10;- No lengthy monologues"
                            />
                        </div>
                    </div>

                    <div className="flex-group" style={{ marginTop: '0.5rem' }}>
                        <button className="btn btn-secondary" onClick={handleSave} style={{flex:1}} title="Save Profile">SAVE / UPDATE</button>
                        <button className="btn btn-danger" onClick={handleDelete} disabled={selectedId === 'OPEN'} style={{width:'4rem'}} title="Delete Profile">DEL</button>
                    </div>
                    
                    <button 
                        className="btn btn-accent" 
                        onClick={handleApply}
                        disabled={selectedId === activeId}
                        style={{ width: '100%' }}
                        title="Set as Active Room Focus"
                    >
                        {selectedId === activeId ? 'CURRENTLY ACTIVE' : `APPLY "${selectedId}" TO ROOM`}
                    </button>

                </div>
            </div>
        </div>
    );
};
