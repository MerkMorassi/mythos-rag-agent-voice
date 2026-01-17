
import React, { useState, useEffect, useRef } from 'react';
import { ModelConfig } from '../types';
import { geminiClient } from '../services/geminiClient';

interface SettingsManagerProps {
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  disabled: boolean;
  generalInstruction: string;
  setGeneralInstruction: (val: string) => void;
  agentInstruction: string;
  setAgentInstruction: (val: string) => void;
  agentName: string;
  agentId: string;
  agentAccessLevel: string;
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  onSave: (modelName: string, voiceRef?: string, accessLevel?: string, voiceSpeed?: number, voicePitch?: number) => Promise<void>;
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  hfToken: string;
  setHfToken: (token: string) => void;
  voiceReference?: string;
  voiceSpeed?: number;
  voicePitch?: number;
}

const SettingsManager: React.FC<SettingsManagerProps> = (props) => {
  const [isSaving, setIsSaving] = useState(false);
  const [voiceRef, setVoiceRef] = useState(props.voiceReference || '');
  const [accessLevel, setAccessLevel] = useState(props.agentAccessLevel);
  const [speed, setSpeed] = useState(props.voiceSpeed || 1.0);
  const [pitch, setPitch] = useState(props.voicePitch || 0);
  const [modelsList, setModelsList] = useState<{ name: string, displayName: string }[]>([]);
  
  // Audio Refs
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVoiceRef(props.voiceReference || '');
    setAccessLevel(props.agentAccessLevel);
    setSpeed(props.voiceSpeed || 1.0);
    setPitch(props.voicePitch || 0);
  }, [props.voiceReference, props.agentAccessLevel, props.voiceSpeed, props.voicePitch, props.isOpen]);

  if (!props.isOpen) return null;

  const handleFetchModels = async () => {
    if (!props.apiKey) {
      alert("Please enter a Gemini API Key first.");
      return;
    }
    try {
      const models = await geminiClient.listModels(props.apiKey);
      setModelsList(models);
      alert(`Found ${models.length} compatible models.`);
    } catch (error: any) {
      alert(`Failed to fetch models: ${error.message}`);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    if (props.apiKey) localStorage.setItem('gemini_api_key', props.apiKey);
    if (props.hfToken) localStorage.setItem('hf_token', props.hfToken);
    
    await props.onSave(props.selectedModel, voiceRef, accessLevel, speed, pitch);
    
    setIsSaving(false);
    alert("NEURAL SYNC: System parameters updated.");
  };

  const togglePreview = () => {
    if (!voiceRef) return;
    if (isPreviewPlaying) {
      audioPreviewRef.current?.pause();
      setIsPreviewPlaying(false);
    } else {
      if (!audioPreviewRef.current) {
          audioPreviewRef.current = new Audio();
      }
      // Service handles both raw base64 and data URLs
      const src = voiceRef.startsWith('data:') ? voiceRef : `data:audio/wav;base64,${voiceRef}`;
      audioPreviewRef.current.src = src;
      audioPreviewRef.current.play().catch(err => console.warn("Preview Error:", err));
      setIsPreviewPlaying(true);
      audioPreviewRef.current.onended = () => setIsPreviewPlaying(false);
    }
  };
  
  const handleAudioFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        const base64 = dataUrl.split(',')[1];
        setVoiceRef(base64);
    };
    reader.readAsDataURL(file);

    if (audioFileInputRef.current) audioFileInputRef.current.value = '';
  };


  return (
    <div className="modal-overlay">
      <div className="modal-content animate-slide-in-right">
        <div className="modal-header-area">
          <span className="modal-section-title">SYSTEM CONFIGURATION</span>
          <button onClick={props.onClose} className="close-btn">✕</button>
        </div>
        <div className="modal-body-area">
          <form onSubmit={handleSave} className="flex-col" style={{ gap: '1.2rem' }}>
            
            <div className="flex-col">
                <label className="form-label">GEMINI API KEY</label>
                <input type="password" value={props.apiKey} onChange={e => props.setApiKey(e.target.value)} className="form-input" placeholder="AIza..." autoComplete="off" />
            </div>

            <div className="flex-col">
                <label className="form-label">HUGGINGFACE TOKEN (External Models)</label>
                <input type="password" value={props.hfToken} onChange={e => props.setHfToken(e.target.value)} className="form-input" placeholder="hf_..." autoComplete="off" />
            </div>

            <div className="flex-col">
                <span className="section-header-title">SYSTEM CORE PARAMETERS</span>
                <textarea 
                    value={props.generalInstruction} 
                    onChange={e => props.setGeneralInstruction(e.target.value)} 
                    className="form-input" 
                    style={{ height: '5rem', fontSize: '0.8rem' }}
                    placeholder="Global directives for all agents..."
                />
            </div>

            <div className="flex-col">
                <span className="section-header-title">AGENT IDENTITY: {props.agentName}</span>
                <textarea 
                    value={props.agentInstruction} 
                    onChange={e => props.setAgentInstruction(e.target.value)} 
                    className="form-input" 
                    style={{ height: '4rem' }}
                    placeholder="Traits for this agent..."
                />
            </div>
            
            {/* MODEL CONFIGURATION */}
            <div className="section-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', borderColor: '#38bdf8' }}>
                <span className="section-header-title" style={{ fontSize: '0.7rem', color: '#38bdf8' }}>MODEL CONFIGURATION</span>
                <div className="flex-col">
                    <div className="flex-group" style={{justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px'}}>
                        <label className="form-label">COGNITIVE ENGINE (TEXT)</label>
                        <button type="button" onClick={handleFetchModels} className="btn btn-secondary btn-xs">FETCH MODELS</button>
                    </div>
                    <select value={props.selectedModel} onChange={(e) => props.setSelectedModel(e.target.value)} className="form-select">
                        {modelsList.length > 0 ? (
                            modelsList.map(model => (
                                <option key={model.name} value={model.name}>{model.displayName} ({model.name})</option>
                            ))
                        ) : (
                            <>
                                <option value="gemini-3-flash-preview">Gemini 3 Flash (Fast)</option>
                                <option value="gemini-3-pro-preview">Gemini 3 Pro (Complex)</option>
                            </>
                        )}
                    </select>
                </div>
                 <div className="flex-group" style={{ gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                        <label className="form-label">TEMPERATURE</label>
                        <input type="number" min="0" max="2" step="0.1" className="form-input" value={props.modelConfig.temperature} onChange={(e) => props.setModelConfig({ ...props.modelConfig, temperature: parseFloat(e.target.value) })} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label className="form-label">TOP P</label>
                        <input type="number" min="0" max="1" step="0.05" className="form-input" value={props.modelConfig.topP} onChange={(e) => props.setModelConfig({ ...props.modelConfig, topP: parseFloat(e.target.value) })} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label className="form-label">TOP K</label>
                        <input type="number" min="1" max="100" step="1" className="form-input" value={props.modelConfig.topK} onChange={(e) => props.setModelConfig({ ...props.modelConfig, topK: parseInt(e.target.value) })} />
                    </div>
                </div>
            </div>

            {/* LIVE INTERFACE VOICE (GEMINI) */}
            <div className="section-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', borderColor: '#4ade80' }}>
                <span className="section-header-title" style={{ fontSize: '0.7rem', color: '#4ade80' }}>LIVE INTERFACE (GEMINI NATIVE AUDIO)</span>
                <p style={{fontSize:'0.7rem', color:'#888', margin:0}}>Select the real-time, low-latency voice for this agent's live conversation.</p>
                <div className="flex-col">
                    <label className="form-label">VOICE PRESET</label>
                    <select value={props.selectedVoice} onChange={(e) => props.onVoiceChange(e.target.value)} className="form-select">
                        <option value="Puck">Puck (Fast/Young)</option>
                        <option value="Charon">Charon (Deep/Old)</option>
                        <option value="Kore">Kore (Divine/Maternal)</option>
                        <option value="Fenrir">Fenrir (Analytical/Viking)</option>
                        <option value="Zephyr">Zephyr (Librarian/Ethereal)</option>
                        <option value="Aoede">Aoede (Muse/Lyric)</option>
                        <option value="Callirrhoe">Callirrhoe (Wisdom/Sophisticated)</option>
                        <option value="Leda">Leda (Oracle/Intuitive)</option>
                    </select>
                </div>
            </div>

            {/* LONG-FORM SYNTHESIS (CHATTERBOX) */}
            <div className="section-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', borderColor: '#facc15' }}>
                <span className="section-header-title" style={{ fontSize: '0.7rem', color: '#facc15' }}>LONG-FORM SYNTHESIS (CHATTERBOX)</span>
                <p style={{fontSize:'0.7rem', color:'#888', margin:0}}>Configure the high-fidelity voice clone for generating long-form audio assets (e.g., audiobooks, podcasts) via the `routeRequest` tool.</p>
                
                <div className="flex-group">
                    <div style={{ flex: 1 }}>
                        <label className="form-label">TEMPORAL SPEED: {speed}x</label>
                        <input type="range" min="0.5" max="2.0" step="0.1" value={speed} onChange={e => setSpeed(parseFloat(e.target.value))} style={{ width: '100%' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label className="form-label">HARMONIC PITCH: {pitch}</label>
                        <input type="range" min="-12" max="12" step="1" value={pitch} onChange={e => setPitch(parseInt(e.target.value))} style={{ width: '100%' }} />
                    </div>
                </div>

                <div className="flex-col">
                    <label className="form-label">VOICE CLONE SAMPLE (.wav, .mp3)</label>
                    <div className="flex-group">
                        <input 
                            value={voiceRef} 
                            onChange={e => setVoiceRef(e.target.value)} 
                            className="form-input" 
                            style={{ flex: 1 }}
                            placeholder="Upload a file or paste Base64 data..." 
                        />
                         <input 
                            type="file" 
                            ref={audioFileInputRef}
                            className="hidden" 
                            accept="audio/wav,audio/mpeg" 
                            onChange={handleAudioFileSelect}
                        />
                        <button 
                            type="button"
                            onClick={() => audioFileInputRef.current?.click()}
                            className="btn btn-secondary"
                            style={{ width: '6rem' }}
                        >
                            UPLOAD
                        </button>
                        <button 
                            type="button"
                            onClick={togglePreview}
                            className={`btn ${isPreviewPlaying ? 'btn-danger' : 'btn-accent'}`}
                            style={{ width: '4rem' }}
                            disabled={!voiceRef}
                        >
                            {isPreviewPlaying ? 'STOP' : 'TEST'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-col">
                <label className="form-label">CHMOD (SOMA ACCESS LEVEL)</label>
                <input value={accessLevel} onChange={e => setAccessLevel(e.target.value)} className="form-input" style={{ fontFamily: 'monospace' }} placeholder="777, 755, 644..." />
            </div>

            <button type="submit" className="btn btn-primary btn-lg" disabled={isSaving}>
                {isSaving ? 'SYNCING...' : 'SAVE SYSTEM STATE'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default SettingsManager;
