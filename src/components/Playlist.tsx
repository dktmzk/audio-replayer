import React from 'react';
import { Trash2, Music, SortAsc, History, Plus, ListMusic, Upload } from 'lucide-react';
import { type StoredPlaylist } from '../db';

interface Track {
  id: string;
  url: string;
  name: string;
  priority: number;
}

interface PlaylistProps {
  playlist: Track[];
  currentTrackIndex: number;
  onTrackSelect: (index: number) => void;
  onRemoveTrack: (id: string) => void;
  onPriorityChange: (id: string, newPriority: number) => void;
  sortOrder: 'recent' | 'added';
  setSortOrder: (order: 'recent' | 'added') => void;
  
  // New Props for Selector
  playlists: StoredPlaylist[];
  currentPlaylistId: string | null;
  onPlaylistChange: (id: string) => void;
  onCreatePlaylist: () => void;
  onDeletePlaylist: () => void;
  onAddFiles: () => void;
}

const Playlist: React.FC<PlaylistProps> = ({ 
    playlist, 
    currentTrackIndex, 
    onTrackSelect, 
    onRemoveTrack, 
    onPriorityChange, 
    sortOrder, 
    setSortOrder,
    playlists,
    currentPlaylistId,
    onPlaylistChange,
    onCreatePlaylist,
    onDeletePlaylist,
    onAddFiles
}) => {
  
  const handleSliderClick = (e: React.MouseEvent<HTMLDivElement>, trackId: string) => {
    e.stopPropagation(); // Prevent track selection
    const sliderWrapper = e.currentTarget;
    const sliderInput = sliderWrapper.querySelector('input[type="range"]') as HTMLInputElement;

    if (!sliderInput) return;

    const rect = sliderWrapper.getBoundingClientRect();
    const x = e.clientX - rect.left; // x position within the element.

    const min = parseFloat(sliderInput.min);
    const max = parseFloat(sliderInput.max);
    const step = parseFloat(sliderInput.step);

    // Calculate value based on click position
    let value = (x / rect.width) * (max - min) + min;

    // Snap to step (especially important for min/max/step=1)
    value = Math.round(value / step) * step;
    value = Math.max(min, Math.min(max, value)); // Clamp value

    onPriorityChange(trackId, value);
  };

  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl shadow-xl overflow-hidden flex flex-col h-full">
      <div className="p-4 border-b border-white/10 bg-black/20">
        
        {/* Header with Selector */}
        <div className="flex items-center justify-between mb-3">
             <div className="flex items-center gap-2 flex-1 min-w-0 mr-3">
                <ListMusic className="text-blue-400 flex-shrink-0" size={20} />
                <select 
                    value={currentPlaylistId || ''} 
                    onChange={(e) => onPlaylistChange(e.target.value)}
                    className="bg-black/30 text-white border border-white/10 rounded-lg p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none w-full font-medium"
                >
                    {playlists.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>
            </div>
            <div className="flex gap-1">
                <button onClick={onCreatePlaylist} title="New Playlist" className="p-2 hover:bg-white/10 rounded-lg text-green-400 transition-colors">
                    <Plus size={18} />
                </button>
                <button onClick={onDeletePlaylist} title="Delete Playlist" className="p-2 hover:bg-white/10 rounded-lg text-red-400 transition-colors">
                    <Trash2 size={18} />
                </button>
            </div>
        </div>

        {/* Sub-header: Add & Sort */}
        <div className="flex items-center gap-3">
            <button 
                onClick={onAddFiles}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-2 shadow-lg transition-all active:scale-95 whitespace-nowrap"
            >
                <Upload size={14} /> Add Tracks
            </button>

            {/* Sort Order Control */}
            <div className="flex bg-black/30 rounded-lg p-0.5 text-xs flex-1">
                <button
                    onClick={() => setSortOrder('added')}
                    className={`flex-1 px-3 py-1 rounded-md transition-all flex items-center justify-center gap-1 ${
                        sortOrder === 'added' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    }`}
                >
                    <SortAsc size={14} /> Added
                </button>
                <button
                    onClick={() => setSortOrder('recent')}
                    className={`flex-1 px-3 py-1 rounded-md transition-all flex items-center justify-center gap-1 ${
                        sortOrder === 'recent' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    }`}
                >
                    <History size={14} /> Recent
                </button>
            </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
        {playlist.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-60">
             <Music size={48} className="mb-2"/>
             <p>No tracks added</p>
          </div>
        ) : (
          playlist.map((track, index) => (
            <div
              key={track.id}
              onClick={() => onTrackSelect(index)}
              className={`group flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all duration-200 border border-transparent ${
                index === currentTrackIndex 
                  ? 'bg-blue-600/20 border-blue-500/30 text-blue-100 shadow-[0_0_15px_rgba(59,130,246,0.15)]' 
                  : 'hover:bg-white/5 hover:border-white/10 text-gray-300'
              }`}
            >
              {/* Left Col: Index & Name */}
              <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
                  <span className={`text-xs font-mono w-5 text-right flex-shrink-0 ${index === currentTrackIndex ? 'text-blue-400' : 'text-gray-600'}`}>
                      {index + 1}
                  </span>
                  <span className="truncate font-medium text-sm">{track.name}</span>
              </div>

              {/* Right Col: Priority Slider & Delete */}
              <div className="flex items-center gap-3 flex-shrink-0">
                  {/* Priority Slider with larger click area */}
                  <div 
                    className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity"
                  >
                      <div 
                        className="relative h-6 w-20 cursor-pointer rounded-lg"
                        onClick={(e) => handleSliderClick(e, track.id)}
                      >
                        <input 
                          type="range" 
                          min="1" 
                          max="3" 
                          step="1"
                          value={track.priority ?? 2} 
                          onChange={(e) => { e.stopPropagation(); onPriorityChange(track.id, Number(e.target.value)); }}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        />
                        {/* Visual Track */}
                        <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 bg-gray-600 pointer-events-none rounded-lg" />
                        {/* Visual Thumb */}
                        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md pointer-events-none"
                            style={{ left: `${((track.priority ?? 2) - 1) * 50}%`, transform: 'translateX(-50%)' }}
                        />
                      </div>
                      
                      <span className={`text-[9px] font-bold w-7 text-center tracking-wide ${
                          (track.priority === 1) ? 'text-emerald-400' :
                          (track.priority === 3) ? 'text-rose-400' : 'text-amber-400'
                      }`}>
                          {(track.priority === 1) ? 'LOW' : (track.priority === 3) ? 'HIGH' : 'MED'}
                      </span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation(); 
                      onRemoveTrack(track.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                    title="Remove Track"
                  >
                    <Trash2 size={14} />
                  </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Playlist;