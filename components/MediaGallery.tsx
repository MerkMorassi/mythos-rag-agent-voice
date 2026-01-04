
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getAllMediaAssets, saveMediaAsset, deleteMediaAsset, updateMediaAsset } from '../services/db';
import { MediaAsset } from '../types';
import { AGENTS } from '../agents';
import { NumMarkX_GenerateID } from '../patterns/NumMarkX';

interface MediaGalleryProps {
    isOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
    currentAgentId: string;
}

export const MediaGallery: React.FC<MediaGalleryProps> = ({ isOpen, onOpen, onClose, currentAgentId }) => {
    const [assets, setAssets] = useState<MediaAsset[]>([]);
    const [filteredAssets, setFilteredAssets] = useState<MediaAsset[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedAgentId, setSelectedAgentId] = useState<string>(currentAgentId || 'ALL');

    // Lightbox & Upload State
    const [viewingAsset, setViewingAsset] = useState<MediaAsset | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editPrompt, setEditPrompt] = useState('');
    const [editTags, setEditTags] = useState('');
    
    // Slideshow State
    const [isPlaying, setIsPlaying] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setSelectedAgentId(currentAgentId || 'ALL');
            refresh();
        }
    }, [isOpen, currentAgentId]);

    // ... (keeping internal logic same) ...
    useEffect(() => {
        if (selectedAgentId === 'ALL') {
            setFilteredAssets(assets);
        } else {
            setFilteredAssets(assets.filter(a => a.agentId === selectedAgentId));
        }
    }, [selectedAgentId, assets]);

    // Slideshow Effect
    useEffect(() => {
        let interval: number;
        if (isPlaying && viewingAsset) {
            interval = window.setInterval(() => {
                handleNext(true); // true = loop enabled
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [isPlaying, viewingAsset, filteredAssets]);

    // Keyboard Navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!viewingAsset) return;
            if (e.key === 'ArrowRight') handleNext();
            if (e.key === 'ArrowLeft') handlePrev();
            if (e.key === 'Escape') setViewingAsset(null);
            if (e.key === ' ') {
                e.preventDefault();
                setIsPlaying(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [viewingAsset, filteredAssets]);

    const refresh = async () => {
        setIsLoading(true);
        try {
            const dbAssets = await getAllMediaAssets();
            setAssets(dbAssets);
        } catch (e) {
            console.error("Failed to load media", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileUpload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setIsLoading(true);
        try {
            const newAssets: MediaAsset[] = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                
                let type: MediaAsset['type'] = 'image';
                const lowerName = file.name.toLowerCase();
                
                if (file.type.includes('pdf')) type = 'pdf';
                else if (file.type.includes('video')) type = 'video';
                else if (file.type.includes('audio')) type = 'audio';
                else if (
                    file.type.includes('text') || 
                    lowerName.endsWith('.md') || 
                    lowerName.endsWith('.json') ||
                    lowerName.endsWith('.js') ||
                    lowerName.endsWith('.ts') ||
                    lowerName.endsWith('.tsx') ||
                    lowerName.endsWith('.jsx') ||
                    lowerName.endsWith('.py') ||
                    lowerName.endsWith('.html') ||
                    lowerName.endsWith('.css') ||
                    lowerName.endsWith('.sh') ||
                    lowerName.endsWith('.yml') ||
                    lowerName.endsWith('.yaml')
                ) {
                    type = 'text';
                }
                else if (!file.type.startsWith('image/')) continue; 

                await new Promise<void>((resolve) => {
                    const reader = new FileReader();
                    
                    reader.onload = async (e) => {
                        const res = e.target?.result as string;
                        let data = res;
                        
                        if ((type === 'image' || type === 'pdf' || type === 'video' || type === 'audio') && res.includes('base64,')) {
                            data = res.split(',')[1];
                        }

                        const asset: MediaAsset = {
                            id: NumMarkX_GenerateID(type === 'image' ? 'IMG' : (type === 'video' ? 'VID' : (type === 'audio' ? 'AUD' : (type === 'text' ? 'CODE' : 'DOC')))),
                            type: type,
                            data: data,
                            prompt: file.name,
                            agentId: selectedAgentId === 'ALL' ? 'USER' : selectedAgentId,
                            timestamp: Date.now(),
                            tags: ['UPLOAD', 'MANUAL', type.toUpperCase()]
                        };
                        await saveMediaAsset(asset);
                        newAssets.push(asset);
                        resolve();
                    };

                    if (type === 'text') {
                        reader.readAsText(file);
                    } else {
                        reader.readAsDataURL(file);
                    }
                });
            }
            // Optimistic Update
            setAssets(prev => [...newAssets, ...prev]);
        } catch (e) {
            console.error("Upload failed", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        await handleFileUpload(e.dataTransfer.files);
    };

    const handleDelete = async (id: string, e?: React.MouseEvent) => {
        if(e) e.stopPropagation();
        if(!window.confirm("Delete this media asset permanently?")) return;
        
        try {
            await deleteMediaAsset(id);
            setAssets(prev => prev.filter(a => a.id !== id));
            if (viewingAsset?.id === id) setViewingAsset(null);
        } catch (err) {
            console.error("Delete failed", err);
            alert("Failed to delete asset.");
        }
    };

    const openAsset = (asset: MediaAsset) => {
        setViewingAsset(asset);
        setEditPrompt(asset.prompt);
        setEditTags(asset.tags ? asset.tags.join(', ') : '');
        setIsEditing(false);
        setIsPlaying(false);
    };

    const handleUpdateAsset = async () => {
        if (!viewingAsset) return;
        const tagsArray = editTags.split(',').map(t => t.trim()).filter(Boolean);
        const updatedAsset = { ...viewingAsset, prompt: editPrompt, tags: tagsArray };

        setViewingAsset(updatedAsset);
        setAssets(prev => prev.map(a => a.id === updatedAsset.id ? updatedAsset : a));
        setIsEditing(false);

        try {
            await updateMediaAsset(viewingAsset.id, {
                prompt: editPrompt,
                tags: tagsArray
            });
        } catch(e) {
            console.error("Failed to save update", e);
            refresh();
        }
    };

    const getCurrentIndex = () => {
        if (!viewingAsset) return -1;
        return filteredAssets.findIndex(a => a.id === viewingAsset.id);
    };

    const handleNext = (loop = false) => {
        const idx = getCurrentIndex();
        if (idx === -1) return;
        
        if (idx < filteredAssets.length - 1) {
            setViewingAsset(filteredAssets[idx + 1]);
        } else if (loop) {
            setViewingAsset(filteredAssets[0]);
        }
    };

    const handlePrev = () => {
        const idx = getCurrentIndex();
        if (idx > 0) {
            setViewingAsset(filteredAssets[idx - 1]);
        }
    };

    const renderThumbnail = (asset: MediaAsset) => {
        if (asset.type === 'image') {
            return <img 
                src={asset.data.startsWith('http') ? asset.data : `data:image/jpeg;base64,${asset.data}`} 
                alt={asset.prompt}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />;
        }
        if (asset.type === 'video') {
             return <div style={{ width: '100%', height: '100%', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                 <div style={{ position: 'absolute', inset: 0, opacity: 0.3, backgroundSize: 'cover', backgroundImage: 'linear-gradient(45deg, #111 25%, transparent 25%), linear-gradient(-45deg, #111 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #111 75%), linear-gradient(-45deg, transparent 75%, #111 75%)', backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px' }}></div>
                 <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="rgba(255,255,255,0.8)" stroke="none">
                    <path d="M8 5v14l11-7z"/>
                 </svg>
                 <span style={{ position: 'absolute', bottom: '4px', right: '4px', fontSize: '0.6rem', color: '#fff', background: 'rgba(0,0,0,0.6)', padding: '1px 3px', borderRadius: '2px' }}>VIDEO</span>
             </div>;
        }
        if (asset.type === 'audio') {
             return <div style={{ width: '100%', height: '100%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                 <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                 </svg>
                 <span style={{ position: 'absolute', bottom: '4px', right: '4px', fontSize: '0.6rem', color: '#fff', background: 'rgba(0,0,0,0.6)', padding: '1px 3px', borderRadius: '2px' }}>AUDIO</span>
             </div>;
        }
        if (asset.type === 'text') {
            return <div style={{ padding: '1rem', fontSize: '0.6rem', color: '#ccc', overflow: 'hidden', height: '100%', wordBreak: 'break-word', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                {asset.data.substring(0, 150)}...
            </div>;
        }
        if (asset.type === 'pdf') {
            return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#f87171' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                <span style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>PDF</span>
            </div>;
        }
        return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>FILE</div>;
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" style={{ zIndex: 100 }}>
            {/* LIGHTBOX OVERLAY */}
            {viewingAsset && (
                <div 
                    style={{ 
                        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.95)', 
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' 
                    }}
                    onClick={() => {
                        setViewingAsset(null);
                        setIsPlaying(false);
                    }}
                >
                    {/* Navigation Buttons */}
                    <button 
                        className="btn btn-icon btn-xl"
                        style={{ position: 'absolute', left: '2rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.5, borderColor: '#fff', color: '#fff' }}
                        onClick={(e) => { e.stopPropagation(); handlePrev(); }}
                        disabled={getCurrentIndex() <= 0}
                    >
                        ❮
                    </button>
                    <button 
                        className="btn btn-icon btn-xl"
                        style={{ position: 'absolute', right: '2rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.5, borderColor: '#fff', color: '#fff' }}
                        onClick={(e) => { e.stopPropagation(); handleNext(); }}
                        disabled={getCurrentIndex() >= filteredAssets.length - 1}
                    >
                        ❯
                    </button>

                    {/* Slideshow Control */}
                    <div 
                        style={{ position: 'absolute', top: '2rem', left: '2rem', display: 'flex', gap: '0.5rem' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <button 
                            className={`btn btn-sm ${isPlaying ? 'active-green' : 'btn-secondary'}`}
                            onClick={() => setIsPlaying(!isPlaying)}
                        >
                            {isPlaying ? 'PAUSE ⏸' : 'PLAY SLIDESHOW ▶'}
                        </button>
                        <div style={{ color: '#666', fontSize: '0.8rem', alignSelf: 'center' }}>
                            {getCurrentIndex() + 1} / {filteredAssets.length}
                        </div>
                    </div>

                    {/* Asset Render Logic ... same as before */}
                    {viewingAsset.type === 'image' && (
                        <img 
                            src={viewingAsset.data.startsWith('http') ? viewingAsset.data : `data:image/jpeg;base64,${viewingAsset.data}`} 
                            style={{ maxWidth: '90%', maxHeight: '70vh', border: '1px solid #333', boxShadow: '0 0 30px rgba(0,0,0,0.5)' }}
                            onClick={e => e.stopPropagation()}
                        />
                    )}
                    {viewingAsset.type === 'video' && (
                        <video 
                            controls
                            autoPlay={isPlaying}
                            src={viewingAsset.data.startsWith('http') ? viewingAsset.data : `data:video/mp4;base64,${viewingAsset.data}`} 
                            style={{ maxWidth: '90%', maxHeight: '70vh', border: '1px solid #333', boxShadow: '0 0 30px rgba(0,0,0,0.5)' }}
                            onClick={e => e.stopPropagation()}
                            onEnded={() => isPlaying && handleNext(true)}
                        />
                    )}
                    {viewingAsset.type === 'audio' && (
                        <div style={{ padding: '2rem', background: '#111', border: '1px solid #333', borderRadius: '8px' }} onClick={e => e.stopPropagation()}>
                            <div style={{ marginBottom: '1rem', textAlign: 'center', color: '#4ade80', fontSize: '2rem' }}>♪</div>
                            <audio 
                                controls
                                autoPlay
                                src={viewingAsset.data.startsWith('http') ? viewingAsset.data : `data:audio/wav;base64,${viewingAsset.data}`} 
                                style={{ width: '300px' }}
                                onEnded={() => isPlaying && handleNext(true)}
                            />
                        </div>
                    )}
                    {viewingAsset.type === 'text' && (
                         <div style={{ background: '#111', padding: '2rem', maxWidth: '80%', maxHeight: '70vh', overflow: 'auto', border: '1px solid #333', width: '800px' }} onClick={e => e.stopPropagation()}>
                             <pre style={{ whiteSpace: 'pre-wrap', color: '#ccc', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                                 {viewingAsset.data}
                             </pre>
                         </div>
                    )}
                    {viewingAsset.type === 'pdf' && (
                         <div style={{ background: '#111', padding: '2rem', maxWidth: '80%', maxHeight: '70vh', overflow: 'auto', border: '1px solid #333', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                             <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{marginBottom: '1rem'}}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                             <div style={{color: '#eee'}}>PDF Preview Not Available</div>
                             <div style={{color: '#666', fontSize: '0.8rem'}}>Please Download to View</div>
                         </div>
                    )}

                    {/* EDIT / VIEW PANEL */}
                    <div style={{ marginTop: '1rem', color: '#eee', textAlign: 'center', width: '100%', maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
                        
                        {isEditing ? (
                            <div className="flex-col" style={{ gap: '0.5rem', background: '#111', padding: '1rem', borderRadius: '4px', border: '1px solid #4ade80' }}>
                                <input 
                                    className="form-input" 
                                    value={editPrompt} 
                                    onChange={e => setEditPrompt(e.target.value)} 
                                    placeholder="Title / Prompt"
                                />
                                <input 
                                    className="form-input" 
                                    value={editTags} 
                                    onChange={e => setEditTags(e.target.value)} 
                                    placeholder="Tags (comma separated)"
                                />
                                <div className="flex-group">
                                    <button onClick={handleUpdateAsset} className="btn btn-primary" style={{flex: 1}}>SAVE</button>
                                    <button onClick={() => setIsEditing(false)} className="btn btn-secondary" style={{flex: 1}}>CANCEL</button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{viewingAsset.prompt}</div>
                                <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.25rem' }}>
                                    {new Date(viewingAsset.timestamp).toLocaleString()} • <span style={{ color: '#a78bfa' }}>{viewingAsset.agentId}</span> • {viewingAsset.type.toUpperCase()}
                                </div>
                                {viewingAsset.tags && (
                                     <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                                        {viewingAsset.tags.map(t => (
                                            <span key={t} style={{ fontSize: '0.7rem', color: '#e879f9', border: '1px solid #e879f9', padding: '2px 6px', borderRadius: '4px' }}>{t}</span>
                                        ))}
                                     </div>
                                )}
                                <div className="flex-group" style={{ marginTop: '1rem', justifyContent: 'center' }}>
                                    <button onClick={() => setIsEditing(true)} className="btn btn-secondary btn-sm">EDIT METADATA</button>
                                    <button onClick={(e) => handleDelete(viewingAsset.id, e)} className="btn btn-danger btn-sm">DELETE</button>
                                    <a 
                                        href={viewingAsset.data.startsWith('http') ? viewingAsset.data : (viewingAsset.type === 'text' ? `data:text/plain;charset=utf-8,${encodeURIComponent(viewingAsset.data)}` : (viewingAsset.type === 'pdf' ? `data:application/pdf;base64,${viewingAsset.data}` : (viewingAsset.type === 'audio' ? `data:audio/wav;base64,${viewingAsset.data}` : `data:application/octet-stream;base64,${viewingAsset.data}`)))} 
                                        download={viewingAsset.prompt}
                                        className="btn btn-secondary btn-sm"
                                        onClick={e => e.stopPropagation()}
                                    >
                                        DOWNLOAD
                                    </a>
                                </div>
                            </>
                        )}
                    </div>

                    <button 
                        onClick={() => { setViewingAsset(null); setIsPlaying(false); }}
                        className="btn btn-icon btn-lg"
                        style={{ position: 'absolute', top: '2rem', right: '2rem', borderColor: '#fff', color: '#fff' }}
                    >
                        ✕
                    </button>
                </div>
            )}

            <div className="modal-content animate-slide-in-right" style={{ maxWidth: '800px', width: '90%' }}>
                
                <div className="modal-header-area">
                    <div className="flex-group">
                        <span className="modal-section-title" style={{ color: '#e879f9' }}>MEDIA GALLERY</span>
                    </div>
                    <button onClick={onClose} className="close-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <div className="modal-body-area">
                    
                    {/* DROP ZONE */}
                    <label 
                        className={`btn-file-input ${isDragging ? 'active-green' : ''}`}
                        style={{ borderColor: isDragging ? '#e879f9' : '#333', color: isDragging ? '#e879f9' : '#888', marginBottom: '1rem' }}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                        onDrop={handleDrop}
                    >
                        <input 
                            type="file" 
                            accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.html,.css,.xml,.yaml,.yml,.sh" 
                            multiple
                            className="hidden" 
                            ref={fileInputRef}
                            onChange={(e) => handleFileUpload(e.target.files)}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>
                                {isDragging ? 'RELEASE TO UPLOAD' : 'DROP FILES TO IMPORT'}
                            </span>
                            <span style={{ fontSize: '0.7rem' }}>Images, Videos, Audio, PDF, Text, Code</span>
                        </div>
                    </label>

                    <div className="flex-group" style={{ marginBottom: '1rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: '#eee' }}>FILTER:</span>
                        <select 
                            value={selectedAgentId}
                            onChange={(e) => setSelectedAgentId(e.target.value)}
                            className="form-select"
                            style={{ width: 'auto', flex: 1 }}
                        >
                            <option value="ALL">ALL AGENTS</option>
                            <option value="USER">USER UPLOADS</option>
                            {AGENTS.map(a => (
                                <option key={a.id} value={a.id}>{a.handle.toUpperCase()}</option>
                            ))}
                        </select>
                        <button onClick={refresh} className="btn btn-secondary btn-sm">REFRESH</button>
                    </div>

                    {isLoading && <div className="empty-state">LOADING...</div>}
                    
                    {!isLoading && filteredAssets.length === 0 && (
                        <div className="empty-state">NO ASSETS FOUND.</div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
                        {filteredAssets.map(asset => (
                            <div 
                                key={asset.id} 
                                className="section-panel" 
                                style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: 'pointer', transition: 'transform 0.2s', borderColor: asset.agentId === 'USER' ? '#333' : '#a78bfa' }}
                                onClick={() => openAsset(asset)}
                            >
                                <div style={{ height: '140px', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                                    {renderThumbnail(asset)}
                                    <div className="panel-overlay top-left" style={{ padding: '4px' }}>
                                        <span className="overlay-label" style={{ fontSize: '0.6rem', color: '#e879f9', borderColor: '#e879f9' }}>
                                            {asset.type.toUpperCase()}
                                        </span>
                                    </div>
                                    <button 
                                        onClick={(e) => handleDelete(asset.id, e)}
                                        className="btn btn-danger btn-xs"
                                        style={{ position: 'absolute', top: '4px', right: '4px', borderRadius: '50%', padding: 0, width: '20px', height: '20px', lineHeight: '20px', fontSize: '12px' }}
                                        title="Delete Asset"
                                    >
                                        ×
                                    </button>
                                </div>
                                <div style={{ padding: '0.5rem', background: '#111', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <div style={{ fontSize: '0.7rem', color: '#eee', maxHeight: '3rem', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 'bold' }}>
                                        {asset.prompt}
                                    </div>
                                    <div style={{ fontSize: '0.65rem', color: '#a78bfa', textTransform: 'uppercase' }}>
                                        {asset.agentId}
                                    </div>
                                    
                                    {asset.tags && asset.tags.length > 0 && (
                                        <div style={{ display: 'flex', gap: '0.25rem', overflow: 'hidden', height: '1.2rem' }}>
                                            {asset.tags.slice(0, 3).map(t => (
                                                <span key={t} style={{ fontSize: '0.6rem', color: '#888', background: '#222', padding: '0 4px', borderRadius: '2px', whiteSpace: 'nowrap' }}>{t}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
