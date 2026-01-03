
import React, { useState, useEffect } from 'react';
import { ModelConfig, DEFAULT_MODEL_CONFIG } from '../types';
import { getSavedPromptsByAgentId, SavedPrompt, deleteSavedPrompt } from '../services/db';

interface SettingsManagerProps {
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig) => void;
  disabled: boolean;
  
  generalInstruction: string;
  setGeneralInstruction: (val: string) => void;
  
  agentInstruction: string;
  setAgentInstruction: (val: string) => void;
  
  agentName: string;
  agentId: string; // Needed for loading saved prompts
  
  onSave: () => Promise<void>;
}

const SettingsManager: React.FC<SettingsManagerProps> = ({ 
  modelConfig, 
  setModelConfig, 
  disabled,
  generalInstruction,
  setGeneralInstruction,
  agentInstruction,
  setAgentInstruction,
  agentName,
  agentId,
  onSave
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  
  // API Credentials State
  const [geminiKey, setGeminiKey] = useState('');
  const [hfToken, setHfToken] = useState('');

  useEffect(() => {
      if (isOpen) {
          if (agentId) loadPrompts();
          // Load credentials from local storage (not persistent across devices/sessions if cleared)
          setGeminiKey(localStorage.getItem('gemini_api_key') || '');
          setHfToken(localStorage.getItem('hf_token') || '');
      }
  }, [isOpen, agentId]);

  const loadPrompts = async () => {
      const prompts = await getSavedPromptsByAgentId(agentId);
      setSavedPrompts(prompts);
  };

  const handleDeletePrompt = async (id: string) => {
      if (window.confirm("Delete this saved prompt?")) {
          await deleteSavedPrompt(id);
          loadPrompts();
      }
  };

  const handleLoadPrompt = (content: string) => {
      if (agentInstruction && agentInstruction.trim() !== "") {
          if (!window.confirm("Replace current instructions with this saved prompt?")) return;
      }
      setAgentInstruction(content);
  };

  const handleChange = (key: keyof ModelConfig, value: number) => {
    setModelConfig({ ...modelConfig, [key]: value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
        // Save Credentials
        if (geminiKey) localStorage.setItem('gemini_api_key', geminiKey);
        else localStorage.removeItem('gemini_api_key');

        if (hfToken) localStorage.setItem('hf_token', hfToken);
        else localStorage.removeItem('hf_token');

        await onSave();
    } catch (e) {
        console.error(e);
    } finally {
        setIsSaving(false);
    }
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="btn btn-secondary btn-icon"
        title="Settings & System Configuration"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-slide-in-right">
        
        <div className="section-header" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
             <span className="section-header-title" style={{ fontSize: '1.25rem' }}>SYSTEM CONFIGURATION</span>
          </div>
          <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="section-panel" style={{ borderColor: disabled ? '#4ade80' : '#4ade80' }}>
            <div className="section-header" style={{ borderBottom: 'none', padding: 0, marginBottom: '0.5rem' }}>
                 <span className="section-header-title" style={{color: '#4ade80'}}>STATUS</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#eee' }}>
                {disabled 
                    ? "LIVE LINK ACTIVE. Saving updates will inject new instructions into the active session." 
                    : "Ready to apply to next connection."}
            </p>
          </div>
          
          <form onSubmit={handleSave} className="flex-col" style={{gap: '1.5rem'}}>
            
            <div className="flex-col">
                <span className="section-header-title" style={{color: '#facc15'}}>CREDENTIALS</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div>
                        <label style={{ fontSize: '0.7rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>GEMINI API KEY (Required)</label>
                        <input 
                            type="password"
                            value={geminiKey}
                            onChange={(e) => setGeminiKey(e.target.value)}
                            placeholder="AIza..."
                            className="form-input"
                            style={{ fontFamily: 'monospace' }}
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: '0.7rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>HUGGING FACE TOKEN (Read - Optional)</label>
                        <input 
                            type="password"
                            value={hfToken}
                            onChange={(e) => setHfToken(e.target.value)}
                            placeholder="hf_..."
                            className="form-input"
                            style={{ fontFamily: 'monospace' }}
                        />
                    </div>
                </div>
            </div>

            <div className="flex-col">
              <span className="section-header-title" style={{color: '#a3a3a3'}}>GENERAL SYSTEM INSTRUCTIONS (GLOBAL)</span>
              <textarea
                placeholder="Instructions that apply to ALL agents (e.g., 'Be concise', 'Always answer in JSON')..."
                value={generalInstruction}
                onChange={(e) => setGeneralInstruction(e.target.value)}
                className="form-input"
                style={{ height: '6rem', resize: 'vertical' }}
                disabled={false} 
              />
            </div>

            <div className="flex-col">
              <span className="section-header-title" style={{color: '#a78bfa'}}>AGENT FINE-TUNING: {agentName.toUpperCase()}</span>
              
              {/* SAVED PROMPTS LOADER */}
              {savedPrompts.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
                      {savedPrompts.map(p => (
                          <div key={p.id} className="section-panel" style={{ padding: '0.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                              <span 
                                onClick={() => handleLoadPrompt(p.content)}
                                style={{ fontSize: '0.65rem', cursor: 'pointer', color: '#a78bfa', fontWeight: 'bold' }}
                                title="Click to Load"
                              >
                                  {p.name}
                              </span>
                              <button 
                                type="button" 
                                onClick={() => handleDeletePrompt(p.id)}
                                style={{ background: 'none', border: 'none', color: '#f87171', fontSize: '0.6rem', cursor: 'pointer' }}
                              >
                                  ×
                              </button>
                          </div>
                      ))}
                  </div>
              )}

              <textarea
                placeholder={`Specific instructions for ${agentName}...`}
                value={agentInstruction}
                onChange={(e) => setAgentInstruction(e.target.value)}
                className="form-input"
                style={{ height: '6rem', resize: 'vertical' }}
                disabled={false}
              />
            </div>

            <hr style={{ borderColor: '#333', margin: 0 }} />

            <div className="flex-col">
               <div className="section-header" style={{ borderBottom: 'none', padding: 0 }}>
                   <span className="section-header-title">MODEL PARAMETERS ({agentName.toUpperCase()})</span>
              </div>
              
              <div className="flex-col">
                  <div className="flex-group" style={{ justifyContent: 'space-between' }}>
                      <span className="section-header-title">TEMPERATURE: {modelConfig.temperature}</span>
                      <input 
                          type="range" 
                          min="0" 
                          max="2" 
                          step="0.1" 
                          value={modelConfig.temperature} 
                          onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
                          disabled={disabled}
                          style={{ width: '50%' }}
                      />
                  </div>
                  <div className="flex-group" style={{ justifyContent: 'space-between' }}>
                      <span className="section-header-title">TOP P: {modelConfig.topP}</span>
                      <input 
                          type="range" 
                          min="0" 
                          max="1" 
                          step="0.05" 
                          value={modelConfig.topP} 
                          onChange={(e) => handleChange('topP', parseFloat(e.target.value))}
                          disabled={disabled}
                          style={{ width: '50%' }}
                      />
                  </div>
                  <div className="flex-group" style={{ justifyContent: 'space-between' }}>
                      <span className="section-header-title">TOP K: {modelConfig.topK}</span>
                      <input 
                          type="range" 
                          min="1" 
                          max="100" 
                          step="1" 
                          value={modelConfig.topK} 
                          onChange={(e) => handleChange('topK', parseInt(e.target.value))}
                          disabled={disabled}
                          style={{ width: '50%' }}
                      />
                  </div>
              </div>

              <div className="flex-group" style={{ marginTop: '1rem' }}>
                  <button 
                    onClick={() => setModelConfig(DEFAULT_MODEL_CONFIG)}
                    className="btn btn-secondary"
                    type="button"
                    disabled={disabled}
                    style={{ flex: 1 }}
                  >
                    RESET DEFAULTS
                  </button>
                  <button 
                    type="submit" 
                    disabled={isSaving}
                    className="btn btn-ingest"
                    style={{ flex: 2 }}
                  >
                    {isSaving ? 'SAVING...' : (disabled ? 'UPDATE LIVE SESSION' : 'SAVE CONFIGURATION')}
                  </button>
              </div>
            </div>
          </form>

        </div>
      </div>
    </div>
  );
};

export default SettingsManager;
