

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { KnowledgeDoc } from '../types';
import { 
  addDocument, 
  getDocumentsByAgentId, 
  deleteDocument, 
  bulkAddDocuments,
  clearAllDocuments,
  deleteDocumentsByAgentId
} from '../services/db';

interface KnowledgeManagerProps {
  onUpdate: () => void;
  currentAgentId: string;
  embeddingModelName: string;
}

const ITEMS_PER_PAGE = 5;

const KnowledgeManager: React.FC<KnowledgeManagerProps> = ({ onUpdate, currentAgentId, embeddingModelName }) => {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  
  // Import/Export State
  const [importStats, setImportStats] = useState<{
    total: number;
    withVectors: number;
    agents: string[];
    avgContentLength: number;
  } | null>(null);
  const [pendingImportData, setPendingImportData] = useState<KnowledgeDoc[] | null>(null);
  
  // Upload Progress State
  const [uploadProgress, setUploadProgress] = useState<{
    fileName: string;
    current: number;
    total: number;
    startTime: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const fetchDocs = async () => {
    try {
      // Only fetch docs for the current agent
      const data = await getDocumentsByAgentId(currentAgentId);
      setDocs(data);
    } catch (e) {
      console.error("Failed to fetch docs", e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setDocs([]); // Clear docs immediately when switching or opening to avoid flash of wrong agent data
      fetchDocs();
    }
  }, [isOpen, currentAgentId]);

  // Reset pagination when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterQuery, docs]);

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
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Yield to main thread
        await new Promise(resolve => setTimeout(resolve, 0));
        
        const text = await file.text();
        const chunks = chunkText(text);
        const startTime = Date.now();

        // Initial Progress State
        setUploadProgress({
            fileName: file.name,
            current: 0,
            total: chunks.length,
            startTime
        });

        // Execute in batches of 100 (API limit)
        const BATCH_SIZE = 100;
        for (let j = 0; j < chunks.length; j += BATCH_SIZE) {
            // Yield to main thread
            await new Promise(resolve => setTimeout(resolve, 0));

            const batchChunks = chunks.slice(j, j + BATCH_SIZE);
            
            try {
                // Use embedContent with multiple contents
                const batchResult = await ai.models.embedContent({
                    model: embeddingModelName,
                    contents: batchChunks.map(c => ({ parts: [{ text: c }] })),
                    config: {
                        taskType: 'RETRIEVAL_DOCUMENT',
                        title: file.name
                    }
                });
                
                const embeddings = batchResult.embeddings;

                // Save documents with embeddings
                for (let k = 0; k < batchChunks.length; k++) {
                    const embedding = embeddings?.[k]?.values;
                    const chunkContent = batchChunks[k];
                    await addDocument({
                        id: crypto.randomUUID(),
                        agentId: currentAgentId, // Tag with current agent
                        title: `${file.name} (Part ${j + k + 1}/${chunks.length})`,
                        content: chunkContent,
                        embedding: embedding,
                        timestamp: Date.now()
                    });
                }
            } catch(err) {
                console.error("Batch embedding failed, saving without vectors", err);
                // Fallback: Save without embeddings
                for (let k = 0; k < batchChunks.length; k++) {
                    const chunkContent = batchChunks[k];
                    await addDocument({
                         id: crypto.randomUUID(),
                         agentId: currentAgentId,
                         title: `${file.name} (Part ${j + k + 1}/${chunks.length})`,
                         content: chunkContent,
                         timestamp: Date.now()
                    });
                }
            }

            // Update Progress
            setUploadProgress(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    current: Math.min(chunks.length, j + batchChunks.length)
                };
            });
        }
      }

      await fetchDocs();
      onUpdate();
    } catch (err) {
      console.error("Upload failed", err);
      alert("Failed to upload files.");
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

    try {
        const text = await file.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseError) {
            throw new Error("Invalid JSON file.");
        }

        if (!Array.isArray(data)) {
            throw new Error("Invalid LorePack format: Expected an array of documents.");
        }

        const valid = data.every(d => d.id && d.title && d.content);
        if(!valid) {
             throw new Error("Invalid LorePack format: Missing required fields (id, title, content) in some documents.");
        }

        // Stats
        const total = data.length;
        const withVectors = data.filter((d: any) => d.embedding && Array.isArray(d.embedding)).length;
        const agents = Array.from(new Set(data.map((d: any) => d.agentId).filter(Boolean))) as string[];
        const avgContentLength = Math.round(data.reduce((acc, curr) => acc + (curr.content?.length || 0), 0) / total);

        setImportStats({
            total,
            withVectors,
            agents,
            avgContentLength
        });
        setPendingImportData(data);

    } catch (err: any) {
        console.error("LorePack verification failed", err);
        alert(`Failed to verify LorePack: ${err.message}`);
        if(importInputRef.current) importInputRef.current.value = '';
    } finally {
        setIsProcessing(false);
    }
  };

  const executeImport = async () => {
      if (!pendingImportData) return;

      setIsProcessing(true);
      try {
        // Force all imported docs to belong to the current agent
        const taggedData = pendingImportData.map((d: KnowledgeDoc) => ({
            ...d,
            agentId: currentAgentId // Enforce current agent ownership
        }));

        await bulkAddDocuments(taggedData);
        await fetchDocs();
        onUpdate();
        
        // Reset
        setPendingImportData(null);
        setImportStats(null);
        if(importInputRef.current) importInputRef.current.value = '';
        
        alert(`Successfully imported ${taggedData.length} documents into ${currentAgentId}'s knowledge base.`);
      } catch (err: any) {
        console.error("LorePack import execution failed", err);
        alert(`Failed to commit import: ${err.message}`);
      } finally {
        setIsProcessing(false);
      }
  };

  const cancelImport = () => {
    setPendingImportData(null);
    setImportStats(null);
    if(importInputRef.current) importInputRef.current.value = '';
  };

  const handleDelete = async (id: string) => {
    await deleteDocument(id);
    await fetchDocs();
    onUpdate();
  };
  
  const handlePurgeAll = async () => {
      const confirmFirst = window.confirm(`WARNING: You are about to DELETE ALL DOCUMENTS for ${currentAgentId}.`);
      if (!confirmFirst) return;
      
      const confirmFinal = window.confirm("FINAL WARNING: This action is irreversible. Are you sure?");
      if (!confirmFinal) return;

      setIsProcessing(true);
      try {
          await deleteDocumentsByAgentId(currentAgentId);
          await fetchDocs();
          onUpdate();
          alert(`Database purged for ${currentAgentId}.`);
      } catch (e) {
          console.error("Failed to purge db", e);
          alert("Failed to purge database.");
      } finally {
          setIsProcessing(false);
      }
  };

  const handleExport = () => {
    const dataToExport = filteredDocs; // Only exports current agent's docs
    if (dataToExport.length === 0) {
      alert("No documents to export for this agent.");
      return;
    }
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `LorePack_${currentAgentId}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredDocs = docs.filter(doc => 
    doc.title.toLowerCase().includes(filterQuery.toLowerCase()) || 
    doc.content.toLowerCase().includes(filterQuery.toLowerCase())
  );

  // Pagination Logic
  const totalPages = Math.ceil(filteredDocs.length / ITEMS_PER_PAGE);
  const paginatedDocs = filteredDocs.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const calculateETA = () => {
      if (!uploadProgress || uploadProgress.current === 0) return 'Calculating...';
      const elapsed = Date.now() - uploadProgress.startTime;
      const speed = uploadProgress.current / elapsed; // chunks per ms
      const remaining = uploadProgress.total - uploadProgress.current;
      const etaMs = remaining / speed;
      return `${Math.ceil(etaMs / 1000)}s remaining`;
  };

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
        
        {/* Header */}
        <div className="section-header" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
             <span className="section-header-title" style={{ fontSize: '1.25rem' }}>KNOWLEDGE DATABASE ({currentAgentId})</span>
          </div>
          <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* Upload Section */}
          <div className="flex-col">
            <span className="section-header-title">INGEST DOCUMENTS (FOR {currentAgentId})</span>
            <label className="btn-file-input">
              <input 
                type="file" 
                accept=".txt,.md" 
                onChange={handleFileUpload} 
                ref={fileInputRef}
                className="hidden" 
                disabled={isProcessing}
                multiple
              />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#a3a3a3' }}>
                  {isProcessing && uploadProgress ? 'PROCESSING...' : 'DROP .TXT / .MD FILES'}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#666' }}>Auto-chunking & Vector Embedding</span>
              </div>
            </label>

            {/* Progress Bar */}
            {uploadProgress && (
                <div className="flex-col" style={{ gap: '0.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#a3a3a3', fontFamily: 'monospace' }}>
                        <span>{uploadProgress.fileName}</span>
                        <span>{uploadProgress.current}/{uploadProgress.total} Vectors</span>
                    </div>
                    <div style={{ width: '100%', height: '4px', background: '#333', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ 
                            width: `${(uploadProgress.current / uploadProgress.total) * 100}%`, 
                            height: '100%', 
                            background: '#fff', 
                            transition: 'width 0.3s ease-out' 
                        }} />
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '0.7rem', color: '#666' }}>
                        ETA: {calculateETA()}
                    </div>
                </div>
            )}
          </div>
          
           {/* Verify & Import Section */}
           {importStats && (
              <div className="section-panel" style={{ borderColor: '#666' }}>
                  <div className="section-header" style={{ borderBottomColor: '#666' }}>
                      <span className="section-header-title" style={{color: '#fff'}}>VERIFY LOREPACK JSON</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.75rem', marginBottom: '1rem', color: '#ccc' }}>
                      <div>DOCUMENTS: <span style={{color: '#fff', fontWeight: 'bold'}}>{importStats.total}</span></div>
                      <div>EMBEDDINGS: <span style={{color: importStats.withVectors === importStats.total ? '#4ade80' : '#f87171', fontWeight: 'bold'}}>{importStats.withVectors} / {importStats.total}</span></div>
                      <div style={{gridColumn: 'span 2'}}>ORIGIN AGENTS: <span style={{color: '#fff'}}>{importStats.agents.join(', ') || 'None'}</span></div>
                      <div style={{gridColumn: 'span 2'}}>AVG SIZE: <span style={{color: '#fff'}}>{importStats.avgContentLength} chars</span></div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={executeImport} className="btn btn-ingest" disabled={isProcessing}>
                          CONFIRM IMPORT TO {currentAgentId}
                      </button>
                      <button onClick={cancelImport} className="btn btn-secondary">
                          CANCEL
                      </button>
                  </div>
              </div>
           )}

          {/* List */}
          <div className="flex-col">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <span className="section-header-title">STORED VECTORS ({filteredDocs.length})</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                     <label className="btn btn-secondary" style={{ padding: '0.4rem 0.6rem', fontSize: '0.7rem', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                        {importStats ? 'VERIFYING...' : 'IMPORT LOREPACK (JSON)'}
                        <input 
                            type="file" 
                            accept=".json" 
                            onChange={handleSelectLorePack}
                            ref={importInputRef}
                            className="hidden" 
                            disabled={isProcessing}
                        />
                    </label>
                    <button 
                        onClick={handleExport}
                        disabled={filteredDocs.length === 0}
                        className="btn btn-secondary"
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.7rem' }}
                    >
                        EXPORT LOREPACK (JSON)
                    </button>
                </div>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem' }}>
                <button 
                    onClick={handlePurgeAll}
                    className="btn btn-danger"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.6rem' }}
                    disabled={isProcessing}
                >
                    PURGE CURRENT AGENT DATA
                </button>
            </div>

            <div style={{ position: 'relative' }}>
                <input 
                    type="text"
                    placeholder="Filter documents..."
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    className="form-input"
                />
            </div>
            
            <div className="flex-col" style={{ gap: '0.5rem' }}>
            {paginatedDocs.length === 0 ? (
              <div className="section-panel" style={{ textAlign: 'center', padding: '2rem' }}>
                <p style={{ color: '#666', fontSize: '0.75rem' }}>
                    {docs.length === 0 ? "DATABASE EMPTY FOR THIS AGENT" : "NO MATCHES"}
                </p>
              </div>
            ) : (
                paginatedDocs.map((doc) => (
                <div key={doc.id} className="section-panel" style={{ padding: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                         <span style={{ fontWeight: 'bold', fontSize: '0.75rem', color: '#eeeeee' }}>{doc.title}</span>
                         {doc.embedding && <span style={{ fontSize: '0.6rem', background: '#222', padding: '2px 4px', borderRadius: '2px', color: '#666' }}>VEC</span>}
                    </div>
                    <button 
                      onClick={() => handleDelete(doc.id)}
                      style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.75rem' }}
                      title="Delete"
                    >
                      [X]
                    </button>
                  </div>
                  <p style={{ color: '#888', fontSize: '0.7rem', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.content}</p>
                </div>
              ))
            )}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.5rem' }}
                    >
                        &lt;
                    </button>
                    <span style={{ alignSelf: 'center', fontSize: '0.75rem', color: '#666' }}>
                        PAGE {currentPage} OF {totalPages}
                    </span>
                    <button 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.5rem' }}
                    >
                        &gt;
                    </button>
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeManager;
