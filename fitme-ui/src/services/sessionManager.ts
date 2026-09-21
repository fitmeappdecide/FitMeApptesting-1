import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearAuth, incrementSessionEpoch } from './api';
import { useUserStore } from './userStore';
import { useLooksStore, mapLocalJobToHistoryItem } from './looksStore';
import { useSavedPhotosStore, mapLocalPhotoToSavedPhoto } from './savedPhotosStore';
import { useSession } from './session';
import { DatabaseManager, UserRepository, LooksRepository, SavedPhotosRepository } from '../repositories';
import { SyncManager } from './syncManager';

export const USER_SCOPED_STORAGE_KEYS = [
  'fitme_user_phone_cache_v2',
  'fitme_looks_phone_cache_v3',
  'fitme_saved_photos_cache_v2',
  'fitme_home_recent_comparisons',
  'fitme_home_recent_tryons',
];

/**
 * Synchronously and asynchronously purges ALL account-specific in-memory and persisted state.
 * Guaranteed to run on logout and before any new user session is mounted.
 */
export async function purgeAllSessionState(options?: { deleteLocalDatabase?: boolean }): Promise<void> {
  // 1. Advance session epoch to immediately invalidate any in-flight promises
  incrementSessionEpoch();

  // 2. Abort any ongoing background sync
  try {
    SyncManager.abortOngoingSync();
  } catch (_) {}

  // 3. Synchronously clear in-memory Zustand store states
  try {
    useUserStore.getState().resetLocalState();
  } catch (_) {}

  try {
    useLooksStore.getState().resetLocalState();
  } catch (_) {}

  try {
    useSavedPhotosStore.getState().resetLocalState();
  } catch (_) {}

  try {
    useSession.getState().reset();
  } catch (_) {}

  // 4. Close or permanently delete active SQLite database
  try {
    if (options?.deleteLocalDatabase) {
      await DatabaseManager.deleteActiveDatabase();
    } else {
      await DatabaseManager.closeActiveDatabase();
    }
  } catch (_) {}

  // 5. Clear auth tokens in SecureStore & in-memory API headers
  await clearAuth();

  // 6. Purge all user-scoped cached keys from AsyncStorage
  try {
    await AsyncStorage.multiRemove(USER_SCOPED_STORAGE_KEYS);
  } catch (_) {}
}

/**
 * Initializes a clean user session upon successful login/registration.
 * Mounts the target account's SQLite database, hydrates userStore, looksStore & savedPhotosStore instantly from SQLite,
 * and kicks off fresh background data synchronization via SyncManager.
 */
export async function initializeUserSession(user: {
  id?: string | null;
  email?: string | null;
  full_name?: string | null;
  avatar_uri?: string | null;
}): Promise<void> {
  // 1. Invalidate any lingering state from a prior session in memory
  incrementSessionEpoch();
  SyncManager.abortOngoingSync();
  useLooksStore.getState().resetLocalState();
  useSavedPhotosStore.getState().resetLocalState();
  useSession.getState().reset();

  const userId = user.id || null;

  // 2. Mount target account's SQLite database and hydrate profile, looks & saved photos immediately
  if (userId) {
    try {
      await DatabaseManager.openUserDatabase(userId);
      const localUser = await UserRepository.getUser(userId);

      if (localUser) {
        // Hydrate immediately from existing SQLite record (0ms UI latency)
        useUserStore.getState().hydrateFromLocalUser(localUser);
      } else {
        // Seed initial profile in SQLite
        const seeded = await UserRepository.upsertUser({
          id: userId,
          email: user.email || '',
          full_name: user.full_name || null,
          avatar_uri: user.avatar_uri || null,
          try_on_count: 0,
          saved_count: 0,
          is_premium: false,
        });
        useUserStore.getState().hydrateFromLocalUser(seeded);
      }

      // Hydrate looks immediately from SQLite (0ms UI latency)
      const [localGen, localSaved] = await Promise.all([
        LooksRepository.getGeneratedLooks(20, 0),
        LooksRepository.getSavedLooks(20, 0),
      ]);
      const mappedGen = localGen.map(mapLocalJobToHistoryItem);
      const mappedSaved = localSaved.map(mapLocalJobToHistoryItem);
      useLooksStore.getState().hydrateFromLocalLooks(mappedGen, mappedSaved, userId);

      // Hydrate saved photos immediately from SQLite (0ms UI latency)
      const localPhotos = await SavedPhotosRepository.getPhotos();
      const mappedPhotos = localPhotos.map(mapLocalPhotoToSavedPhoto);
      useSavedPhotosStore.getState().hydrateFromLocalPhotos(mappedPhotos, userId);
    } catch (dbErr) {
      console.warn('[SessionManager] SQLite mount notice during login:', dbErr);
      // Fallback in-memory seeding if SQLite mount encountered issue
      useUserStore.getState().setProfile({
        user_id: userId,
        email: user.email || null,
        full_name: user.full_name || null,
        avatar_uri: user.avatar_uri || null,
      });
    }

    // 3. Orchestrate full cloud hydration in the background via SyncManager
    SyncManager.performCloudHydration(userId).catch((syncErr) => {
      console.warn('[SessionManager] Background cloud hydration notice:', syncErr);
    });
  }
}
