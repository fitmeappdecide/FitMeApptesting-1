import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { tryOnApi, TryOnHistoryItem, getAuthenticatedUserId, getSessionEpoch } from './api';
import { DatabaseManager, LooksRepository, LocalTryOnJob, TryOnStatus } from '../repositories';
import { useUserStore } from './userStore';
import { persistJobImagesPermanently } from './imageStorage';

export function mapLocalJobToHistoryItem(job: LocalTryOnJob, existingItem?: TryOnHistoryItem | number | null): TryOnHistoryItem {
  const existing = typeof existingItem === 'object' && existingItem !== null ? existingItem : null;
  // Prefer local permanent disk paths for 100% offline access
  const resultUrls =
    job.local_image_paths && job.local_image_paths.length > 0
      ? job.local_image_paths
      : job.result_image_urls && job.result_image_urls.length > 0
      ? job.result_image_urls
      : [];

  return {
    id: job.server_id || job.local_id,
    garment_id: job.garment_id,
    status: job.status,
    result_image_urls: resultUrls,
    thumbnail_url: (job.local_image_paths && job.local_image_paths[0]) || (job.result_image_urls && job.result_image_urls[0]) || null,
    created_at:
      typeof job.created_at === 'number'
        ? new Date(job.created_at).toISOString()
        : String(job.created_at || ''),
    is_saved: job.is_saved,
    saved_photo_id: job.saved_photo_id || null,
    saved_photo_name: job.saved_photo_name || null,
    brand: job.brand_name || existing?.brand || job.brand_id || null,
    title: job.title || existing?.title || null,
    platform: job.platform || existing?.platform || null,
    garment_image_url: job.garment_image_url || existing?.garment_image_url || null,
    price: job.price ?? existing?.price ?? null,
    product_url: job.product_url || existing?.product_url || null,
  };
}

export function mapHistoryItemToLocalJob(
  item: TryOnHistoryItem,
  activeUserId: string,
  existingLocalPaths?: string[]
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

  const localPaths = existingLocalPaths && existingLocalPaths.length > 0
    ? existingLocalPaths
    : (item.result_image_urls || []).filter((u) => u.startsWith('file://'));

  return {
    local_id: item.id,
    server_id: item.id,
    garment_id: item.garment_id || '',
    brand_id: null,
    status: (item.status || 'completed') as TryOnStatus,
    result_image_urls: item.result_image_urls || [],
    local_image_paths: localPaths,
    is_saved: Boolean(item.is_saved),
    saved_photo_id: item.saved_photo_id || null,
    saved_photo_name: item.saved_photo_name || null,
    created_at: createdAtMs,
    completed_at: createdAtMs,
    _sync_status: 'synced',
    title: item.title || null,
    brand_name: item.brand || null,
    garment_image_url: item.garment_image_url || null,
    platform: item.platform || null,
    price: item.price ?? null,
    product_url: item.product_url || null,
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
          generatedPage: Math.max(1, Math.ceil(generated.length / 20)),
          savedPage: Math.max(1, Math.ceil(saved.length / 20)),
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
            // Read all locally cached looks to show complete history immediately
            const [localGen, localSaved] = await Promise.all([
              LooksRepository.getAllGeneratedLooks(200),
              LooksRepository.getAllSavedLooks(200),
            ]);
            const currentGenMap = new Map(get().generatedLooks.map((item) => [item.id, item]));
            const currentSavedMap = new Map(get().savedLooks.map((item) => [item.id, item]));

            const mappedGen = localGen.map((job) =>
              mapLocalJobToHistoryItem(job, currentGenMap.get(job.server_id || job.local_id))
            );
            const mappedSaved = localSaved.map((job) =>
              mapLocalJobToHistoryItem(job, currentSavedMap.get(job.server_id || job.local_id))
            );

            if (
              mappedGen.length > 0 ||
              mappedSaved.length > 0 ||
              (get().cachedUserId !== activeUserId && get().generatedLooks.length === 0)
            ) {
              get().hydrateFromLocalLooks(mappedGen, mappedSaved, activeUserId);
            } else if (get().cachedUserId !== activeUserId) {
              set({ cachedUserId: activeUserId });
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
          (isSameUser || get().cachedUserId === null) &&
          (get().generatedLooks.length > 0 || get().savedLooks.length > 0);

        // Only show full-screen blocking loader if user has NO local data whatsoever
        if (!hasExisting) {
          set({ loading: true });
        }
        if (forceRefresh) {
          set({ refreshing: true });
        }

        // Safety watchdog: ensure loading spinner is unconditionally cleared after max 4 seconds
        setTimeout(() => {
          if (get().loading) {
            set({ loading: false });
          }
        }, 4000);

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
                    // Non-blocking background save to permanent device storage
                    persistJobImagesPermanently({
                      id: item.id,
                      result_image_urls: item.result_image_urls,
                      garment_image_url: item.garment_image_url,
                    }).then(({ localResultPaths }) => {
                      if (localResultPaths.length > 0) {
                        LooksRepository.updateLocalImagePaths(item.id, localResultPaths).catch(() => {});
                      }
                    }).catch(() => {});
                  }
                }
                if (Array.isArray(savedRes)) {
                  for (const item of savedRes) {
                    await LooksRepository.insertTryOnJob(
                      mapHistoryItemToLocalJob(item, activeUserId)
                    );
                    persistJobImagesPermanently({
                      id: item.id,
                      result_image_urls: item.result_image_urls,
                      garment_image_url: item.garment_image_url,
                    }).then(({ localResultPaths }) => {
                      if (localResultPaths.length > 0) {
                        LooksRepository.updateLocalImagePaths(item.id, localResultPaths).catch(() => {});
                      }
                    }).catch(() => {});
                  }
                }
              } catch (dbSaveErr) {
                console.warn('[LooksStore] Failed to persist looks to SQLite:', dbSaveErr);
              }
            }

            // Update Zustand store
            if (Array.isArray(genRes)) {
              const currentGen = get().generatedLooks;
              const serverIds = new Set(genRes.map((i) => i.id));
              // Merge server page 1 with any existing items beyond page 1
              const remaining = currentGen.filter((i) => !serverIds.has(i.id));
              const mergedGen = [...genRes, ...remaining];

              set({
                cachedUserId: activeUserId,
                generatedLooks: mergedGen,
                generatedPage: Math.max(1, Math.ceil(mergedGen.length / 20)),
                generatedHasMore: genRes.length >= 20,
                generatedLoadingMore: false,
              });
              AsyncStorage.setItem(
                'fitme_home_recent_tryons',
                JSON.stringify(mergedGen.slice(0, 8))
              ).catch(() => {});
            }
            if (Array.isArray(savedRes)) {
              const currentSaved = get().savedLooks;
              const serverIds = new Set(savedRes.map((i) => i.id));
              const remaining = currentSaved.filter((i) => !serverIds.has(i.id));
              const mergedSaved = [...savedRes, ...remaining];

              set({
                cachedUserId: activeUserId,
                savedLooks: mergedSaved,
                savedPage: Math.max(1, Math.ceil(mergedSaved.length / 20)),
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
            // Check local SQLite first for next batch
            if (DatabaseManager.getActiveUserId() === activeUserId) {
              const localNext = await LooksRepository.getGeneratedLooks(20, (nextPage - 1) * 20);
              if (localNext.length > 0) {
                const currentGenMap = new Map(get().generatedLooks.map((item) => [item.id, item]));
                const mappedNext = localNext.map((job) =>
                  mapLocalJobToHistoryItem(job, currentGenMap.get(job.server_id || job.local_id))
                );
                const currentItems = get().generatedLooks;
                const existingIds = new Set(currentItems.map((i) => i.id));
                const newUniqueLocal = mappedNext.filter((i) => !existingIds.has(i.id));
                if (newUniqueLocal.length > 0) {
                  set({
                    generatedLooks: [...currentItems, ...newUniqueLocal],
                    generatedPage: nextPage,
                    generatedHasMore: true,
                    generatedLoadingMore: false,
                  });
                }
              }
            }

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
              // Network error or invalid payload: keep hasMore true so user can retry scrolling
              set({ generatedLoadingMore: false });
            }
          } catch (err) {
            console.warn('Notice fetching next page of generated looks:', err);
            set({ generatedLoadingMore: false });
          }
        } else {
          const { savedLoadingMore, savedHasMore, savedPage, loading, refreshing } =
            get();
          if (savedLoadingMore || !savedHasMore || loading || refreshing) return;

          set({ savedLoadingMore: true });
          const nextPage = savedPage + 1;

          try {
            // Check local SQLite first for next batch
            if (DatabaseManager.getActiveUserId() === activeUserId) {
              const localNext = await LooksRepository.getSavedLooks(20, (nextPage - 1) * 20);
              if (localNext.length > 0) {
                const currentSavedMap = new Map(get().savedLooks.map((item) => [item.id, item]));
                const mappedNext = localNext.map((job) =>
                  mapLocalJobToHistoryItem(job, currentSavedMap.get(job.server_id || job.local_id))
                );
                const currentItems = get().savedLooks;
                const existingIds = new Set(currentItems.map((i) => i.id));
                const newUniqueLocal = mappedNext.filter((i) => !existingIds.has(i.id));
                if (newUniqueLocal.length > 0) {
                  set({
                    savedLooks: [...currentItems, ...newUniqueLocal],
                    savedPage: nextPage,
                    savedHasMore: true,
                    savedLoadingMore: false,
                  });
                }
              }
            }

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
              set({ savedLoadingMore: false });
            }
          } catch (err) {
            console.warn('Notice fetching next page of saved looks:', err);
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

