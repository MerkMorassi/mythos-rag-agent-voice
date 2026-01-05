
import React, { useState, useEffect } from 'react';
import { getCanvas } from '../services/db';
import { WorkingMemory } from '../types';

export const Holodeck: React.FC<{ isOpen: boolean, refreshTrigger: number }> = ({ isOpen, refreshTrigger }) => {
    const [data, setData] = useState<WorkingMemory | null>(null);

    useEffect(() => {
        if (isOpen) {
            getCanvas().then(setData);
        }
    }, [isOpen, refreshTrigger]); // Refresh whenever a tool updates the DB

    if (!isOpen || !data) return null;

    return (
        <div className="holodeck-panel">
            <h1 style={{ borderBottom: '2px solid #facc15', paddingBottom: '0.5rem', color: '#facc15' }}>
                {data.title.toUpperCase()}
            </h1>
            <div className="canvas-meta" style={{ fontSize: '0.7rem', color: '#666', marginBottom: '2rem' }}>
                LAST MODIFIED: {new Date(data.lastModified).toLocaleTimeString()}
            </div>
            
            <div className="canvas-body">
                {data.sections.length === 0 && <div style={{color:'#444', fontStyle:'italic'}}>The Holodeck is empty. Ask an agent to "Update the Canvas".</div>}
                
                {data.sections.map(section => (
                    <div key={section.id} style={{ marginBottom: '2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <h2 style={{ color: '#38bdf8', margin: '0 0 0.5rem 0' }}>{section.title}</h2>
                            <span style={{ fontSize: '0.6rem', color: '#555' }}>ED: {section.lastEditor}</span>
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', color: '#d1d5db' }}>
                            {section.content}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
