
import React, { useEffect, useRef, useState } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

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
    
    // Configure Analyser for "Square" Bars (Low FFT Size)
    if (analyser) {
        analyser.fftSize = 64; 
    }
    
    const bufferLength = analyser ? analyser.frequencyBinCount : 0;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationId = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;
      
      ctx.clearRect(0, 0, width, height);

      // Gradient for active bars
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, '#4ade80');
      gradient.addColorStop(0.5, '#a78bfa');
      gradient.addColorStop(1, '#ffffff');

      if (!analyser || !isActive) {
        // IDLE STATE: Clean horizontal line (Standby)
        ctx.fillStyle = 'rgba(50, 50, 50, 0.5)';
        ctx.fillRect(0, height / 2, width, 1);
        return;
      }

      analyser.getByteFrequencyData(dataArray);

      // Check for silence to draw a subtle baseline
      const hasSignal = dataArray.some(val => val > 0);
      if (!hasSignal) {
          ctx.fillStyle = 'rgba(74, 222, 128, 0.2)';
          ctx.fillRect(0, height - 1, width, 1);
          return;
      }

      const barWidth = width / bufferLength; 
      let x = 0;

      ctx.fillStyle = gradient;

      for (let i = 0; i < bufferLength; i++) {
        // Scale bar height - Audio data is 0-255
        const val = dataArray[i];
        const barHeight = (val / 255) * height;

        if (barHeight > 0) {
            // Draw Square Bar with 2px gap
            ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);
        }

        x += barWidth;
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, isActive, dimensions]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex' }}>
        <canvas 
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
    </div>
  );
};

export default Visualizer;