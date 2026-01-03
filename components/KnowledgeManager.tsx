
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
import { IngestionService } from '../services/ingestion';
import { NumMarkX_GenerateSigil, NumMarkX_GenerateHeader } from '../patterns/NumMarkX';

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
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeLinecap="round" strokeLinejoin="round" style={style}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <polyline points="21 15 16 10 5 21"></polyline>
      </svg>
    );
  }
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

export const KnowledgeManager: React.FC<KnowledgeManagerProps> = ({ onUpdate, currentAgentId }) => {
  const [activeTab, setActiveTab] = useState<'local' | 'cloud'>('local');
  const [isOpen, setIsOpen] = useState(false);
  
  // Local DB State
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  
  // Ingestion State
  const [isStreamingImport, setIsStreamingImport] = useState(false);
  const [streamedDocsCount, setStreamedDocsCount] = useState(0);
  
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
    } catch (e: any) {
      console.error("Failed to fetch docs", e);
      showStatus(`Failed to fetch documents: ${e.message}`, 'error');
    }
  };

  const fetchCloudFiles = async () => {
    try {
      setIsProcessing(true);
      const files = await listCloudFiles();
      setCloudFiles(files);
    } catch (e: any) {
      console.error("Failed to fetch cloud files", e);
      showStatus(`Cloud List Error: ${e.message}`, 'error');
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

  const handleExportLorePack = async () => {
      if (docs.length === 0) {
          showStatus("No documents to export.", 'error');
          return;
      }
      
      try {
          const exportDocs = docs.map(d => ({
              ...d,
              numMarkId: d.numMarkId || NumMarkX_GenerateSigil(d.content)
          }));

          const header = NumMarkX_GenerateHeader(
              currentAgentId, 
              currentAgentId,
              "Exported via Knowledge Manager"
          );

          const blob = IngestionService.exportLorePack(header, exportDocs);
          
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${currentAgentId}_LOREPACK_${new Date().toISOString().slice(0,10)}.json`;
          a.click();
          
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          
          showStatus(`Exported ${exportDocs.length} nodes to LorePack.`, 'success');
      } catch (e: any) {
          console.error("Export failed", e);
          showStatus(`Export Failed: ${e.message}`, 'error');
      }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
    if (!apiKey) {
        showStatus("API Key Missing. Configure in Settings.", 'error');
        return;
    }

    setIsProcessing(true);
    setStatusMsg(null);
    try {
      const ai = new GoogleGenAI({ apiKey });
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await new Promise(resolve => setTimeout(resolve, 0));
        const text = await file.text();
        
        // Use the new Recursive Chunker
        const chunks = IngestionService.chunkText(text);
        
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
            } catch(err: any) {
                console.error("Batch embedding failed, saving without vectors", err);
                for (let k = 0; k < batchChunks.length; k++) {
                    const chunkContent = batchChunks[k];
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
                if (err.message && err.message.includes('429')) {
                    showStatus("Rate limit hit. Saving remaining chunks without vectors.", 'info');
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
    } catch (err: any) {
      console.error("Upload failed", err);
      showStatus(`Failed to upload files: ${err.message}`, 'error');
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
    setIsStreamingImport(true);
    setStreamedDocsCount(0);

    const BATCH_SIZE = 150;
    let batch: KnowledgeDoc[] = [];
    let count = 0;
    let foundHeader = null;

    try {
        for await (const obj of IngestionService.streamLorePack(file)) {
            if (obj.schema === 'MYTHOS.LOREPACK.v1' || (obj.agentId && obj.handle)) {
                foundHeader = obj;
            } else {
                const doc = IngestionService.normalizeNode(obj, currentAgentId, count);
                batch.push(doc);
                count++;
                
                if (batch.length >= BATCH_SIZE) {
                    await bulkAddDocuments(batch);
                    batch = [];
                    setStreamedDocsCount(count);
                    await new Promise(r => setTimeout(r, 0));
                }
            }
        }
        
        if (batch.length > 0) {
            await bulkAddDocuments(batch);
            setStreamedDocsCount(count);
        }

        if (count === 0) {
             showStatus("Warning: No valid nodes found in stream. Check JSON format.", 'error');
        } else {
             if (foundHeader && foundHeader.agentId !== currentAgentId) {
                 showStatus(`Imported ${count} nodes (Agent: ${foundHeader.agentId})`, 'info');
             } else {
                 showStatus(`Streamed ${count} nodes successfully.`, 'success');
             }
             await fetchDocs();
             onUpdate();
        }

    } catch (err: any) {
        console.error(err);
        showStatus(`Streaming Failed: ${err.message}`, 'error');
    } finally { 
        setIsProcessing(false); 
        setIsStreamingImport(false);
        if(importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handlePurgeAll = async () => {
      if (!window.confirm(`WARNING: DELETE ALL DOCUMENTS for ${currentAgentId}?`)) return;
      setIsProcessing(true);
      try {
          await deleteDocumentsByAgentId(currentAgentId);
          setDocs([]);
          await fetchDocs();
          onUpdate();
          showStatus("Database purged.", 'success');
      } catch (e: any) {
          console.error(e);
          showStatus(`Failed to purge database: ${e.message}`, 'error');
      } finally { setIsProcessing(false); }
  };

  const handleDelete = async (id: string) => {
    await deleteDocument(id);
    await fetchDocs();
    onUpdate();
  };

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
    } catch (err: any) {
      showStatus(`Failed to delete file: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

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
        className="btn btn-secondary btn-icon"
        title="Knowledge Database"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
        </svg>
      </button>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-slide-in-right">
        
        <div className="modal-header-area">
          <div className="flex-group">
             <span className="modal-section-title">KNOWLEDGE MANAGER</span>
          </div>
          <button onClick={() => setIsOpen(false)} className="close-btn">[X]</button>
        </div>

        {isStreamingImport ? (
            <div style={{ padding: '2rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem', justifyContent: 'center', animation: 'fadeIn 0.3s' }}>
                <div style={{ textAlign: 'center' }}>
                    <h3 style={{ color: '#4ade80', marginBottom: '0.5rem' }}>STREAMING INGESTION</h3>
                    <p style={{ color: '#ccc', fontSize: '0.8rem' }}>Processing Large LorePack...</p>
                </div>
                
                <div className="section-panel" style={{ borderColor: '#4ade80' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem', alignItems: 'center' }}>
                        <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#fff' }}>{streamedDocsCount}</div>
                        <div style={{ color: '#666' }}>Nodes Processed</div>
                        <div className="spinner" style={{ marginTop: '1rem' }} />
                    </div>
                </div>
            </div>
        ) : (
            <>
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

                <div className="modal-body-area">
                
                {statusMsg && (
                    <div className={`status-banner status-${statusMsg.type}`}>
                        {statusMsg.text}
                    </div>
                )}

                {activeTab === 'local' ? (
                    <>
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
                                <span style={{ fontSize: '0.75rem', color: '#666' }}>Smart Recursive Chunking & Embedding</span>
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

                        <div className="flex-col">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <span className="section-header-title">STORED ({filteredDocs.length})</span>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <button 
                                        onClick={handleExportLorePack} 
                                        className="btn btn-secondary" 
                                        style={{ color: '#a78bfa', borderColor: '#a78bfa' }}
                                        title="Download valid LorePack JSON"
                                    >
                                        EXPORT LOREPACK
                                    </button>
                                    
                                    <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                                        IMPORT LOREPACK
                                        <input type="file" accept=".json" onChange={handleSelectLorePack} ref={importInputRef} className="hidden" />
                                    </label>
                                    <button onClick={handlePurgeAll} className="btn btn-danger">PURGE ALL</button>
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
                                                    {doc.numMarkId && <span style={{ fontSize: '0.6rem', color: '#a78bfa' }}>{doc.numMarkId}</span>}
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
                                <button onClick={fetchCloudFiles} className="btn btn-secondary" style={{ fontSize: '0.7rem' }}>REFRESH</button>
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
            </>
        )}
      </div>
    </div>
  );
};
