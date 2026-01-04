
import React, { useState, useEffect, useRef } from 'react';
import { ModelConfig, DEFAULT_MODEL_CONFIG } from '../types';
import { getSavedPromptsByAgentId, SavedPrompt, deleteSavedPrompt, getAgentConfig } from '../services/db';
import { AccessControl } from '../services/accessControl';

// PREBUILT VOICES LIST
const PREBUILT_VOICES = ["Puck", "Kore", "Fenrir", "Zephyr", "Aoede", "Callirrhoe", "Leda"];

interface SettingsManagerProps {
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig) => void;
  disabled: boolean;
  
  generalInstruction: string;
  setGeneralInstruction: (val: string) => void;
  
  agentInstruction: string;
  setAgentInstruction: (val: string) => void;
  
  agentName: string;
  agentId: string; 
  
  // New props for access level
  agentAccessLevel?: string;
  
  // Voice Props
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  
  onSave: (voiceRef?: string, accessLevel?: string, voiceSpeed?: number, voicePitch?: number) => Promise<void>;
  onDirty?: () => void;
  
  // Modal Control
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
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
  agentAccessLevel,
  selectedVoice,
  onVoiceChange,
  onSave,
  onDirty,
  isOpen,
  onOpen,
  onClose
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  
  const [localAccessLevel, setLocalAccessLevel] = useState('755');
  
  // Voice Settings
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceBase64, setVoiceBase64] = useState<string | undefined>(undefined);
  const [voiceSpeed, setVoiceSpeed] = useState<number>(1.0);
  const [voicePitch, setVoicePitch] = useState<number>(0); // Semitones
  
  const voiceInputRef = useRef<HTMLInputElement>(null);
  
  // API Credentials State
  const [geminiKey, setGeminiKey] = useState('');
  const [hfToken, setHfToken] = useState('');
  const [openlKey, setOpenlKey] = useState('');

  useEffect(() => {
      if (isOpen) {
          if (agentId) {
              loadPrompts();
              loadAgentVoiceSettings();
          }
          setLocalAccessLevel(agentAccessLevel || '400');
          setGeminiKey(localStorage.getItem('gemini_api_key') || '');
          setHfToken(localStorage.getItem('hf_token') || '');
          setOpenlKey(localStorage.getItem('openl_api_key') || '');
      }
  }, [isOpen, agentId, agentAccessLevel]);

  const loadAgentVoiceSettings = async () => {
      try {
          const cfg = await getAgentConfig(agentId);
          setVoiceSpeed(cfg.voiceSpeed !== undefined ? cfg.voiceSpeed : 1.0);
          setVoicePitch(cfg.voicePitch !== undefined ? cfg.voicePitch : 0);
          setVoiceBase64(cfg.voiceReference);
      } catch (e) {
          console.warn("Failed to load agent voice settings", e);
      }
  };

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
      if (onDirty) onDirty();
  };

  const handleChange = (key: keyof ModelConfig, value: number) => {
    setModelConfig({ ...modelConfig, [key]: value });
    if (onDirty) onDirty();
  };

  const handleVoiceSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          setVoiceFile(file);
          
          const reader = new FileReader();
          reader.onload = (evt) => {
              const res = evt.target?.result as string;
              setVoiceBase64(res); 
              if (onDirty) onDirty();
          };
          reader.readAsDataURL(file);
      }
  };

  const handleAccessChange = (val: string) => {
      setLocalAccessLevel(val);
      if (onDirty) onDirty();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
        if (geminiKey) localStorage.setItem('gemini_api_key', geminiKey);
        else localStorage.removeItem('gemini_api_key');

        if (hfToken) localStorage.setItem('hf_token', hfToken);
        else localStorage.removeItem('hf_token');

        if (openlKey) localStorage.setItem('openl_api_key', openlKey);
        else localStorage.removeItem('openl_api_key');

        await onSave(voiceBase64, localAccessLevel, voiceSpeed, voicePitch);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
        console.error(e);
    } finally {
        setIsSaving(false);
    }
  };

  const accessDesc = AccessControl.getDescription(localAccessLevel);

  if (!isOpen) {
    return (
      <button 
        onClick={onOpen}
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
        
        <div className="modal-header-area">
          <div className="flex-group">
             <span className="modal-section-title">SYSTEM CONFIGURATION</span>
          </div>
          <button onClick={onClose} className="close-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="modal-body-area">
          
          <div className="section-panel" style={{ borderColor: disabled ? '#4ade80' : '#333' }}>
            <div className="section-header" style={{ borderBottom: 'none', padding: 0, marginBottom: '0.5rem' }}>
                 <span className="section-header-title" style={{color: '#4ade80'}}>SYSTEM STATUS</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#eee' }}>
                {disabled 
                    ? "LIVE LINK ACTIVE. Saving updates will inject new instructions into the active session." 
                    : "Ready to apply configuration to next connection."}
            </p>
          </div>
          
          <form onSubmit={handleSave} className="flex-col" style={{gap: '2rem'}}>
            
            {/* PERMISSION CHMOD EDITOR */}
            <div className="flex-col">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="section-header-title" style={{color: '#a78bfa'}}>ACCESS CONTROL (CHMOD)</span>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <input 
                        type="text"
                        maxLength={3}
                        value={localAccessLevel}
                        onChange={(e) => handleAccessChange(e.target.value.replace(/[^0-7]/g, ''))}
                        className="form-input"
                        style={{ width: '5rem', textAlign: 'center', fontSize: '1.25rem', fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: '2px', color: '#a78bfa', borderColor: '#a78bfa' }}
                    />
                    <div className="flex-col" style={{ gap: '0.2rem' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#eee' }}>{accessDesc}</span>
                        <span style={{ fontSize: '0.65rem', color: '#666' }}>Format: [LORE] [TOOLS] [SYSTEM] (e.g. 755)</span>
                    </div>
                </div>
            </div>

            <div className="flex-col">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="section-header-title" style={{color: '#facc15'}}>CREDENTIALS</span>
                    {saveSuccess && <span className="animate-pulse" style={{ color: '#4ade80', fontWeight: 'bold' }}>✓ SAVED</span>}
                </div>
                <div className="flex-col" style={{ gap: '0.75rem' }}>
                    <div>
                        <label className="form-label">GEMINI API KEY (Required)</label>
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
                        <label className="form-label">HUGGING FACE TOKEN (Read - Optional)</label>
                        <input 
                            type="password"
                            value={hfToken}
                            onChange={(e) => setHfToken(e.target.value)}
                            placeholder="hf_..."
                            className="form-input"
                            style={{ fontFamily: 'monospace' }}
                        />
                    </div>
                    <div>
                        <label className="form-label">OPENL.IO API KEY (Translate - Optional)</label>
                        <input 
                            type="password"
                            value={openlKey}
                            onChange={(e) => setOpenlKey(e.target.value)}
                            placeholder="Key..."
                            className="form-input"
                            style={{ fontFamily: 'monospace' }}
                        />
                    </div>
                </div>
            </div>

            {/* VOICE SETTINGS & CLONE */}
            <div className="flex-col">
                <span className="section-header-title" style={{color: '#a78bfa'}}>VOICE PARAMETERS</span>
                
                <div style={{ marginBottom: '0.5rem' }}>
                    <label className="form-label">PREBUILT VOICE MODEL</label>
                    <select 
                        className="form-select"
                        value={selectedVoice}
                        onChange={(e) => { onVoiceChange(e.target.value); if(onDirty) onDirty(); }}
                    >
                        {PREBUILT_VOICES.map(v => (
                            <option key={v} value={v}>{v}</option>
                        ))}
                    </select>
                </div>

                <div className="flex-group" style={{justifyContent: 'space-between', alignItems: 'center'}}>
                    <span className="form-label" style={{ width: '30%' }}>SPEED ({voiceSpeed}x)</span>
                    <input 
                        type="range" 
                        min="0.5" 
                        max="2.0" 
                        step="0.1" 
                        value={voiceSpeed} 
                        onChange={(e) => { setVoiceSpeed(parseFloat(e.target.value)); if(onDirty) onDirty(); }} 
                        style={{ width: '60%' }} 
                    />
                </div>
                
                <div className="flex-group" style={{justifyContent: 'space-between', alignItems: 'center'}}>
                    <span className="form-label" style={{ width: '30%' }}>PITCH ({voicePitch > 0 ? '+' : ''}{voicePitch} st)</span>
                    <input 
                        type="range" 
                        min="-12" 
                        max="12" 
                        step="1" 
                        value={voicePitch} 
                        onChange={(e) => { setVoicePitch(parseInt(e.target.value)); if(onDirty) onDirty(); }} 
                        style={{ width: '60%' }} 
                    />
                </div>

                <div style={{ marginTop: '0.5rem' }}>
                    <input 
                        type="file" 
                        accept="audio/*" 
                        ref={voiceInputRef} 
                        className="hidden" 
                        onChange={handleVoiceSelect}
                    />
                    <div 
                        onClick={() => voiceInputRef.current?.click()}
                        className="btn btn-secondary"
                        style={{ borderStyle: 'dashed', textAlign: 'center', cursor: 'pointer', padding: '1rem', height: 'auto' }}
                    >
                        {voiceFile ? `SELECTED: ${voiceFile.name}` : (voiceBase64 ? "REPLACE REFERENCE AUDIO" : "UPLOAD REFERENCE AUDIO (WAV/MP3)")}
                    </div>
                    {voiceBase64 && (
                        <div style={{ marginTop: '0.5rem' }}>
                            <audio src={voiceBase64} controls style={{ width: '100%', height: '2rem' }} />
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-col">
              <span className="section-header-title" style={{color: '#eee'}}>GENERAL SYSTEM INSTRUCTIONS (GLOBAL)</span>
              <textarea
                placeholder="Instructions that apply to ALL agents..."
                value={generalInstruction}
                onChange={(e) => { setGeneralInstruction(e.target.value); if (onDirty) onDirty(); }}
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
                onChange={(e) => { setAgentInstruction(e.target.value); if (onDirty) onDirty(); }}
                className="form-input"
                style={{ height: '6rem', resize: 'vertical' }}
                disabled={false}
              />
            </div>

            <hr style={{ borderColor: '#333', margin: 0 }} />

            <div className="flex-col">
               <div className="section-header" style={{ borderBottom: 'none', padding: 0 }}>
                   <span className="section-header-title" style={{ color: '#4ade80' }}>MODEL PARAMETERS ({agentName.toUpperCase()})</span>
              </div>
              
              <div className="flex-col" style={{ gap: '0.5rem' }}>
                  <div className="flex-group" style={{ justifyContent: 'space-between' }}>
                      <span className="form-label" style={{marginBottom: 0}}>TEMPERATURE: {modelConfig.temperature}</span>
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
                      <span className="form-label" style={{marginBottom: 0}}>TOP P: {modelConfig.topP}</span>
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
                      <span className="form-label" style={{marginBottom: 0}}>TOP K: {modelConfig.topK}</span>
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
                    onClick={() => { setModelConfig(DEFAULT_MODEL_CONFIG); if (onDirty) onDirty(); }}
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
                    className="btn btn-primary"
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
