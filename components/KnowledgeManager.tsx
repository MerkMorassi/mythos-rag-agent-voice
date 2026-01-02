
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { KnowledgeDoc, CloudFile } from '../types';
import { 
  addDocument, 
  getDocumentsByAgentId, 
  deleteDocument, 
  bulkAddDocuments,
  deleteDocumentsByAgentId
} from '../services/db';
import { uploadCloudFile, listCloudFiles, deleteCloudFile } from '../services/googleFiles';
import { IngestionService, IngestionResult } from '../services/ingestion';
import { NumMarkX_GenerateSigil } from '../patterns/NumMarkX';

interface KnowledgeManagerProps {
  onUpdate: () => void;
  currentAgentId: string;
}

const ITEMS_PER_PAGE = 5;

// --- ICONS ---
const FileIcon = ({ typeStr }: { typeStr: string }) => {
  const t = typeStr.toLowerCase();
  const style = { width: '20px', height: '20px', strokeWidth: 1.5, flexShrink: 0 };
  
  if (t.includes('image') || t.endsWith('.png') || t.endsWith('.jpg') || t.endsWith('.jpeg') || t.endsWith('.webp')) {
    // Image Icon (Purple)
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeLinecap="round" strokeLinejoin="round" style={style}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <polyline points="21 15 16 10 5 21"></polyline>
      </svg>
    );
  }
  
  if (t.includes('pdf') || t.endsWith('.pdf')) {
    // PDF Icon (Red-ish)
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeLinecap="round" strokeLinejoin="round" style={style}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    );
  }

  if (t.includes('json') || t.endsWith('.json') || t.includes('javascript') || t.endsWith('.js') || t.endsWith('.ts')) {
    // Code/JSON Icon (Yellow/Green)
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeLinecap="round" strokeLinejoin="round" style={style}>
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>
    );
  }

  if (t.includes('video') || t.endsWith('.mp4') || t.endsWith('.mov') || t.endsWith('.webm')) {
    // Video Icon (Blue)
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeLinecap="round" strokeLinejoin="round" style={style}>
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
        <line x1="7" y1="2" x2="7" y2="22"></line>
        <line x1="17" y1="2" x2="17" y2="22"></line>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <line x1="2" y1="7" x2="7" y2="7"></line>
        <line x1="2" y1="17" x2="7" y2="17"></line>
        <line x1="17" y1="17" x2="22" y2="17"></line>
        <line x1="17" y1="7" x2="22" y2="7"></line>
      </svg>
    );
  }

  if (t.includes('audio') || t.endsWith('.mp3') || t.endsWith('.wav')) {
    // Audio Icon (Pink)
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeLinecap="round" strokeLinejoin="round" style={style}>
        <path d="M9 18V5l12-2v13"></path>
        <circle cx="6" cy="18" r="3"></circle>
        <circle cx="18" cy="16" r="3"></circle>
      </svg>
    );
  }

  // Default Text Icon (Gray)
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
      <line x1="10" y1="9" x2="8" y2="9"></line>
    </svg>
  );
};

const KnowledgeManager: React.FC<KnowledgeManagerProps> = ({ onUpdate, currentAgentId }) => {
  const [activeTab, setActiveTab] = useState<'local' | 'cloud'>('local');
  const [isOpen, setIsOpen] = useState(false);
  
  // Local DB State
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  
  // Ingestion State
  const [importStats, setImportStats] = useState<IngestionResult['stats'] | null>(null);
  const [pendingImportData, setPendingImportData] = useState<KnowledgeDoc[] | null>(null);
  const [pendingHeader, setPendingHeader] = useState<any>(null); // For display
  
  const [uploadProgress, setUploadProgress] = useState<{
    fileName: string;
    current: number;
    total: number;
    startTime: number;
  } | null>(null);

  // Cloud Files State
  const [cloudFiles, setCloudFiles] = useState<CloudFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string, type: 'success' | 'error' | 'info' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cloudFileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const fetchDocs = async () => {
    try {
      const data = await getDocumentsByAgentId(currentAgentId);
      setDocs(data);
    } catch (e) {
      console.error("Failed to fetch docs", e);
      showStatus("Failed to fetch documents.", 'error');
    }
  };

  const fetchCloudFiles = async () => {
    try {
      setIsProcessing(true);
      const files = await listCloudFiles();
      setCloudFiles(files);
    } catch (e) {
      console.error("Failed to fetch cloud files", e);
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'local') {
          setDocs([]); 
          fetchDocs();
      } else {
          fetchCloudFiles();
      }
      setStatusMsg(null);
    }
  }, [isOpen, currentAgentId, activeTab]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterQuery, docs]);

  const showStatus = (text: string, type: 'success' | 'error' | 'info') => {
      setStatusMsg({ text, type });
      if (type !== 'error') {
          setTimeout(() => setStatusMsg(null), 3000);
      }
  };

  // --- LOCAL VECTOR LOGIC ---

  const chunkText = (text: string): string[] => {
    const CHUNK_SIZE = 1500;
    const chunks: string[] = [];
    const cleanText = text.replace(/\r\n/g, '\n');
    let startIndex = 0;
    while (startIndex < cleanText.length) {
        let endIndex = startIndex + CHUNK_SIZE;
        if (endIndex >= cleanText.length) {
            endIndex = cleanText.length;
        } else {
            const lastNewline = cleanText.lastIndexOf('\n', endIndex);
            const lastPeriod = cleanText.lastIndexOf('. ', endIndex);
            if (lastNewline > startIndex && lastNewline > endIndex - 200) {
                endIndex = lastNewline;
            } else if (lastPeriod > startIndex && lastPeriod > endIndex - 200) {
                endIndex = lastPeriod + 1;
            } else {
                 const lastSpace = cleanText.lastIndexOf(' ', endIndex);
                 if (lastSpace > startIndex) endIndex = lastSpace;
            }
        }
        chunks.push(cleanText.substring(startIndex, endIndex).trim());
        startIndex = endIndex;
    }
    return chunks;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setStatusMsg(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await new Promise(resolve => setTimeout(resolve, 0));
        const text = await file.text();
        const chunks = chunkText(text);
        const startTime = Date.now();
        setUploadProgress({ fileName: file.name, current: 0, total: chunks.length, startTime });
        const BATCH_SIZE = 100;
        for (let j = 0; j < chunks.length; j += BATCH_SIZE) {
            await new Promise(resolve => setTimeout(resolve, 0));
            const batchChunks = chunks.slice(j, j + BATCH_SIZE);
            try {
                const batchResult = await ai.models.embedContent({
                    model: 'text-embedding-004',
                    contents: batchChunks.map(c => ({ parts: [{ text: c }] })),
                    config: { taskType: 'RETRIEVAL_DOCUMENT', title: file.name }
                });
                const embeddings = batchResult.embeddings;
                for (let k = 0; k < batchChunks.length; k++) {
                    const embedding = embeddings?.[k]?.values;
                    const chunkContent = batchChunks[k];
                    
                    // GENERATE NUMMARK SIGIL
                    const sigil = NumMarkX_GenerateSigil(chunkContent);

                    await addDocument({
                        id: crypto.randomUUID(),
                        agentId: currentAgentId,
                        title: `${file.name} (Part ${j + k + 1}/${chunks.length})`,
                        content: chunkContent,
                        embedding: embedding,
                        timestamp: Date.now(),
                        numMarkId: sigil
                    });
                }
            } catch(err) {
                console.error("Batch embedding failed, saving without vectors", err);
                for (let k = 0; k < batchChunks.length; k++) {
                    const chunkContent = batchChunks[k];
                    // GENERATE NUMMARK SIGIL
                    const sigil = NumMarkX_GenerateSigil(chunkContent);
                    
                    await addDocument({
                         id: crypto.randomUUID(),
                         agentId: currentAgentId,
                         title: `${file.name} (Part ${j + k + 1}/${chunks.length})`,
                         content: chunkContent,
                         timestamp: Date.now(),
                         numMarkId: sigil
                    });
                }
            }
            setUploadProgress(prev => {
                if (!prev) return null;
                return { ...prev, current: Math.min(chunks.length, j + batchChunks.length) };
            });
        }
      }
      await fetchDocs();
      onUpdate();
      showStatus("Files uploaded successfully.", 'success');
    } catch (err) {
      console.error("Upload failed", err);
      showStatus("Failed to upload files.", 'error');
    } finally {
      setIsProcessing(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSelectLorePack = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsProcessing(true);
    setImportStats(null);
    setPendingImportData(null);
    setPendingHeader(null);

    try {
        const text = await file.text();
        // USE INGESTION SERVICE (Already NumMark compliant)
        const result = await IngestionService.parseLorePack(text, currentAgentId);
        
        if (!result.success) {
            throw new Error(result.error || "Parsing failed");
        }

        if (result.header.agentId !== currentAgentId) {
             const confirmMix = window.confirm(`LorePack belongs to ${result.header.agentId}, but you are importing into ${currentAgentId}. Continue? (Docs will be re-assigned)`);
             if (!confirmMix) {
                 setIsProcessing(false);
                 if(importInputRef.current) importInputRef.current.value = '';
                 return;
             }
        }

        setPendingImportData(result.docs);
        setImportStats(result.stats);
        setPendingHeader(result.header);

    } catch (err: any) {
        showStatus(`Verification Failed: ${err.message}`, 'error');
        if(importInputRef.current) importInputRef.current.value = '';
    } finally { setIsProcessing(false); }
  };

  const executeImport = async () => {
      if (!pendingImportData) return;
      setIsProcessing(true);
      try {
        // Re-assign agentId to ensure they land in the right bucket in DB
        const taggedData = pendingImportData.map((d: KnowledgeDoc) => ({ ...d, agentId: currentAgentId }));
        await bulkAddDocuments(taggedData);
        await fetchDocs();
        onUpdate();
        
        setPendingImportData(null);
        setImportStats(null);
        setPendingHeader(null);
        
        if(importInputRef.current) importInputRef.current.value = '';
        showStatus(`Ingested ${taggedData.length} nodes from LorePack.`, 'success');
      } catch (err: any) {
        showStatus(`Import Failed: ${err.message}`, 'error');
      } finally { setIsProcessing(false); }
  };

  const handlePurgeAll = async () => {
      if (!window.confirm(`WARNING: DELETE ALL DOCUMENTS for ${currentAgentId}?`)) return;
      setIsProcessing(true);
      try {
          await deleteDocumentsByAgentId(currentAgentId);
          await fetchDocs();
          onUpdate();
          showStatus("Database purged.", 'success');
      } catch (e) {
          showStatus("Failed to purge database.", 'error');
      } finally { setIsProcessing(false); }
  };

  const handleDelete = async (id: string) => {
    await deleteDocument(id);
    await fetchDocs();
    onUpdate();
  };

  // --- CLOUD FILE LOGIC ---

  const handleCloudUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);
    setStatusMsg({ text: "Uploading to Google Cloud...", type: 'info' });
    try {
      for (let i = 0; i < files.length; i++) {
        await uploadCloudFile(files[i]);
      }
      await fetchCloudFiles();
      showStatus("Files uploaded to Cloud.", 'success');
      // Trigger parent update to refresh available files in main app
      onUpdate();
    } catch (err: any) {
      console.error(err);
      showStatus(`Cloud Upload Failed: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
      if (cloudFileInputRef.current) cloudFileInputRef.current.value = '';
    }
  };

  const handleDeleteCloudFile = async (name: string) => {
    if (!window.confirm("Delete this file from Google Cloud?")) return;
    setIsProcessing(true);
    try {
      await deleteCloudFile(name);
      await fetchCloudFiles();
      onUpdate();
      showStatus("File deleted.", 'success');
    } catch (err) {
      showStatus("Failed to delete file.", 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // --- RENDER HELPERS ---

  const calculateETA = () => {
      if (!uploadProgress || uploadProgress.current === 0) return 'Calculating...';
      const elapsed = Date.now() - uploadProgress.startTime;
      const speed = uploadProgress.current / elapsed;
      const remaining = uploadProgress.total - uploadProgress.current;
      return `${Math.ceil((remaining / speed) / 1000)}s remaining`;
  };

  const filteredDocs = docs.filter(doc => 
    doc.title.toLowerCase().includes(filterQuery.toLowerCase()) || 
    doc.content.toLowerCase().includes(filterQuery.toLowerCase())
  );
  const totalPages = Math.ceil(filteredDocs.length / ITEMS_PER_PAGE);
  const paginatedDocs = filteredDocs.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="btn btn-secondary"
        style={{ whiteSpace: 'nowrap' }}
      >
        <span>DATABASE</span>
      </button>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-slide-in-right">
        
        <div className="section-header" style={{ padding: '1.5rem', paddingBottom: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
             <span className="section-header-title" style={{ fontSize: '1.25rem' }}>KNOWLEDGE MANAGER</span>
          </div>
          <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>
            [X]
          </button>
        </div>

        {/* TABS */}
        <div style={{ display: 'flex', borderBottom: '1px solid #333', padding: '0 1.5rem' }}>
            <button 
                onClick={() => setActiveTab('local')}
                style={{ 
                    padding: '0.75rem 1rem', 
                    background: 'none', 
                    border: 'none', 
                    borderBottom: activeTab === 'local' ? '2px solid #4ade80' : 'none',
                    color: activeTab === 'local' ? '#eee' : '#666',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '0.75rem'
                }}
            >
                LOCAL VECTORS (RAG)
            </button>
            <button 
                onClick={() => setActiveTab('cloud')}
                style={{ 
                    padding: '0.75rem 1rem', 
                    background: 'none', 
                    border: 'none', 
                    borderBottom: activeTab === 'cloud' ? '2px solid #a78bfa' : 'none',
                    color: activeTab === 'cloud' ? '#eee' : '#666',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '0.75rem'
                }}
            >
                CLOUD FILES (CONTEXT)
            </button>
        </div>

        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {statusMsg && (
              <div className={`status-banner status-${statusMsg.type}`}>
                  {statusMsg.text}
              </div>
          )}

          {activeTab === 'local' ? (
              <>
                {/* LOCAL VECTORS VIEW */}
                <div className="flex-col">
                    <span className="section-header-title">INGEST ({currentAgentId})</span>
                    <label className="btn-file-input">
                    <input 
                        type="file" 
                        accept=".txt,.md,.json" 
                        onChange={handleFileUpload} 
                        ref={fileInputRef}
                        className="hidden" 
                        disabled={isProcessing}
                        multiple
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#a3a3a3' }}>
                        {isProcessing && uploadProgress ? 'PROCESSING...' : 'DROP .TXT / .MD / .JSON'}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#666' }}>Auto-chunking & Vector Embedding</span>
                    </div>
                    </label>

                    {uploadProgress && (
                        <div className="flex-col" style={{ gap: '0.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#a3a3a3' }}>
                                <span>{uploadProgress.fileName}</span>
                                <span>{uploadProgress.current}/{uploadProgress.total}</span>
                            </div>
                            <div style={{ width: '100%', height: '4px', background: '#333' }}>
                                <div style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%`, height: '100%', background: '#fff' }} />
                            </div>
                            <div style={{ textAlign: 'right', fontSize: '0.7rem', color: '#666' }}>ETA: {calculateETA()}</div>
                        </div>
                    )}
                </div>

                {importStats && pendingHeader && (
                    <div className="section-panel" style={{ borderColor: '#666' }}>
                        <div className="section-header"><span className="section-header-title">LOREPACK VERIFIED</span></div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.2rem', fontSize: '0.75rem', marginBottom: '1rem', color: '#ccc' }}>
                            <div style={{color: '#4ade80'}}><strong>AGENT:</strong> {pendingHeader.handle}</div>
                            <div><strong>SCHEMA:</strong> {pendingHeader.schema || 'Legacy'}</div>
                            <div><strong>NODES:</strong> {importStats.total} ({importStats.withVectors} embedded)</div>
                            <div><strong>AVG SIZE:</strong> {importStats.avgSize} chars</div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button onClick={executeImport} className="btn btn-ingest" disabled={isProcessing}>IMPORT</button>
                            <button onClick={() => { setPendingImportData(null); setImportStats(null); }} className="btn btn-secondary">CANCEL</button>
                        </div>
                    </div>
                )}

                <div className="flex-col">
                     <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="section-header-title">STORED ({filteredDocs.length})</span>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <label className="btn btn-secondary" style={{ padding: '0.4rem', fontSize: '0.6rem', cursor: 'pointer' }}>
                                IMPORT LOREPACK
                                <input type="file" accept=".json" onChange={handleSelectLorePack} ref={importInputRef} className="hidden" />
                            </label>
                            <button onClick={handlePurgeAll} className="btn btn-danger" style={{ padding: '0.4rem', fontSize: '0.6rem' }}>PURGE ALL</button>
                        </div>
                     </div>
                     <input type="text" placeholder="Filter..." value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)} className="form-input" />
                     
                     <div className="flex-col" style={{ gap: '0.5rem' }}>
                        {paginatedDocs.map(doc => (
                            <div key={doc.id} className="section-panel" style={{ padding: '0.75rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
                                        <FileIcon typeStr={doc.title} />
                                        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                            <span style={{ fontWeight: 'bold', fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.title}</span>
                                            {doc.numMarkId && <span style={{ fontSize: '0.6rem', color: '#666' }}>{doc.numMarkId}</span>}
                                        </div>
                                    </div>
                                    <button onClick={() => handleDelete(doc.id)} style={{ background: 'none', border: 'none', color: '#666', marginLeft: '0.5rem' }}>[X]</button>
                                </div>
                                <p style={{ color: '#888', fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '0.25rem', paddingLeft: 'calc(20px + 0.75rem)' }}>{doc.content}</p>
                            </div>
                        ))}
                     </div>
                     
                     {totalPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                            <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} className="btn btn-secondary" disabled={currentPage === 1}>&lt;</button>
                            <span style={{ fontSize: '0.75rem', alignSelf: 'center' }}>{currentPage} / {totalPages}</span>
                            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} className="btn btn-secondary" disabled={currentPage === totalPages}>&gt;</button>
                        </div>
                     )}
                </div>
              </>
          ) : (
              <>
                {/* CLOUD FILES VIEW */}
                <div className="flex-col">
                    <span className="section-header-title">UPLOAD TO GOOGLE CLOUD</span>
                    <label className="btn-file-input" style={{ borderColor: '#a78bfa', color: '#a78bfa' }}>
                        <input 
                            type="file" 
                            onChange={handleCloudUpload} 
                            ref={cloudFileInputRef}
                            className="hidden" 
                            disabled={isProcessing}
                            multiple
                        />
                         <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>
                                {isProcessing ? 'UPLOADING...' : 'DROP LARGE FILES (PDF/CSV/TXT/VIDEO)'}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: '#a78bfa' }}>Supports 2M+ Context Window via Gating Model</span>
                        </div>
                    </label>
                </div>

                <div className="flex-col">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                         <span className="section-header-title">CLOUD FILES ({cloudFiles.length})</span>
                         <button onClick={fetchCloudFiles} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }}>REFRESH</button>
                    </div>
                    
                    {cloudFiles.length === 0 ? (
                        <div className="section-panel" style={{ textAlign: 'center', padding: '2rem' }}>
                            <p style={{ color: '#666', fontSize: '0.75rem' }}>NO CLOUD FILES FOUND</p>
                        </div>
                    ) : (
                        cloudFiles.map(file => (
                            <div key={file.name} className="section-panel" style={{ padding: '0.75rem', borderColor: file.state === 'ACTIVE' ? '#a78bfa' : '#333' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                                        <FileIcon typeStr={file.mimeType} />
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <span style={{ fontWeight: 'bold', fontSize: '0.75rem', color: '#eee' }}>{file.displayName}</span>
                                            <span style={{ fontSize: '0.65rem', color: '#666', fontFamily: 'monospace' }}>
                                                {(parseInt(file.sizeBytes) / 1024 / 1024).toFixed(2)} MB • {file.state}
                                            </span>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => handleDeleteCloudFile(file.name)}
                                        style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', marginLeft: '0.5rem' }}
                                        title="Delete from Cloud"
                                    >
                                        [DEL]
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
              </>
          )}

        </div>
      </div>
    </div>
  );
};

export default KnowledgeManager;
