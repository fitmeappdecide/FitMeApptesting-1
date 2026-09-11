import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { tryOnApi, TryOnHistoryItem } from './api';

type LooksState = {
  generatedLooks: TryOnHistoryItem[];
  savedLooks: TryOnHistoryItem[];
  generatedPage: number;
  savedPage: number;
  generatedHasMore: boolean;
  savedHasMore: boolean;
  generatedLoadingMore: boolean;
  savedLoadingMore: boolean;
  loading: boolean;
  refreshing: boolean;

  fetchLooks: (forceRefresh?: boolean) => Promise<void>;
  fetchNextPage: (tab: 'Generated' | 'Saved') => Promise<void>;
  toggleSave: (jobId: string) => Promise<void>;
  deleteLook: (jobId: string) => Promise<void>;
  clearAll: () => Promise<void>;
};

let inFlightFetchLooks: Promise<void> | null = null;

export const useLooksStore = create<LooksState>()(
  persist(
    (set, get) => ({
      generatedLooks: [],
      savedLooks: [],
      generatedPage: 1,
      savedPage: 1,
      generatedHasMore: true,
      savedHasMore: true,
      generatedLoadingMore: false,
      savedLoadingMore: false,
      loading: false,
      refreshing: false,

      fetchLooks: async (forceRefresh = false) => {
        if (inFlightFetchLooks && !forceRefresh) {
          return inFlightFetchLooks;
        }

        const runFetch = async () => {
          const hasExisting = get().generatedLooks.length > 0 || get().savedLooks.length > 0;
          if (!hasExisting && !forceRefresh) {
            set({ loading: true });
          }
          if (forceRefresh) {
            set({ refreshing: true });
          }

          try {
            const [genRes, savedRes] = await Promise.all([
              tryOnApi
                .getHistory({
                  status: 'completed',
                  saved_only: false,
                  page: 1,
                  limit: 20,
                })
                .catch((err) => {
                  console.warn('[LooksStore] Error fetching generated looks:', err?.message || err);
                  return null;
                }),
              tryOnApi
                .getHistory({
                  status: 'completed',
                  saved_only: true,
                  page: 1,
                  limit: 20,
                })
                .catch((err) => {
                  console.warn('[LooksStore] Error fetching saved looks:', err?.message || err);
                  return null;
                }),
            ]);

            if (Array.isArray(genRes)) {
              set({
                generatedLooks: genRes,
                generatedPage: 1,
                generatedHasMore: genRes.length >= 20,
                generatedLoadingMore: false,
              });
              AsyncStorage.setItem('fitme_home_recent_tryons', JSON.stringify(genRes.slice(0, 8))).catch(() => {});
            }
            if (Array.isArray(savedRes)) {
              set({
                savedLooks: savedRes,
                savedPage: 1,
                savedHasMore: savedRes.length >= 20,
                savedLoadingMore: false,
              });
            }
          } finally {
            set({ loading: false, refreshing: false });
            inFlightFetchLooks = null;
          }
        };

        inFlightFetchLooks = runFetch();
        return inFlightFetchLooks;
      },

      fetchNextPage: async (tab: 'Generated' | 'Saved') => {
        if (tab === 'Generated') {
          const { generatedLoadingMore, generatedHasMore, generatedPage, generatedLooks, loading, refreshing } = get();
          if (generatedLoadingMore || !generatedHasMore || loading || refreshing) return;

          set({ generatedLoadingMore: true });
          const nextPage = generatedPage + 1;

          try {
            const res = await tryOnApi.getHistory({
              status: 'completed',
              saved_only: false,
              page: nextPage,
              limit: 20,
            });

            if (Array.isArray(res)) {
              const currentItems = get().generatedLooks;
              const existingIds = new Set(currentItems.map((i) => i.id));
              const newUniqueItems = res.filter((i) => !existingIds.has(i.id));

              set({
                generatedLooks: [...currentItems, ...newUniqueItems],
                generatedPage: nextPage,
                generatedHasMore: res.length >= 20,
                generatedLoadingMore: false,
              });
            } else {
              set({ generatedHasMore: false, generatedLoadingMore: false });
            }
          } catch (err) {
            console.warn('Failed to fetch next page of generated looks:', err);
            set({ generatedLoadingMore: false });
          }
        } else {
          const { savedLoadingMore, savedHasMore, savedPage, savedLooks, loading, refreshing } = get();
          if (savedLoadingMore || !savedHasMore || loading || refreshing) return;

          set({ savedLoadingMore: true });
          const nextPage = savedPage + 1;

          try {
            const res = await tryOnApi.getHistory({
              status: 'completed',
              saved_only: true,
              page: nextPage,
              limit: 20,
            });

            if (Array.isArray(res)) {
              const currentItems = get().savedLooks;
              const existingIds = new Set(currentItems.map((i) => i.id));
              const newUniqueItems = res.filter((i) => !existingIds.has(i.id));

              set({
                savedLooks: [...currentItems, ...newUniqueItems],
                savedPage: nextPage,
                savedHasMore: res.length >= 20,
                savedLoadingMore: false,
              });
            } else {
              set({ savedHasMore: false, savedLoadingMore: false });
            }
          } catch (err) {
            console.warn('Failed to fetch next page of saved looks:', err);
            set({ savedLoadingMore: false });
          }
        }
      },

      toggleSave: async (jobId: string) => {
        const currentGen = get().generatedLooks;
        const currentSaved = get().savedLooks;
        const target = currentGen.find((l) => l.id === jobId);
        const isSavedNow = !target?.is_saved;

        set({
          generatedLooks: currentGen.map((l) =>
            l.id === jobId ? { ...l, is_saved: isSavedNow } : l
          ),
          savedLooks:
            isSavedNow && target
              ? [{ ...target, is_saved: true }, ...currentSaved.filter((l) => l.id !== jobId)]
              : currentSaved.filter((l) => l.id !== jobId),
        });

        try {
          await tryOnApi.toggleSave(jobId);
        } catch (e) {
          get().fetchLooks(true);
        }
      },

      deleteLook: async (jobId: string) => {
        set({
          generatedLooks: get().generatedLooks.filter((l) => l.id !== jobId),
          savedLooks: get().savedLooks.filter((l) => l.id !== jobId),
        });
        try {
          await tryOnApi.delete(jobId);
        } catch (e) {
          get().fetchLooks(true);
        }
      },

      clearAll: async () => {
        set({
          generatedLooks: [],
          savedLooks: [],
          generatedPage: 1,
          savedPage: 1,
          generatedHasMore: false,
          savedHasMore: false,
        });
        try {
          await tryOnApi.clearAllHistory();
        } catch (e) {
          get().fetchLooks(true);
        }
      },
    }),
    {
      name: 'fitme_looks_phone_cache_v3',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        generatedLooks: state.generatedLooks,
        savedLooks: state.savedLooks,
      }),
    }
  )
);
