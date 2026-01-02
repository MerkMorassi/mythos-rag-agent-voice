import React, { useState, useEffect } from 'react';
import { LogMessage, ChatSession } from '../types';
import { saveChatSession, getAllChatSessions, deleteChatSession } from '../services/db';

interface ChatHistoryManagerProps {
  currentLogs: LogMessage[];
  onLoadSession: (logs: LogMessage[]) => void;
}

const ChatHistoryManager: React.FC<ChatHistoryManagerProps> = ({ currentLogs, onLoadSession }) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [sessionName, setSessionName] = useState('');

  const loadSessions = async () => {
    try {
      const data = await getAllChatSessions();
      setSessions(data);
    } catch (e) {
      console.error("Failed to load sessions", e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSessions();
    }
  }, [isOpen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionName.trim()) return;
    if (currentLogs.length === 0) {
      alert("No chat history to save.");
      return;
    }

    const newSession: ChatSession = {
      id: crypto.randomUUID(),
      title: sessionName.trim(),
      timestamp: Date.now(),
      logs: currentLogs
    };

    try {
      await saveChatSession(newSession);
      setSessionName('');
      await loadSessions();
      alert("Session saved successfully.");
    } catch (e) {
      console.error("Failed to save session", e);
      alert("Failed to save session");
    }
  };

  const handleDelete = async (id: string) => {
    if(!window.confirm("Delete this saved session?")) return;
    try {
      await deleteChatSession(id);
      await loadSessions();
    } catch (e) {
      console.error("Failed to delete session", e);
    }
  };

  const handleLoad = (session: ChatSession) => {
    const confirmLoad = window.confirm("Loading a session will replace the current chat history. Continue?");
    if (confirmLoad) {
      onLoadSession(session.logs);
      setIsOpen(false);
    }
  };
  
  const handleClear = () => {
      const confirmClear = window.confirm("Are you sure you want to clear the current chat?");
      if(confirmClear) {
          onLoadSession([]);
          // Note: The App component's useEffect will catch the empty logs and update the persistent store automatically.
          setIsOpen(false);
      }
  }

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="btn btn-secondary"
        style={{ whiteSpace: 'nowrap' }}
        title="Save current chat or load previous sessions"
      >
        <span>SAVE / LOAD CHAT</span>
      </button>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-slide-in-right">
        <div className="section-header" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
             <span className="section-header-title" style={{ fontSize: '1.25rem' }}>SESSION HISTORY</span>
          </div>
          <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          <div className="flex-col">
            <span className="section-header-title">CURRENT SESSION ACTIONS</span>
            <div className="flex-group">
                <button 
                  onClick={handleClear} 
                  className="btn btn-danger" 
                  style={{flex: 1}}
                  disabled={currentLogs.length === 0}
                >
                  CLEAR CHAT
                </button>
            </div>
            <form onSubmit={handleSave} className="flex-col" style={{marginTop: '1rem'}}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Session Name (e.g. Project Alpha)"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  className="form-input"
                  style={{ flex: 1 }}
                />
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={currentLogs.length === 0 || !sessionName.trim()}
                >
                  SAVE
                </button>
              </div>
            </form>
          </div>

          <div className="flex-col">
            <span className="section-header-title">SAVED SESSIONS</span>
            <div className="flex-col" style={{ gap: '0.5rem' }}>
              {sessions.length === 0 ? (
                <div className="section-panel" style={{ textAlign: 'center', padding: '2rem' }}>
                  <p style={{ color: '#666', fontSize: '0.75rem' }}>NO SAVED SESSIONS FOUND</p>
                </div>
              ) : (
                sessions.sort((a,b) => b.timestamp - a.timestamp).map((session) => (
                  <div key={session.id} className="section-panel" style={{ padding: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                         <span style={{ fontWeight: 'bold', fontSize: '0.875rem', color: '#eeeeee' }}>{session.title}</span>
                         <span style={{ fontSize: '0.65rem', color: '#666', fontFamily: 'monospace' }}>
                            {new Date(session.timestamp).toLocaleString()}
                         </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <button 
                            onClick={() => handleLoad(session)}
                            className="btn btn-secondary"
                            style={{ flex: 1, fontSize: '0.7rem', padding: '0.4rem' }}
                        >
                            LOAD SESSION
                        </button>
                        <button 
                            onClick={() => handleDelete(session.id)}
                            className="btn btn-danger"
                            style={{ width: '2.5rem', padding: '0.4rem' }}
                            title="Delete Session"
                        >
                            DEL
                        </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default ChatHistoryManager;