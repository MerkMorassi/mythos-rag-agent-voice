
import React, { useEffect, useRef, useState } from 'react';
import { GraphNode, GraphEdge } from '../types';
import { getAllGraphNodes, getGraphEdges } from '../services/db';

interface GraphVisualizerProps {
    isOpen: boolean;
    onClose: () => void;
}

// Simple vector math
interface Point { x: number; y: number; }
interface SimulationNode extends GraphNode {
    x: number;
    y: number;
    vx: number;
    vy: number;
}

const COLOR_MAP: Record<string, string> = {
    'PERSON': '#38bdf8', // Cyan
    'LOCATION': '#a78bfa', // Purple
    'CONCEPT': '#facc15', // Gold
    'EVENT': '#f87171', // Red
    'DEFAULT': '#9ca3af' // Grey
};

export const GraphVisualizer: React.FC<GraphVisualizerProps> = ({ isOpen, onClose }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [nodes, setNodes] = useState<SimulationNode[]>([]);
    const [edges, setEdges] = useState<GraphEdge[]>([]);
    const [stats, setStats] = useState({ nodes: 0, edges: 0 });
    
    // Size state for responsiveness
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    
    // Interactive State
    const [hoveredNode, setHoveredNode] = useState<SimulationNode | null>(null);
    const draggingRef = useRef<SimulationNode | null>(null);
    const offsetRef = useRef<Point>({ x: 0, y: 0 }); // Pan offset
    const zoomRef = useRef<number>(1);
    const animationRef = useRef<number>(0);

    // Resize Handler
    useEffect(() => {
        if (!containerRef.current) return;

        const updateSize = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                });
            }
        };

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(updateSize);
        });
        
        resizeObserver.observe(containerRef.current);
        updateSize(); // Initial call

        return () => resizeObserver.disconnect();
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) loadGraph();
        return () => cancelAnimationFrame(animationRef.current);
    }, [isOpen]);

    const loadGraph = async () => {
        const rawNodes = await getAllGraphNodes();
        const rawEdges = await getGraphEdges();
        
        // Initialize positions randomly but centered
        const simNodes: SimulationNode[] = rawNodes.map(n => ({
            ...n,
            x: (Math.random() - 0.5) * 800,
            y: (Math.random() - 0.5) * 600,
            vx: 0,
            vy: 0
        }));

        setNodes(simNodes);
        setEdges(rawEdges);
        setStats({ nodes: simNodes.length, edges: rawEdges.length });
    };

    // --- PHYSICS ENGINE ---
    const updatePhysics = () => {
        const REPULSION = 8000;
        const ATTRACTION = 0.05; // Spring strength
        const CENTER_GRAVITY = 0.01;
        const DAMPING = 0.85; // Friction
        const MAX_VELOCITY = 10;

        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            if (a === draggingRef.current) continue; // Mouse holds it still

            let fx = 0, fy = 0;

            // 1. Repulsion (Nodes push apart)
            for (let j = 0; j < nodes.length; j++) {
                if (i === j) continue;
                const b = nodes[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const distSq = dx*dx + dy*dy + 0.1; // Avoid div0
                const force = REPULSION / distSq;
                const dist = Math.sqrt(distSq);
                fx += (dx / dist) * force;
                fy += (dy / dist) * force;
            }

            // 2. Center Gravity (Pull to 0,0)
            fx -= a.x * CENTER_GRAVITY;
            fy -= a.y * CENTER_GRAVITY;

            // 3. Edges (Springs)
            // Naive loop: find connected edges
            
            a.vx = (a.vx + fx) * DAMPING;
            a.vy = (a.vy + fy) * DAMPING;
            
            // Cap velocity
            const vMag = Math.sqrt(a.vx*a.vx + a.vy*a.vy);
            if (vMag > MAX_VELOCITY) {
                a.vx = (a.vx / vMag) * MAX_VELOCITY;
                a.vy = (a.vy / vMag) * MAX_VELOCITY;
            }

            a.x += a.vx;
            a.y += a.vy;
        }

        // Apply Edge Attraction (Iterate Edges once)
        edges.forEach(e => {
            const source = nodes.find(n => n.id === e.source);
            const target = nodes.find(n => n.id === e.target);
            if (source && target) {
                const dx = target.x - source.x;
                const dy = target.y - source.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                // Spring force
                const force = (dist - 100) * ATTRACTION; // 100 is resting length
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;

                if (source !== draggingRef.current) {
                    source.vx += fx;
                    source.vy += fy;
                }
                if (target !== draggingRef.current) {
                    target.vx -= fx;
                    target.vy -= fy;
                }
            }
        });
    };

    const draw = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        updatePhysics();

        // Clear
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Transform (Pan/Zoom)
        ctx.save();
        ctx.translate(canvas.width / 2 + offsetRef.current.x, canvas.height / 2 + offsetRef.current.y);
        ctx.scale(zoomRef.current, zoomRef.current);

        // Draw Edges
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        edges.forEach(e => {
            const source = nodes.find(n => n.id === e.source);
            const target = nodes.find(n => n.id === e.target);
            if (source && target) {
                ctx.moveTo(source.x, source.y);
                ctx.lineTo(target.x, target.y);
            }
        });
        ctx.stroke();

        // Draw Nodes
        nodes.forEach(n => {
            const color = COLOR_MAP[n.label] || COLOR_MAP.DEFAULT;
            const size = n === hoveredNode ? 8 : 4;
            
            // Glow
            if (n === hoveredNode) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = color;
            } else {
                ctx.shadowBlur = 0;
            }

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
            ctx.fill();

            // Labels (Show if zoomed in or hovered or important)
            if (zoomRef.current > 0.8 || n === hoveredNode) {
                ctx.fillStyle = '#eee';
                ctx.font = '10px monospace';
                ctx.fillText(n.name, n.x + 8, n.y + 3);
            }
        });

        ctx.restore();
        animationRef.current = requestAnimationFrame(draw);
    };

    useEffect(() => {
        if (isOpen && dimensions.width > 0) {
            animationRef.current = requestAnimationFrame(draw);
        }
        return () => cancelAnimationFrame(animationRef.current);
    }, [isOpen, nodes, edges, dimensions]);

    // --- INTERACTION HANDLERS ---
    
    const getCanvasCoords = (e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        // Convert screen pixels to transformed world space
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        
        // Apply inverse transform
        const x = (screenX - canvas.width/2 - offsetRef.current.x) / zoomRef.current;
        const y = (screenY - canvas.height/2 - offsetRef.current.y) / zoomRef.current;
        return { x, y };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        const { x, y } = getCanvasCoords(e);
        // Find clicked node
        const clicked = nodes.find(n => {
            const dx = n.x - x;
            const dy = n.y - y;
            return Math.sqrt(dx*dx + dy*dy) < 10 / zoomRef.current; // Tolerance
        });

        if (clicked) {
            draggingRef.current = clicked;
        } else {
            // Dragging background (Pan)
            // Implementation of panning requires state tracking, simplified here:
            // We just use native event movement for panning in handleMouseMove
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const { x, y } = getCanvasCoords(e);
        
        // Hover Logic
        if (!draggingRef.current) {
            const hovered = nodes.find(n => {
                const dx = n.x - x;
                const dy = n.y - y;
                return Math.sqrt(dx*dx + dy*dy) < 10 / zoomRef.current;
            });
            setHoveredNode(hovered || null);
            if (canvasRef.current) canvasRef.current.style.cursor = hovered ? 'pointer' : 'default';
        }

        // Node Drag
        if (draggingRef.current) {
            draggingRef.current.x = x;
            draggingRef.current.y = y;
            draggingRef.current.vx = 0;
            draggingRef.current.vy = 0;
        } 
        
        // Background Pan (if mouse down and no node) - Needs separate state for "isPanning"
        if (e.buttons === 1 && !draggingRef.current) {
            offsetRef.current.x += e.movementX;
            offsetRef.current.y += e.movementY;
        }
    };

    const handleMouseUp = () => {
        draggingRef.current = null;
    };

    const handleWheel = (e: React.WheelEvent) => {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        zoomRef.current = Math.min(Math.max(0.1, zoomRef.current * delta), 5);
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content large animate-slide-in-right" style={{ width: '100vw', maxWidth: '100vw', border: 'none', height: '100%' }}>
                
                <div className="modal-header-area" style={{ position: 'absolute', top: 0, left: 0, width: '100%', zIndex: 10, background: 'rgba(5,5,5,0.8)' }}>
                    <div className="flex-group">
                        <span className="modal-section-title" style={{ color: '#38bdf8' }}>NEURAL LATTICE VISUALIZER</span>
                        <div style={{ fontSize: '0.7rem', color: '#666' }}>
                            NODES: {stats.nodes} | EDGES: {stats.edges}
                        </div>
                    </div>
                    <button onClick={onClose} className="close-btn" title="Close">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                {/* OVERLAY HUD */}
                {hoveredNode && (
                    <div style={{ 
                        position: 'absolute', 
                        bottom: '20px', 
                        left: '20px', 
                        background: 'rgba(0,0,0,0.8)', 
                        border: `1px solid ${COLOR_MAP[hoveredNode.label] || '#fff'}`,
                        padding: '1rem',
                        borderRadius: '4px',
                        maxWidth: '300px',
                        zIndex: 20,
                        pointerEvents: 'none'
                    }}>
                        <div style={{ fontSize: '1rem', fontWeight: 'bold', color: COLOR_MAP[hoveredNode.label] }}>{hoveredNode.name}</div>
                        <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: '0.5rem' }}>{hoveredNode.label}</div>
                        <div style={{ fontSize: '0.8rem', color: '#eee' }}>{hoveredNode.description}</div>
                    </div>
                )}

                <div 
                    ref={containerRef}
                    style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: 'grab', width: '100%', height: '100%' }}
                >
                    <canvas 
                        ref={canvasRef}
                        width={dimensions.width}
                        height={dimensions.height}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        onWheel={handleWheel}
                    />
                </div>
            </div>
        </div>
    );
};
