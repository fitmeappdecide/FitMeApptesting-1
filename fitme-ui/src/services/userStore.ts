import { create } from 'zustand';

export type UserPhoto = {
  id: string;
  uri: string;
  age: string;
  name?: string;
};

type UserState = {
  isPremium: boolean;
  photos: UserPhoto[];
  
  setPremium: (isPremium: boolean) => void;
  addPhoto: (photo: UserPhoto) => void;
  deletePhoto: (id: string) => void;
  renamePhoto: (id: string, name: string) => void;
};

const initialPhotos: UserPhoto[] = [
  { id: '1', uri: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&h=800&q=80', age: '2 days ago', name: 'Look 1' },
  { id: '2', uri: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&h=800&q=80', age: '1 week ago', name: 'Look 2' },
];

export const useUserStore = create<UserState>((set) => ({
  isPremium: false, // Default to Free tier for testing
  photos: initialPhotos,

  setPremium: (isPremium) => set({ isPremium }),
  
  addPhoto: (photo) => set((state) => ({ 
    photos: [photo, ...state.photos] 
  })),
  
  deletePhoto: (id) => set((state) => ({ 
    photos: state.photos.filter((p) => p.id !== id) 
  })),
  
  renamePhoto: (id, name) => set((state) => ({
    photos: state.photos.map((p) => (p.id === id ? { ...p, name } : p))
  })),
}));
