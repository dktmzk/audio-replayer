import React, { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import Player from './components/Player';
import Playlist from './components/Playlist';
import logo from './assets/logo.svg';
import { Upload, Settings, FileAudio, Moon, X, Play, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { 
    addTrackToDB, 
    getPlaylists, 
    createPlaylist, 
    deletePlaylist, 
    getTracksForPlaylist, 
    deleteTrackFromDB, 
    updateTrackPriorityInDB,
    type StoredPlaylist
} from './db';

interface Track {
  id: string;
  url: string;
  name: string;
  priority: number;
}

function App() {
  const [playlist, setPlaylist] = useState<Track[]>([]); // Current tracks
  const [playlists, setPlaylists] = useState<StoredPlaylist[]>([]);
  const [currentPlaylistId, setCurrentPlaylistId] = useState<string | null>(null);
  
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);
  const [sleepTimerDuration, setSleepTimerDuration] = useState(0);
  const [sleepMinutes, setSleepMinutes] = useState(60);
  const [isLoading, setIsLoading] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [sortOrder, setSortOrder] = useState<'recent' | 'added'>('added');
  const [recentHistory, setRecentHistory] = useState<string[]>([]);
  const [isShuffleOn, setIsShuffleOn] = useState(true);

  const [loopCount, setLoopCount] = useState(() => {
    const saved = localStorage.getItem('loopCount');
    return saved ? Number(saved) : 2;
  });

  const [playbackSpeeds, setPlaybackSpeeds] = useState<number[]>(() => {
    const saved = localStorage.getItem('playbackSpeeds');
    return saved ? JSON.parse(saved) : [1.0, 1.1, 1.2];
  });

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const [playlistHeight, setPlaylistHeight] = useState<number | undefined>(undefined);

  // Initialize App & Load Playlists
  useEffect(() => {
      const init = async () => {
          try {
              const lists = await getPlaylists();
              if (lists.length > 0) {
                  setPlaylists(lists);
                  // Sort by creation usually, or last accessed?
                  // For now, simple default.
                  setCurrentPlaylistId(lists[0].id);
              } else {
                  // Fallback if migration failed or fresh DB
                  const newPl = await createPlaylist("My Playlist");
                  setPlaylists([newPl]);
                  setCurrentPlaylistId(newPl.id);
              }
          } catch (error) {
              console.error("Failed to load application data:", error);
          } finally {
              setIsLoading(false);
          }
      };
      init();
  }, []);

  // Load Tracks when Playlist Selection Changes
  useEffect(() => {
      if (!currentPlaylistId) return;

      let isMounted = true;

      const loadTracks = async () => {
          try {
              // Note: Revoking old URLs here is tricky with async races. 
              // Ideally we track active URLs in a ref or cleaning up previous effect.
              // For now, we rely on the fact that if isMounted is true, we are the latest request.
              if (playlist.length > 0) {
                 playlist.forEach(t => URL.revokeObjectURL(t.url));
              }

              const storedTracks = await getTracksForPlaylist(currentPlaylistId);
              
              if (!isMounted) return;

              const tracks: Track[] = storedTracks.map(t => ({
                  id: t.id,
                  url: URL.createObjectURL(t.file),
                  name: t.name,
                  priority: t.priority
              }));
              
              setPlaylist(tracks);
              setCurrentTrackIndex(0); 
              setIsPlaying(false);
          } catch (e) {
              if (isMounted) console.error("Failed to load tracks", e);
          }
      };
      loadTracks();

      return () => {
          isMounted = false;
      };
  }, [currentPlaylistId]); // playlist dependency removed to avoid loop, but accessing current value is unsafe inside async.
  // Actually, accessing `playlist` (state) inside async function uses the closure value from when effect started.
  // This is "ok" for revocation if we assume we are revoking what was there when we started loading.

  useLayoutEffect(() => {
    const updateHeight = () => {
      if (leftColumnRef.current) {
        setPlaylistHeight(leftColumnRef.current.offsetHeight);
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, [loopCount, playlist.length, isLoading, isSettingsOpen]);

  useEffect(() => {
      let timer: number;
      if (isPlaying) {
          timer = setInterval(() => {
              setSessionTime(prevTime => prevTime + 1);
          }, 1000);
      }
      return () => clearInterval(timer);
  }, [isPlaying]);

  useEffect(() => {
    let interval: number;
    if (isPlaying && sleepTimerDuration > 0) {
      interval = setInterval(() => {
        setSleepTimerDuration(prev => {
          if (prev <= 1) {
            setIsPlaying(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, sleepTimerDuration]);

  useEffect(() => {
    localStorage.setItem('loopCount', loopCount.toString());
  }, [loopCount]);

  useEffect(() => {
    localStorage.setItem('playbackSpeeds', JSON.stringify(playbackSpeeds));
  }, [playbackSpeeds]);

  const addToHistory = useCallback((trackId: string) => {
      setRecentHistory(prev => {
          const newHistory = [trackId, ...prev.filter(id => id !== trackId)];
          return newHistory.slice(0, 50);
      });
  }, []);

  const addFilesToPlaylist = async (files: FileList | File[]) => {
    if (!currentPlaylistId) return;

    const newFiles = Array.from(files).filter(file => file.type.startsWith('audio/'));
    
    const baseTime = Date.now();
    const newTracks = await Promise.all(newFiles.map(async (file, index): Promise<Track | null> => {
        const id = crypto.randomUUID();
        const trackData = {
            id,
            playlistId: currentPlaylistId,
            file,
            name: file.name,
            priority: 2,
            addedAt: baseTime + index
        };
        try {
            await addTrackToDB(trackData);
            return {
                id,
                url: URL.createObjectURL(file),
                name: file.name,
                priority: 2
            };
        } catch (e: any) {
            if (e.name === 'QuotaExceededError') {
                alert(`Storage quota exceeded! Could not save "${file.name}".`);
                return null;
            }
            console.error("Error saving track:", e);
            return null;
        }
    }));

    const successfulTracks = newTracks.filter((t): t is Track => t !== null);
    setPlaylist(prev => [...prev, ...successfulTracks]);
  };

  const handleCreatePlaylist = async () => {
      let name = prompt("Enter playlist name:", "New Playlist");
      if (name) {
          name = name.trim();
          if (!name) return;

          // Auto-rename if duplicate
          let finalName = name;
          let counter = 1;
          while (playlists.some(p => p.name === finalName)) {
              finalName = `${name} (${counter})`;
              counter++;
          }

          try {
              const newPl = await createPlaylist(finalName);
              setPlaylists(prev => [...prev, newPl]);
              setCurrentPlaylistId(newPl.id);
          } catch (e) {
              alert("Failed to create playlist");
          }
      }
  };

  const handleDeletePlaylist = async () => {
      if (!currentPlaylistId) return;
      
      if (playlists.length <= 1) {
          alert("You must have at least one playlist.");
          return;
      }

      if (confirm("Are you sure you want to delete this playlist and all its tracks?")) {
           const idToDelete = currentPlaylistId;
           // Find next playlist to select
           const currentIndex = playlists.findIndex(p => p.id === idToDelete);
           const nextPlaylist = playlists[currentIndex === 0 ? 1 : currentIndex - 1];
           
           await deletePlaylist(idToDelete);
           
           setPlaylists(prev => prev.filter(p => p.id !== idToDelete));
           setCurrentPlaylistId(nextPlaylist.id);
      }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      addFilesToPlaylist(files);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      addFilesToPlaylist(files);
    }
  }, []);

  const pickNextWeightedTrack = useCallback((currentId: string | null) => {
      if (playlist.length === 0) return 0;
      if (playlist.length === 1) return 0;

      const candidates = playlist.filter(t => t.id !== currentId);
      
      const getWeight = (p: number) => {
          switch(p) {
              case 3: return 9;
              case 2: return 3;
              case 1: return 1;
              default: return 3;
          }
      };

      const totalWeight = candidates.reduce((sum, track) => sum + getWeight(track.priority), 0);
      let randomValue = Math.random() * totalWeight;
      
      let selectedTrack = candidates[0];
      for (const track of candidates) {
          randomValue -= getWeight(track.priority);
          if (randomValue <= 0) {
              selectedTrack = track;
              break;
          }
      }
      return playlist.findIndex(t => t.id === selectedTrack.id);
  }, [playlist]);

  const handleTrackEnd = useCallback(() => {
    if (playlist.length === 0) return;
    
    const currentId = playlist[currentTrackIndex]?.id;
    if (currentId) addToHistory(currentId);

    if (isShuffleOn) {
        const nextIndex = pickNextWeightedTrack(currentId);
        setCurrentTrackIndex(nextIndex);
    } else {
        setCurrentTrackIndex(prevIndex => (prevIndex + 1) % playlist.length);
    }
  }, [playlist, currentTrackIndex, isShuffleOn, pickNextWeightedTrack, addToHistory]);

  const handleTrackSelect = useCallback((index: number) => {
    const trackId = playlist[index]?.id;
    if (trackId) addToHistory(trackId);
    setCurrentTrackIndex(index);
  }, [playlist, addToHistory]);
  
  const handleNextTrack = useCallback(() => {
      if (playlist.length > 0) {
           const currentId = playlist[currentTrackIndex]?.id;
           if (currentId) addToHistory(currentId);
           
           if (isShuffleOn) {
               const nextIndex = pickNextWeightedTrack(currentId);
               setCurrentTrackIndex(nextIndex);
           } else {
               setCurrentTrackIndex(prev => (prev + 1) % playlist.length);
           }
      }
  }, [playlist, currentTrackIndex, isShuffleOn, pickNextWeightedTrack, addToHistory]);

  const handlePreviousTrack = useCallback(() => {
      if (playlist.length > 0) {
           const currentId = playlist[currentTrackIndex]?.id;
           if (currentId) addToHistory(currentId);

           if (recentHistory.length > 0) {
               const previousTrackId = recentHistory.find(id => id !== currentId && playlist.some(t => t.id === id));
               if (previousTrackId) {
                   const prevIndex = playlist.findIndex(t => t.id === previousTrackId);
                   if (prevIndex !== -1) {
                       setCurrentTrackIndex(prevIndex);
                       return;
                   }
               }
           }
           setCurrentTrackIndex(prev => (prev - 1 + playlist.length) % playlist.length);
      }
  }, [playlist, currentTrackIndex, recentHistory, addToHistory]);

  const handleRemoveTrack = useCallback((idToRemove: string) => {
    const currentTrackId = playlist[currentTrackIndex]?.id;
    
    deleteTrackFromDB(idToRemove).catch(console.error);

    const trackToRemove = playlist.find(t => t.id === idToRemove);
    if (trackToRemove) {
        URL.revokeObjectURL(trackToRemove.url);
    }

    setPlaylist(prev => {
        const newPlaylist = prev.filter(t => t.id !== idToRemove);
        
        if (idToRemove === currentTrackId) {
            if (newPlaylist.length === 0) {
                setCurrentTrackIndex(0);
            } else {
                setCurrentTrackIndex(prevIndex => Math.min(prevIndex, newPlaylist.length - 1));
            }
        } 
        else {
            const newIndex = newPlaylist.findIndex(t => t.id === currentTrackId);
            if (newIndex !== -1) {
                setCurrentTrackIndex(newIndex);
            }
        }
        return newPlaylist;
    });
  }, [playlist, currentTrackIndex]);

  const handlePriorityChange = useCallback((id: string, newPriority: number) => {
      updateTrackPriorityInDB(id, newPriority).catch(console.error);

      setPlaylist(prev => {
          return prev.map(track => 
              track.id === id ? { ...track, priority: newPriority } : track
          );
      });
  }, []);

  const handleLoopCountChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setLoopCount(Number(event.target.value));
  };

  const handleSpeedChange = (index: number, value: number) => {
    setPlaybackSpeeds(prev => {
      const newSpeeds = [...prev];
      newSpeeds[index] = value;
      return newSpeeds;
    });
  };

  const toggleShuffle = useCallback(() => {
      setIsShuffleOn(prev => !prev);
  }, []);

  const sortedPlaylist = useMemo(() => {
    if (sortOrder === 'recent' && recentHistory.length > 0) {
      const historyMap = new Map(recentHistory.map((id, index) => [id, index]));
      const sorted = [...playlist].sort((a, b) => {
          const indexA = historyMap.has(a.id) ? historyMap.get(a.id)! : Infinity;
          const indexB = historyMap.has(b.id) ? historyMap.get(b.id)! : Infinity;
          return indexA - indexB; 
      });
      return sorted;
    }
    return playlist;
  }, [playlist, sortOrder, recentHistory]);

  const currentTrackIndexInSorted = useMemo(() => {
    const currentTrack = playlist[currentTrackIndex];
    if (!currentTrack) return 0;
    return sortedPlaylist.findIndex(track => track.id === currentTrack.id);
  }, [playlist, currentTrackIndex, sortedPlaylist]);

  const handleSortedTrackSelect = useCallback((sortedIndex: number) => {
      const selectedTrack = sortedPlaylist[sortedIndex];
      const mainIndex = playlist.findIndex(t => t.id === selectedTrack.id);
      handleTrackSelect(mainIndex);
    }, [sortedPlaylist, playlist, handleTrackSelect]);
  
    const formatTime = (totalSeconds: number) => {
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const pad = (num: number) => String(num).padStart(2, '0');
      return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    };
  
    if (isLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black flex items-center justify-center text-white">
                <Loader2 size={48} className="animate-spin text-blue-500" />
            </div>
        );
    }

    return (
      <div  
      className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black text-gray-100 font-sans selection:bg-blue-500/30 relative flex flex-col"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-blue-600/20 backdrop-blur-sm border-4 border-blue-500 border-dashed m-4 rounded-3xl flex flex-col items-center justify-center pointer-events-none">
          <FileAudio size={80} className="text-blue-400 mb-4 animate-bounce" />
          <h2 className="text-3xl font-bold text-white drop-shadow-md">Drop Audio Files Here</h2>
        </div>
      )}

      <header className="p-6 border-b border-white/5 bg-black/20 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <h1 className="text-2xl font-bold flex items-center gap-3">
                <img src={logo} alt="Audio Replayer Logo" className="w-8 h-8" />
                <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">Audio Replayer</span>
                <span className="text-sm text-gray-400 ml-4 hidden sm:inline-block">
                  Session: {formatTime(sessionTime)}
                </span>
                <span className="text-xs text-gray-400 ml-2 sm:hidden font-mono">
                  {formatTime(sessionTime)}
                </span>
            </h1>
            
            <div className="flex gap-3">
                <input
                type="file"
                accept="audio/*"
                multiple
                onChange={handleFileChange}
                className="hidden"
                ref={fileInputRef}
                />
            </div>
          </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 md:p-8 w-full flex-grow">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          <div className="lg:col-span-7 flex flex-col space-y-6" ref={leftColumnRef}>
             {playlist.length > 0 ? (
                <Player
                playlist={playlist}
                currentTrackIndex={currentTrackIndex}
                onTrackEnd={handleTrackEnd}
                playbackSpeeds={playbackSpeeds}
                loopCount={loopCount}
                onNextTrack={handleNextTrack}
                onPreviousTrack={handlePreviousTrack}
                isShuffleOn={isShuffleOn}
                onToggleShuffle={toggleShuffle}
                isPlaying={isPlaying} 
                setIsPlaying={setIsPlaying} 
                />
            ) : (
                <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center text-gray-500 flex flex-col items-center justify-center h-[320px] cursor-pointer hover:bg-white/10 transition-colors"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                >
                    <Upload size={48} className="mb-4 opacity-50"/>
                    <h3 className="text-xl font-semibold mb-2 text-gray-300">Start Your Session</h3>
                    <p>Add audio files to begin practicing.</p>
                </div>
            )}
            
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl shadow-lg transition-all duration-300">
                {/* Collapsible header - only interactive on small screens */}
                <button 
                    onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                    className="w-full flex items-center justify-between text-gray-300 pb-2 focus:outline-none lg:cursor-default"
                >
                    <div className="flex items-center gap-2">
                        <Settings size={20} className="text-indigo-400" />
                        <h3 className="font-semibold">Playback Configuration</h3>
                    </div>
                    <span className="lg:hidden">
                        {isSettingsOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </span>
                </button>
                
                {/* Settings content - always visible on lg+, collapsible on smaller */}
                <div className={`grid grid-cols-1 md:grid-cols-2 gap-8 mt-6 ${isSettingsOpen ? 'block' : 'hidden lg:grid'}`}>
                        <div>
                            <label htmlFor="loop-count" className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">Loops per Track</label>
                            <select
                                id="loop-count"
                                value={loopCount}
                                onChange={handleLoopCountChange}
                                className="w-full bg-black/30 border border-white/10 text-white p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all appearance-none cursor-pointer hover:bg-black/40"
                            >
                                <option value={1}>1 Play (No Repeat)</option>
                                <option value={2}>2 Plays (Loop Once)</option>
                                <option value={3}>3 Plays (Loop Twice)</option>
                            </select>
                        </div>

                        <div>
                            <label htmlFor="sleep-timer" className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider flex items-center gap-2">
                                <Moon size={14} /> Sleep Timer
                            </label>
                            {sleepTimerDuration > 0 ? (
                                <div className="flex items-center justify-between bg-black/30 border border-white/10 p-3 rounded-xl h-[50px]">
                                    <span className="font-mono text-xl text-blue-400 tracking-wider">
                                        {formatTime(sleepTimerDuration)}
                                    </span>
                                    <button 
                                        onClick={() => setSleepTimerDuration(0)} 
                                        className="text-gray-400 hover:text-red-400 transition-colors p-1"
                                        title="Cancel Timer"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex gap-2 h-[50px]">
                                    <div className="relative flex-1">
                                        <input
                                            type="number"
                                            min="1"
                                            max="180"
                                            value={sleepMinutes}
                                            onChange={(e) => setSleepMinutes(Number(e.target.value))}
                                            className="w-full h-full bg-black/30 border border-white/10 text-white pl-3 pr-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-center no-spin appearance-none"
                                            placeholder="Min"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">min</span>
                                    </div>
                                    <button
                                        onClick={() => {
                                            const totalSeconds = sleepMinutes * 60;
                                            if (totalSeconds > 0) {
                                                setSleepTimerDuration(totalSeconds);
                                                setIsPlaying(true);
                                            }
                                        }}
                                        className="bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-xl transition-all shadow-lg hover:shadow-blue-500/25 active:scale-95 flex items-center justify-center aspect-square"
                                        title="Start Timer"
                                    >
                                        <Play size={20} fill="currentColor" />
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="md:col-span-2 space-y-4">
                            <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">Adaptive Speed Control</label>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                {Array.from({ length: loopCount }).map((_, i) => (
                                    <div key={i} className="bg-black/20 p-4 rounded-xl border border-white/5 relative group">
                                        <div className="flex justify-between items-center mb-3">
                                            <span className="text-xs font-bold text-indigo-300">PASS {i + 1}</span>
                                            <span className="text-sm font-mono text-white bg-indigo-500/20 px-2 py-0.5 rounded">
                                                {(playbackSpeeds[i] || 1.0).toFixed(2)}x
                                            </span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0.5"
                                            max="2.0"
                                            step="0.05"
                                            value={playbackSpeeds[i] || 1.0}
                                            onChange={(e) => handleSpeedChange(i, Number(e.target.value))}
                                            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
            </div>
          </div>

          <div 
            className="lg:col-span-5 flex flex-col lg:sticky lg:top-24"
            style={{ height: playlistHeight ? `${playlistHeight}px` : 'auto' }}
          >
             <Playlist
                playlist={sortedPlaylist} 
                currentTrackIndex={currentTrackIndexInSorted}
                onTrackSelect={handleSortedTrackSelect}
                onRemoveTrack={handleRemoveTrack}
                onPriorityChange={handlePriorityChange}
                sortOrder={sortOrder}
                setSortOrder={setSortOrder}
                
                playlists={playlists}
                currentPlaylistId={currentPlaylistId}
                onPlaylistChange={setCurrentPlaylistId}
                onCreatePlaylist={handleCreatePlaylist}
                onDeletePlaylist={handleDeletePlaylist}
                onAddFiles={() => fileInputRef.current?.click()}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;