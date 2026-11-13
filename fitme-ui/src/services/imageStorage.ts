// fitme-ui/src/services/imageStorage.ts

import * as FileSystem from 'expo-file-system';

const PERMANENT_STORAGE_DIR = `${FileSystem.documentDirectory}fitme_tryon_storage/`;

let dirChecked = false;

export async function ensurePermanentStorageDir(): Promise<void> {
  if (dirChecked) return;
  try {
    const dirInfo = await FileSystem.getInfoAsync(PERMANENT_STORAGE_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(PERMANENT_STORAGE_DIR, { intermediates: true });
    }
    dirChecked = true;
  } catch (err) {
    console.warn('[ImageStorage] Directory creation notice:', err);
  }
}

/**
 * Creates a deterministic, safe filename from a remote URL.
 */
export function getPermanentFilename(uri: string, prefix = 'img'): string {
  if (!uri) return `${prefix}_${Date.now()}.jpg`;
  const cleanUrl = uri.split('?')[0];
  let hash = 0;
  for (let i = 0; i < cleanUrl.length; i++) {
    const char = cleanUrl.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const ext = cleanUrl.split('.').pop() || 'jpg';
  const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext.toLowerCase()) ? ext : 'jpg';
  return `${prefix}_${Math.abs(hash)}.${safeExt}`;
}

// In-memory fast cache for known verified local files
const verifiedPermanentFiles = new Set<string>();

/**
 * Checks if a remote URL has already been downloaded to permanent disk.
 * Returns the local file:// path if it exists, or null.
 */
export async function getLocalPermanentPath(remoteUrl: string, prefix = 'tryon'): Promise<string | null> {
  if (!remoteUrl || remoteUrl.startsWith('file://') || remoteUrl.startsWith('data:')) {
    return remoteUrl || null;
  }

  const filename = getPermanentFilename(remoteUrl, prefix);
  const localPath = `${PERMANENT_STORAGE_DIR}${filename}`;

  if (verifiedPermanentFiles.has(localPath)) {
    return localPath;
  }

  try {
    await ensurePermanentStorageDir();
    const info = await FileSystem.getInfoAsync(localPath);
    if (info.exists && (info.size === undefined || info.size >= 500)) {
      verifiedPermanentFiles.add(localPath);
      return localPath;
    }
  } catch (_) {}

  return null;
}

/**
 * Downloads a remote image into the phone's permanent documentDirectory.
 * Files in documentDirectory are NEVER deleted by iOS or Android cleanups.
 * Returns the local file:// path on success, or the original remote URL on error.
 */
export async function saveToPermanentStorage(remoteUrl: string, prefix = 'tryon'): Promise<string> {
  if (!remoteUrl || remoteUrl.startsWith('file://') || remoteUrl.startsWith('data:')) {
    return remoteUrl;
  }

  const existingLocal = await getLocalPermanentPath(remoteUrl, prefix);
  if (existingLocal) {
    return existingLocal;
  }

  try {
    await ensurePermanentStorageDir();
    const filename = getPermanentFilename(remoteUrl, prefix);
    const localPath = `${PERMANENT_STORAGE_DIR}${filename}`;

    const res = await FileSystem.downloadAsync(remoteUrl, localPath);
    if (res?.status === 200 && res.uri) {
      verifiedPermanentFiles.add(localPath);
      return localPath;
    } else {
      // Cleanup non-200 / corrupt downloads
      await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
    }
  } catch (err) {
    console.warn('[ImageStorage] Download notice for permanent storage:', remoteUrl, err);
  }

  return remoteUrl;
}

/**
 * Persists all core images of a try-on job (result image and garment image)
 * into permanent disk storage in the background.
 */
export async function persistJobImagesPermanently(job: {
  id: string;
  result_image_urls?: string[];
  garment_image_url?: string | null;
}): Promise<{ localResultPaths: string[]; localGarmentPath: string | null }> {
  const localResultPaths: string[] = [];
  let localGarmentPath: string | null = null;

  try {
    if (Array.isArray(job.result_image_urls) && job.result_image_urls.length > 0) {
      for (let i = 0; i < job.result_image_urls.length; i++) {
        const url = job.result_image_urls[i];
        if (url && typeof url === 'string') {
          const localPath = await saveToPermanentStorage(url, `job_${job.id}_res_${i}`);
          if (localPath.startsWith('file://')) {
            localResultPaths.push(localPath);
          }
        }
      }
    }

    if (job.garment_image_url && typeof job.garment_image_url === 'string') {
      const gPath = await saveToPermanentStorage(job.garment_image_url, `job_${job.id}_garment`);
      if (gPath.startsWith('file://')) {
        localGarmentPath = gPath;
      }
    }
  } catch (err) {
    console.warn('[ImageStorage] Error persisting job images:', job.id, err);
  }

  return { localResultPaths, localGarmentPath };
}
