import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { savedPhotosApi, SavedPhoto, getAuthenticatedUserId, getSessionEpoch } from './api';
import { DatabaseManager, SavedPhotosRepository, LocalUserSavedPhoto } from '../repositories';

export function mapLocalPhotoToSavedPhoto(local: LocalUserSavedPhoto): SavedPhoto {
  const url = local.local_file_uri || local.storage_path;
  return {
    id: local.id,
    user_id: local.user_id,
    display_name: local.display_name,
    storage_path: local.storage_path,
    original_filename: local.original_filename,
    mime_type: local.mime_type,
    signed_url: url,
    scan_id: null,
    created_at:
      typeof local.created_at === 'number'
        ? new Date(local.created_at).toISOString()
        : String(local.created_at || ''),
    updated_at:
      typeof local.updated_at === 'number'
        ? new Date(local.updated_at).toISOString()
        : String(local.updated_at || ''),
  };
}

export function mapSavedPhotoToLocalPhoto(
  photo: SavedPhoto,
  activeUserId: string
): Parameters<typeof SavedPhotosRepository.savePhoto>[0] {
  const createdAtMs = photo.created_at
    ? !isNaN(Date.parse(photo.created_at))
      ? Date.parse(photo.created_at)
      : Date.now()
    : Date.now();
  const updatedAtMs = photo.updated_at
    ? !isNaN(Date.parse(photo.updated_at))
      ? Date.parse(photo.updated_at)
      : Date.now()
    : Date.now();

  return {
    id: photo.id,
    storage_path: photo.storage_path || '',
    local_file_uri: photo.signed_url || photo.storage_path || '',
    display_name: photo.display_name || 'My Photo',
    original_filename: photo.original_filename || null,
    mime_type: photo.mime_type || 'image/jpeg',
    created_at: createdAtMs,
    updated_at: updatedAtMs,
    _sync_status: 'synced',
  };
}

type SavedPhotosState = {
  cachedUserId: string | null;
  photos: SavedPhoto[];
  loading: boolean;
  error: string | null;

  hydrateFromLocalPhotos: (photos: SavedPhoto[], userId?: string) => void;
  fetchPhotos: (forceRefresh?: boolean) => Promise<void>;
  uploadPhoto: (uri: string, name?: string) => Promise<SavedPhoto>;
  renamePhoto: (id: string, name: string) => Promise<void>;
  deletePhoto: (id: string) => Promise<void>;
  clearAll: () => void;
  resetLocalState: () => void;
};

let inFlightFetchPhotos: Promise<void> | null = null;
let inFlightTargetUserId: string | null = null;

export const useSavedPhotosStore = create<SavedPhotosState>()(
  persist(
    (set, get) => ({
      cachedUserId: null,
      photos: [],
      loading: false,
      error: null,

      hydrateFromLocalPhotos: (photos: SavedPhoto[], userId?: string) => {
        const activeUserId = userId || getAuthenticatedUserId();
        set({
          cachedUserId: activeUserId,
          photos,
          loading: false,
          error: null,
        });
      },

      fetchPhotos: async (forceRefresh = false) => {
        const activeUserId = getAuthenticatedUserId();
        const currentEpoch = getSessionEpoch();

        if (!activeUserId) {
          return Promise.resolve();
        }

        // 1. Local SQLite Read First: Hydrate immediately if database is active (0ms UI latency)
        try {
          if (DatabaseManager.getActiveUserId() === activeUserId) {
            const localPhotos = await SavedPhotosRepository.getPhotos();
            const mappedPhotos = localPhotos.map(mapLocalPhotoToSavedPhoto);

            if (get().cachedUserId !== activeUserId || mappedPhotos.length > 0) {
              get().hydrateFromLocalPhotos(mappedPhotos, activeUserId);
            }
          }
        } catch (sqliteErr) {
          console.warn('[SavedPhotosStore] Local SQLite read notice:', sqliteErr);
        }

        // Check if an identical in-flight fetch is already active for this exact user
        if (inFlightFetchPhotos && inFlightTargetUserId === activeUserId && !forceRefresh) {
          return inFlightFetchPhotos;
        }

        const isSameUser = get().cachedUserId === activeUserId;
        if (!isSameUser || get().photos.length === 0) {
          set({ loading: true, error: null });
        }

        inFlightTargetUserId = activeUserId;
        inFlightFetchPhotos = (async () => {
          try {
            const remotePhotos = await savedPhotosApi.list();

            // Guard: discard if user/session changed during network fetch
            if (
              getSessionEpoch() !== currentEpoch ||
              getAuthenticatedUserId() !== activeUserId ||
              inFlightTargetUserId !== activeUserId
            ) {
              console.log('[SavedPhotosStore] Discarding stale photos response');
              return;
            }

            if (Array.isArray(remotePhotos)) {
              // Only keep real user photos (exclude demo mock photos)
              const realPhotos = remotePhotos.filter((p) => !p.id.startsWith('demo-'));

              // Persist fresh server photos to SQLite
              if (DatabaseManager.getActiveUserId() === activeUserId) {
                try {
                  for (const photo of realPhotos) {
                    await SavedPhotosRepository.savePhoto(
                      mapSavedPhotoToLocalPhoto(photo, activeUserId)
                    );
                  }
                } catch (dbSaveErr) {
                  console.warn('[SavedPhotosStore] Failed to persist photos to SQLite:', dbSaveErr);
                }
              }

              // Update Zustand store
              set({
                cachedUserId: activeUserId,
                photos: realPhotos,
              });
            }
          } catch (err: any) {
            console.warn('Failed to fetch saved photos from backend:', err?.message || err);
            set({ error: err?.message || 'Could not load saved photos' });
          } finally {
            set({ loading: false });
            if (inFlightTargetUserId === activeUserId) {
              inFlightFetchPhotos = null;
              inFlightTargetUserId = null;
            }
          }
        })();

        return inFlightFetchPhotos;
      },

      uploadPhoto: async (uri: string, name?: string) => {
        const activeUserId = getAuthenticatedUserId();
        try {
          set({ loading: true, error: null });
          let newPhoto: SavedPhoto;
          try {
            newPhoto = await savedPhotosApi.upload(uri, name);
          } catch (apiErr) {
            // Local fallback for offline / mock testing
            const photoId = 'local-' + Date.now();
            const currentNames = get().photos.map((p) => p.display_name);
            let autoName = name?.trim();
            if (!autoName) {
              let n = 1;
              while (currentNames.includes(`My Photo ${n}`)) {
                n++;
              }
              autoName = `My Photo ${n}`;
            }
            newPhoto = {
              id: photoId,
              user_id: activeUserId || 'local',
              display_name: autoName,
              storage_path: uri,
              signed_url: uri,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
          }

          // Persist to local SQLite
          if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
            try {
              await SavedPhotosRepository.savePhoto(
                mapSavedPhotoToLocalPhoto(newPhoto, activeUserId)
              );
            } catch (dbErr) {
              console.warn('[SavedPhotosStore] SQLite savePhoto notice on upload:', dbErr);
            }
          }

          set((state) => {
            const alreadyExists = state.photos.some((p) => p.id === newPhoto.id);
            if (alreadyExists) {
              return state;
            }
            return {
              photos: [
                newPhoto,
                ...state.photos.filter((p) => p.id !== newPhoto.id && !p.id.startsWith('demo-')),
              ],
            };
          });
          return newPhoto;
        } catch (err: any) {
          console.error('Failed to upload saved photo:', err);
          set({ error: err?.message || 'Failed to save photo' });
          throw err;
        } finally {
          set({ loading: false });
        }
      },

      renamePhoto: async (id: string, name: string) => {
        const activeUserId = getAuthenticatedUserId();

        // Optimistic in-memory update
        set((state) => ({
          photos: state.photos.map((p) =>
            p.id === id ? { ...p, display_name: name, updated_at: new Date().toISOString() } : p
          ),
        }));

        // Optimistic SQLite update
        if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
          try {
            await SavedPhotosRepository.renamePhoto(id, name);
          } catch (dbErr) {
            console.warn('[SavedPhotosStore] SQLite renamePhoto error:', dbErr);
          }
        }

        try {
          if (!id.startsWith('demo-') && !id.startsWith('local-')) {
            await savedPhotosApi.rename(id, name);
          }
        } catch (err: any) {
          console.error('Failed to rename photo on server:', err);
          get().fetchPhotos(true);
        }
      },

      deletePhoto: async (id: string) => {
        const activeUserId = getAuthenticatedUserId();

        // Optimistic in-memory update
        set((state) => ({
          photos: state.photos.filter((p) => p.id !== id),
        }));

        // Optimistic SQLite update
        if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
          try {
            await SavedPhotosRepository.deletePhoto(id);
          } catch (dbErr) {
            console.warn('[SavedPhotosStore] SQLite deletePhoto error:', dbErr);
          }
        }

        try {
          if (!id.startsWith('demo-') && !id.startsWith('local-')) {
            await savedPhotosApi.delete(id);
          }
        } catch (err: any) {
          console.error('Failed to delete photo on server:', err);
          get().fetchPhotos(true);
        }
      },

      clearAll: () => {
        get().resetLocalState();
      },

      resetLocalState: () => {
        inFlightFetchPhotos = null;
        inFlightTargetUserId = null;
        set({
          cachedUserId: null,
          photos: [],
          loading: false,
          error: null,
        });
      },
    }),
    {
      name: 'fitme_saved_photos_cache_v2',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        cachedUserId: state.cachedUserId,
        photos: state.photos,
      }),
    }
  )
);

