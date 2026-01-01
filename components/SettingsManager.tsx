
import React, { useState } from 'react';

export interface ModelConfig {
  temperature: number;
  topP: number;
  topK: number;
}

export const DEFAULT_CONFIG: ModelConfig = {
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
};

interface SettingsManagerProps {
  config: ModelConfig;
  setConfig: (config: ModelConfig) => void;
  disabled: boolean;
  systemInstruction: string;
  setSystemInstruction: (val: string) => void;
  saveSystemInstruction: () => Promise<void>;
}

const SettingsManager: React.FC<SettingsManagerProps> = ({ 
  config, 
  setConfig, 
  disabled,
  systemInstruction,
  setSystemInstruction,
  saveSystemInstruction
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (key: keyof ModelConfig, value: number) => {
    setConfig({ ...config, [key]: value });
  };

  const handleSaveInstructions = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
        await saveSystemInstruction();
        alert("Instructions saved.");
    } catch (e) {
        alert("Failed to save instructions.");
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
             <span className="section-header-title" style={{ fontSize: '1.25rem' }}>CONFIGURATION</span>
          </div>
          <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
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

          {/* System Instructions Section */}
          <div className="flex-col">
            <span className="section-header-title">SYSTEM INSTRUCTIONS (HIGH PRIORITY)</span>
            <form onSubmit={handleSaveInstructions} className="flex-col">
              <textarea
                placeholder="Enter high-priority system instructions here..."
                value={systemInstruction}
                onChange={(e) => setSystemInstruction(e.target.value)}
                className="form-input"
                style={{ height: '8rem', resize: 'vertical' }}
                disabled={disabled}
              />
              <button 
                type="submit" 
                disabled={disabled || isSaving}
                className="btn btn-ingest"
              >
                {isSaving ? 'SAVING...' : 'SAVE INSTRUCTIONS'}
              </button>
            </form>
          </div>

          <hr style={{ borderColor: '#333', margin: 0 }} />

          {/* Model Configuration Section */}
          <div className="flex-col">
             <div className="section-header" style={{ borderBottom: 'none', padding: 0 }}>
                 <span className="section-header-title">MODEL PARAMETERS</span>
            </div>
            
            <div className="flex-col">
                <div className="flex-group" style={{ justifyContent: 'space-between' }}>
                    <span className="section-header-title">TEMPERATURE: {config.temperature}</span>
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
                    value={config.temperature} 
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
                    <span className="section-header-title">TOP P: {config.topP}</span>
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
                    value={config.topP} 
                    onChange={(e) => handleChange('topP', parseFloat(e.target.value))}
                    disabled={disabled}
                />
            </div>

            <div className="flex-col">
                <div className="flex-group" style={{ justifyContent: 'space-between' }}>
                    <span className="section-header-title">TOP K: {config.topK}</span>
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
                    value={config.topK} 
                    onChange={(e) => handleChange('topK', parseInt(e.target.value))}
                    disabled={disabled}
                />
            </div>

            <button 
                onClick={() => setConfig(DEFAULT_CONFIG)}
                className="btn btn-secondary"
                disabled={disabled}
                style={{ marginTop: '1rem' }}
            >
                RESET DEFAULTS
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};

export default SettingsManager;
