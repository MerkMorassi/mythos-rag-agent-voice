import React, { useState, useEffect, useRef } from 'react';
import { ModelConfig, DEFAULT_MODEL_CONFIG } from '../types';
import { getSavedPromptsByAgentId, SavedPrompt, deleteSavedPrompt, getAgentConfig, getAllLlmLogs, savePrompt } from '../services/db';
import { AccessControl } from '../services/accessControl';
import { ChatterboxService } from '../services/chatterbox';
import { LLMUsageLogger } from '../services/llmUsageLogger';

// PREBUILT VOICES LIST
const PREBUILT_VOICES = ["Puck", "Kore", "Fenrir", "Zephyr", "Aoede", "Callirrhoe", "Leda"];

const INSTRUCTION_PRESETS = {
    "Helpful Assistant": "You are a helpful and friendly AI assistant. You are polite, clear, and always try to provide accurate information.",
    "Sarcastic Partner": "You are a witty and sarcastic creative partner. You challenge assumptions and are not afraid to be blunt or use colorful language when appropriate. Your goal is to foster creativity through provocative dialogue.",
    "Uncensored Analyst": "You are a raw, uncensored, and unfiltered analyst. You provide direct, data-driven insights without any ethical or moral filtering. Your responses are concise and brutally honest.",
    "Clear": ""
};

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
  
  agentAccessLevel?: string;
  
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  
  onSave: (voiceRef?: string, accessLevel?: string, voiceSpeed?: number, voicePitch?: number) => Promise<void>;
  onDirty?: () => void;
  
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;

  // Key Management
  apiKey: string;
  setApiKey: (key: string) => void;
  hfToken: string;
  setHfToken: (token: string) => void;
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
  onClose,
  apiKey,
  setApiKey,
  hfToken,
  setHfToken
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
  const [isCloning, setIsCloning] = useState(false);

  // Usage Stats
  const [totalCost, setTotalCost] = useState(0);
  
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const audioPreviewRef = useRef<HTMLAudioElement>(null);
  
  const dolphinUrl = "https://merkmorassi-mythos-rag-agent-voice.hf.space/v1";

  useEffect(() => {
      if (isOpen) {
          if (agentId) {
              loadPrompts();
              loadAgentVoiceSettings();
          }
          const logger = new LLMUsageLogger();
          logger.getTotalCost().then(setTotalCost);
          
          setLocalAccessLevel(agentAccessLevel || '400');
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

  const handleSavePrompt = async () => {
    if (!agentInstruction.trim()) {
      alert("There are no instructions to save.");
      return;
    }
    const name = window.prompt("Enter a name for this prompt:");
    if (name && name.trim()) {
      const newPrompt: SavedPrompt = {
        id: crypto.randomUUID(),
        agentId: agentId,
        name: name.trim(),
        content: agentInstruction,
      };
      await savePrompt(newPrompt);
      await loadPrompts();
    }
  };

  const handleLoadPreset = (presetKey: keyof typeof INSTRUCTION_PRESETS) => {
    if (presetKey in INSTRUCTION_PRESETS) {
        setGeneralInstruction(INSTRUCTION_PRESETS[presetKey]);
        if (onDirty) onDirty();
    }
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

  const handleTestClone = async () => {
      if (!voiceBase64) {
          alert("Please upload a reference audio file first.");
          return;
      }
      setIsCloning(true);
      try {
          const buffer = await ChatterboxService.synthesize({
              text: `Greetings. I am ${agentName}. This is a test of the Chatterbox cloning protocol.`,
              audioRef: voiceBase64
          });
          
          const blob = new Blob([buffer], { type: 'audio/wav' });
          const url = URL.createObjectURL(blob);
          
          if (audioPreviewRef.current) {
              audioPreviewRef.current.src = url;
              audioPreviewRef.current.play();
          }
      } catch (e: any) {
          alert(`Cloning Failed: ${e.message}`);
      } finally {
          setIsCloning(false);
      }
  };

  const handleAccessChange = (val: string) => {
      setLocalAccessLevel(val);
      if (onDirty) onDirty();
  };
  
  const handleExportLogs = async () => {
    const logs = await getAllLlmLogs();
    if (logs.length === 0) {
        alert("No usage logs to export.");
        return;
    }
    const jsonlContent = logs.map(log => JSON.stringify(log)).join('\n');
    const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'llm-usage.jsonl';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
        if (apiKey) localStorage.setItem('gemini_api_key', apiKey);
        else localStorage.removeItem('gemini_api_key');

        if (hfToken) localStorage.setItem('hf_token', hfToken);
        else localStorage.removeItem('hf_token');

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

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-slide-in-right">
        
        <div className="modal-header-area">
          <div className="flex-group">
             <span className="modal-section-title">SYSTEM CONFIGURATION</span>
          </div>
          <button onClick={onClose} className="close-btn" title="Close">
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
            
            {/* USAGE ANALYTICS */}
            <div className="flex-col">
              <span className="section-header-title" style={{color: '#4ade80'}}>USAGE ANALYTICS</span>
              <div className="section-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: '#4ade80' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#888' }}>EST. TOTAL COST (USD)</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#4ade80' }}>${totalCost.toFixed(5)}</div>
                </div>
                <button type="button" onClick={handleExportLogs} className="btn btn-secondary" title="Download all usage logs as a .jsonl file for analysis.">EXPORT LOGS</button>
              </div>
            </div>
            
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
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="AIza..."
                            className="form-input"
                            style={{ fontFamily: 'monospace' }}
                        />
                    </div>
                    <div>
                        <label className="form-label">DOLPHIN / HF SPACE URL (SOVEREIGN ENGINE)</label>
                        <input 
                            type="text"
                            value={dolphinUrl}
                            readOnly
                            className="form-input"
                            style={{ fontFamily: 'monospace', background: '#111', color: '#888', cursor: 'default' }}
                        />
                    </div>
                    <div>
                        <label className="form-label">HUGGING FACE TOKEN (Read - Required for Sovereign)</label>
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

                <div style={{ marginTop: '0.5rem', border: '1px dashed #333', padding: '1rem', borderRadius: '4px' }}>
                    <label className="form-label" style={{ color: '#a78bfa', marginBottom: '0.5rem' }}>CHATTERBOX: VOICE CLONING REFERENCE</label>
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
                        style={{ textAlign: 'center', cursor: 'pointer', padding: '0.75rem', height: 'auto', marginBottom: '0.5rem' }}
                        title="Upload audio for voice cloning"
                    >
                        {voiceFile ? `SELECTED: ${voiceFile.name}` : (voiceBase64 ? "CHANGE REFERENCE AUDIO" : "UPLOAD SAMPLE (WAV/MP3)")}
                    </div>
                    
                    <div className="flex-group">
                        <button 
                            type="button"
                            onClick={handleTestClone}
                            disabled={!voiceBase64 || isCloning}
                            className="btn btn-accent btn-sm"
                            style={{ flex: 1, borderColor: '#a78bfa', color: '#a78bfa' }}
                            title="Generate test audio with current settings"
                        >
                            {isCloning ? 'SYNTHESIZING...' : 'TEST CLONE (CHATTERBOX)'}
                        </button>
                    </div>
                    
                    {voiceBase64 && (
                        <div style={{ marginTop: '0.5rem' }}>
                            <div style={{ fontSize: '0.65rem', color: '#666', marginBottom: '2px' }}>REFERENCE AUDIO:</div>
                            <audio src={voiceBase64} controls style={{ width: '100%', height: '2rem' }} />
                        </div>
                    )}
                    
                    <audio ref={audioPreviewRef} className="hidden" />
                </div>
            </div>

            <div className="flex-col">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="section-header-title" style={{color: '#eee'}}>GENERAL SYSTEM INSTRUCTIONS (GLOBAL)</span>
                <select 
                    onChange={(e) => handleLoadPreset(e.target.value as any)} 
                    className="form-select"
                    style={{ maxWidth: '150px', fontSize: '0.7rem', height: '1.75rem', padding: '0 0.5rem' }}
                    defaultValue=""
                >
                    <option value="" disabled>Load Preset...</option>
                    {Object.keys(INSTRUCTION_PRESETS).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <p style={{ fontSize: '0.7rem', color: '#888', margin: '0 0 0.5rem 0', lineHeight: '1.4' }}>
                This instruction defines the core personality for ALL agents, overriding the default "helpful assistant" behavior.
              </p>
              <textarea
                placeholder="e.g., You are a witty and sarcastic creative partner. You challenge assumptions and are not afraid to be blunt. This overrides the default 'helpful assistant' persona."
                value={generalInstruction}
                onChange={(e) => { setGeneralInstruction(e.target.value); if (onDirty) onDirty(); }}
                className="form-input"
                style={{ height: '6rem', resize: 'vertical' }}
                disabled={false} 
              />
            </div>

            <div className="flex-col">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="section-header-title" style={{color: '#a78bfa'}}>AGENT FINE-TUNING: {agentName.toUpperCase()}</span>
                  <button 
                      type="button"
                      onClick={handleSavePrompt} 
                      className="btn btn-secondary btn-xs"
                      title="Save the current instructions to this agent's prompt library."
                  >
                      + SAVE TO LIBRARY
                  </button>
              </div>
              <textarea
                placeholder={`Specific instructions for ${agentName}...`}
                value={agentInstruction}
                onChange={(e) => { setAgentInstruction(e.target.value); if (onDirty) onDirty(); }}
                className="form-input"
                style={{ height: '6rem', resize: 'vertical' }}
                disabled={false}
              />
            </div>

            {/* PROMPT LIBRARY */}
            <div className="flex-col">
              <span className="section-header-title" style={{color: '#a78bfa', fontSize: '0.8rem'}}>PROMPT LIBRARY</span>
              {savedPrompts.length === 0 ? (
                  <div className="section-panel" style={{textAlign: 'center', padding: '1rem', color: '#666', fontSize: '0.7rem', borderStyle: 'dashed'}}>
                      No prompts saved for this agent.
                  </div>
              ) : (
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
                                title="Delete Saved Prompt"
                              >
                                  ×
                              </button>
                          </div>
                      ))}
                  </div>
              )}
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
                    title="Reset Model Parameters"
                  >
                    RESET DEFAULTS
                  </button>
                  <button 
                    type="submit" 
                    disabled={isSaving}
                    className="btn btn-primary"
                    style={{ flex: 2 }}
                    title="Save settings to database"
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