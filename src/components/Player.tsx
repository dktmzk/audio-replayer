import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, FastForward, Repeat, Scissors, Rewind, SkipBack, SkipForward, Shuffle } from 'lucide-react';
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
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<RegionsPlugin | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Track Loop: How many times the FULL track has played
  const [currentLoop, setCurrentLoop] = useState(0); 
  const [isLoopLocked, setIsLoopLocked] = useState(false);
  
  // Region Loop: How many times the CURRENT REGION has played
  const [regionLoop, setRegionLoop] = useState(0);
  const regionLoopRef = useRef(0);
  
  // Ref to track last time for loop detection
  const lastTimeRef = useRef(0);
  
  // Guard to prevent double-firing of finish event
  const isHandlingFinishRef = useRef(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeRegion, setActiveRegion] = useState<any>(null);
  const lastRegionOutTimeRef = useRef(0);

  const currentTrack = playlist[currentTrackIndex];

  // State Ref to access latest values inside WaveSurfer events
  // Declared AFTER state variables so they are available
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

  // Update State Ref - includes onTrackEnd to avoid stale closure
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

  // Helper for safe audio element playback
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

  // Sync ref with state
  useEffect(() => {
    regionLoopRef.current = regionLoop;
  }, [regionLoop]);

  // Initialize WaveSurfer & Regions
  useEffect(() => {
    if (!containerRef.current || !audioRef.current) return;

    // Initialize Regions Plugin
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
      height: 64, // Slightly taller for regions
      media: audioRef.current,
      plugins: [wsRegions],
    });

    wavesurferRef.current = ws;

    // Enable drag-to-create
    wsRegions.enableDragSelection({
      color: 'rgba(59, 130, 246, 0.3)', // Semi-transparent blue
    });

    // Track if we were playing before region interaction
    let wasPlayingBeforeRegion = false;

    // Handle Region Creation
    wsRegions.on('region-created', (region) => {
      // Remove other regions to enforce single A-B loop
      wsRegions.getRegions().forEach(r => {
        if (r.id !== region.id) r.remove();
      });
      setActiveRegion(region);
      setRegionLoop(0); // Reset REGION loop count
      
      // If we were playing before, ensure we continue playing
      // The drag-selection might pause playback, so restore it
      if (wasPlayingBeforeRegion) {
          setTimeout(() => {
              const audio = audioRef.current;
              if (audio && audio.paused) {
                  // resuming playback after region creation
                  ws.play().catch((err: any) => {
                      if (err.name !== 'AbortError') {
                          console.error('[region-created] Play failed:', err);
                      }
                  });
              }
          }, 10);
      }
    });

    // Track playback state before interaction
    ws.on('interaction', () => {
        wasPlayingBeforeRegion = !audioRef.current?.paused;
    });

    // Handle Region Updates
    wsRegions.on('region-updated', (region) => {
      setActiveRegion(region);
    });

    // Handle Region Out (Infinite Looping Logic)
    wsRegions.on('region-out', (region) => {
        // Debounce check: Prevent double-firing within 100ms
        const now = Date.now();
        if (now - lastRegionOutTimeRef.current < 100) {
            // debounced
            return;
        }
        lastRegionOutTimeRef.current = now;

        // Check if region is still active (not removed)
        // stateRef.current.activeRegion will be null if region was just cleared
        if (!stateRef.current.activeRegion) {
            // region no longer active
            return;
        }

        // region out detected; looping back to start
        
        // Infinite loop for regions (Drill Mode)
        // Just increment the counter for display, but don't change speed
        setRegionLoop(prev => {
            const newLoop = prev + 1;
            return newLoop;
        });
        
        // Keep the same speed based on currentLoop (the track loop), not regionLoop
        // Speed is already set based on currentLoop when the track started this pass
        
        // Seek to region start and continue playing
        // Use ws.setTime instead of region.play() for more reliable behavior
        setTimeout(() => {
            // Double-check region is still active before seeking
            if (!stateRef.current.activeRegion) {
                // region cleared during timeout
                return;
            }
            ws.setTime(region.start);
            // Ensure we're still playing
            if (audioRef.current && audioRef.current.paused) {
                ws.play().catch((err: any) => {
                    if (err.name !== 'AbortError') {
                        console.error('[region-out] Play failed:', err);
                    }
                });
            }
        }, 10);
    });

    // Handle Track Finish (Custom Looping Logic)
    ws.on('finish', () => {
        // Guard against double-firing
        if (isHandlingFinishRef.current) {
            // already handling finish
            return;
        }
        isHandlingFinishRef.current = true;
        
        const { isLoopLocked, currentLoop, loopCount, activeRegion, onTrackEnd: handleTrackEnd } = stateRef.current;
        
        // If we are in a region, the region plugin handles the loop (usually).
        // But if we hit the end of the track while in a region (edge case), ignore this.
        if (activeRegion) {
            // in active region, ignore external finish
            isHandlingFinishRef.current = false;
            return;
        }

        const shouldLoop = isLoopLocked || currentLoop < loopCount - 1;

        if (shouldLoop) {
            // Calculate next loop index for speed
            const nextLoopIndex = isLoopLocked ? currentLoop : currentLoop + 1;
            const speedIndex = Math.min(nextLoopIndex, loopCount - 1);
            const nextSpeed = stateRef.current.playbackSpeeds[speedIndex] || 1.0;
            
            if (!isLoopLocked) {
                // Increment loop count for non-locked loops
                setCurrentLoop(prev => prev + 1);
            }
            
            // Use queueMicrotask to handle loop restart immediately after the current event loop
            // This avoids browser throttling (1000ms+) in background tabs which causes "double play" or gaps
            queueMicrotask(() => {
                const audio = audioRef.current;
                if (audio) {
                    audio.pause(); // Ensure we are stopped
                    audio.playbackRate = nextSpeed;
                    audio.currentTime = 0; // Seek directly on audio element for speed
                }

                // Sync WaveSurfer and play
                ws.setTime(0);
                ws.play().then(() => {
                    isHandlingFinishRef.current = false;
                }).catch((err: any) => {
                    console.error('[finish] WaveSurfer play failed:', err);
                    // Fallback to basic audio play
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
            // Truly finished - keep guard set until we've returned
            // to prevent the double-fire from also calling onTrackEnd
            handleTrackEnd();
            // Guard will be reset when track changes via currentTrackIndex effect
        }
    });

    // Clear active region state if removed manually
    wsRegions.on('region-removed', () => {
        setActiveRegion(null);
        setRegionLoop(0); // Reset region loop counter (display only)
        // Don't seek or change playback - let it continue from current position
    });

    // Auto-play when a new track is loaded and ready
    ws.on('ready', () => {
        const { isPlaying, playbackSpeeds, loopCount, currentLoop } = stateRef.current;
        
        // Apply the correct playback rate based on currentLoop (track loop)
        // In drill mode, we use the same speed as the current track loop, not regionLoop
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
  }, []); // Run once on mount

  // Reset loop count when track changes
  useEffect(() => {
    setCurrentLoop(0);
    lastTimeRef.current = 0;
    isHandlingFinishRef.current = false; // Reset the finish guard
    
    setRegionLoop(0);
    setIsLoopLocked(false);

    if (regionsPluginRef.current) {
        regionsPluginRef.current.clearRegions();
        setActiveRegion(null);
    }
  }, [currentTrackIndex]);

  useEffect(() => {
    if (audioRef.current && currentTrack && wavesurferRef.current) {
      // Use WaveSurfer to load the track. This renders the waveform AND sets the audio element src.
      const isSameSrc = audioRef.current.src === currentTrack.url;
      if (!isSameSrc) {
        wavesurferRef.current.load(currentTrack.url).catch((err) => {
             if (err.name !== 'AbortError') {
                 console.warn("WaveSurfer load error:", err);
             }
        });
      }
      // Removed the 'else if' block here to prevent double-play race condition
    }
  }, [currentTrack, currentLoop]); 

  // Separate effect for playback rate - this should NOT trigger play/restart
  useEffect(() => {
    if (audioRef.current) {
      const speedIndex = Math.min(currentLoop, loopCount - 1);
      const newRate = playbackSpeeds[speedIndex] || 1.0;
      // Only update if the rate actually changed
      if (audioRef.current.playbackRate !== newRate) {
        audioRef.current.playbackRate = newRate;
      }
    }
  }, [currentLoop, playbackSpeeds, loopCount]);

  // Handle play/pause toggle separately
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
      // Update stateRef synchronously BEFORE clearing regions
      // This prevents the region-out event from seeking back
      stateRef.current.activeRegion = null;
      regionsPluginRef.current?.clearRegions();
      setActiveRegion(null);
      setRegionLoop(0);
      // currentLoop is untouched, so it resumes where it left off (e.g. Loop 1)
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

  // Helper to get display values - loop count uses regionLoop or currentLoop, but speed always uses currentLoop
  const displayLoop = activeRegion ? regionLoop : currentLoop;
  const displaySpeed = playbackSpeeds[Math.min(currentLoop, loopCount - 1)] || 1.0;

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