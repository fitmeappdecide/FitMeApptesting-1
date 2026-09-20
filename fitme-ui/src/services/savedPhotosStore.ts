import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { savedPhotosApi, SavedPhoto } from './api';

type SavedPhotosState = {
  photos: SavedPhoto[];
  loading: boolean;
  error: string | null;

  fetchPhotos: () => Promise<void>;
  uploadPhoto: (uri: string, name?: string) => Promise<SavedPhoto>;
  renamePhoto: (id: string, name: string) => Promise<void>;
  deletePhoto: (id: string) => Promise<void>;
  clearAll: () => void;
};

let inFlightFetchPhotos: Promise<void> | null = null;

export const useSavedPhotosStore = create<SavedPhotosState>()(
  persist(
    (set, get) => ({
      photos: [],
      loading: false,
      error: null,

      fetchPhotos: async () => {
        if (inFlightFetchPhotos) {
          return inFlightFetchPhotos;
        }

        inFlightFetchPhotos = (async () => {
          try {
            if (get().photos.length === 0) {
              set({ loading: true, error: null });
            }
            const remotePhotos = await savedPhotosApi.list();
            if (Array.isArray(remotePhotos)) {
              // Only keep real user photos (exclude demo mock photos)
              const realPhotos = remotePhotos.filter((p) => !p.id.startsWith('demo-'));
              set({ photos: realPhotos });
            }
          } catch (err: any) {
            console.warn('Failed to fetch saved photos from backend:', err?.message);
            set({ error: err?.message || 'Could not load saved photos' });
          } finally {
            set({ loading: false });
            inFlightFetchPhotos = null;
          }
        })();

        return inFlightFetchPhotos;
      },

      uploadPhoto: async (uri: string, name?: string) => {
        try {
          set({ loading: true, error: null });
          let newPhoto: SavedPhoto;
          try {
            newPhoto = await savedPhotosApi.upload(uri, name);
          } catch (apiErr) {
            // Local fallback for testing
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
              user_id: 'local',
              display_name: autoName,
              storage_path: uri,
              signed_url: uri,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
          }

          set((state) => {
            const alreadyExists = state.photos.some((p) => p.id === newPhoto.id);
            if (alreadyExists) {
              return state;
            }
            return {
              photos: [newPhoto, ...state.photos.filter((p) => p.id !== newPhoto.id && !p.id.startsWith('demo-'))],
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
        try {
          if (!id.startsWith('demo-') && !id.startsWith('local-')) {
            await savedPhotosApi.rename(id, name);
          }
          set((state) => ({
            photos: state.photos.map((p) =>
              p.id === id ? { ...p, display_name: name, updated_at: new Date().toISOString() } : p
            ),
          }));
        } catch (err: any) {
          console.error('Failed to rename photo:', err);
          set((state) => ({
            photos: state.photos.map((p) =>
              p.id === id ? { ...p, display_name: name } : p
            ),
          }));
        }
      },

      deletePhoto: async (id: string) => {
        try {
          if (!id.startsWith('demo-') && !id.startsWith('local-')) {
            await savedPhotosApi.delete(id);
          }
          set((state) => ({
            photos: state.photos.filter((p) => p.id !== id),
          }));
        } catch (err: any) {
          console.error('Failed to delete photo:', err);
          set((state) => ({
            photos: state.photos.filter((p) => p.id !== id),
          }));
        }
      },

      clearAll: () => {
        set({ photos: [] });
      },
    }),
    {
      name: 'fitme_saved_photos_cache_v2',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
