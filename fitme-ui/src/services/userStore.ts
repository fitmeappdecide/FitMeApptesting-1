// fitme-ui/src/services/userStore.ts

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { userApi, getAuthenticatedUserId, getSessionEpoch } from './api';
import { DatabaseManager, UserRepository, LocalUser } from '../repositories';

export type UserPhoto = {
  id: string;
  uri: string;
  age: string;
  name?: string;
};

export type UserProfileInfo = {
  user_id?: string | null;
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
  cachedUserId: string | null;
  lastFetchedAt: number | null;
  
  setPremium: (isPremium: boolean) => void;
  setProfile: (profile: Partial<UserProfileInfo>) => void;
  decrementTryOnCount: (amount?: number) => void;
  hydrateFromLocalUser: (localUser: LocalUser) => void;
  fetchProfile: (forceRefresh?: boolean) => Promise<void>;
  addPhoto: (photo: UserPhoto) => void;
  deletePhoto: (id: string) => void;
  renamePhoto: (id: string, name: string) => void;
  resetLocalState: () => void;
  clearProfile: () => void;
};

const PROFILE_TTL_MS = 60_000; // 60 seconds freshness window for the SAME authenticated user
let inFlightProfilePromise: Promise<void> | null = null;
let inFlightTargetUserId: string | null = null;

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      isPremium: false,
      photos: [],
      profile: null,
      cachedUserId: null,
      lastFetchedAt: null,

      setPremium: (isPremium) => {
        set({ isPremium });
        const activeUserId = getAuthenticatedUserId();
        if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
          const current = get().profile;
          UserRepository.upsertUser({
            id: activeUserId,
            email: current?.email || '',
            is_premium: isPremium,
          }).catch(() => {});
        }
      },

      setProfile: (newProfile) => {
        set((state) => ({
          profile: { ...(state.profile || {}), ...newProfile },
        }));
        const activeUserId = getAuthenticatedUserId();
        if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
          const current = get().profile;
          UserRepository.upsertUser({
            id: activeUserId,
            email: current?.email || newProfile.email || '',
            full_name: newProfile.full_name !== undefined ? newProfile.full_name : current?.full_name,
            avatar_uri: newProfile.avatar_uri !== undefined ? newProfile.avatar_uri : current?.avatar_uri,
            try_on_count: newProfile.try_on_count !== undefined ? newProfile.try_on_count : current?.try_on_count,
            saved_count: newProfile.saved_count !== undefined ? newProfile.saved_count : current?.saved_count,
          }).catch(() => {});
        }
      },

      decrementTryOnCount: (amount = 1) => {
        const current = get().profile;
        const currentCount = typeof current?.try_on_count === 'number' ? current.try_on_count : 0;
        const newCount = Math.max(0, currentCount - amount);
        get().setProfile({ try_on_count: newCount });
      },

      hydrateFromLocalUser: (localUser: LocalUser) => {
        set({
          profile: {
            user_id: localUser.id,
            full_name: localUser.full_name,
            email: localUser.email,
            avatar_uri: localUser.avatar_uri,
            try_on_count: localUser.try_on_count,
            saved_count: localUser.saved_count,
          },
          isPremium: localUser.is_premium,
          cachedUserId: localUser.id,
          lastFetchedAt: localUser.updated_at || Date.now(),
        });
      },

      fetchProfile: async (forceRefresh = false) => {
        const activeUserId = getAuthenticatedUserId();
        const currentEpoch = getSessionEpoch();

        if (!activeUserId) {
          return Promise.resolve();
        }

        // 1. Local SQLite Read First: Hydrate immediately if database is active
        try {
          if (DatabaseManager.getActiveUserId() === activeUserId) {
            const localUser = await UserRepository.getUser(activeUserId);
            if (localUser && get().cachedUserId !== activeUserId) {
              get().hydrateFromLocalUser(localUser);
            }
          }
        } catch (sqliteErr) {
          console.warn('[UserStore] Local SQLite read notice:', sqliteErr);
        }

        // Check if an identical in-flight fetch is already active for this exact user
        if (inFlightProfilePromise && inFlightTargetUserId === activeUserId && !forceRefresh) {
          return inFlightProfilePromise;
        }

        const { lastFetchedAt, profile, cachedUserId } = get();
        // 60s TTL is ONLY valid if the cached user matches the active authenticated user
        if (
          !forceRefresh &&
          cachedUserId === activeUserId &&
          lastFetchedAt &&
          Date.now() - lastFetchedAt < PROFILE_TTL_MS &&
          profile
        ) {
          return Promise.resolve();
        }

        inFlightTargetUserId = activeUserId;
        inFlightProfilePromise = (async () => {
          try {
            const res: any = await userApi.getProfile();
            
            // Session guard: If user logged out or switched accounts during network transit, discard
            if (getSessionEpoch() !== currentEpoch || getAuthenticatedUserId() !== activeUserId) {
              console.log('[UserStore] Discarding stale profile response for user:', activeUserId);
              return;
            }

            if (res) {
              const current = get().cachedUserId === activeUserId ? get().profile : null;
              const resolvedUserId = res.user?.id || activeUserId;
              const updatedProfile: UserProfileInfo = {
                user_id: resolvedUserId,
                full_name: res.user?.full_name || res.user?.displayName || current?.full_name || null,
                email: res.user?.email || current?.email || null,
                avatar_uri: current?.avatar_uri || null,
                try_on_count: typeof res.try_on_count === 'number' ? res.try_on_count : current?.try_on_count ?? 0,
                saved_count: typeof res.saved_count === 'number' ? res.saved_count : current?.saved_count ?? 0,
              };

              // Persist server truth to SQLite
              try {
                if (DatabaseManager.getActiveUserId() === activeUserId) {
                  await UserRepository.upsertUser({
                    id: resolvedUserId,
                    email: updatedProfile.email || '',
                    full_name: updatedProfile.full_name,
                    avatar_uri: updatedProfile.avatar_uri,
                    try_on_count: updatedProfile.try_on_count ?? 0,
                    saved_count: updatedProfile.saved_count ?? 0,
                    is_premium: typeof res.is_premium === 'boolean' ? res.is_premium : get().isPremium,
                    updated_at: Date.now(),
                  });
                }
              } catch (saveErr) {
                console.warn('[UserStore] Failed to persist profile to SQLite:', saveErr);
              }

              // Update in-memory Zustand store
              set({
                profile: updatedProfile,
                cachedUserId: resolvedUserId,
                lastFetchedAt: Date.now(),
              });
            }
          } catch (err: any) {
            console.warn('[UserStore] Background profile sync status:', err?.message || err);
          } finally {
            if (inFlightTargetUserId === activeUserId) {
              inFlightProfilePromise = null;
              inFlightTargetUserId = null;
            }
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

      resetLocalState: () => {
        inFlightProfilePromise = null;
        inFlightTargetUserId = null;
        set({
          profile: null,
          isPremium: false,
          photos: [],
          cachedUserId: null,
          lastFetchedAt: null,
        });
      },

      clearProfile: () => {
        get().resetLocalState();
      },
    }),
    {
      name: 'fitme_user_phone_cache_v2',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        isPremium: state.isPremium,
        photos: state.photos,
        profile: state.profile,
        cachedUserId: state.cachedUserId,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);
