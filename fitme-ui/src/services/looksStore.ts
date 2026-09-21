import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { tryOnApi, TryOnHistoryItem, getAuthenticatedUserId, getSessionEpoch } from './api';
import { DatabaseManager, LooksRepository, LocalTryOnJob, TryOnStatus } from '../repositories';
import { useUserStore } from './userStore';

export function mapLocalJobToHistoryItem(job: LocalTryOnJob): TryOnHistoryItem {
  const resultUrls =
    job.result_image_urls && job.result_image_urls.length > 0
      ? job.result_image_urls
      : job.local_image_paths && job.local_image_paths.length > 0
      ? job.local_image_paths
      : [];

  return {
    id: job.server_id || job.local_id,
    garment_id: job.garment_id,
    status: job.status,
    result_image_urls: resultUrls,
    thumbnail_url: resultUrls[0] || null,
    created_at:
      typeof job.created_at === 'number'
        ? new Date(job.created_at).toISOString()
        : String(job.created_at || ''),
    is_saved: job.is_saved,
    saved_photo_id: job.saved_photo_id || null,
    saved_photo_name: job.saved_photo_name || null,
    brand: job.brand_id || null,
    title: null,
    platform: null,
  };
}

export function mapHistoryItemToLocalJob(
  item: TryOnHistoryItem,
  activeUserId: string
): Parameters<typeof LooksRepository.insertTryOnJob>[0] {
  let createdAtMs = Date.now();
  if (item.created_at) {
    const parsed = Date.parse(item.created_at);
    if (!isNaN(parsed)) {
      createdAtMs = parsed;
    } else {
      const num = Number(item.created_at);
      if (!isNaN(num) && num > 0) {
        createdAtMs = num;
      }
    }
  }

  return {
    local_id: item.id,
    server_id: item.id,
    garment_id: item.garment_id || '',
    brand_id: item.brand || null,
    status: (item.status || 'completed') as TryOnStatus,
    result_image_urls: item.result_image_urls || [],
    local_image_paths: [],
    is_saved: Boolean(item.is_saved),
    saved_photo_id: item.saved_photo_id || null,
    saved_photo_name: item.saved_photo_name || null,
    created_at: createdAtMs,
    completed_at: createdAtMs,
    _sync_status: 'synced',
  };
}

type LooksState = {
  cachedUserId: string | null;
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

  hydrateFromLocalLooks: (
    generated: TryOnHistoryItem[],
    saved: TryOnHistoryItem[],
    userId?: string
  ) => void;
  fetchLooks: (forceRefresh?: boolean) => Promise<void>;
  fetchNextPage: (tab: 'Generated' | 'Saved') => Promise<void>;
  toggleSave: (jobId: string) => Promise<void>;
  deleteLook: (jobId: string) => Promise<void>;
  clearAll: () => Promise<void>;
  resetLocalState: () => void;
};

let inFlightFetchLooks: Promise<void> | null = null;
let inFlightTargetUserId: string | null = null;

export const useLooksStore = create<LooksState>()(
  persist(
    (set, get) => ({
      cachedUserId: null,
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

      hydrateFromLocalLooks: (
        generated: TryOnHistoryItem[],
        saved: TryOnHistoryItem[],
        userId?: string
      ) => {
        const activeUserId = userId || getAuthenticatedUserId();
        set({
          cachedUserId: activeUserId,
          generatedLooks: generated,
          savedLooks: saved,
          generatedPage: 1,
          savedPage: 1,
          generatedHasMore: generated.length >= 20,
          savedHasMore: saved.length >= 20,
          generatedLoadingMore: false,
          savedLoadingMore: false,
          loading: false,
          refreshing: false,
        });
      },

      fetchLooks: async (forceRefresh = false) => {
        const activeUserId = getAuthenticatedUserId();
        const currentEpoch = getSessionEpoch();

        if (!activeUserId) {
          return Promise.resolve();
        }

        // 1. Local SQLite Read First: Hydrate immediately if database is active (0ms UI latency)
        try {
          if (DatabaseManager.getActiveUserId() === activeUserId) {
            const [localGen, localSaved] = await Promise.all([
              LooksRepository.getGeneratedLooks(20, 0),
              LooksRepository.getSavedLooks(20, 0),
            ]);
            const mappedGen = localGen.map(mapLocalJobToHistoryItem);
            const mappedSaved = localSaved.map(mapLocalJobToHistoryItem);

            if (
              get().cachedUserId !== activeUserId ||
              mappedGen.length > 0 ||
              mappedSaved.length > 0
            ) {
              get().hydrateFromLocalLooks(mappedGen, mappedSaved, activeUserId);
            }
          }
        } catch (sqliteErr) {
          console.warn('[LooksStore] Local SQLite read notice:', sqliteErr);
        }

        // Check if an identical in-flight fetch is already active for this exact user
        if (inFlightFetchLooks && inFlightTargetUserId === activeUserId && !forceRefresh) {
          return inFlightFetchLooks;
        }

        const isSameUser = get().cachedUserId === activeUserId;
        const hasExisting =
          isSameUser && (get().generatedLooks.length > 0 || get().savedLooks.length > 0);
        if (!hasExisting || !isSameUser) {
          set({ loading: true });
        }
        if (forceRefresh) {
          set({ refreshing: true });
        }

        inFlightTargetUserId = activeUserId;
        inFlightFetchLooks = (async () => {
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

            // Guard: discard if session changed or user switched during network fetch
            if (
              getSessionEpoch() !== currentEpoch ||
              getAuthenticatedUserId() !== activeUserId ||
              inFlightTargetUserId !== activeUserId
            ) {
              console.log('[LooksStore] Discarding stale looks response for user:', activeUserId);
              return;
            }

            // Persist fresh server looks to SQLite
            if (DatabaseManager.getActiveUserId() === activeUserId) {
              try {
                if (Array.isArray(genRes)) {
                  for (const item of genRes) {
                    await LooksRepository.insertTryOnJob(
                      mapHistoryItemToLocalJob(item, activeUserId)
                    );
                  }
                }
                if (Array.isArray(savedRes)) {
                  for (const item of savedRes) {
                    await LooksRepository.insertTryOnJob(
                      mapHistoryItemToLocalJob(item, activeUserId)
                    );
                  }
                }
              } catch (dbSaveErr) {
                console.warn('[LooksStore] Failed to persist looks to SQLite:', dbSaveErr);
              }
            }

            // Update Zustand store
            if (Array.isArray(genRes)) {
              set({
                cachedUserId: activeUserId,
                generatedLooks: genRes,
                generatedPage: 1,
                generatedHasMore: genRes.length >= 20,
                generatedLoadingMore: false,
              });
              AsyncStorage.setItem(
                'fitme_home_recent_tryons',
                JSON.stringify(genRes.slice(0, 8))
              ).catch(() => {});
            }
            if (Array.isArray(savedRes)) {
              set({
                cachedUserId: activeUserId,
                savedLooks: savedRes,
                savedPage: 1,
                savedHasMore: savedRes.length >= 20,
                savedLoadingMore: false,
              });
            }
          } finally {
            set({ loading: false, refreshing: false });
            if (inFlightTargetUserId === activeUserId) {
              inFlightFetchLooks = null;
              inFlightTargetUserId = null;
            }
          }
        })();

        return inFlightFetchLooks;
      },

      fetchNextPage: async (tab: 'Generated' | 'Saved') => {
        const activeUserId = getAuthenticatedUserId();
        const currentEpoch = getSessionEpoch();
        if (!activeUserId) return;

        if (tab === 'Generated') {
          const {
            generatedLoadingMore,
            generatedHasMore,
            generatedPage,
            loading,
            refreshing,
          } = get();
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

            // Guard session epoch
            if (getSessionEpoch() !== currentEpoch || getAuthenticatedUserId() !== activeUserId) {
              return;
            }

            if (Array.isArray(res)) {
              if (DatabaseManager.getActiveUserId() === activeUserId) {
                for (const item of res) {
                  await LooksRepository.insertTryOnJob(
                    mapHistoryItemToLocalJob(item, activeUserId)
                  ).catch(() => {});
                }
              }

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
          const { savedLoadingMore, savedHasMore, savedPage, loading, refreshing } =
            get();
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

            // Guard session epoch
            if (getSessionEpoch() !== currentEpoch || getAuthenticatedUserId() !== activeUserId) {
              return;
            }

            if (Array.isArray(res)) {
              if (DatabaseManager.getActiveUserId() === activeUserId) {
                for (const item of res) {
                  await LooksRepository.insertTryOnJob(
                    mapHistoryItemToLocalJob(item, activeUserId)
                  ).catch(() => {});
                }
              }

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
        const activeUserId = getAuthenticatedUserId();
        const currentGen = get().generatedLooks;
        const currentSaved = get().savedLooks;
        const target =
          currentGen.find((l) => l.id === jobId) || currentSaved.find((l) => l.id === jobId);
        const isSavedNow = target ? !target.is_saved : true;

        // Optimistic in-memory update
        set({
          generatedLooks: currentGen.map((l) =>
            l.id === jobId ? { ...l, is_saved: isSavedNow } : l
          ),
          savedLooks:
            isSavedNow && target
              ? [{ ...target, is_saved: true }, ...currentSaved.filter((l) => l.id !== jobId)]
              : currentSaved.filter((l) => l.id !== jobId),
        });

        // Optimistic SQLite mutation
        if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
          try {
            await LooksRepository.toggleSave(jobId);
          } catch (dbErr) {
            console.warn('[LooksStore] SQLite toggleSave error:', dbErr);
          }
        }

        try {
          await tryOnApi.toggleSave(jobId);
        } catch (e) {
          console.warn('[LooksStore] Server toggleSave error, reverting via refresh:', e);
          get().fetchLooks(true);
        }
      },

      deleteLook: async (jobId: string) => {
        const activeUserId = getAuthenticatedUserId();

        // Optimistic in-memory update
        set({
          generatedLooks: get().generatedLooks.filter((l) => l.id !== jobId),
          savedLooks: get().savedLooks.filter((l) => l.id !== jobId),
        });

        // Optimistically decrement local profile try-on count
        useUserStore.getState().decrementTryOnCount(1);

        // Optimistic SQLite deletion
        if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
          try {
            await LooksRepository.deleteLook(jobId);
          } catch (dbErr) {
            console.warn('[LooksStore] SQLite deleteLook error:', dbErr);
          }
        }

        try {
          await tryOnApi.delete(jobId);
        } catch (e) {
          console.warn('[LooksStore] Server deleteLook error, reverting via refresh:', e);
          get().fetchLooks(true);
          useUserStore.getState().fetchProfile(true).catch(() => {});
        }
      },

      clearAll: async () => {
        const activeUserId = getAuthenticatedUserId();

        // Optimistic in-memory clear
        set({
          generatedLooks: [],
          savedLooks: [],
          generatedPage: 1,
          savedPage: 1,
          generatedHasMore: false,
          savedHasMore: false,
        });

        // Optimistically reset local profile try-on count to 0
        useUserStore.getState().setProfile({ try_on_count: 0 });

        // Optimistic SQLite clear
        if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
          try {
            await LooksRepository.clearAll();
          } catch (dbErr) {
            console.warn('[LooksStore] SQLite clearAll error:', dbErr);
          }
        }

        try {
          await tryOnApi.clearAllHistory();
        } catch (e) {
          console.warn('[LooksStore] Server clearAll error, reverting via refresh:', e);
          get().fetchLooks(true);
          useUserStore.getState().fetchProfile(true).catch(() => {});
        }
      },

      resetLocalState: () => {
        inFlightFetchLooks = null;
        inFlightTargetUserId = null;
        set({
          cachedUserId: null,
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
        });
      },
    }),
    {
      name: 'fitme_looks_phone_cache_v3',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        cachedUserId: state.cachedUserId,
        generatedLooks: state.generatedLooks,
        savedLooks: state.savedLooks,
      }),
    }
  )
);

