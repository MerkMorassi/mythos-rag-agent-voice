import React, { useState, useEffect, useRef } from 'react';
import { VectorRecord, LorePack, LorePackHeader } from '../types';
import { 
  getVectorsByAgent,
  deleteVectorsByAgent,
  saveLorePack,
  getLorePacksByAgentId,
  deleteLorePack,
  bulkDeleteVectors,
  bulkPutVectors
} from '../services/db';
import { IngestionService } from '../services/ingestion';
import { AGENTS } from '../agents';
import { NumMarkX_GenerateHeader, NumMarkX_GenerateID } from '../patterns/NumMarkX';

interface KnowledgeManagerProps {
  onUpdate: () => void;
  currentAgentId: string;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

const ITEMS_PER_PAGE = 5;

interface IngestionQueueItem {
    id: string;
    file: File;
    status: 'PENDING' | 'PROCESSING' | 'DONE' | 'ERROR';
    progress: number;
    total: number;
    errorMsg?: string;
}

interface GroupedVector {
    source: string;
    count: number;
    ids: string[];
    firstVec: VectorRecord;
}

export const KnowledgeManager: React.FC<KnowledgeManagerProps> = ({ 
    onUpdate, 
    currentAgentId,
    isOpen,
    onClose
}) => {
  const [activeTab, setActiveTab] = useState<'local' | 'library'>('local');
  
  const [vectors, setVectors] = useState<VectorRecord[]>([]);
  const [groupedVectors, setGroupedVectors] = useState<GroupedVector[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  
  const [savedPacks, setSavedPacks] = useState<LorePack[]>([]);
  const [packName, setPackName] = useState('');

  const [ingestionQueue, setIngestionQueue] = useState<IngestionQueueItem[]>([]);
  const [isQueueProcessing, setIsQueueProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // For single operations like import/purge

  const [statusMsg, setStatusMsg] = useState<{ text: string, type: 'success' | 'error' | 'info', persistent?: boolean } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const agentHandle = AGENTS.find(a => a.id === currentAgentId)?.handle || currentAgentId;

  const fetchVectors = async () => {
    try {
      setIsLoading(true);
      const data = await getVectorsByAgent(agentHandle);
      setVectors(data);
    } catch (e: any) {
      showStatus(`Failed to fetch documents: ${e.message}`, 'error', true);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSavedPacks = async () => {
      setIsLoading(true);
      try {
        const packs = await getLorePacksByAgentId(currentAgentId);
        setSavedPacks(packs);
      } finally {
        setIsLoading(false);
      }
  };

  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'local') fetchVectors();
      if (activeTab === 'library') fetchSavedPacks();
      setStatusMsg(null);
    }
  }, [isOpen, currentAgentId, activeTab]);

  useEffect(() => {
    const groups: { [key: string]: { count: number; ids: string[]; vecs: VectorRecord[] } } = {};
    
    vectors.forEach(vec => {
        const groupKey = vec.source || 'Unknown Source';
        if (!groups[groupKey]) groups[groupKey] = { count: 0, ids: [], vecs: [] };
        groups[groupKey].count++;
        groups[groupKey].ids.push(vec.id);
        groups[groupKey].vecs.push(vec);
    });

    const groupedArray = Object.entries(groups).map(([source, data]) => ({
        source,
        count: data.count,
        ids: data.ids,
        firstVec: data.vecs[0],
    })).sort((a,b) => b.firstVec.timestamp - a.firstVec.timestamp);
    
    setGroupedVectors(groupedArray);
    setCurrentPage(1);
  }, [vectors]);

  // Process Ingestion Queue
  useEffect(() => {
    const processNext = async () => {
      if (isQueueProcessing) return;
      const next = ingestionQueue.find(item => item.status === 'PENDING');
      if (!next) return;

      setIsQueueProcessing(true);
      setIngestionQueue(prev => prev.map(i => i.id === next.id ? { ...i, status: 'PROCESSING' } : i));

      try {
        const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
        if (!apiKey) throw new Error("API Key not found.");

        const text = await next.file.text();
        const savedCount = await IngestionService.ingestText(text, next.file.name, agentHandle, apiKey, (p, t) => {
             setIngestionQueue(prev => prev.map(i => i.id === next.id ? { ...i, progress: p, total: t } : i));
        });

        setIngestionQueue(prev => prev.map(i => i.id === next.id ? { ...i, status: 'DONE' } : i));
        await fetchVectors();
        onUpdate();
      } catch (e: any) {
        setIngestionQueue(prev => prev.map(i => i.id === next.id ? { ...i, status: 'ERROR', errorMsg: e.message } : i));
      } finally {
        setIsQueueProcessing(false);
      }
    };
    processNext();
  }, [ingestionQueue, isQueueProcessing]);

  const showStatus = (text: string, type: 'success' | 'error' | 'info', persistent = false) => {
      setStatusMsg({ text, type, persistent });
      if (!persistent) setTimeout(() => setStatusMsg(null), 3000);
  };
  
  const triggerInput = (ref: React.RefObject<HTMLInputElement>) => {
      if (ref.current) {
          ref.current.value = '';
          ref.current.click();
      }
  };
  
  const handleFileIngest = (files: FileList | null) => {
      if (!files) return;
      const newItems: IngestionQueueItem[] = Array.from(files).map(file => ({
          id: crypto.randomUUID(),
          file,
          status: 'PENDING',
          progress: 0,
          total: 0
      }));
      setIngestionQueue(prev => [...prev, ...newItems]);
  };
  
  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      handleFileIngest(e.dataTransfer.files);
  };

  const handleExportLorePack = async () => {
    try {
      await IngestionService.exportLorePack(agentHandle);
      showStatus('LorePack export started.', 'success');
    } catch (e: any) {
      showStatus(`Export Failed: ${e.message}`, 'error');
    }
  };
  
  const handleImportLorePack = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const shouldProceed = window.confirm(`Importing "${file.name}". This will ADD records to the current memory for ${agentHandle}. Records with duplicate IDs will be overwritten. Continue?`);
      if (!shouldProceed) return;

      setIsLoading(true);
      showStatus(`Merging "${file.name}"...`, 'info', true);
      try {
          const count = await IngestionService.importLorePack(file, agentHandle);
          await fetchVectors();
          onUpdate();
          showStatus(`Merge complete. ${count} records added/updated.`, 'success');
      } catch (err: any) {
          showStatus(`Import Failed: ${err.message}`, 'error', true);
      } finally {
          setIsLoading(false);
          if (importInputRef.current) importInputRef.current.value = '';
      }
  };

  const handlePurgeAll = async () => {
    if (!window.confirm(`WARNING: DELETE ALL vectors for ${agentHandle}?`)) return;
    setIsLoading(true);
    try {
        await deleteVectorsByAgent(agentHandle);
        await fetchVectors();
        onUpdate();
        showStatus("Database purged.", 'success');
    } catch (e: any) {
        showStatus(`Failed to purge: ${e.message}`, 'error');
    } finally {
        setIsLoading(false);
    }
  };

  const handleDeleteSource = async (ids: string[], sourceName: string) => {
      if (!window.confirm(`Delete all ${ids.length} vectors from source "${sourceName}"?`)) return;
      setIsLoading(true);
      try {
          await bulkDeleteVectors(ids);
          await fetchVectors();
          onUpdate();
          showStatus(`Deleted source: ${sourceName}`, 'success');
      } catch (e: any) {
          showStatus(`Failed to delete: ${e.message}`, 'error');
      } finally {
          setIsLoading(false);
      }
  };

  const handleSaveToLibrary = async () => {
      if (!packName.trim()) { alert("Please enter a name for this LorePack."); return; }
      if (vectors.length === 0) { alert("Cannot save an empty memory set."); return; }
      
      const header = NumMarkX_GenerateHeader(currentAgentId, agentHandle, `Saved snapshot of ${agentHandle}'s memory.`);
      const pack: LorePack = {
          id: crypto.randomUUID(),
          header: { ...header, name: packName.trim() },
          sacred_archive: vectors
      };

      setIsLoading(true);
      try {
          await saveLorePack(pack);
          setPackName('');
          await fetchSavedPacks();
          showStatus(`Saved "${pack.header.name}" to library.`, 'success');
      } catch (e: any) {
          showStatus(`Failed to save: ${e.message}`, 'error');
      } finally {
          setIsLoading(false);
      }
  };
  
  const handleLoadFromLibrary = async (pack: LorePack) => {
      if (!window.confirm(`RESTORE from "${pack.header.name}"? This will REPLACE all current active memory for ${agentHandle}.`)) return;
      
      setIsLoading(true);
      try {
          await deleteVectorsByAgent(agentHandle);
          await bulkPutVectors(pack.sacred_archive);
          await fetchVectors(); // To update the local memory view if user switches back
          onUpdate();
          showStatus(`Restored memory from "${pack.header.name}".`, 'success');
      } catch (e: any) {
          showStatus(`Failed to restore: ${e.message}`, 'error');
      } finally {
          setIsLoading(false);
      }
  };
  
  const handleDeleteFromLibrary = async (id: string) => {
      if (!window.confirm("Delete this saved LorePack from the library?")) return;
      setIsLoading(true);
      try {
          await deleteLorePack(id);
          await fetchSavedPacks();
      } catch (e: any) {
          showStatus(`Failed to delete: ${e.message}`, 'error');
      } finally {
        setIsLoading(false);
      }
  };

  const filteredGroupedVectors = groupedVectors.filter(group => 
    group.source.toLowerCase().includes(filterQuery.toLowerCase())
  );
  const totalPages = Math.ceil(filteredGroupedVectors.length / ITEMS_PER_PAGE);
  const paginatedGroupedVectors = filteredGroupedVectors.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  if (!isOpen) return null;

  const TabButton: React.FC<{tabId: string, children: React.ReactNode}> = ({tabId, children}) => (
      <button 
          onClick={() => setActiveTab(tabId as any)}
          style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tabId ? '2px solid #4ade80' : '2px solid transparent',
              color: activeTab === tabId ? '#4ade80' : '#888',
              padding: '0.75rem 1rem',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '0.8rem'
          }}
      >{children}</button>
  );

  return (
    <div className="modal-overlay">
      <input type="file" accept=".jsonl" onChange={handleImportLorePack} ref={importInputRef} className="hidden" />
      <input type="file" multiple ref={fileInputRef} className="hidden" onChange={(e) => handleFileIngest(e.target.files)} />

      <div className="modal-content animate-slide-in-right large">
        <div className="modal-header-area">
          <span className="modal-section-title" style={{ color: '#4ade80' }}>KNOWLEDGE MANAGER: {agentHandle.toUpperCase()}</span>
          <button onClick={onClose} className="close-btn" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        
        <div style={{ padding: '0 1rem', borderBottom: '1px solid #333', flexShrink: 0, display: 'flex' }}>
            <TabButton tabId="local">LOCAL MEMORY ({vectors.length})</TabButton>
            <TabButton tabId="library">LOREPACK LIBRARY ({savedPacks.length})</TabButton>
        </div>

        <div className="modal-body-area">
          {statusMsg && <div className={`status-banner status-${statusMsg.type}`}>{statusMsg.text}</div>}

          {activeTab === 'local' && (
              <>
                  <div className="flex-col">
                      <label 
                          className={`btn-file-input ${isDragging ? 'active-green' : ''}`}
                          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                          onDrop={handleDrop}
                          title="Click or Drag files to ingest"
                      >
                         DROP FILES TO INGEST (.txt, .md, etc)
                      </label>
                      
                      {ingestionQueue.length > 0 && (
                          <div className="queue-panel">
                              {ingestionQueue.map(item => (
                                  <div key={item.id} className="queue-item">
                                      <span style={{flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{item.file.name}</span>
                                      {item.status === 'PROCESSING' && item.total > 0 && <span style={{fontSize:'0.7rem', color:'#888'}}>{item.progress}/{item.total}</span>}
                                      <span className={`queue-status ${item.status}`}>{item.status}</span>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
                  <div className="flex-col">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="flex-group">
                            <span className="section-header-title">STORED VECTORS</span>
                            {isLoading && <div className="spinner" style={{width:'1rem', height:'1rem'}}></div>}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={handleExportLorePack} disabled={isLoading} className="btn btn-accent btn-xs" title="Export as .jsonl">EXPORT LP</button>
                          <button onClick={() => triggerInput(importInputRef)} disabled={isLoading} className="btn btn-accent btn-xs" title="Import a .jsonl LorePack (Additive Merge)">IMPORT LP</button>
                          <button onClick={handlePurgeAll} disabled={isLoading} className="btn btn-danger btn-xs">PURGE ALL</button>
                        </div>
                      </div>
                      <input type="text" placeholder="Filter by source..." value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)} className="form-input" />
                      
                      {paginatedGroupedVectors.length === 0 && !isLoading && <div className="empty-state">NO VECTORS FOUND</div>}
                      
                      <div className="flex-col" style={{ gap: '0.5rem' }}>
                        {paginatedGroupedVectors.map(group => (
                          <div key={group.firstVec.id} className="section-panel" style={{ padding: '0.75rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontWeight: 'bold', fontSize: '0.75rem', color: '#eee', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{group.source}</span>
                                  <div className="flex-group">
                                    <span style={{ fontSize: '0.7rem', color: '#4ade80' }}>{group.count} nodes</span>
                                    <button onClick={() => handleDeleteSource(group.ids, group.source)} disabled={isLoading} className="btn-ghost" style={{color:'#f87171', fontSize:'1rem'}} title="Delete all nodes from this source">×</button>
                                  </div>
                              </div>
                          </div>
                        ))}
                      </div>
                      
                      {totalPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', alignItems: 'center', marginTop: '1rem' }}>
                          <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage === 1 || isLoading} className="btn btn-xs btn-secondary">&lt;</button>
                          <span style={{fontSize: '0.7rem', color:'#666'}}>{currentPage} / {totalPages}</span>
                          <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage === totalPages || isLoading} className="btn btn-xs btn-secondary">&gt;</button>
                        </div>
                      )}
                  </div>
              </>
          )}

          {activeTab === 'library' && (
              <>
                  <div className="flex-col section-panel" style={{borderColor: '#a78bfa'}}>
                      <span className="section-header-title" style={{color: '#a78bfa'}}>SAVE TO LIBRARY</span>
                      <p style={{fontSize:'0.75rem', color:'#888', margin: 0}}>Save the current state of {agentHandle}'s local memory as a portable, named LorePack.</p>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <input 
                              type="text"
                              placeholder="Name for this LorePack..."
                              value={packName}
                              onChange={e => setPackName(e.target.value)}
                              className="form-input"
                              style={{flex: 1}}
                              disabled={isLoading}
                          />
                          <button onClick={handleSaveToLibrary} className="btn btn-accent" disabled={isLoading}>SAVE</button>
                      </div>
                  </div>
                  <div className="flex-col">
                      <span className="section-header-title">SAVED LOREPACKS</span>
                      {isLoading && <div className="spinner"></div>}
                      {!isLoading && savedPacks.length === 0 && <div className="empty-state">NO SAVED PACKS</div>}
                      <div className="flex-col" style={{ gap: '0.5rem' }}>
                          {savedPacks.map(pack => (
                              <div key={pack.id} className="section-panel" style={{ opacity: isLoading ? 0.5 : 1 }}>
                                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
                                      <span style={{fontWeight:'bold', color:'#eee'}}>{pack.header.name}</span>
                                      <span style={{fontSize:'0.7rem', color:'#666'}}>{pack.sacred_archive.length} nodes</span>
                                  </div>
                                  <div style={{display: 'flex', gap: '0.5rem'}}>
                                      <button onClick={() => handleLoadFromLibrary(pack)} className="btn btn-secondary btn-sm" style={{flex:1}} disabled={isLoading}>LOAD (REPLACE)</button>
                                      <button onClick={() => handleDeleteFromLibrary(pack.id)} className="btn btn-danger btn-sm" disabled={isLoading}>DELETE</button>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              </>
          )}
        </div>
      </div>
    </div>
  );
};