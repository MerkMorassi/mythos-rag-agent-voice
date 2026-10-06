
import React, { useEffect, useRef, useState } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
}

type VisualizerPreset = 'bars' | 'wave' | 'particles';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseRadius: number;
  color: string;
}

const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [preset, setPreset] = useState<VisualizerPreset>('bars');
  
  // Persistent particle system
  const particlesRef = useRef<Particle[]>([]);

  // Initialize particles once dimensions are established
  useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0) return;
    const count = 50;
    const colors = ['#a78bfa', '#38bdf8', '#4ade80', '#ffffff'];
    const pts: Particle[] = [];
    for (let i = 0; i < count; i++) {
      pts.push({
        x: Math.random() * dimensions.width,
        y: Math.random() * dimensions.height,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        baseRadius: Math.random() * 2 + 1.5,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
    particlesRef.current = pts;
  }, [dimensions]);

  // Handle Resizing
  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        });
      }
    };

    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  // Drawing Loop
  useEffect(() => {
    if (!canvasRef.current || dimensions.width === 0 || dimensions.height === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    let animationId: number;
    
    // Configure Analyser based on chosen preset
    if (analyser) {
        if (preset === 'bars') {
            analyser.fftSize = 64; 
        } else if (preset === 'wave') {
            analyser.fftSize = 256;
        } else {
            analyser.fftSize = 128; // particles
        }
    }
    
    const bufferLength = analyser ? analyser.frequencyBinCount : 0;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationId = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;
      
      ctx.clearRect(0, 0, width, height);

      // 1. If IDLE or NO ANALYSER, render elegant idle visualization
      if (!analyser || !isActive) {
        if (preset === 'wave') {
          // Draw clean horizontal oscilloscope line
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(167, 139, 250, 0.25)';
          ctx.lineWidth = 1.5;
          ctx.moveTo(0, height / 2);
          ctx.lineTo(width, height / 2);
          ctx.stroke();
        } else if (preset === 'particles') {
          // Draw slowly drifting idle particles
          particlesRef.current.forEach(p => {
            p.x += p.vx * 0.2;
            p.y += p.vy * 0.2;
            if (p.x < 0 || p.x > width) p.vx *= -1;
            if (p.y < 0 || p.y > height) p.vy *= -1;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.baseRadius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fill();
          });
        } else {
          // 'bars' standby line
          ctx.fillStyle = 'rgba(74, 222, 128, 0.15)';
          ctx.fillRect(0, height / 2, width, 1.5);
        }
        return;
      }

      // 2. Fetch appropriate audio data
      if (preset === 'wave') {
        analyser.getByteTimeDomainData(dataArray);
      } else {
        analyser.getByteFrequencyData(dataArray);
      }

      // Check if we actually have any signal (not absolute silence)
      const hasSignal = dataArray.some(val => preset === 'wave' ? Math.abs(val - 128) > 2 : val > 0);
      if (!hasSignal) {
        if (preset === 'wave') {
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(167, 139, 250, 0.25)';
          ctx.lineWidth = 1.5;
          ctx.moveTo(0, height / 2);
          ctx.lineTo(width, height / 2);
          ctx.stroke();
        } else if (preset === 'particles') {
          // Draw slowly drifting idle particles
          particlesRef.current.forEach(p => {
            p.x += p.vx * 0.2;
            p.y += p.vy * 0.2;
            if (p.x < 0 || p.x > width) p.vx *= -1;
            if (p.y < 0 || p.y > height) p.vy *= -1;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.baseRadius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fill();
          });
        } else {
          ctx.fillStyle = 'rgba(74, 222, 128, 0.2)';
          ctx.fillRect(0, height - 1.5, width, 1.5);
        }
        return;
      }

      // 3. Render Based on Selected Preset
      if (preset === 'bars') {
        // Gradient for active bars
        const gradient = ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, 'rgba(56, 189, 248, 0.85)'); // light blue
        gradient.addColorStop(0.5, 'rgba(167, 139, 250, 0.85)'); // purple
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0.95)'); // white

        const barWidth = width / bufferLength; 
        let x = 0;
        ctx.fillStyle = gradient;

        for (let i = 0; i < bufferLength; i++) {
          const val = dataArray[i];
          const barHeight = (val / 255) * height;

          if (barHeight > 0) {
            ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);
          }
          x += barWidth;
        }

      } else if (preset === 'wave') {
        // Oscilloscope Mode
        ctx.beginPath();
        ctx.lineWidth = 2.5;
        
        // Horizontal glow line gradient
        const waveGradient = ctx.createLinearGradient(0, 0, width, 0);
        waveGradient.addColorStop(0, '#38bdf8');
        waveGradient.addColorStop(0.5, '#a78bfa');
        waveGradient.addColorStop(1, '#4ade80');
        ctx.strokeStyle = waveGradient;

        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0; // Normalized -1.0 to 1.0 around baseline
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }

          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();

      } else if (preset === 'particles') {
        // Compute overall energy level
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avgEnergy = sum / bufferLength; // 0 to 255
        const normEnergy = avgEnergy / 255;   // 0.0 to 1.0

        // Particle speed & size reactive factors
        const speedMultiplier = 1.0 + normEnergy * 5.0;
        const radiusMultiplier = 1.0 + normEnergy * 2.5;

        // Draw connecting lines (plexus) if particles are close
        ctx.lineWidth = 0.5;
        for (let i = 0; i < particlesRef.current.length; i++) {
          const p1 = particlesRef.current[i];
          for (let j = i + 1; j < particlesRef.current.length; j++) {
            const p2 = particlesRef.current[j];
            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            
            // Connecting line threshold
            if (dist < 75) {
              const alpha = (1 - dist / 75) * (0.15 + normEnergy * 0.4);
              ctx.strokeStyle = `rgba(167, 139, 250, ${alpha})`;
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.stroke();
            }
          }
        }

        // Draw and update each particle
        particlesRef.current.forEach(p => {
          // Dynamic update reactive speed
          p.x += p.vx * speedMultiplier;
          p.y += p.vy * speedMultiplier;

          // Boundary bounce
          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;

          // Keep within constraints
          p.x = Math.max(0, Math.min(width, p.x));
          p.y = Math.max(0, Math.min(height, p.y));

          // Compute dynamic radius based on base size and current audio energy
          const r = p.baseRadius * radiusMultiplier;

          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = 0.4 + normEnergy * 0.6;
          ctx.fill();
          ctx.globalAlpha = 1.0; // Reset
        });
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, isActive, dimensions, preset]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', position: 'relative' }}>
        <select 
          value={preset} 
          onChange={(e) => setPreset(e.target.value as VisualizerPreset)} 
          style={{
            position: 'absolute',
            top: '0.5rem',
            right: '0.5rem',
            background: 'rgba(10, 10, 10, 0.85)',
            color: '#a78bfa',
            border: '1px solid #333',
            borderRadius: '4px',
            fontSize: '0.65rem',
            padding: '2px 8px',
            fontFamily: 'Menlo, monospace',
            outline: 'none',
            cursor: 'pointer',
            zIndex: 10,
          }}
          title="Select Audio Visualization Preset"
        >
          <option value="bars">ANALYSIS: BARS</option>
          <option value="wave">ANALYSIS: WAVE</option>
          <option value="particles">ANALYSIS: PLEXUS</option>
        </select>
        
        <canvas 
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
    </div>
  );
};

export default Visualizer;
