import { openDB } from 'idb';

const DB_NAME = 'AudioPlayerDB';
const TRACKS_STORE = 'tracks';
const PLAYLISTS_STORE = 'playlists';

export interface StoredPlaylist {
  id: string;
  name: string;
  createdAt: number;
}

export interface StoredTrack {
  id: string;
  playlistId: string;
  file: File;
  name: string;
  priority: number;
  addedAt: number;
}

const dbPromise = openDB(DB_NAME, 2, {
  async upgrade(db, oldVersion, _newVersion, transaction) {
    // Ensure Tracks store exists (Version 1)
    if (!db.objectStoreNames.contains(TRACKS_STORE)) {
      const trackStore = db.createObjectStore(TRACKS_STORE, { keyPath: 'id' });
      trackStore.createIndex('addedAt', 'addedAt');
    }

    // Version 2 Migration: Multiple Playlists
    if (oldVersion < 2) {
      const trackStore = transaction.objectStore(TRACKS_STORE);
      
      // 1. Create Playlists Store
      if (!db.objectStoreNames.contains(PLAYLISTS_STORE)) {
          const playlistStore = db.createObjectStore(PLAYLISTS_STORE, { keyPath: 'id' });
          playlistStore.createIndex('createdAt', 'createdAt');
          
          // Create a Default Playlist for existing tracks
          const defaultPlaylistId = crypto.randomUUID();
          await playlistStore.add({
              id: defaultPlaylistId,
              name: 'Default Playlist',
              createdAt: Date.now()
          });

          // 2. Assign existing tracks to the Default Playlist
          let cursor = await trackStore.openCursor();
          while (cursor) {
              const track = cursor.value;
              // Only update if missing (safety)
              if (!track.playlistId) {
                  track.playlistId = defaultPlaylistId;
                  await cursor.update(track);
              }
              cursor = await cursor.continue();
          }
      }

      // 3. Add index for querying tracks by playlist
      if (!trackStore.indexNames.contains('playlistId')) {
          trackStore.createIndex('playlistId', 'playlistId');
      }
    }
  },
});

// --- Playlist Operations ---

export const getPlaylists = async (): Promise<StoredPlaylist[]> => {
    const db = await dbPromise;
    return db.getAllFromIndex(PLAYLISTS_STORE, 'createdAt');
};

export const createPlaylist = async (name: string): Promise<StoredPlaylist> => {
    const db = await dbPromise;
    const playlist = {
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now()
    };
    await db.add(PLAYLISTS_STORE, playlist);
    return playlist;
};

export const deletePlaylist = async (id: string) => {
    const db = await dbPromise;
    const tx = db.transaction([PLAYLISTS_STORE, TRACKS_STORE], 'readwrite');
    const playlists = tx.objectStore(PLAYLISTS_STORE);
    const tracks = tx.objectStore(TRACKS_STORE);
    const playlistIdIndex = tracks.index('playlistId');

    // 1. Delete the playlist itself
    await playlists.delete(id);

    // 2. Delete all tracks belonging to this playlist
    let cursor = await playlistIdIndex.openCursor(IDBKeyRange.only(id));
    while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
    }
    
    await tx.done;
};

// --- Track Operations ---

export const addTrackToDB = async (track: StoredTrack) => {
  const db = await dbPromise;
  return db.put(TRACKS_STORE, track);
};

export const getTracksForPlaylist = async (playlistId: string): Promise<StoredTrack[]> => {
  const db = await dbPromise;
  return db.getAllFromIndex(TRACKS_STORE, 'playlistId', playlistId)
    .then(tracks => tracks.sort((a, b) => {
        if (a.addedAt !== b.addedAt) {
            return a.addedAt - b.addedAt;
        }
        return a.name.localeCompare(b.name);
    }));
};

export const deleteTrackFromDB = async (id: string) => {
  const db = await dbPromise;
  return db.delete(TRACKS_STORE, id);
};

export const updateTrackPriorityInDB = async (id: string, priority: number) => {
    const db = await dbPromise;
    const track = await db.get(TRACKS_STORE, id);
    if (track) {
        track.priority = priority;
        await db.put(TRACKS_STORE, track);
    }
};