import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);

    const draw = () => {
      animationId = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Create gradient
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, '#333333'); 
      gradient.addColorStop(0.5, '#ffffff'); 
      gradient.addColorStop(1, '#333333'); 

      if (!analyser || !isActive) {
        // Draw idle line
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1;
        ctx.stroke();
        return;
      }

      analyser.getByteTimeDomainData(dataArray);

      ctx.lineWidth = 2;
      ctx.strokeStyle = gradient;
      ctx.shadowBlur = 0;
      
      ctx.beginPath();

      const sliceWidth = width * 1.0 / dataArray.length;
      let x = 0;

      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * height / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          // Smooth curve
          const prevX = x - sliceWidth;
          const prevY = (dataArray[i-1] / 128.0) * height / 2;
          const cpX = (prevX + x) / 2;
          ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y)/2);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, isActive]);

  return (
    <canvas 
      ref={canvasRef} 
      width={800} 
      height={200} 
      className="w-full"
      style={{ width: '100%', height: '8rem', display: 'block' }}
    />
  );
};

export default Visualizer;