import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { userApi } from './api';

export type UserPhoto = {
  id: string;
  uri: string;
  age: string;
  name?: string;
};

export type UserProfileInfo = {
  full_name?: string | null;
  email?: string | null;
  try_on_count?: number;
  saved_count?: number;
  avatar_uri?: string | null;
};

type UserState = {
  isPremium: boolean;
  photos: UserPhoto[];
  profile: UserProfileInfo | null;
  lastFetchedAt: number | null;
  
  setPremium: (isPremium: boolean) => void;
  setProfile: (profile: Partial<UserProfileInfo>) => void;
  fetchProfile: (forceRefresh?: boolean) => Promise<void>;
  addPhoto: (photo: UserPhoto) => void;
  deletePhoto: (id: string) => void;
  renamePhoto: (id: string, name: string) => void;
  clearProfile: () => void;
};

const PROFILE_TTL_MS = 60_000; // 60 seconds freshness window
let inFlightProfilePromise: Promise<void> | null = null;

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      isPremium: false,
      photos: [],
      profile: null,
      lastFetchedAt: null,

      setPremium: (isPremium) => set({ isPremium }),

      setProfile: (newProfile) =>
        set((state) => ({
          profile: { ...(state.profile || {}), ...newProfile },
        })),

      fetchProfile: async (forceRefresh = false) => {
        if (inFlightProfilePromise && !forceRefresh) {
          return inFlightProfilePromise;
        }

        const { lastFetchedAt, profile } = get();
        if (!forceRefresh && lastFetchedAt && Date.now() - lastFetchedAt < PROFILE_TTL_MS && profile) {
          return Promise.resolve();
        }

        inFlightProfilePromise = (async () => {
          try {
            const res: any = await userApi.getProfile();
            if (res) {
              const current = get().profile;
              const updated: UserProfileInfo = {
                full_name: res.user?.full_name || res.user?.displayName || current?.full_name || null,
                email: res.user?.email || current?.email || null,
                avatar_uri: current?.avatar_uri || null,
                try_on_count: typeof res.try_on_count === 'number' ? res.try_on_count : current?.try_on_count ?? 0,
                saved_count: typeof res.saved_count === 'number' ? res.saved_count : current?.saved_count ?? 0,
              };
              set({
                profile: updated,
                lastFetchedAt: Date.now(),
              });
            }
          } catch (err: any) {
            console.warn('[UserStore] Background profile sync status:', err?.message || err);
          } finally {
            inFlightProfilePromise = null;
          }
        })();

        return inFlightProfilePromise;
      },

      addPhoto: (photo) =>
        set((state) => ({
          photos: [photo, ...state.photos.filter((p) => p.id !== photo.id)],
        })),

      deletePhoto: (id) =>
        set((state) => ({
          photos: state.photos.filter((p) => p.id !== id),
        })),

      renamePhoto: (id, name) =>
        set((state) => ({
          photos: state.photos.map((p) => (p.id === id ? { ...p, name } : p)),
        })),

      clearProfile: () => {
        inFlightProfilePromise = null;
        set({
          profile: null,
          isPremium: false,
          photos: [],
          lastFetchedAt: null,
        });
      },
    }),
    {
      name: 'fitme_user_phone_cache_v2',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
