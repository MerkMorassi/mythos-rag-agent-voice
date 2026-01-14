import React, { useState, useEffect, useRef } from 'react';
import { VectorRecord, LorePack } from '../types';
import { 
  getVectorsByAgent,
  deleteVectorsByAgent,
  saveLorePack,
  getLorePacksByAgentId,
  deleteLorePack,
  bulkDeleteVectors,
  clearVectorsStore
} from '../services/db';
import { IngestionService } from '../services/ingestion';
import { AGENTS } from '../agents';
import { NumMarkX_GenerateHeader } from '../patterns/NumMarkX';

interface KnowledgeManagerProps {
  onUpdate: () => void;
  currentAgentId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const KnowledgeManager: React.FC<KnowledgeManagerProps> = ({ 
    onUpdate, 
    currentAgentId,
    isOpen,
    onClose
}) => {
  const [activeTab, setActiveTab] = useState<'local' | 'library'>('local');
  const [vectors, setVectors] = useState<VectorRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showNukeModal, setShowNukeModal] = useState(false);
  const [importProgress, setImportProgress] = useState({ p: 0, t: 0 });
  
  const importInputRef = useRef<HTMLInputElement>(null);
  const agentHandle = AGENTS.find(a => a.id === currentAgentId)?.handle || currentAgentId;

  const fetchVectors = async () => {
    setIsLoading(true);
    const data = await getVectorsByAgent(agentHandle);
    setVectors(data.sort((a,b) => b.timestamp - a.timestamp)); // Sort by most recent
    onUpdate();
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) fetchVectors();
  }, [isOpen, currentAgentId, activeTab]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsLoading(true);
      try {
          await IngestionService.importLorePack(file, agentHandle, (p, t) => {
              setImportProgress({ p, t });
          });
          await fetchVectors();
          alert(`Import Success: Knowledge base synchronized for ${agentHandle}.`);
      } catch (err: any) {
          alert(`Import Failed: ${err.message}`);
      } finally {
          setIsLoading(false);
          setImportProgress({ p: 0, t: 0 });
          if (importInputRef.current) importInputRef.current.value = '';
      }
  };

  const handleNuke = async () => {
      setIsLoading(true);
      try {
          await clearVectorsStore();
          await fetchVectors();
      } catch (err: any) {
          alert(`Nuke failed: ${err?.message || err}`);
      } finally {
          setIsLoading(false);
          setShowNukeModal(false);
      }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-slide-in-right large">
        <div className="modal-header-area">
          <span className="modal-section-title" style={{ color: '#4ade80' }}>LORE ARCHIVE: {agentHandle}</span>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>

        <div className="modal-body-area">
          {/* NUKE MODAL OVERLAY */}
          {showNukeModal && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(255,0,0,0.2)', backdropFilter: 'blur(10px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="section-panel" style={{ maxWidth: '400px', textAlign: 'center', borderColor: '#ff3333', background: '#0a0a0a', padding: '2rem' }}>
                      <div style={{ color: '#ff3333', fontSize: '3rem', marginBottom: '1rem' }}>⚠</div>
                      <h2 style={{ color: '#fff', margin: '0 0 1rem 0' }}>CRITICAL WARNING</h2>
                      <p style={{ color: '#888', fontSize: '0.9rem', lineHeight: '1.5' }}>
                          This action will permanently vaporize the entire local lore database. This cannot be undone. All agents will lose their grounding.
                      </p>
                      <div className="flex-group" style={{ marginTop: '2rem' }}>
                          <button onClick={() => setShowNukeModal(false)} className="btn btn-secondary" style={{ flex: 1 }}>ABORT</button>
                          <button onClick={handleNuke} className="btn btn-danger" style={{ flex: 1 }}>CONFIRM NUKE</button>
                      </div>
                  </div>
              </div>
          )}

          <div className="flex-group" style={{ marginBottom: '1rem' }}>
              <button onClick={() => importInputRef.current?.click()} className="btn btn-primary" style={{ flex: 2 }}>IMPORT LOREPACK (.jsonl)</button>
              <button onClick={() => IngestionService.exportLorePack(agentHandle)} className="btn btn-secondary" style={{ flex: 1 }}>EXPORT</button>
              <button onClick={() => setShowNukeModal(true)} className="btn btn-danger" style={{ width: 'auto' }}>NUKE VAULT</button>
              <input type="file" ref={importInputRef} className="hidden" onChange={handleImport} accept=".jsonl" />
          </div>

          {isLoading && (
              <div className="status-banner status-info">
                  {importProgress.t > 0 ? `Syncing Lattice: ${importProgress.p} / ${importProgress.t}` : 'Accessing Vault...'}
              </div>
          )}

          <div className="flex-col">
              <span className="section-header-title">ACTIVE KNOWLEDGE NODES ({vectors.length})</span>
              <div className="flex-col" style={{ gap: '0.5rem' }}>
                  {vectors.slice(0, 20).map(v => (
                      <div key={v.id} className="section-panel" style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                          <div style={{ color: '#4ade80', marginBottom: '4px' }}>[{v.source}]</div>
                          <div style={{ color: '#ccc' }}>{v.text.substring(0, 200)}...</div>
                      </div>
                  ))}
                  {vectors.length > 20 && <div style={{ textAlign: 'center', color: '#666', fontSize: '0.7rem' }}>+ {vectors.length - 20} additional nodes stored in lattice</div>}
              </div>
          </div>
        </div>
      </div>
    </div>
  );
};
