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

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeRegion, setActiveRegion] = useState<any>(null);
  const lastRegionOutTimeRef = useRef(0);

  const currentTrack = playlist[currentTrackIndex];

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

    // Handle Region Creation
    wsRegions.on('region-created', (region) => {
      // Remove other regions to enforce single A-B loop
      wsRegions.getRegions().forEach(r => {
        if (r.id !== region.id) r.remove();
      });
      setActiveRegion(region);
      setRegionLoop(0); // Reset REGION loop count
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
            return;
        }
        lastRegionOutTimeRef.current = now;

        // Infinite loop for regions (Drill Mode)
        setRegionLoop(prev => prev + 1);
        // Small timeout to ensure seek happens cleanly
        setTimeout(() => region.play(), 0);
    });

    // Clear active region state if removed manually
    wsRegions.on('region-removed', () => {
        setActiveRegion(null);
        setRegionLoop(0); // Reset region loop
    });

    return () => {
      ws.destroy();
    };
  }, []); // Run once on mount

  // Reset loop count when track changes
  useEffect(() => {
    setCurrentLoop(0);
    setRegionLoop(0);
    setIsLoopLocked(false);
    if (regionsPluginRef.current) {
        regionsPluginRef.current.clearRegions();
        setActiveRegion(null);
    }
  }, [currentTrackIndex]);

  useEffect(() => {
    if (audioRef.current && currentTrack) {
      const isSameSrc = audioRef.current.src === currentTrack.url;
      if (!isSameSrc) {
        audioRef.current.src = currentTrack.url;
      }
      
      // DETERMINE ACTIVE LOOP INDEX
      // If region active -> use regionLoop
      // If normal play -> use currentLoop
      const activeLoopIndex = activeRegion ? regionLoop : currentLoop;

      // Use the active loop index, but cap it at the last configured speed
      const speedIndex = Math.min(activeLoopIndex, loopCount - 1);
      audioRef.current.playbackRate = playbackSpeeds[speedIndex] || 1.0;

      if (isPlaying) {
        audioRef.current.play().catch(e => console.error("Playback failed:", e));
      }
    }
  }, [currentTrack, currentLoop, regionLoop, playbackSpeeds, loopCount, activeRegion]); 

  // Handle play/pause toggle separately
  useEffect(() => {
    if (audioRef.current) {
        if (isPlaying) {
             audioRef.current.play().catch(e => console.error("Playback failed:", e));
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

  // Robust Track End (Normal Mode)
  const handleAudioEnded = () => {
      // Only handle if NOT in a region (Region Plugin handles that case)
      if (!activeRegion) {
        if (isLoopLocked) {
             if (audioRef.current) {
              audioRef.current.currentTime = 0;
              audioRef.current.play();
             }
             return;
        }

        if (currentLoop < loopCount - 1) {
          setCurrentLoop((prev) => prev + 1);
          if (audioRef.current) {
              audioRef.current.currentTime = 0;
              audioRef.current.play();
          }
        } else {
          onTrackEnd();
        }
      }
  };

  const handleClearRegion = (e: React.MouseEvent) => {
      e.stopPropagation();
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

  // Helper to get display values
  const displayLoop = activeRegion ? regionLoop : currentLoop;

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
                    ? `Region Loop ${displayLoop + 1} (Infinite) • ${(playbackSpeeds[Math.min(displayLoop, loopCount - 1)] || 1.0).toFixed(2)}x Speed`
                    : `Loop ${displayLoop + 1} of ${loopCount} • ${(playbackSpeeds[Math.min(displayLoop, loopCount - 1)] || 1.0).toFixed(2)}x Speed`
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
        onEnded={handleAudioEnded}
        className="hidden" 
      />

      {/* Waveform Container */}
      <div className="w-full flex items-center gap-3 text-xs text-gray-400 font-mono mb-6 relative group">
          <span>{formatTime(currentTime)}</span>
          <div ref={containerRef} className="flex-1 cursor-pointer" />
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
                className="absolute right-6 text-xs text-red-400 hover:text-red-300 flex items-center gap-1 border border-red-500/30 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
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