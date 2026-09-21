// fitme-ui/src/services/syncManager.ts

import {
  userApi,
  savedPhotosApi,
  tryOnApi,
  productIntelligenceApi,
  getAuthenticatedUserId,
  getSessionEpoch,
  TryOnHistoryItem,
} from './api';
import {
  DatabaseManager,
  UserRepository,
  SavedPhotosRepository,
  LooksRepository,
  RecentItemsRepository,
} from '../repositories';
import { useUserStore } from './userStore';
import { useLooksStore, mapHistoryItemToLocalJob, mapLocalJobToHistoryItem } from './looksStore';
import { useSavedPhotosStore, mapSavedPhotoToLocalPhoto, mapLocalPhotoToSavedPhoto } from './savedPhotosStore';
import { getAVAConversations } from './avaService';

export interface SyncDomainResult {
  domain: string;
  status: 'fulfilled' | 'rejected';
  count?: number;
  error?: string;
}

export interface SyncSummary {
  userId: string;
  timestamp: number;
  results: SyncDomainResult[];
}

class SyncManagerService {
  private activeSyncPromise: Promise<SyncSummary | null> | null = null;
  private syncingUserId: string | null = null;

  /**
   * Returns true if cloud hydration is currently executing.
   */
  public isSyncing(): boolean {
    return this.activeSyncPromise !== null;
  }

  /**
   * Aborts ongoing sync references.
   */
  public abortOngoingSync(): void {
    this.activeSyncPromise = null;
    this.syncingUserId = null;
  }

  /**
   * Performs full cloud data hydration from FastAPI/Supabase into local SQLite.
   * Safe, non-blocking, user-isolated, and resilient across partial failures.
   */
  public performCloudHydration(userId: string, force = false): Promise<SyncSummary | null> {
    const activeAuthUser = getAuthenticatedUserId();
    if (!userId || activeAuthUser !== userId) {
      return Promise.resolve(null);
    }

    // In-flight deduplication for the same user
    if (this.activeSyncPromise && this.syncingUserId === userId && !force) {
      return this.activeSyncPromise;
    }

    const currentEpoch = getSessionEpoch();
    this.syncingUserId = userId;

    this.activeSyncPromise = (async () => {
      const results: SyncDomainResult[] = [];

      try {
        // Run all domain sync tasks concurrently with isolated fault handling
        const domainTasks = [
          this.syncProfile(userId, currentEpoch),
          this.syncSavedPhotos(userId, currentEpoch),
          this.syncLooksHistory(userId, currentEpoch),
          this.syncAVAConversations(userId, currentEpoch),
          this.syncRecentPriceComparisons(userId, currentEpoch),
        ];

        const settled = await Promise.allSettled(domainTasks);

        const domainNames = ['profile', 'saved_photos', 'looks', 'ava', 'price_comparisons'];
        settled.forEach((res, index) => {
          const domain = domainNames[index];
          if (res.status === 'fulfilled') {
            results.push({
              domain,
              status: 'fulfilled',
              count: typeof res.value === 'number' ? res.value : 1,
            });
          } else {
            results.push({
              domain,
              status: 'rejected',
              error: String(res.reason?.message || res.reason),
            });
          }
        });

        // Record last successful sync timestamp in SQLite if session is still valid
        if (
          getSessionEpoch() === currentEpoch &&
          getAuthenticatedUserId() === userId &&
          DatabaseManager.getActiveUserId() === userId
        ) {
          try {
            const db = DatabaseManager.getDatabase();
            await db.runAsync(
              `INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
               VALUES (?, ?, ?);`,
              ['last_cloud_hydration', String(Date.now()), Date.now()]
            );
          } catch (_) {}
        }

        return {
          userId,
          timestamp: Date.now(),
          results,
        };
      } finally {
        if (this.syncingUserId === userId) {
          this.activeSyncPromise = null;
          this.syncingUserId = null;
        }
      }
    })();

    return this.activeSyncPromise;
  }

  // ─── DOMAIN 1: PROFILE ─────────────────────────────────────────────
  private async syncProfile(userId: string, epoch: number): Promise<number> {
    const res: any = await userApi.getProfile();

    // Guard: discard if session changed during network transit
    if (
      getSessionEpoch() !== epoch ||
      getAuthenticatedUserId() !== userId ||
      DatabaseManager.getActiveUserId() !== userId
    ) {
      return 0;
    }

    if (res) {
      const resolvedUserId = res.user?.id || userId;
      const updatedUser = await UserRepository.upsertUser({
        id: resolvedUserId,
        email: res.user?.email || '',
        full_name: res.user?.full_name || res.user?.displayName || null,
        avatar_uri: null,
        try_on_count: typeof res.try_on_count === 'number' ? res.try_on_count : 0,
        saved_count: typeof res.saved_count === 'number' ? res.saved_count : 0,
        is_premium: typeof res.is_premium === 'boolean' ? res.is_premium : false,
        updated_at: Date.now(),
      });

      useUserStore.getState().hydrateFromLocalUser(updatedUser);
      return 1;
    }
    return 0;
  }

  // ─── DOMAIN 2: SAVED PHOTOS ────────────────────────────────────────
  private async syncSavedPhotos(userId: string, epoch: number): Promise<number> {
    const remotePhotos = await savedPhotosApi.list();

    // Guard: discard if session changed
    if (
      getSessionEpoch() !== epoch ||
      getAuthenticatedUserId() !== userId ||
      DatabaseManager.getActiveUserId() !== userId
    ) {
      return 0;
    }

    if (Array.isArray(remotePhotos)) {
      const realPhotos = remotePhotos.filter((p) => !p.id.startsWith('demo-'));
      for (const photo of realPhotos) {
        await SavedPhotosRepository.savePhoto(mapSavedPhotoToLocalPhoto(photo, userId));
      }

      const localPhotos = await SavedPhotosRepository.getPhotos();
      const mappedPhotos = localPhotos.map(mapLocalPhotoToSavedPhoto);
      useSavedPhotosStore.getState().hydrateFromLocalPhotos(mappedPhotos, userId);
      return realPhotos.length;
    }
    return 0;
  }

  // ─── DOMAIN 3: LOOKS / TRY-ON HISTORY (MULTI-PAGE) ──────────────────
  private async syncLooksHistory(userId: string, epoch: number): Promise<number> {
    let page = 1;
    let hasMore = true;
    let totalSynced = 0;
    const maxPages = 5; // Download up to 100 historical looks upon initial cloud hydration

    while (hasMore && page <= maxPages) {
      if (
        getSessionEpoch() !== epoch ||
        getAuthenticatedUserId() !== userId ||
        DatabaseManager.getActiveUserId() !== userId
      ) {
        return totalSynced;
      }

      const res = await tryOnApi.getHistory({
        status: 'completed',
        page,
        limit: 20,
      });

      if (
        getSessionEpoch() !== epoch ||
        getAuthenticatedUserId() !== userId ||
        DatabaseManager.getActiveUserId() !== userId
      ) {
        return totalSynced;
      }

      if (Array.isArray(res) && res.length > 0) {
        for (const item of res) {
          await LooksRepository.insertTryOnJob(mapHistoryItemToLocalJob(item, userId));
          totalSynced += 1;
        }

        if (res.length < 20) {
          hasMore = false;
        } else {
          page += 1;
        }
      } else {
        hasMore = false;
      }
    }

    // Refresh store from freshly populated SQLite table
    if (
      getSessionEpoch() === epoch &&
      getAuthenticatedUserId() === userId &&
      DatabaseManager.getActiveUserId() === userId
    ) {
      const [localGen, localSaved] = await Promise.all([
        LooksRepository.getGeneratedLooks(20, 0),
        LooksRepository.getSavedLooks(20, 0),
      ]);
      const mappedGen = localGen.map(mapLocalJobToHistoryItem);
      const mappedSaved = localSaved.map(mapLocalJobToHistoryItem);
      useLooksStore.getState().hydrateFromLocalLooks(mappedGen, mappedSaved, userId);
    }

    return totalSynced;
  }

  // ─── DOMAIN 4: AVA CONVERSATIONS ────────────────────────────────────
  private async syncAVAConversations(userId: string, epoch: number): Promise<number> {
    const convs = await getAVAConversations();

    if (
      getSessionEpoch() !== epoch ||
      getAuthenticatedUserId() !== userId ||
      DatabaseManager.getActiveUserId() !== userId
    ) {
      return 0;
    }

    return Array.isArray(convs) ? convs.length : 0;
  }

  // ─── DOMAIN 5: RECENT PRICE COMPARISONS ─────────────────────────────
  private async syncRecentPriceComparisons(userId: string, epoch: number): Promise<number> {
    const compHistory = await productIntelligenceApi.getHistory({
      status: 'done',
      limit: 10,
    });

    if (
      getSessionEpoch() !== epoch ||
      getAuthenticatedUserId() !== userId ||
      DatabaseManager.getActiveUserId() !== userId
    ) {
      return 0;
    }

    let count = 0;
    if (Array.isArray(compHistory)) {
      for (const item of compHistory) {
        let createdAtMs = Date.now();
        if (item.created_at) {
          const parsed = Date.parse(item.created_at);
          if (!isNaN(parsed)) createdAtMs = parsed;
        }

        await RecentItemsRepository.saveRecentItem(
          item.scan_id,
          'price_comparison',
          item,
          createdAtMs
        );
        count += 1;
      }
    }

    return count;
  }
}

export const SyncManager = new SyncManagerService();
