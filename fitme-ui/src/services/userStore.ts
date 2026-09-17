import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  
  setPremium: (isPremium: boolean) => void;
  setProfile: (profile: Partial<UserProfileInfo>) => void;
  addPhoto: (photo: UserPhoto) => void;
  deletePhoto: (id: string) => void;
  renamePhoto: (id: string, name: string) => void;
  clearProfile: () => void;
};

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      isPremium: false,
      photos: [],
      profile: null,

      setPremium: (isPremium) => set({ isPremium }),

      setProfile: (newProfile) =>
        set((state) => ({
          profile: { ...(state.profile || {}), ...newProfile },
        })),

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

      clearProfile: () =>
        set({
          profile: null,
          isPremium: false,
          photos: [],
        }),
    }),
    {
      name: 'fitme_user_phone_cache_v2',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
