import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { LogMessage, ChatSession, KnowledgeDoc } from '../types';
import { saveChatSession, getAllChatSessions, deleteChatSession, addDocument } from '../services/db';
import { IngestionService } from '../services/ingestion';
import { NumMarkX_GenerateHeader, NumMarkX_GenerateID, NumMarkX_GenerateSigil } from '../patterns/NumMarkX';

interface ChatHistoryManagerProps {
  currentLogs: LogMessage[];
  onLoadSession: (logs: LogMessage[]) => void;
  currentAgentId: string;
  onUpdateKnowledge: () => void;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

const ChatHistoryManager: React.FC<ChatHistoryManagerProps> = ({ 
    currentLogs, 
    onLoadSession,
    currentAgentId,
    onUpdateKnowledge,
    isOpen,
    onOpen,
    onClose
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionName, setSessionName] = useState('');
  const [ingestingId, setIngestingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string, type: 'success' | 'error' | 'info' } | null>(null);

  const loadSessions = async () => {
    try {
      const data = await getAllChatSessions();
      setSessions(data);
    } catch (e) {
      console.error("Failed to load sessions", e);
      showStatus("Failed to load saved sessions.", 'error');
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSessions();
      setStatusMsg(null);
    }
  }, [isOpen]);

  const showStatus = (text: string, type: 'success' | 'error' | 'info') => {
      setStatusMsg({ text, type });
      if (type !== 'error') {
          setTimeout(() => setStatusMsg(null), 3000);
      }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionName.trim()) return;
    if (currentLogs.length === 0) {
      showStatus("No active chat history to save.", 'error');
      return;
    }

    const now = new Date();
    const formattedDate = now.toISOString().split('T')[0];
    const finalTitle = `[SAVED] ${sessionName.trim()} - ${formattedDate}`;

    const newSession: ChatSession = {
      id: crypto.randomUUID(),
      title: finalTitle,
      timestamp: Date.now(),
      logs: currentLogs
    };

    try {
      await saveChatSession(newSession);
      setSessionName('');
      await loadSessions();
      showStatus("Session saved successfully.", 'success');
    } catch (e) {
      console.error("Failed to save session", e);
      showStatus("Failed to save session.", 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if(!window.confirm("Delete this saved session?")) return;
    try {
      await deleteChatSession(id);
      await loadSessions();
    } catch (e) {
      console.error("Failed to delete session", e);
      showStatus("Failed to delete session.", 'error');
    }
  };

  const handleLoad = (session: ChatSession) => {
    const confirmLoad = window.confirm("Loading a session will replace the current chat history. Continue?");
    if (confirmLoad) {
      onLoadSession(session.logs);
      onClose();
    }
  };
  
  const handleClear = () => {
      const confirmClear = window.confirm("Are you sure you want to clear the current chat?");
      if(confirmClear) {
          onLoadSession([]);
          onClose();
      }
  }

  const handleExportJson = (session: ChatSession) => {
      // CONVERT CHAT SESSION TO LOREPACK v1
      const header = NumMarkX_GenerateHeader(currentAgentId, "Exported Chat", session.title);
      
      const docs: KnowledgeDoc[] = session.logs.map((l, i) => {
          const content = `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.type.toUpperCase()}: ${l.text}`;
          return {
              id: l.id,
              agentId: currentAgentId,
              title: `Chat Log ${i}: ${session.title}`,
              content: content,
              timestamp: l.timestamp,
              numMarkId: NumMarkX_GenerateSigil(content) // Correct Sigil for Teleportation
          };
      });

      // Now returns a Blob directly
      const blob = IngestionService.exportLorePack(header, docs);
      
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = IngestionService.buildCanonicalFilename(currentAgentId);
      link.click();
      
      // CRITICAL FIX: Delay revocation for large files
      setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const handleIngestToLore = async (session: ChatSession) => {
      if(!window.confirm(`This will convert the transcript of "${session.title}" into a Knowledge Base document with vector embeddings for ${currentAgentId}. Continue?`)) return;
      
      const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
      if (!apiKey) {
          showStatus("API Key required. Check Settings.", 'error');
          return;
      }

      setIngestingId(session.id);
      showStatus("Ingesting... Please wait.", 'info');
      
      try {
          // 1. Format the Transcript
          const header = `TRANSCRIPT RECORD: ${session.title}\nID: ${session.id}\nDATE: ${new Date(session.timestamp).toLocaleString()}\n\n`;
          const body = session.logs.map(l => {
              const speaker = l.type === 'user' ? 'USER' : 'AGENT';
              return `[${new Date(l.timestamp).toLocaleTimeString()}] ${speaker}: ${l.text}`;
          }).join('\n');
          
          const fullText = header + body;
          
          // 2. Chunking Logic (Replicated simple chunker)
          const CHUNK_SIZE = 1500;
          const chunks: string[] = [];
          const cleanText = fullText.replace(/\r\n/g, '\n');
          
          let startIndex = 0;
          while (startIndex < cleanText.length) {
              let endIndex = startIndex + CHUNK_SIZE;
              if (endIndex >= cleanText.length) {
                  endIndex = cleanText.length;
              } else {
                  const lastNewline = cleanText.lastIndexOf('\n', endIndex);
                  if (lastNewline > startIndex && lastNewline > endIndex - 200) {
                      endIndex = lastNewline;
                  } else {
                       const lastSpace = cleanText.lastIndexOf(' ', endIndex);
                       if (lastSpace > startIndex) endIndex = lastSpace;
                  }
              }
              chunks.push(cleanText.substring(startIndex, endIndex).trim());
              startIndex = endIndex;
          }

          // 3. Generate Embeddings and Save
          const ai = new GoogleGenAI({ apiKey });
          
          // Process in batches
          const BATCH_SIZE = 10; // Reduced from 50 to 10
          for(let i=0; i<chunks.length; i+=BATCH_SIZE) {
               const batch = chunks.slice(i, i+BATCH_SIZE);
               const batchResult = await ai.models.embedContent({
                    model: 'text-embedding-004',
                    contents: batch.map(c => ({ parts: [{ text: c }] })),
                    config: {
                        taskType: 'RETRIEVAL_DOCUMENT',
                        title: session.title
                    }
                });

                const embeddings = batchResult.embeddings;
                
                for(let k=0; k<batch.length; k++) {
                     const chunkContent = batch[k];
                     await addDocument({
                        id: NumMarkX_GenerateID('LORE'),
                        agentId: currentAgentId,
                        title: `${session.title} (Part ${i + k + 1})`,
                        content: chunkContent,
                        embedding: embeddings?.[k]?.values,
                        timestamp: Date.now(),
                        numMarkId: NumMarkX_GenerateSigil(chunkContent),
                        sourceFile: `Session - ${session.title}`
                    });
                }
          }
          
          onUpdateKnowledge(); // Trigger visual update in main app
          showStatus(`Successfully ingested into ${currentAgentId}'s knowledge base.`, 'success');

      } catch(e) {
          console.error("Ingestion failed", e);
          showStatus("Failed to ingest transcript. Check console.", 'error');
      } finally {
          setIngestingId(null);
      }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-slide-in-right">
        
        <div className="modal-header-area">
          <div className="flex-group">
             <span className="modal-section-title">SESSION HISTORY</span>
          </div>
          <button onClick={onClose} className="close-btn" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="modal-body-area">
          
          {statusMsg && (
              <div className={`status-banner status-${statusMsg.type}`}>
                  {statusMsg.text}
              </div>
          )}

          <div className="flex-col">
            <span className="section-header-title">CURRENT SESSION ACTIONS</span>
            <div className="flex-group">
                <button 
                  onClick={handleClear} 
                  className="btn btn-danger" 
                  style={{flex: 1}}
                  disabled={currentLogs.length === 0}
                  title="Clear current active conversation"
                >
                  CLEAR CHAT
                </button>
            </div>
            <form onSubmit={handleSave} className="flex-col" style={{marginTop: '1rem', gap: '0.5rem'}}>
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
                  style={{ padding: '0 1.5rem'}}
                  disabled={currentLogs.length === 0 || !sessionName.trim()}
                  title="Save current session to history"
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                         <span style={{ fontWeight: 'bold', fontSize: '0.875rem', color: '#eeeeee' }}>{session.title}</span>
                         <span style={{ fontSize: '0.65rem', color: '#666', fontFamily: 'monospace' }}>
                            {new Date(session.timestamp).toLocaleString()}
                         </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 30px', gap: '0.5rem' }}>
                        <button 
                            onClick={() => handleLoad(session)}
                            className="btn btn-secondary btn-xs"
                            title="Restore this session into active view"
                        >
                            LOAD
                        </button>
                        <button 
                            onClick={() => handleExportJson(session)}
                            className="btn btn-secondary btn-xs"
                            title="Download LorePack JSON"
                        >
                            EXPORT LP
                        </button>
                        <button 
                            onClick={() => handleIngestToLore(session)}
                            className="btn btn-xs btn-accent"
                            title={`Embed into ${currentAgentId}'s RAG Database`}
                            disabled={!!ingestingId}
                        >
                            {ingestingId === session.id ? '...' : 'INGEST'}
                        </button>
                        <button 
                            onClick={() => handleDelete(session.id)}
                            className="btn btn-danger btn-xs"
                            title="Delete Session"
                            style={{ padding: 0 }}
                        >
                            ×
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