
import React, { useState } from 'react';
import { McpClient } from '../services/mcpClient';

interface McpManagerProps {
    isOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
}

export const McpManager: React.FC<McpManagerProps> = ({ isOpen, onOpen, onClose }) => {
    const [serverName, setServerName] = useState('filesystem');
    const [toolName, setToolName] = useState('read_file');
    const [argsJson, setArgsJson] = useState('{\n  "path": "README.md"\n}');
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
                    
                    <div className="section-panel" style={{ borderColor: '#38bdf8', padding: '1rem' }}>
                        <p style={{ fontSize: '0.75rem', color: '#ccc', marginBottom: '0.5rem' }}>
                            Connect to external data sources and tools via the Orchestrator Bridge. 
                            Add servers to <code>mcp_config.json</code> in the root directory.
                        </p>
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
