
import React, { useState, useEffect, useRef } from 'react';
import { ShellService } from '../services/shell';

interface TerminalProps {
    isOpen: boolean;
    onClose: () => void;
    onSwitchAgent: (agentId: string) => void;
    currentAgentHandle: string;
}

export const Terminal: React.FC<TerminalProps> = ({ isOpen, onClose, onSwitchAgent, currentAgentHandle }) => {
    const [history, setHistory] = useState<string[]>([]);
    const [input, setInput] = useState('');
    const [shell] = useState(() => new ShellService(currentAgentHandle));
    const [prompt, setPrompt] = useState('');
    
    const inputRef = useRef<HTMLInputElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Sync shell user with active agent
        shell.setUser(currentAgentHandle);
        setPrompt(shell.getPrompt());
    }, [currentAgentHandle, shell]);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    useEffect(() => {
        if(isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history, isOpen]);

    const handleKeyDown = async (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            const cmd = input;
            setInput('');
            setHistory(prev => [...prev, `${prompt} ${cmd}`]);
            
            if (cmd.trim() === 'clear') {
                setHistory([]);
                return;
            }
            if (cmd.trim() === 'exit') {
                onClose();
                return;
            }

            const res = await shell.execute(cmd);
            if (res.output) {
                setHistory(prev => [...prev, res.output]);
            }
            
            setPrompt(shell.getPrompt());
            
            if (res.action && res.action.type === 'SWITCH_AGENT') {
                onSwitchAgent(res.action.payload);
            }
        }
    };

    if (!isOpen) return null;

    return (
        <div 
            style={{ 
                position: 'fixed', 
                top: 0, 
                left: 0, 
                width: '100%', 
                height: '50vh', 
                backgroundColor: 'rgba(10, 10, 10, 0.95)', 
                borderBottom: '2px solid #4ade80',
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                color: '#eee',
                boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
                backdropFilter: 'blur(8px)',
                transition: 'transform 0.2s'
            }}
            className="animate-slide-in-down"
        >
            <div style={{ padding: '0.5rem', background: '#222', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', color: '#4ade80', paddingLeft: '0.5rem' }}>MYTHOS TERMINAL // BASH v1.0</span>
                <button 
                    className="btn btn-ghost"
                    style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', fontWeight: 'bold' }}
                    onClick={onClose}
                >
                    [CLOSE X]
                </button>
            </div>
            
            <div 
                style={{ 
                    flex: 1, 
                    overflowY: 'auto', 
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem'
                }}
                onClick={() => inputRef.current?.focus()}
            >
                {history.length === 0 && (
                    <div style={{ color: '#666', marginBottom: '1rem' }}>
                        Welcome to MythOS Shell.<br/>
                        Type 'help' for a list of commands.<br/>
                        Type 'exit' or press ~ to close.<br/>
                    </div>
                )}
                
                {history.map((line, i) => (
                    <div key={i} dangerouslySetInnerHTML={{ __html: line }} />
                ))}
                
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <span style={{ color: '#4ade80' }}>{prompt}</span>
                    <input 
                        ref={inputRef}
                        type="text" 
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        style={{ 
                            flex: 1, 
                            background: 'transparent', 
                            border: 'none', 
                            color: '#fff', 
                            outline: 'none',
                            fontFamily: 'inherit',
                            fontSize: 'inherit'
                        }}
                        autoFocus
                    />
                </div>
                <div ref={bottomRef} />
            </div>
        </div>
    );
};
