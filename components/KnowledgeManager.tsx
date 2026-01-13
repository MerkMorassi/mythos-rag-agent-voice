import React, { useState, useEffect, useRef } from 'react';
import { VectorRecord, LorePack } from '../types';
import { 
  getVectorsByAgent,
  deleteVectorsByAgent,
  saveLorePack,
  getLorePacksByAgentId,
  deleteLorePack,
  bulkDeleteVectors,
  initDB,
  deleteVector
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
  const [vectors, setVectors] = useState<VectorRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showNukeModal, setShowNukeModal] = useState(false);
  const [importProgress, setImportProgress] = useState({ processed: 0, active: false });
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

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
    if (isOpen) {
        setCurrentPage(1); // Reset to first page on open
        fetchVectors();
    }
  }, [isOpen, currentAgentId]);

  const handleDeleteVector = async (id: string) => {
    if (window.confirm("Permanently delete this knowledge node?")) {
        await deleteVector(id);
        fetchVectors(); // This will re-fetch, update state, and update the parent count.
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsLoading(true);
      setImportProgress({ processed: 0, active: true });
      try {
          await IngestionService.importLorePack(file, agentHandle, (processed) => {
              setImportProgress({ processed, active: true });
          });
          await fetchVectors();
          alert(`Import Success: Knowledge base synchronized for ${agentHandle}.`);
      } catch (err: any) {
          alert(`Import Failed: ${err.message}`);
      } finally {
          setIsLoading(false);
          setImportProgress({ processed: 0, active: false });
          if (importInputRef.current) importInputRef.current.value = '';
      }
  };

  const handleNuke = async () => {
      setIsLoading(true);
      const db = await initDB();
      const tx = db.transaction(['vectors'], 'readwrite');
      tx.objectStore('vectors').clear();
      await new Promise(r => tx.oncomplete = r);
      await fetchVectors();
      setIsLoading(false);
      setShowNukeModal(false);
  };

  // Pagination Logic
  const totalPages = Math.ceil(vectors.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentVectors = vectors.slice(startIndex, endIndex);

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
              <button onClick={() => importInputRef.current?.click()} className="btn btn-primary" style={{ flex: 2 }}>IMPORT LOREPACK (.jsonl / .gz)</button>
              <button onClick={() => IngestionService.exportLorePack(agentHandle)} className="btn btn-secondary" style={{ flex: 1 }}>EXPORT</button>
              <button onClick={() => setShowNukeModal(true)} className="btn btn-danger" style={{ width: 'auto' }}>NUKE VAULT</button>
              <input type="file" ref={importInputRef} className="hidden" onChange={handleImport} accept=".jsonl,.gz" />
          </div>

          {importProgress.active && (
              <div className="status-banner status-info">
                  Syncing Lattice: {importProgress.processed} nodes...
              </div>
          )}

          <div className="flex-col">
              <span className="section-header-title">ACTIVE KNOWLEDGE NODES ({vectors.length})</span>
               <div style={{color: '#666', fontSize: '0.7rem', marginBottom: '0.5rem'}}>
                  Displaying {currentVectors.length > 0 ? startIndex + 1 : 0} - {Math.min(endIndex, vectors.length)} of {vectors.length} nodes.
              </div>
              <div className="flex-col" style={{ gap: '0.75rem' }}>
                  {isLoading ? (
                      <div className="status-banner status-info">Accessing Vault...</div>
                  ) : currentVectors.length === 0 && !importProgress.active ? (
                      <div className="section-panel" style={{textAlign: 'center', color: '#666', padding: '2rem'}}>No nodes found for this agent.</div>
                  ) : (
                      currentVectors.map(v => (
                          <div key={v.id} className="section-panel vector-item">
                              <div className="vector-item-header">
                                  <span className="vector-item-source">{v.source}</span>
                                  <div className="vector-item-meta">
                                      <span className="vector-item-timestamp">{new Date(v.timestamp).toLocaleString()}</span>
                                      <button onClick={() => handleDeleteVector(v.id)} className="btn btn-danger btn-xs vector-item-delete" title="Delete Node">×</button>
                                  </div>
                              </div>
                              <p className="vector-item-text">{v.text}</p>
                          </div>
                      ))
                  )}
              </div>
              {totalPages > 1 && (
                  <div className="pagination-controls">
                      <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="btn btn-secondary btn-sm">PREV</button>
                      <span>Page {currentPage} of {totalPages}</span>
                      <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="btn btn-secondary btn-sm">NEXT</button>
                  </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
};
