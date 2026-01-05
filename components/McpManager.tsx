
import React, { useState } from 'react';
import { McpClient } from '../services/mcpClient';

interface McpManagerProps {
    isOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
}

export const McpManager: React.FC<McpManagerProps> = ({ isOpen, onOpen, onClose }) => {
    const [serverName, setServerName] = useState('google-maps');
    const [toolName, setToolName] = useState('maps_search_places');
    const [argsJson, setArgsJson] = useState('{\n  "query": "Restaurants in Paris",\n  "radius": 5000\n}');
    const [output, setOutput] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);

    const handleExecute = async () => {
        setIsLoading(true);
        setOutput('Executing...');
        try {
            const args = JSON.parse(argsJson);
            const res = await McpClient.execute(serverName, toolName, args);
            
            if (res.status === 'SUCCESS') {
                setOutput(JSON.stringify(res.result, null, 2));
            } else {
                setOutput(`ERROR: ${res.error}`);
            }
        } catch (e: any) {
            setOutput(`JSON PARSE ERROR: ${e.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const loadPreset = (server: string, tool: string, args: string) => {
        setServerName(server);
        setToolName(tool);
        setArgsJson(args);
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content animate-slide-in-right">
                
                <div className="modal-header-area">
                    <div className="flex-group">
                        <span className="modal-section-title" style={{ color: '#38bdf8' }}>MODEL CONTEXT PROTOCOL (MCP)</span>
                    </div>
                    <button onClick={onClose} className="close-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <div className="modal-body-area">
                    
                    <div className="section-panel" style={{ borderColor: '#38bdf8', padding: '1rem', background: 'rgba(56, 189, 248, 0.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <span className="section-header-title" style={{ color: '#38bdf8' }}>INSTALLED SERVERS</span>
                            <span style={{ fontSize: '0.65rem', color: '#666' }}>mcp_config.json</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div className="flex-group">
                                <span style={{ fontSize: '0.8rem', fontWeight: 'bold', width: '120px', color: '#eee' }}>google-maps</span>
                                <div style={{ display: 'flex', gap: '0.25rem' }}>
                                    <button 
                                        className="btn btn-xs btn-secondary" 
                                        onClick={() => loadPreset('google-maps', 'maps_search_places', '{\n  "query": "Coffee shops in Tokyo",\n  "radius": 1000\n}')}
                                    >
                                        SEARCH
                                    </button>
                                    <button 
                                        className="btn btn-xs btn-secondary" 
                                        onClick={() => loadPreset('google-maps', 'maps_distancematrix', '{\n  "origin": "New York, NY",\n  "destination": "Boston, MA",\n  "mode": "driving"\n}')}
                                    >
                                        DISTANCE
                                    </button>
                                </div>
                            </div>
                            <div className="flex-group">
                                <span style={{ fontSize: '0.8rem', fontWeight: 'bold', width: '120px', color: '#eee' }}>chrome-devtools</span>
                                <div style={{ display: 'flex', gap: '0.25rem' }}>
                                    <button 
                                        className="btn btn-xs btn-secondary" 
                                        onClick={() => loadPreset('chrome-devtools', 'Page.reload', '{}')}
                                    >
                                        RELOAD
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex-col">
                        <label className="section-header-title">SERVER NAME</label>
                        <input 
                            className="form-input" 
                            value={serverName} 
                            onChange={e => setServerName(e.target.value)} 
                            placeholder="e.g. filesystem, notebooklm, github"
                        />
                    </div>

                    <div className="flex-col">
                        <label className="section-header-title">TOOL NAME</label>
                        <input 
                            className="form-input" 
                            value={toolName} 
                            onChange={e => setToolName(e.target.value)} 
                            placeholder="e.g. read_file, search_notes"
                        />
                    </div>

                    <div className="flex-col" style={{ flex: 1 }}>
                        <label className="section-header-title">ARGUMENTS (JSON)</label>
                        <textarea 
                            className="form-input" 
                            style={{ height: '100%', resize: 'none', fontFamily: 'monospace', fontSize: '0.8rem' }}
                            value={argsJson}
                            onChange={e => setArgsJson(e.target.value)}
                        />
                    </div>

                    <button 
                        className="btn btn-cyan" 
                        onClick={handleExecute} 
                        disabled={isLoading}
                    >
                        {isLoading ? 'EXECUTING ON SERVER...' : 'RUN MCP TOOL'}
                    </button>

                    <div className="flex-col" style={{ flex: 1, minHeight: '150px' }}>
                        <label className="section-header-title">OUTPUT</label>
                        <div className="section-panel" style={{ flex: 1, overflow: 'auto', fontFamily: 'monospace', fontSize: '0.7rem', whiteSpace: 'pre-wrap', color: '#aaddff' }}>
                            {output}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};
