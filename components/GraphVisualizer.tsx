import React, { useEffect, useRef, useState } from 'react';
import { GraphNode, GraphEdge } from '../types';
import { getGraphNodesByAgent, getGraphEdges } from '../services/db';

interface SimulationNode extends GraphNode {
    x: number;
    y: number;
    vx: number;
    vy: number;
}

// Optimized Edge holding direct references
interface SimulationEdge {
    source: SimulationNode;
    target: SimulationNode;
}

const COLOR_MAP: Record<string, string> = {
    'PERSON': '#38bdf8', // Cyan
    'LOCATION': '#a78bfa', // Purple
    'CONCEPT': '#facc15', // Gold
    'EVENT': '#f87171', // Red
    'DEFAULT': '#9ca3af' // Grey
};

interface GraphVisualizerProps {
    currentAgentId: string;
}

export const GraphVisualizer: React.FC<GraphVisualizerProps> = ({ currentAgentId }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Use Refs for simulation state to decouple from React render cycle
    const nodesRef = useRef<SimulationNode[]>([]);
    const edgesRef = useRef<SimulationEdge[]>([]);
    
    const [stats, setStats] = useState({ nodes: 0, edges: 0 });
    const [hoveredNode, setHoveredNode] = useState<SimulationNode | null>(null);
    
    const draggingRef = useRef<SimulationNode | null>(null);
    const offsetRef = useRef({ x: 0, y: 0 });
    const zoomRef = useRef(0.8);
    const animationRef = useRef<number>(0);
    const isRunningRef = useRef(false);

    // Re-load graph when agent changes
    useEffect(() => {
        loadGraph();
        isRunningRef.current = true;
        animationRef.current = requestAnimationFrame(draw);
        
        return () => {
            isRunningRef.current = false;
            cancelAnimationFrame(animationRef.current);
        };
    }, [currentAgentId]);

    const loadGraph = async () => {
        const rawNodes = await getGraphNodesByAgent(currentAgentId);
        const allRawEdges = await getGraphEdges();
        // Filter edges for the current agent
        const rawEdges = allRawEdges.filter(edge => edge.agentId === currentAgentId);
        
        initSimulation(rawNodes, rawEdges);
    };

    const initSimulation = (rawNodes: GraphNode[], rawEdges: GraphEdge[]) => {
        // 1. Initialize Nodes with random positions
        const simNodes: SimulationNode[] = rawNodes.map(n => ({
            ...n,
            x: (Math.random() - 0.5) * 1000,
            y: (Math.random() - 0.5) * 800,
            vx: 0,
            vy: 0
        }));

        // 2. Pre-resolve Edges to Node References (O(1) lookup during physics)
        const nodeMap = new Map(simNodes.map(n => [n.id, n]));
        const simEdges: SimulationEdge[] = [];
        
        rawEdges.forEach(e => {
            const source = nodeMap.get(e.source);
            const target = nodeMap.get(e.target);
            if (source && target) {
                simEdges.push({ source, target });
            }
        });

        nodesRef.current = simNodes;
        edgesRef.current = simEdges;
        
        setStats({ nodes: simNodes.length, edges: simEdges.length });
        
        // Reset View
        offsetRef.current = { x: 0, y: 0 };
        zoomRef.current = 0.8;
    };

    const updatePhysics = () => {
        const nodes = nodesRef.current;
        const edges = edgesRef.current;
        
        const REPULSION = 5000;
        const ATTRACTION = 0.02; 
        const CENTER_GRAVITY = 0.005;
        const DAMPING = 0.85; 
        const MAX_VELOCITY = 15;

        // 1. Repulsion (N^2 optimized checks could go here, but simple N^2 is fine for <500 nodes)
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            if (a === draggingRef.current) continue;

            let fx = 0, fy = 0;

            for (let j = 0; j < nodes.length; j++) {
                if (i === j) continue;
                const b = nodes[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                let distSq = dx*dx + dy*dy;
                if (distSq < 0.1) distSq = 0.1; // Prevent Singularity
                
                const dist = Math.sqrt(distSq);
                const force = REPULSION / distSq;
                
                fx += (dx / dist) * force;
                fy += (dy / dist) * force;
            }

            // 2. Center Gravity
            fx -= a.x * CENTER_GRAVITY;
            fy -= a.y * CENTER_GRAVITY;

            a.vx = (a.vx + fx) * DAMPING;
            a.vy = (a.vy + fy) * DAMPING;
        }

        // 3. Edges (Springs)
        for (const e of edges) {
            const { source, target } = e;
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            // Hooke's Law with resting length
            const resting = 150;
            const force = (dist - resting) * ATTRACTION;
            
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

        // 4. Update Positions & Cap Velocity
        for (const n of nodes) {
            if (n === draggingRef.current) continue;
            
            const vMag = Math.sqrt(n.vx*n.vx + n.vy*n.vy);
            if (vMag > MAX_VELOCITY) {
                n.vx = (n.vx / vMag) * MAX_VELOCITY;
                n.vy = (n.vy / vMag) * MAX_VELOCITY;
            }
            
            n.x += n.vx;
            n.y += n.vy;
        }
    };

    const draw = () => {
        if (!canvasRef.current || !containerRef.current) return;
        
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Resize Canvas to Match Container exactly
        const { clientWidth, clientHeight } = containerRef.current;
        if (canvas.width !== clientWidth || canvas.height !== clientHeight) {
            canvas.width = clientWidth;
            canvas.height = clientHeight;
        }

        updatePhysics();

        const nodes = nodesRef.current;
        const edges = edgesRef.current;

        // Clear
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Transform
        ctx.save();
        ctx.translate(canvas.width / 2 + offsetRef.current.x, canvas.height / 2 + offsetRef.current.y);
        ctx.scale(zoomRef.current, zoomRef.current);

        // Draw Edges
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const e of edges) {
            ctx.moveTo(e.source.x, e.source.y);
            ctx.lineTo(e.target.x, e.target.y);
        }
        ctx.stroke();

        // Draw Nodes
        for (const n of nodes) {
            const color = COLOR_MAP[n.label] || COLOR_MAP.DEFAULT;
            const isHovered = n.id === hoveredNode?.id; // Check ID stability
            const size = isHovered ? 12 : 6;

            // Glow
            if (isHovered) {
                ctx.shadowBlur = 20;
                ctx.shadowColor = color;
            } else {
                ctx.shadowBlur = 0;
            }

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
            ctx.fill();

            // Labels
            if (zoomRef.current > 0.6 || isHovered) {
                ctx.fillStyle = '#eee';
                ctx.font = isHovered ? 'bold 14px monospace' : '10px monospace';
                ctx.fillText(n.name, n.x + size + 4, n.y + 4);
            }
        }

        ctx.restore();

        if (isRunningRef.current) {
            animationRef.current = requestAnimationFrame(draw);
        }
    };

    // --- INTERACTION ---

    const getCanvasCoords = (e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - canvas.width/2 - offsetRef.current.x) / zoomRef.current;
        const y = (e.clientY - rect.top - canvas.height/2 - offsetRef.current.y) / zoomRef.current;
        return { x, y };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        const { x, y } = getCanvasCoords(e);
        // Find Node
        const nodes = nodesRef.current;
        let clicked = null;
        // Search in reverse draw order (top first)
        for (let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i];
            const dist = Math.sqrt((n.x - x)**2 + (n.y - y)**2);
            if (dist < 20 / zoomRef.current) {
                clicked = n;
                break;
            }
        }

        if (clicked) {
            draggingRef.current = clicked;
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const { x, y } = getCanvasCoords(e);
        
        if (draggingRef.current) {
            draggingRef.current.x = x;
            draggingRef.current.y = y;
            draggingRef.current.vx = 0;
            draggingRef.current.vy = 0;
        } else if (e.buttons === 1) {
            // Pan
            offsetRef.current.x += e.movementX;
            offsetRef.current.y += e.movementY;
        } else {
            // Hover check
            const nodes = nodesRef.current;
            let found = null;
            for (let i = nodes.length - 1; i >= 0; i--) {
                const n = nodes[i];
                const dist = Math.sqrt((n.x - x)**2 + (n.y - y)**2);
                if (dist < 15 / zoomRef.current) {
                    found = n;
                    break;
                }
            }
            setHoveredNode(found);
            if (canvasRef.current) {
                canvasRef.current.style.cursor = found ? 'pointer' : (e.buttons === 1 ? 'grabbing' : 'grab');
            }
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        zoomRef.current = Math.min(Math.max(0.1, zoomRef.current * delta), 5);
    };

    return (
        <div style={{ 
            position: 'relative',
            width: '100%', 
            height: '100%', 
            display: 'flex',
            flexDirection: 'column',
            background: '#050505'
        }}>
            
            {/* Header / HUD */}
            <div style={{ 
                position: 'absolute', 
                top: 0, 
                left: 0, 
                width: '100%', 
                padding: '1rem', 
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.9), transparent)', 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                zIndex: 10,
                pointerEvents: 'none'
            }}>
                <div style={{ pointerEvents: 'auto' }}>
                    <div style={{ color: '#38bdf8', fontWeight: 'bold', fontSize: '1.2rem', letterSpacing: '2px', textShadow: '0 0 10px rgba(56, 189, 248, 0.5)' }}>
                        NEURAL LATTICE
                    </div>
                    <div style={{ color: '#666', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                        NODES: {stats.nodes} • EDGES: {stats.edges} • ZOOM: {Math.round(zoomRef.current * 100)}%
                    </div>
                </div>
            </div>

            {/* Info Panel for Hover */}
            {hoveredNode && (
                <div style={{ 
                    position: 'absolute', 
                    bottom: '2rem', 
                    left: '2rem', 
                    maxWidth: '400px', 
                    background: 'rgba(10, 10, 10, 0.9)', 
                    border: `1px solid ${COLOR_MAP[hoveredNode.label] || '#fff'}`,
                    padding: '1.5rem',
                    borderRadius: '8px',
                    zIndex: 20,
                    backdropFilter: 'blur(4px)',
                    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                    pointerEvents: 'none'
                }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#fff', marginBottom: '0.5rem' }}>
                        {hoveredNode.name}
                    </div>
                    <div style={{ 
                        display: 'inline-block', 
                        padding: '2px 8px', 
                        borderRadius: '4px', 
                        background: COLOR_MAP[hoveredNode.label], 
                        color: '#000', 
                        fontWeight: 'bold', 
                        fontSize: '0.7rem',
                        marginBottom: '1rem'
                    }}>
                        {hoveredNode.label}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#ccc', lineHeight: '1.5' }}>
                        {hoveredNode.description}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '1rem' }}>
                        ID: {hoveredNode.id}
                    </div>
                </div>
            )}

            {/* Main Canvas Container */}
            <div 
                ref={containerRef} 
                style={{ flex: 1, width: '100%', height: '100%', cursor: 'grab', position: 'relative' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={() => draggingRef.current = null}
                onMouseLeave={() => draggingRef.current = null}
                onWheel={handleWheel}
            >
                <canvas ref={canvasRef} style={{ display: 'block' }} />
                
                {stats.nodes === 0 && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', textAlign: 'center', padding: '1rem' }}>
                        <div style={{ color: '#666', fontSize: '1.5rem', letterSpacing: '2px', marginBottom: '1rem' }}>
                            NO GRAPH DATA FOR THIS AGENT
                        </div>
                        <div style={{ color: '#444', fontSize: '0.8rem' }}>
                            Ingest documents or use the "Inject Graph" command in 'Active Memory' to build the lattice.
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
