
import React, { useState } from 'react';
import { ModelConfig, DEFAULT_MODEL_CONFIG } from '../types';

interface SettingsManagerProps {
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig) => void;
  disabled: boolean;
  
  generalInstruction: string;
  setGeneralInstruction: (val: string) => void;
  
  agentInstruction: string;
  setAgentInstruction: (val: string) => void;
  
  agentName: string;
  
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
  onSave
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (key: keyof ModelConfig, value: number | string) => {
    setModelConfig({ ...modelConfig, [key]: value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
        await onSave();
        alert("Configuration saved.");
    } catch (e) {
        alert("Failed to save configuration.");
        console.error(e);
    } finally {
        setIsSaving(false);
    }
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="btn btn-secondary"
        style={{ whiteSpace: 'nowrap' }}
        title="Model Generation Settings"
      >
        <span>SETTINGS</span>
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
          
          <div className="section-panel" style={{ borderColor: disabled ? '#333' : '#4ade80' }}>
            <div className="section-header" style={{ borderBottom: 'none', padding: 0, marginBottom: '0.5rem' }}>
                 <span className="section-header-title" style={{color: disabled ? '#666' : '#4ade80'}}>STATUS</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: disabled ? '#666' : '#eee' }}>
                {disabled 
                    ? "Settings are locked while the link is active. Terminate connection to modify." 
                    : "Ready to apply to next connection."}
            </p>
          </div>
          
          <form onSubmit={handleSave} className="flex-col" style={{gap: '1.5rem'}}>
            
            {/* General Instructions */}
            <div className="flex-col">
              <span className="section-header-title" style={{color: '#a3a3a3'}}>GENERAL SYSTEM INSTRUCTIONS (GLOBAL)</span>
              <textarea
                placeholder="Instructions that apply to ALL agents (e.g., 'Be concise', 'Always answer in JSON')..."
                value={generalInstruction}
                onChange={(e) => setGeneralInstruction(e.target.value)}
                className="form-input"
                style={{ height: '6rem', resize: 'vertical' }}
                disabled={disabled}
              />
            </div>

            {/* Agent Specific Instructions */}
            <div className="flex-col">
              <span className="section-header-title" style={{color: '#a78bfa'}}>AGENT FINE-TUNING: {agentName.toUpperCase()}</span>
              <textarea
                placeholder={`Specific instructions for ${agentName}...`}
                value={agentInstruction}
                onChange={(e) => setAgentInstruction(e.target.value)}
                className="form-input"
                style={{ height: '6rem', resize: 'vertical' }}
                disabled={disabled}
              />
            </div>

            <hr style={{ borderColor: '#333', margin: 0 }} />

            {/* Model Configuration Section */}
            <div className="flex-col">
               <div className="section-header" style={{ borderBottom: 'none', padding: 0 }}>
                   <span className="section-header-title">MODEL PARAMETERS ({agentName.toUpperCase()})</span>
              </div>
              
              <div className="flex-col">
                  <div className="flex-group" style={{ justifyContent: 'space-between' }}>
                      <span className="section-header-title">TEMPERATURE: {modelConfig.temperature}</span>
                      <span className="tooltip-container">
                          <span className="tooltip-trigger" style={{fontSize:'0.7rem', color:'#666'}}>[?]</span>
                          <span className="tooltip-text">Controls randomness. Higher values (e.g., 1.5) make output more creative/random. Lower values (e.g., 0.2) make it more focused/deterministic.</span>
                      </span>
                  </div>
                  <input 
                      type="range" 
                      min="0" 
                      max="2" 
                      step="0.1" 
                      value={modelConfig.temperature} 
                      onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
                      disabled={disabled}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: '#666' }}>
                      <span>Precise (0.0)</span>
                      <span>Creative (2.0)</span>
                  </div>
              </div>

              <div className="flex-col">
                  <div className="flex-group" style={{ justifyContent: 'space-between' }}>
                      <span className="section-header-title">TOP P: {modelConfig.topP}</span>
                      <span className="tooltip-container">
                          <span className="tooltip-trigger" style={{fontSize:'0.7rem', color:'#666'}}>[?]</span>
                          <span className="tooltip-text">Nucleus sampling. The model considers the results of the tokens with top_p probability mass.</span>
                      </span>
                  </div>
                  <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.05" 
                      value={modelConfig.topP} 
                      onChange={(e) => handleChange('topP', parseFloat(e.target.value))}
                      disabled={disabled}
                  />
              </div>

              <div className="flex-col">
                  <div className="flex-group" style={{ justifyContent: 'space-between' }}>
                      <span className="section-header-title">TOP K: {modelConfig.topK}</span>
                      <span className="tooltip-container">
                          <span className="tooltip-trigger" style={{fontSize:'0.7rem', color:'#666'}}>[?]</span>
                          <span className="tooltip-text">Limits the pool of tokens to the top K most likely tokens. Lower values reduce probability of random/nonsensical words.</span>
                      </span>
                  </div>
                  <input 
                      type="range" 
                      min="1" 
                      max="100" 
                      step="1" 
                      value={modelConfig.topK} 
                      onChange={(e) => handleChange('topK', parseInt(e.target.value))}
                      disabled={disabled}
                  />
              </div>

              <hr style={{ borderColor: '#333', margin: '1rem 0' }} />

              <div className="flex-col">
                <span className="section-header-title" style={{color: '#a3a3a3'}}>LIVE MODEL NAME</span>
                <input
                  type="text"
                  value={modelConfig.liveModelName}
                  onChange={(e) => handleChange('liveModelName', e.target.value)}
                  className="form-input"
                  disabled={disabled}
                />
              </div>

              <div className="flex-col">
                <span className="section-header-title" style={{color: '#a3a3a3'}}>GATING MODEL NAME</span>
                <input
                  type="text"
                  value={modelConfig.gatingModelName}
                  onChange={(e) => handleChange('gatingModelName', e.target.value)}
                  className="form-input"
                  disabled={disabled}
                />
              </div>

              <div className="flex-col">
                <span className="section-header-title" style={{color: '#a3a3a3'}}>EMBEDDING MODEL NAME</span>
                <input
                  type="text"
                  value={modelConfig.embeddingModelName}
                  onChange={(e) => handleChange('embeddingModelName', e.target.value)}
                  className="form-input"
                  disabled={disabled}
                />
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
                    disabled={disabled || isSaving}
                    className="btn btn-ingest"
                    style={{ flex: 2 }}
                  >
                    {isSaving ? 'SAVING...' : 'SAVE ALL CONFIGURATION'}
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
