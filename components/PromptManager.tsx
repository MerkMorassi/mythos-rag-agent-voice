import React, { useState, useEffect } from 'react';
import { SavedPrompt } from '../services/db';
import {
  savePrompt,
  getSavedPromptsByAgentId,
  deleteSavedPrompt
} from '../services/db';
import { NumMarkX_GenerateID } from '../patterns/NumMarkX';

interface PromptManagerProps {
  isOpen: boolean;
  onClose: () => void;
  currentAgentId: string;
  onLoadPrompt: (content: string) => void;
}

export const PromptManager: React.FC<PromptManagerProps> = ({ isOpen, onClose, currentAgentId, onLoadPrompt }) => {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const refreshPrompts = async () => {
    setIsLoading(true);
    const agentHandle = currentAgentId; 
    const saved = await getSavedPromptsByAgentId(agentHandle);
    setPrompts(saved);
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      refreshPrompts();
    }
  }, [isOpen, currentAgentId]);

  const handleSave = async () => {
    if (!newPromptName.trim() || !newPromptContent.trim()) return;
    const newPrompt: SavedPrompt = {
      id: NumMarkX_GenerateID('PROMPT'),
      agentId: currentAgentId,
      name: newPromptName,
      content: newPromptContent
    };
    await savePrompt(newPrompt);
    setNewPromptName('');
    setNewPromptContent('');
    await refreshPrompts();
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("Delete this prompt?")) {
      await deleteSavedPrompt(id);
      await refreshPrompts();
    }
  };

  const handleLoad = (content: string) => {
    onLoadPrompt(content);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-slide-in-right">
        <div className="modal-header-area">
          <span className="modal-section-title" style={{ color: '#fcd34d' }}>PROMPT LIBRARY</span>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>
        <div className="modal-body-area">
          
          <div className="section-panel" style={{ borderColor: '#fcd34d' }}>
            <span className="section-header-title">CREATE NEW PROMPT</span>
            <div className="flex-col" style={{ gap: '0.75rem' }}>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Prompt Name..." 
                value={newPromptName}
                onChange={e => setNewPromptName(e.target.value)}
              />
              <textarea 
                className="form-input" 
                style={{ height: '6rem', resize: 'vertical' }} 
                placeholder="Prompt content..."
                value={newPromptContent}
                onChange={e => setNewPromptContent(e.target.value)}
              />
              <button onClick={handleSave} className="btn btn-secondary" style={{ borderColor: '#fcd34d', color: '#fcd34d' }}>SAVE PROMPT</button>
            </div>
          </div>
          
          <div className="flex-col">
            <span className="section-header-title">SAVED FOR AGENT: {currentAgentId}</span>
            {isLoading && <div>Loading...</div>}
            {!isLoading && prompts.length === 0 && <div className="section-panel" style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>No prompts saved for this agent.</div>}
            <div className="flex-col" style={{ gap: '0.5rem' }}>
              {prompts.sort((a,b) => a.name.localeCompare(b.name)).map(p => (
                <div key={p.id} className="section-panel" style={{ padding: '0.75rem' }}>
                  <div style={{ fontWeight: 'bold', color: '#eee', marginBottom: '0.5rem' }}>{p.name}</div>
                  <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 0.75rem 0', whiteSpace: 'pre-wrap', maxHeight: '50px', overflow: 'hidden', borderLeft: '2px solid #333', paddingLeft: '0.5rem' }}>{p.content}</p>
                  <div className="flex-group">
                    <button onClick={() => handleLoad(p.content)} className="btn btn-primary btn-sm" style={{ flex: 1 }}>LOAD</button>
                    <button onClick={() => handleDelete(p.id)} className="btn btn-danger btn-sm" style={{ width: '4rem' }}>DELETE</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
