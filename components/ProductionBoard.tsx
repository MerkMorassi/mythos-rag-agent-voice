
import React, { useState, useEffect } from 'react';
import { ProductionBoardService } from '../services/productionBoard';
import { CanonBlock, ProductionStage, ApprovalStatus } from '../types';

interface ProductionBoardProps {
    isOpen: boolean;
    onClose: () => void;
}

const STAGE_COLORS: Record<ProductionStage, string> = {
    [ProductionStage.IDEATION]: '#f472b6', // Pink
    [ProductionStage.SCRIPT]: '#60a5fa',    // Blue
    [ProductionStage.DESIGN]: '#a78bfa',    // Purple
    [ProductionStage.ART]: '#4ade80'        // Green
};

export const ProductionBoard: React.FC<ProductionBoardProps> = ({ isOpen, onClose }) => {
    const [blocks, setBlocks] = useState<CanonBlock[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    
    // View State
    const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) refresh();
    }, [isOpen]);

    const refresh = async () => {
        setIsLoading(true);
        const data = await ProductionBoardService.getAllBlocks();
        setBlocks(data);
        setIsLoading(false);
    };

    const handleApprove = async (id: string) => {
        await ProductionBoardService.approveBlock(id);
        refresh();
    };

    const handleReject = async (id: string) => {
        const feedback = prompt("Reason for rejection?");
        if (feedback) {
            await ProductionBoardService.rejectBlock(id, feedback);
            refresh();
        }
    };

    const renderColumn = (stage: ProductionStage, title: string) => {
        const stageBlocks = blocks.filter(b => b.stage === stage);
        const color = STAGE_COLORS[stage];

        return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '250px', background: '#0a0a0a', border: `1px solid ${color}`, borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ padding: '0.5rem', background: color, color: '#000', fontWeight: 'bold', fontSize: '0.8rem', textAlign: 'center', textTransform: 'uppercase' }}>
                    {title}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {stageBlocks.length === 0 && (
                        <div style={{ fontSize: '0.7rem', color: '#666', textAlign: 'center', marginTop: '1rem' }}>No Data</div>
                    )}
                    {stageBlocks.map(block => (
                        <div 
                            key={block.id} 
                            style={{ 
                                padding: '0.5rem', 
                                background: '#111', 
                                border: '1px solid #333', 
                                borderRadius: '4px',
                                opacity: block.status === ApprovalStatus.REJECTED ? 0.5 : 1,
                                borderColor: block.status === ApprovalStatus.APPROVED ? color : (block.status === ApprovalStatus.REJECTED ? '#f87171' : '#facc15')
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#eee' }}>{block.title}</span>
                                <span style={{ fontSize: '0.6rem', padding: '1px 4px', borderRadius: '2px', background: '#222', color: '#888' }}>
                                    {block.status}
                                </span>
                            </div>
                            
                            {expandedBlockId === block.id ? (
                                <div style={{ fontSize: '0.75rem', color: '#ccc', whiteSpace: 'pre-wrap', marginBottom: '0.5rem', maxHeight: '200px', overflowY: 'auto', background: '#050505', padding: '4px' }}>
                                    {block.content}
                                </div>
                            ) : (
                                <div style={{ fontSize: '0.7rem', color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }} onClick={() => setExpandedBlockId(block.id)}>
                                    {block.content.substring(0, 50)}... (Show More)
                                </div>
                            )}

                            {block.status === ApprovalStatus.DRAFT && (
                                <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.5rem' }}>
                                    <button onClick={() => handleApprove(block.id)} className="btn btn-xs btn-cyan" style={{ flex: 1 }} title="Lock this block as Canon">APPROVE</button>
                                    <button onClick={() => handleReject(block.id)} className="btn btn-xs btn-danger" style={{ flex: 1 }} title="Reject this draft">REJECT</button>
                                </div>
                            )}
                            
                            {block.status === ApprovalStatus.REJECTED && block.feedback && (
                                <div style={{ fontSize: '0.7rem', color: '#f87171', marginTop: '0.25rem', fontStyle: 'italic' }}>
                                    "{block.feedback}"
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    if (!isOpen) {
        return (
            <button 
                onClick={onClose} 
                className="hidden"
            />
        );
    }

    return (
        <div className="modal-overlay">
            <div className="modal-content animate-slide-in-right" style={{ maxWidth: '90vw', width: '90vw' }}>
                <div className="modal-header-area">
                    <div className="flex-group">
                        <span className="modal-section-title" style={{ color: '#facc15' }}>PRODUCTION BOARD (ANIMAGENTS)</span>
                    </div>
                    <div className="flex-group">
                        <button onClick={refresh} className="btn btn-secondary btn-xs" title="Reload Canon Blocks">REFRESH</button>
                        <button onClick={onClose} className="close-btn" title="Close Board">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>

                <div className="modal-body-area" style={{ flexDirection: 'row', gap: '1rem', overflowX: 'auto', padding: '1rem' }}>
                    {renderColumn(ProductionStage.IDEATION, "1. IDEATION (Brainstorm)")}
                    {renderColumn(ProductionStage.SCRIPT, "2. SCRIPT (Scribe)")}
                    {renderColumn(ProductionStage.DESIGN, "3. DESIGN (VisDev)")}
                    {renderColumn(ProductionStage.ART, "4. ART (Lumière)")}
                </div>
            </div>
        </div>
    );
};
