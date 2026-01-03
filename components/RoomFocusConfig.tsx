
import React, { useState, useEffect } from 'react';
import { RoomFocus, RoomFocusService, DEFAULT_FOCUS } from '../services/roomFocus';

export const RoomFocusConfig: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
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

    if (!isOpen) {
        return (
            <button 
                onClick={() => setIsOpen(true)}
                className="btn btn-secondary btn-icon"
                title="Room Focus Configuration"
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
            </button>
        );
    }

    return (
        <div className="modal-overlay">
            <div className="modal-content animate-slide-in-right">
                
                <div className="modal-header-area">
                    <div className="flex-group">
                        <span className="modal-section-title" style={{ color: '#facc15' }}>ROOM FOCUS PROTOCOL</span>
                    </div>
                    <button onClick={() => setIsOpen(false)} className="close-btn">[ESC]</button>
                </div>

                <div className="modal-body-area">
                    
                    <div className="section-panel" style={{ borderColor: '#facc15' }}>
                        <div className="section-header" style={{ borderBottom: 'none', padding: 0, marginBottom: '0.25rem' }}>
                             <span className="section-header-title" style={{color: '#facc15'}}>ACTIVE FOCUS: {activeId}</span>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: '#ccc' }}>
                            {focusList.find(f => f.id === activeId)?.title || 'Unknown'}
                        </p>
                    </div>

                    <div className="flex-col">
                        <label className="section-header-title">SELECT PROFILE</label>
                        <select 
                            value={selectedId} 
                            onChange={handleSelectChange} 
                            className="form-select"
                        >
                            {focusList.map(f => (
                                <option key={f.id} value={f.id}>{f.id} — {f.title}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex-col" style={{gap: '0.5rem'}}>
                        <div style={{display:'flex', gap:'0.5rem'}}>
                            <div style={{flex:1}}>
                                <label style={{fontSize:'0.65rem', color:'#666'}}>ID (UPPERCASE)</label>
                                <input className="form-input" value={formId} onChange={e => setFormId(e.target.value)} placeholder="WRITERS" />
                            </div>
                            <div style={{flex:2}}>
                                <label style={{fontSize:'0.65rem', color:'#666'}}>TITLE</label>
                                <input className="form-input" value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Creative Writing" />
                            </div>
                        </div>
                        
                        <div>
                            <label style={{fontSize:'0.65rem', color:'#666'}}>SUMMARY</label>
                            <input className="form-input" value={formSummary} onChange={e => setFormSummary(e.target.value)} placeholder="Goal of the session..." />
                        </div>

                        <div>
                            <label style={{fontSize:'0.65rem', color:'#666'}}>RULES (ONE PER LINE)</label>
                            <textarea 
                                className="form-input" 
                                style={{height:'8rem', resize:'vertical', paddingTop:'0.5rem'}} 
                                value={formRules} 
                                onChange={e => setFormRules(e.target.value)}
                                placeholder="- Stay in character&#10;- No lengthy monologues"
                            />
                        </div>
                    </div>

                    <div className="flex-group">
                        <button className="btn btn-secondary" onClick={handleSave} style={{flex:1}}>SAVE / UPDATE</button>
                        <button className="btn btn-danger" onClick={handleDelete} disabled={selectedId === 'OPEN'} style={{width:'3rem'}}>DEL</button>
                    </div>
                    
                    <button 
                        className="btn btn-primary" 
                        onClick={handleApply}
                        style={{ borderColor: '#facc15', color: '#facc15' }}
                    >
                        APPLY TO CONFERENCE
                    </button>

                </div>
            </div>
        </div>
    );
};
