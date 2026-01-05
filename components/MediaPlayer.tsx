
import React, { useEffect, useRef, useState } from 'react';

interface MediaPlayerProps {
    audioUrl: string | null;
    title?: string;
    onClose: () => void;
    interruptSignal: boolean; // Signal from mic/Gemini Live to pause
}

export const MediaPlayer: React.FC<MediaPlayerProps> = ({ audioUrl, title, onClose, interruptSignal }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);

    // Auto-play when URL loads
    useEffect(() => {
        if (audioUrl && audioRef.current) {
            audioRef.current.play().then(() => setIsPlaying(true)).catch(e => console.warn("Autoplay blocked", e));
        }
    }, [audioUrl]);

    // Handle Interruption (Ducking/Pause)
    useEffect(() => {
        if (interruptSignal && isPlaying && audioRef.current) {
            audioRef.current.pause();
            setIsPlaying(false);
        }
    }, [interruptSignal]);

    const togglePlay = () => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            audioRef.current.play();
            setIsPlaying(true);
        }
    };

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            setProgress(audioRef.current.currentTime);
            setDuration(audioRef.current.duration || 0);
        }
    };

    const formatTime = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    if (!audioUrl) return null;

    return (
        <div style={{
            position: 'absolute',
            bottom: '5rem', // Above command deck
            right: '1rem',
            width: '300px',
            background: 'rgba(10, 10, 10, 0.95)',
            border: '1px solid #facc15',
            borderRadius: '8px',
            padding: '1rem',
            zIndex: 50,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#facc15' }}>
                    CHATTERBOX: {title || 'NARRATION'}
                </span>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }} title="Close Player">×</button>
            </div>

            <audio 
                ref={audioRef} 
                src={audioUrl} 
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => setIsPlaying(false)}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button 
                    onClick={togglePlay}
                    className="btn btn-icon btn-sm"
                    style={{ background: isPlaying ? 'rgba(250, 204, 21, 0.2)' : 'transparent', borderColor: '#facc15', color: '#facc15' }}
                    title="Play/Pause"
                >
                    {isPlaying ? '⏸' : '▶'}
                </button>
                
                <div style={{ flex: 1, height: '4px', background: '#333', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${(progress / (duration || 1)) * 100}%`, height: '100%', background: '#facc15' }} />
                </div>
                
                <span style={{ fontSize: '0.65rem', color: '#888', fontFamily: 'monospace' }}>
                    {formatTime(progress)}
                </span>
            </div>
            
            {interruptSignal && (
                <div style={{ fontSize: '0.6rem', color: '#f87171', textAlign: 'center', marginTop: '2px' }}>
                    PAUSED (INTERRUPTED)
                </div>
            )}
        </div>
    );
};
