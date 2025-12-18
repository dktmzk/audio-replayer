import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, FastForward, Repeat, Scissors, Rewind, SkipBack, SkipForward, Shuffle } from 'lucide-react'; // Removed Moon and Settings
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';

interface Track {
  url: string;
  name: string;
}

interface PlayerProps {
  playlist: Track[];
  currentTrackIndex: number;
  onTrackEnd: () => void;
  playbackSpeeds: number[];
  loopCount: number;
  onNextTrack: () => void;
  onPreviousTrack: () => void;
  isShuffleOn: boolean;
  onToggleShuffle: () => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  // Removed sleepTimerDuration, setSleepTimerDuration, handleLoopCountChange, handleSpeedChange
}

const Player: React.FC<PlayerProps> = ({
  playlist,
  currentTrackIndex,
  onTrackEnd,
  playbackSpeeds,
  loopCount,
  onNextTrack,
  onPreviousTrack,
  isShuffleOn,
  onToggleShuffle,
  isPlaying,
  setIsPlaying,
  // Removed sleepTimerDuration, setSleepTimerDuration, handleLoopCountChange, handleSpeedChange
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<RegionsPlugin | null>(null);
  
  const [currentLoop, setCurrentLoop] = useState(0); 
  const [isLoopLocked, setIsLoopLocked] = useState(false);
  
  const [regionLoop, setRegionLoop] = useState(0);
  const regionLoopRef = useRef(0);
  
  const lastTimeRef = useRef(0);
  
  const isHandlingFinishRef = useRef(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeRegion, setActiveRegion] = useState<any>(null);
  const lastRegionOutTimeRef = useRef(0);

  const currentTrack = playlist[currentTrackIndex];

  const stateRef = useRef({
      isLoopLocked,
      currentLoop,
      loopCount,
      activeRegion,
      onTrackEnd,
      isPlaying,
      playbackSpeeds,
      regionLoop
  });

  useEffect(() => {
      stateRef.current = {
          isLoopLocked,
          currentLoop,
          loopCount,
          activeRegion,
          onTrackEnd,
          isPlaying,
          playbackSpeeds,
          regionLoop
      };
  }, [isLoopLocked, currentLoop, loopCount, activeRegion, onTrackEnd, isPlaying, playbackSpeeds, regionLoop]);

  const safePlay = async () => {
    if (audioRef.current) {
        try {
            await audioRef.current.play();
        } catch (error: any) {
            if (error.name !== 'AbortError') {
                console.error("Playback failed:", error);
            }
        }
    }
  };

  useEffect(() => {
    regionLoopRef.current = regionLoop;
  }, [regionLoop]);

  useEffect(() => {
    if (!containerRef.current || !audioRef.current) return;

    const wsRegions = RegionsPlugin.create();
    regionsPluginRef.current = wsRegions;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'rgba(255, 255, 255, 0.3)',
      progressColor: '#3b82f6',
      cursorColor: '#60a5fa',
      barWidth: 2,
      barGap: 3,
      barRadius: 3,
      height: 64,
      media: audioRef.current,
      plugins: [wsRegions],
    });

    wavesurferRef.current = ws;

    wsRegions.enableDragSelection({
      color: 'rgba(59, 130, 246, 0.3)',
    });

    let wasPlayingBeforeRegion = false;

    wsRegions.on('region-created', (region) => {
      wsRegions.getRegions().forEach(r => {
        if (r.id !== region.id) r.remove();
      });
      setActiveRegion(region);
      setRegionLoop(0); 
      
      if (wasPlayingBeforeRegion) {
          setTimeout(() => {
              const audio = audioRef.current;
              if (audio && audio.paused) {
                  ws.play().catch((err: any) => {
                      if (err.name !== 'AbortError') {
                          console.error('[region-created] Play failed:', err);
                      }
                  });
              }
          }, 10);
      }
    });

    ws.on('interaction', () => {
        wasPlayingBeforeRegion = !audioRef.current?.paused;
    });

    wsRegions.on('region-updated', (region) => {
      setActiveRegion(region);
    });

    wsRegions.on('region-out', (region) => {
        const now = Date.now();
        if (now - lastRegionOutTimeRef.current < 100) {
            return;
        }
        lastRegionOutTimeRef.current = now;

        if (!stateRef.current.activeRegion) {
            return;
        }

        setRegionLoop(prev => {
            const newLoop = prev + 1;
            return newLoop;
        });
        
        setTimeout(() => {
            if (!stateRef.current.activeRegion) {
                return;
            }
            ws.setTime(region.start);
            if (audioRef.current && audioRef.current.paused) {
                ws.play().catch((err: any) => {
                    if (err.name !== 'AbortError') {
                        console.error('[region-out] Play failed:', err);
                    }
                });
            }
        }, 10);
    });

    ws.on('finish', () => {
        if (isHandlingFinishRef.current) {
            return;
        }
        isHandlingFinishRef.current = true;
        
        const { isLoopLocked, currentLoop, loopCount, activeRegion, onTrackEnd: handleTrackEnd } = stateRef.current;
        
        if (activeRegion) {
            isHandlingFinishRef.current = false;
            return;
        }

        const shouldLoop = isLoopLocked || currentLoop < loopCount - 1;

        if (shouldLoop) {
            const nextLoopIndex = isLoopLocked ? currentLoop : currentLoop + 1;
            const speedIndex = Math.min(nextLoopIndex, loopCount - 1);
            const nextSpeed = stateRef.current.playbackSpeeds[speedIndex] || 1.0;
            
            if (!isLoopLocked) {
                setCurrentLoop(prev => prev + 1);
            }
            
            queueMicrotask(() => {
                const audio = audioRef.current;
                if (audio) {
                    audio.pause();
                    audio.playbackRate = nextSpeed;
                    audio.currentTime = 0;
                }

                ws.setTime(0);
                ws.play().then(() => {
                    isHandlingFinishRef.current = false;
                }).catch((err: any) => {
                    console.error('[finish] WaveSurfer play failed:', err);
                    if (audio) {
                        audio.play().then(() => {
                             isHandlingFinishRef.current = false;
                        }).catch(e => {
                             isHandlingFinishRef.current = false;
                             if (e.name !== 'AbortError') console.error(e);
                        });
                    } else {
                        isHandlingFinishRef.current = false;
                    }
                });
            });
        } else {
            handleTrackEnd();
        }
    });

    wsRegions.on('region-removed', () => {
        setActiveRegion(null);
        setRegionLoop(0);
    });

    ws.on('ready', () => {
        const { isPlaying, playbackSpeeds, loopCount, currentLoop } = stateRef.current;
        
        const audio = audioRef.current;
        if (audio) {
            const speedIndex = Math.min(currentLoop, loopCount - 1);
            audio.playbackRate = playbackSpeeds[speedIndex] || 1.0;
        }
        
        if (isPlaying) {
            ws.play().catch((err: any) => {
                if (err.name !== 'AbortError') {
                    console.error('[ready] Play failed:', err);
                }
            });
        }
    });

    return () => {
      ws.destroy();
    };
  }, []);

  useEffect(() => {
    setCurrentLoop(0);
    lastTimeRef.current = 0;
    isHandlingFinishRef.current = false; 
    
    setRegionLoop(0);
    setIsLoopLocked(false);

    if (regionsPluginRef.current) {
        regionsPluginRef.current.clearRegions();
        setActiveRegion(null);
    }
  }, [currentTrackIndex]);

  useEffect(() => {
    if (audioRef.current && currentTrack && wavesurferRef.current) {
      const isSameSrc = audioRef.current.src === currentTrack.url;
      if (!isSameSrc) {
        wavesurferRef.current.load(currentTrack.url).catch((err) => {
             if (err.name !== 'AbortError') {
                 console.warn("WaveSurfer load error:", err);
             }
        });
      }
    }
  }, [currentTrack, currentLoop]); 

  useEffect(() => {
    if (audioRef.current) {
      const speedIndex = Math.min(currentLoop, loopCount - 1);
      const newRate = playbackSpeeds[speedIndex] || 1.0;
      if (audioRef.current.playbackRate !== newRate) {
        audioRef.current.playbackRate = newRate;
      }
    }
  }, [currentLoop, playbackSpeeds, loopCount]);

  useEffect(() => {
    if (audioRef.current) {
        if (isPlaying) {
             safePlay();
        } else {
            audioRef.current.pause();
        }
    }
  }, [isPlaying]);


  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleClearRegion = (e: React.MouseEvent) => {
      e.stopPropagation();
      stateRef.current.activeRegion = null;
      regionsPluginRef.current?.clearRegions();
      setActiveRegion(null);
      setRegionLoop(0);
  };

  const handleRewind = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
    }
  };

  const handleFastForward = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 5);
    }
  };
  
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const displayLoop = activeRegion ? regionLoop : currentLoop;
  const displaySpeed = playbackSpeeds[Math.min(currentLoop, loopCount - 1)] || 1.0;

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is on an input element
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          setIsPlaying(!isPlaying);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleRewind();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleFastForward();
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (audioRef.current) {
            audioRef.current.volume = Math.min(1, audioRef.current.volume + 0.1);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (audioRef.current) {
            audioRef.current.volume = Math.max(0, audioRef.current.volume - 0.1);
          }
          break;
        case 'KeyN':
          e.preventDefault();
          onNextTrack();
          break;
        case 'KeyP':
          e.preventDefault();
          onPreviousTrack();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, setIsPlaying, onNextTrack, onPreviousTrack]);

  return (
    <div className="bg-white/10 backdrop-blur-md border border-white/20 p-6 rounded-2xl shadow-xl flex flex-col items-center w-full relative h-[320px] justify-center">
      <div className="w-full text-center mb-6">
        <h2 className="text-2xl font-bold text-white tracking-wide truncate">
          {currentTrack ? currentTrack.name : 'No Track Selected'}
        </h2>
        <div className="flex items-center justify-center gap-2 mt-1">
            <p className="text-gray-400 text-sm">
            {currentTrack 
              ? activeRegion 
                    ? `Region Loop ${displayLoop + 1} (Infinite) • ${displaySpeed.toFixed(2)}x Speed`
                    : `Loop ${displayLoop + 1} of ${loopCount} • ${displaySpeed.toFixed(2)}x Speed`
              : 'Select a track to start'}
            </p>
            {activeRegion && (
                <span className="text-xs bg-blue-600 px-2 py-0.5 rounded text-white animate-pulse">
                    Drill Mode
                </span>
            )}
            {isLoopLocked && !activeRegion && (
                 <span className="text-xs bg-indigo-500 px-2 py-0.5 rounded text-white flex items-center gap-1">
                    <Repeat size={10} /> Locked
                </span>
            )}
        </div>
      </div>

      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        className="fixed top-0 left-0 opacity-0 pointer-events-none" 
      />

      {/* Waveform Container */}
      <div className="w-full flex items-center gap-3 text-xs text-gray-400 font-mono mb-6 relative group">
          <span>{formatTime(currentTime)}</span>
          <div ref={containerRef} className="flex-1 cursor-pointer w-full min-h-[64px]" />
          <span>{formatTime(duration)}</span>
          
          {/* Helper Tooltip */}
          {!activeRegion && duration > 0 && (
              <div className="absolute top-[-20px] left-1/2 -translate-x-1/2 text-[10px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                  Drag on waveform to loop
              </div>
          )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-6">
        {/* Shuffle Toggle */}
        <button
            onClick={onToggleShuffle}
            className={`p-2 rounded-full transition-all ${
                isShuffleOn ? 'text-blue-400 bg-blue-400/10' : 'text-gray-500 hover:text-gray-300'
            }`}
            title="Toggle Weighted Shuffle"
        >
            <Shuffle size={20} />
        </button>

        {/* Previous Track Button */}
        <button
            onClick={onPreviousTrack}
            className="text-gray-300 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full"
            title="Previous Track"
        >
            <SkipBack size={24} />
        </button>

        {/* Rewind 5 Seconds Button */}
        <button
            onClick={handleRewind}
            className="text-gray-300 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full"
            title="Rewind 5 Seconds"
        >
            <Rewind size={24} />
        </button>

        <button
          onClick={handlePlayPause}
          className="bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
        >
          {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
        </button>
        
        {/* Fast Forward 5 Seconds Button */}
        <button
            onClick={handleFastForward}
            className="text-gray-300 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full"
            title="Forward 5 Seconds"
        >
            <FastForward size={24} />
        </button>

        {/* Next Track Button */}
        <button
            onClick={onNextTrack}
            className="text-gray-300 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full"
            title="Next Track"
        >
            <SkipForward size={24} />
        </button>

         {/* Loop Lock Button */}
         <button
            onClick={() => setIsLoopLocked(!isLoopLocked)}
            className={`p-2 rounded-full transition-all ${
                isLoopLocked ? 'text-indigo-400 bg-indigo-400/10' : 'text-gray-500 hover:text-gray-300'
            }`}
            title="Lock Current Loop"
        >
            <Repeat size={20} />
        </button>

        {activeRegion && (
            <button
                onClick={handleClearRegion}
                className="absolute right-6 bottom-6 text-xs text-red-400 hover:text-red-300 flex items-center gap-1 border border-red-500/30 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                title="Clear Loop"
            >
                <Scissors size={12} /> Clear Loop
            </button>
        )}
      </div>
       
       <div className="mt-6 flex items-center gap-2 text-xs text-gray-500 bg-black/20 px-3 py-1 rounded-full">
           <Repeat size={12} />
           <span>Auto-advances after {loopCount} plays</span>
       </div>

    </div>
  );
};

export default Player;