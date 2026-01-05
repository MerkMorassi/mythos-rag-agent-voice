
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { KnowledgeDoc, CloudFile, LorePack } from '../types';
import { 
  addDocument, 
  getDocumentsByAgentId, 
  deleteDocument, 
  bulkAddDocuments, 
  deleteDocumentsByAgentId,
  saveLorePack,
  getLorePacksByAgentId,
  deleteLorePack
} from '../services/db';
import { uploadCloudFile, listCloudFiles, deleteCloudFile } from '../services/googleFiles';
import { IngestionService } from '../services/ingestion';
import { NumMarkX_GenerateSigil, NumMarkX_GenerateHeader } from '../patterns/NumMarkX';

interface KnowledgeManagerProps {
  onUpdate: () => void;
  currentAgentId: string;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

const ITEMS_PER_PAGE = 5;

// --- ICONS ---
const FileIcon = ({ typeStr }: { typeStr: string }) => {
  const t = (typeStr || '').toLowerCase();
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

export const KnowledgeManager: React.FC<KnowledgeManagerProps> = ({ 
    onUpdate, 
    currentAgentId,
    isOpen,
    onOpen,
    onClose
}) => {
  const [activeTab, setActiveTab] = useState<'local' | 'library' | 'cloud'>('local');
  
  // Local DB State
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  
  // Library State
  const [savedPacks, setSavedPacks] = useState<LorePack[]>([]);
  const [packName, setPackName] = useState('');

  // Ingestion State
  const [isStreamingImport, setIsStreamingImport] = useState(false);
  const [streamedDocsCount, setStreamedDocsCount] = useState(0);
  
  const [uploadProgress, setUploadProgress] = useState<{
    fileName: string;
    current: number;
    total: number;
    startTime: number;
  } | null>(null);

  // Retrofit State
  const [retrofitProgress, setRetrofitProgress] = useState<{current: number, total: number} | null>(null);

  // Cloud Files State
  const [cloudFiles, setCloudFiles] = useState<CloudFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string, type: 'success' | 'error' | 'info' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cloudFileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null); // For Active Memory Import
  const libraryImportRef = useRef<HTMLInputElement>(null); // For Library Import

  const fetchDocs = async () => {
    try {
      const data = await getDocumentsByAgentId(currentAgentId);
      setDocs(data);
    } catch (e: any) {
      console.error("Failed to fetch docs", e);
      showStatus(`Failed to fetch documents: ${e.message}`, 'error');
    }
  };

  const fetchSavedPacks = async () => {
      const packs = await getLorePacksByAgentId(currentAgentId);
      setSavedPacks(packs);
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
      if (activeTab === 'local') fetchDocs();
      if (activeTab === 'library') fetchSavedPacks();
      if (activeTab === 'cloud') fetchCloudFiles();
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

  const processBatch = async (batch: KnowledgeDoc[], ai: GoogleGenAI | null) => {
      if (ai) {
          const docsNeedingEmbed = batch.filter(d => !d.embedding);
          if (docsNeedingEmbed.length > 0) {
              try {
                  const batchResult = await ai.models.embedContent({
                      model: 'text-embedding-004',
                      contents: docsNeedingEmbed.map(d => ({ parts: [{ text: d.content }] })),
                      config: { taskType: 'RETRIEVAL_DOCUMENT' }
                  });
                  batchResult.embeddings?.forEach((e, idx) => {
                      docsNeedingEmbed[idx].embedding = e.values;
                  });
              } catch (e) {
                  console.warn("Auto-embed failed for batch, saving without vectors.", e);
              }
          }
      }
      await bulkAddDocuments(batch);
  };

  const handleRetrofit = async () => {
      if (docs.length === 0) return showStatus("No docs to retrofit.", 'error');
      if (!window.confirm("Run INJECT GRAPH Protocol?\n\nThis will scan your existing memory specifically to build the Knowledge Graph. It will SKIP any documents that have already been processed.")) return;

      const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
      if (!apiKey) return showStatus("API Key required.", 'error');

      setIsProcessing(true);
      setStatusMsg({ text: "Injecting Graph Nodes... (Incremental)", type: 'info' });

      try {
          await IngestionService.retrofitAgentMemory(currentAgentId, apiKey, (c, t) => {
              setRetrofitProgress({ current: c, total: t });
          });
          
          await fetchDocs();
          showStatus("Graph Injection Complete.", 'success');
      } catch (e: any) {
          showStatus(`Injection Failed: ${e.message}`, 'error');
      } finally {
          setIsProcessing(false);
          setRetrofitProgress(null);
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
          const header = NumMarkX_GenerateHeader(currentAgentId, currentAgentId, "Exported via Knowledge Manager");
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

  const handleSaveToLibrary = async () => {
      if (docs.length === 0) return showStatus("No active memory to bundle.", 'error');
      if (!packName.trim()) return showStatus("Pack Name required.", 'error');
      
      try {
          const header = NumMarkX_GenerateHeader(currentAgentId, currentAgentId, packName);
          header.name = packName; 
          const pack: LorePack = { id: header.id, header: header, sacred_archive: docs };
          await saveLorePack(pack);
          
          setPackName('');
          showStatus(`Saved "${packName}" to Library (${docs.length} nodes).`, 'success');
          
          // Refresh library in background so it's ready when tab switches
          fetchSavedPacks();
      } catch(e: any) {
          showStatus(`Save Failed: ${e.message}`, 'error');
      }
  };

  const handleImportToLibrary = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      setIsProcessing(true);
      setStatusMsg({ text: "Parsing LorePack for Library...", type: 'info' });

      try {
          // Use IngestionService to parse and validate
          const result = await IngestionService.parseLorePack(file, currentAgentId);
          
          if (!result.success) throw new Error(result.error);
          
          // Construct LorePack object
          const pack: LorePack = {
              id: result.header.id,
              header: result.header,
              sacred_archive: result.docs
          };

          // Retarget to current agent to ensure it shows in their library
          pack.header.agentId = currentAgentId; 
          pack.header.handle = currentAgentId;
          // Use filename as name if header name missing
          if (!pack.header.name || pack.header.name === 'Streamed Import') {
              pack.header.name = file.name.replace('.json', '');
          }

          await saveLorePack(pack);
          await fetchSavedPacks();
          showStatus(`Imported "${pack.header.name}" to Library.`, 'success');

      } catch (e: any) {
          console.error(e);
          showStatus(`Library Import Failed: ${e.message}`, 'error');
      } finally {
          setIsProcessing(false);
          if (libraryImportRef.current) libraryImportRef.current.value = '';
      }
  };

  const handleMountPack = async (pack: LorePack) => {
      const count = pack.sacred_archive.length;
      if (!window.confirm(`MOUNT CARTRIDGE "${pack.header.name}"?\n\nThis will UNMOUNT (delete) current active memory for ${currentAgentId} and load this LorePack (${count} nodes).`)) return;

      setIsProcessing(true);
      setStatusMsg({ text: "Unmounting previous memory...", type: 'info' });

      try {
          await deleteDocumentsByAgentId(currentAgentId);
          setStatusMsg({ text: `Mounting "${pack.header.name}"...`, type: 'info' });

          const newDocs = pack.sacred_archive.map(d => ({ 
              ...d, 
              agentId: currentAgentId, 
              timestamp: Date.now() 
          }));
          
          const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
          const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
          
          const BATCH_SIZE = 50;
          for (let i = 0; i < newDocs.length; i += BATCH_SIZE) {
              const batch = newDocs.slice(i, i + BATCH_SIZE);
              await processBatch(batch, ai);
          }

          showStatus(`Successfully Mounted "${pack.header.name}"`, 'success');
          setActiveTab('local'); 
          await fetchDocs(); 
          onUpdate();
      } catch (e: any) {
          console.error(e);
          showStatus(`Mount Failed: ${e.message}`, 'error');
      } finally {
          setIsProcessing(false);
      }
  };

  const handleDeletePack = async (id: string) => {
      if(!window.confirm("Delete this saved LorePack permanently?")) return;
      try {
          await deleteLorePack(id);
          fetchSavedPacks();
          showStatus("LorePack deleted.", 'success');
      } catch(e: any) {
          showStatus("Delete failed.", 'error');
      }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
    if (!apiKey) { showStatus("API Key Missing. Configure in Settings.", 'error'); return; }
    setIsProcessing(true);
    setStatusMsg(null);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await new Promise(resolve => setTimeout(resolve, 0));
        const text = await file.text();
        const startTime = Date.now();
        
        // Use IngestionService to handle chunking, embedding, AND Graph extraction
        const count = await IngestionService.ingestText(text, file.name, currentAgentId, apiKey);
        
        setUploadProgress({ fileName: file.name, current: count, total: count, startTime });
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
    
    if(!window.confirm("Importing a LorePack file. Do you want to REPLACE the current active memory with this pack? (Cancel to abort)")) return;

    setIsProcessing(true);
    setIsStreamingImport(true);
    setStreamedDocsCount(0);
    
    try {
        await deleteDocumentsByAgentId(currentAgentId);
        
        const BATCH_SIZE = 20; 
        let batch: KnowledgeDoc[] = [];
        let count = 0;
        let foundHeader = null;
        
        const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
        const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

        for await (const obj of IngestionService.streamLorePack(file)) {
            if (obj.schema === 'MYTHOS.LOREPACK.v1' || (obj.agentId && obj.handle)) {
                foundHeader = obj;
            } else {
                const doc = IngestionService.normalizeNode(obj, currentAgentId, count);
                batch.push(doc);
                count++;
                
                if (batch.length >= BATCH_SIZE) {
                    await processBatch(batch, ai);
                    batch = [];
                    setStreamedDocsCount(count);
                    await new Promise(r => setTimeout(r, 0));
                }
            }
        }
        if (batch.length > 0) {
            await processBatch(batch, ai);
            setStreamedDocsCount(count);
        }
        
        showStatus(`Pack Mounted. ${count} nodes loaded.`, 'success');
        await fetchDocs();
        onUpdate();

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

  const filteredDocs = docs.filter(doc => 
    doc.title.toLowerCase().includes(filterQuery.toLowerCase()) || 
    doc.content.toLowerCase().includes(filterQuery.toLowerCase())
  );
  const totalPages = Math.ceil(filteredDocs.length / ITEMS_PER_PAGE);
  const paginatedDocs = filteredDocs.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content animate-slide-in-right">
        
        <div className="modal-header-area">
          <div className="flex-group">
             <span className="modal-section-title" style={{ color: '#4ade80' }}>KNOWLEDGE MANAGER</span>
          </div>
          <button onClick={onClose} className="close-btn" title="Close Manager">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {isStreamingImport || (isProcessing && !uploadProgress && !retrofitProgress) ? (
            <div style={{ padding: '2rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem', justifyContent: 'center', alignItems: 'center', height: '100%', animation: 'fadeIn 0.3s' }}>
                <div style={{ textAlign: 'center' }}>
                    <h3 style={{ color: '#4ade80', marginBottom: '0.5rem' }}>{isStreamingImport ? 'STREAMING INGESTION' : 'PROCESSING'}</h3>
                    <p style={{ color: '#ccc', fontSize: '0.8rem' }}>Integrating Knowledge...</p>
                </div>
                
                <div className="section-panel" style={{ borderColor: '#4ade80', width: '80%', padding: '2rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem', alignItems: 'center' }}>
                        {isStreamingImport ? (
                            <>
                                <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#fff' }}>{streamedDocsCount}</div>
                                <div style={{ color: '#666', letterSpacing: '1px' }}>NODES PROCESSED</div>
                            </>
                        ) : (
                            <div style={{ color: '#fff' }}>{statusMsg?.text || 'Processing...'}</div>
                        )}
                        <div className="spinner" style={{ marginTop: '1.5rem' }} />
                    </div>
                </div>
            </div>
        ) : (
            <>
                <div style={{ display: 'flex', borderBottom: '1px solid #333', padding: '0 1rem', background: '#0a0a0a' }}>
                    <button 
                        onClick={() => setActiveTab('local')}
                        title="Manage local RAG documents"
                        style={{ 
                            padding: '0.75rem 1rem', 
                            background: 'none', 
                            border: 'none', 
                            borderBottom: activeTab === 'local' ? '2px solid #4ade80' : 'none',
                            color: activeTab === 'local' ? '#eee' : '#666',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            fontSize: '0.75rem',
                            flex: 1
                        }}
                    >
                        ACTIVE MEMORY
                    </button>
                    <button 
                        onClick={() => setActiveTab('library')}
                        title="Manage saved LorePacks"
                        style={{ 
                            padding: '0.75rem 1rem', 
                            background: 'none', 
                            border: 'none', 
                            borderBottom: activeTab === 'library' ? '2px solid #facc15' : 'none',
                            color: activeTab === 'library' ? '#eee' : '#666',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            fontSize: '0.75rem',
                            flex: 1
                        }}
                    >
                        LORE LIBRARY
                    </button>
                    <button 
                        onClick={() => setActiveTab('cloud')}
                        title="Manage Google Cloud files"
                        style={{ 
                            padding: '0.75rem 1rem', 
                            background: 'none', 
                            border: 'none', 
                            borderBottom: activeTab === 'cloud' ? '2px solid #a78bfa' : 'none',
                            color: activeTab === 'cloud' ? '#eee' : '#666',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            fontSize: '0.75rem',
                            flex: 1
                        }}
                    >
                        CLOUD CONTEXT
                    </button>
                </div>

                <div className="modal-body-area">
                
                {statusMsg && (
                    <div className={`status-banner status-${statusMsg.type}`}>
                        {statusMsg.text}
                    </div>
                )}

                {activeTab === 'local' && (
                    <>
                        <div className="flex-col">
                            <span className="section-header-title" style={{color: '#4ade80'}}>INGEST ({currentAgentId})</span>
                            <label className="btn-file-input" title="Upload text or code files for RAG">
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
                                <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#a3a3a3' }}>
                                {isProcessing && uploadProgress ? 'PROCESSING...' : 'DROP .TXT / .MD / .JSON'}
                                </span>
                                <span style={{ fontSize: '0.7rem', color: '#666' }}>Smart Recursive Chunking & Graph Extraction</span>
                            </div>
                            </label>

                            {uploadProgress && (
                                <div className="flex-col" style={{ gap: '0.25rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#a3a3a3' }}>
                                        <span>{uploadProgress.fileName}</span>
                                        <span>{uploadProgress.current}/{uploadProgress.total}</span>
                                    </div>
                                    <div style={{ width: '100%', height: '4px', background: '#333' }}>
                                        <div style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%`, height: '100%', background: '#4ade80' }} />
                                    </div>
                                </div>
                            )}
                            
                            {retrofitProgress && (
                                <div className="flex-col" style={{ gap: '0.25rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#facc15' }}>
                                        <span>RETROFITTING...</span>
                                        <span>{retrofitProgress.current}/{retrofitProgress.total}</span>
                                    </div>
                                    <div style={{ width: '100%', height: '4px', background: '#333' }}>
                                        <div style={{ width: `${(retrofitProgress.current / retrofitProgress.total) * 100}%`, height: '100%', background: '#facc15' }} />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* BUNDLE TO LIBRARY */}
                        <div className="section-panel" style={{ padding: '0.75rem', borderColor: '#facc15', borderStyle: 'dashed' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <input 
                                    className="form-input" 
                                    placeholder="Bundle Name (e.g. Project Apollo)" 
                                    value={packName}
                                    onChange={e => setPackName(e.target.value)}
                                    style={{ fontSize: '0.8rem' }}
                                />
                                <button onClick={handleSaveToLibrary} className="btn btn-secondary" style={{ color: '#facc15', borderColor: '#facc15' }} title="Bundle current active memory into a reusable LorePack">SAVE TO LIB</button>
                            </div>
                        </div>

                        <div className="flex-col">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <span className="section-header-title">STORED ({filteredDocs.length})</span>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <button 
                                        onClick={handleExportLorePack} 
                                        className="btn btn-accent" 
                                        style={{ fontSize: '0.65rem' }}
                                        title="Download valid LorePack JSON"
                                    >
                                        EXPORT LP
                                    </button>
                                    
                                    <label className="btn btn-accent" style={{ fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }} title="Load a JSON LorePack into Active Memory">
                                        IMPORT LP
                                        <input type="file" accept=".json" onChange={handleSelectLorePack} ref={importInputRef} className="hidden" />
                                    </label>
                                    
                                    <button 
                                        onClick={handleRetrofit}
                                        className="btn btn-secondary"
                                        style={{ fontSize: '0.65rem', borderColor: '#facc15', color: '#facc15' }}
                                        title="Inject Graph Data into existing documents (Incremental)"
                                        disabled={isProcessing}
                                    >
                                        INJECT GRAPH
                                    </button>

                                    <button onClick={handlePurgeAll} className="btn btn-danger" style={{ fontSize: '0.65rem' }} title="Delete ALL knowledge for this agent">PURGE ALL</button>
                                </div>
                            </div>
                            <input type="text" placeholder="Filter documents..." value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)} className="form-input" />
                            
                            <div className="flex-col" style={{ gap: '0.5rem' }}>
                                {paginatedDocs.map(doc => (
                                    <div key={doc.id} className="section-panel" style={{ padding: '0.75rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
                                                <FileIcon typeStr={doc.title} />
                                                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                                    <span style={{ fontWeight: 'bold', fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#eee' }}>{doc.title}</span>
                                                    {doc.numMarkId && <span style={{ fontSize: '0.6rem', color: '#a78bfa' }}>{doc.numMarkId}</span>}
                                                </div>
                                            </div>
                                            <button onClick={() => handleDelete(doc.id)} style={{ background: 'none', border: 'none', color: '#666', marginLeft: '0.5rem', cursor: 'pointer', fontSize: '1.2rem' }} title="Delete Document">×</button>
                                        </div>
                                        <p style={{ color: '#888', fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '0.25rem', paddingLeft: 'calc(20px + 0.75rem)' }}>{doc.content}</p>
                                    </div>
                                ))}
                            </div>
                            
                            {totalPages > 1 && (
                                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                                    <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} className="btn btn-secondary" disabled={currentPage === 1} title="Previous Page">&lt;</button>
                                    <span style={{ fontSize: '0.75rem', alignSelf: 'center', color: '#666' }}>PAGE {currentPage} / {totalPages}</span>
                                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} className="btn btn-secondary" disabled={currentPage === totalPages} title="Next Page">&gt;</button>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {activeTab === 'library' && (
                    <div className="flex-col">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="section-header-title" style={{color: '#facc15'}}>LORE LIBRARY ({savedPacks.length})</span>
                            
                            {/* IMPORT PACK TO LIBRARY */}
                            <label className="btn btn-secondary btn-xs" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} title="Upload a JSON LorePack to this Library (No Mount)">
                                IMPORT PACK
                                <input type="file" accept=".json" onChange={handleImportToLibrary} ref={libraryImportRef} className="hidden" />
                            </label>
                        </div>
                        
                        <div className="section-panel" style={{ padding: '1rem', marginBottom: '1rem' }}>
                            <p style={{ fontSize: '0.75rem', color: '#ccc' }}>
                                LorePacks are persistent snapshots. Mounting a pack will <strong>SWAP OUT</strong> the current Active Memory for this agent.
                            </p>
                        </div>

                        {savedPacks.length === 0 ? (
                            <div className="empty-state" style={{ padding: '2rem' }}>NO SAVED PACKS</div>
                        ) : (
                            savedPacks.map(pack => (
                                <div key={pack.id} className="section-panel" style={{ padding: '0.75rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <div style={{ fontWeight: 'bold', color: '#facc15' }}>{pack.header.name || pack.header.handle}</div>
                                            <div style={{ fontSize: '0.65rem', color: '#666' }}>{new Date(pack.header.timestamp).toLocaleString()} • {pack.sacred_archive.length} Docs</div>
                                        </div>
                                        <button onClick={() => handleDeletePack(pack.id)} style={{ color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }} title="Delete LorePack">×</button>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                        <button 
                                            onClick={() => handleMountPack(pack)} 
                                            className="btn btn-secondary btn-xs" 
                                            style={{ flex: 1, borderColor: '#facc15', color: '#facc15', fontWeight: 'bold' }} 
                                            title="Unmount current memory and load this pack"
                                        >
                                            MOUNT CARTRIDGE
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'cloud' && (
                    <>
                        <div className="flex-col">
                            <span className="section-header-title" style={{ color: '#a78bfa' }}>UPLOAD TO GOOGLE CLOUD</span>
                            <label className="btn-file-input purple" style={{ borderColor: '#a78bfa', color: '#a78bfa', background: 'rgba(167, 139, 250, 0.05)' }} title="Upload large files to Google Cloud">
                                <input 
                                    type="file" 
                                    onChange={handleCloudUpload} 
                                    ref={cloudFileInputRef}
                                    className="hidden" 
                                    disabled={isProcessing}
                                    multiple
                                />
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>
                                        {isProcessing ? 'UPLOADING...' : 'DROP LARGE FILES (PDF/CSV/TXT/VIDEO)'}
                                    </span>
                                    <span style={{ fontSize: '0.7rem', color: '#a78bfa' }}>Supports 2M+ Context Window via Gating Model</span>
                                </div>
                            </label>
                        </div>

                        <div className="flex-col">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span className="section-header-title">CLOUD FILES ({cloudFiles.length})</span>
                                <button onClick={fetchCloudFiles} className="btn btn-secondary" style={{ fontSize: '0.65rem', padding: '0 0.5rem' }} title="Refresh File List">REFRESH</button>
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
                                                style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', marginLeft: '0.5rem', fontSize: '1.2rem' }}
                                                title="Delete from Cloud"
                                            >
                                                ×
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
