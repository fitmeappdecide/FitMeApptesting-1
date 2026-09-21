// fitme-ui/src/repositories/LooksRepository.ts

import { DatabaseManager } from './DatabaseManager';
import { LocalTryOnJob, TryOnStatus } from './types';

function mapRowToTryOnJob(row: any): LocalTryOnJob {
  let resultUrls: string[] = [];
  try {
    resultUrls = row.result_image_urls ? JSON.parse(row.result_image_urls) : [];
  } catch (_) {
    resultUrls = [];
  }

  let localPaths: string[] = [];
  try {
    localPaths = row.local_image_paths ? JSON.parse(row.local_image_paths) : [];
  } catch (_) {
    localPaths = [];
  }

  return {
    local_id: row.local_id,
    server_id: row.server_id || null,
    user_id: row.user_id,
    garment_id: row.garment_id,
    brand_id: row.brand_id || null,
    status: row.status as TryOnStatus,
    result_image_urls: Array.isArray(resultUrls) ? resultUrls : [],
    local_image_paths: Array.isArray(localPaths) ? localPaths : [],
    cache_tier: row.cache_tier || null,
    processing_time_seconds: row.processing_time_seconds !== null ? Number(row.processing_time_seconds) : null,
    error_message: row.error_message || null,
    is_saved: Boolean(row.is_saved),
    saved_photo_id: row.saved_photo_id || null,
    saved_photo_name: row.saved_photo_name || null,
    created_at: Number(row.created_at),
    completed_at: row.completed_at !== null ? Number(row.completed_at) : null,
    _sync_status: row._sync_status || 'synced',
    _local_updated_at: Number(row._local_updated_at),
  };
}

export class LooksRepository {
  /**
   * Retrieves generated looks ordered by created_at DESC with pagination.
   */
  public static async getGeneratedLooks(limit = 20, offset = 0): Promise<LocalTryOnJob[]> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return [];

    const rows = await db.getAllAsync<any>(
      `SELECT * FROM tryon_jobs 
       WHERE user_id = ? AND _sync_status != 'deleted'
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?;`,
      [activeUserId, limit, offset]
    );

    return rows.map(mapRowToTryOnJob);
  }

  /**
   * Retrieves saved looks (favorites) ordered by created_at DESC with pagination.
   */
  public static async getSavedLooks(limit = 20, offset = 0): Promise<LocalTryOnJob[]> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return [];

    const rows = await db.getAllAsync<any>(
      `SELECT * FROM tryon_jobs 
       WHERE user_id = ? AND is_saved = 1 AND _sync_status != 'deleted'
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?;`,
      [activeUserId, limit, offset]
    );

    return rows.map(mapRowToTryOnJob);
  }

  /**
   * Retrieves a single look by its local_id or server_id.
   */
  public static async getLookById(id: string): Promise<LocalTryOnJob | null> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return null;

    const row = await db.getFirstAsync<any>(
      `SELECT * FROM tryon_jobs 
       WHERE user_id = ? AND (local_id = ? OR server_id = ?);`,
      [activeUserId, id, id]
    );

    if (!row) return null;
    return mapRowToTryOnJob(row);
  }

  /**
   * Inserts a new Try-On job record locally (status: queued / processing).
   */
  public static async insertTryOnJob(job: {
    local_id: string;
    server_id?: string | null;
    garment_id: string;
    brand_id?: string | null;
    status: TryOnStatus;
    result_image_urls?: string[];
    local_image_paths?: string[];
    cache_tier?: string | null;
    processing_time_seconds?: number | null;
    error_message?: string | null;
    is_saved?: boolean;
    saved_photo_id?: string | null;
    saved_photo_name?: string | null;
    created_at?: number;
    completed_at?: number | null;
    _sync_status?: any;
  }): Promise<LocalTryOnJob> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) throw new Error('No active user database');

    const now = Date.now();
    const localJob: LocalTryOnJob = {
      local_id: job.local_id,
      server_id: job.server_id || null,
      user_id: activeUserId,
      garment_id: job.garment_id,
      brand_id: job.brand_id || null,
      status: job.status,
      result_image_urls: job.result_image_urls || [],
      local_image_paths: job.local_image_paths || [],
      cache_tier: job.cache_tier || null,
      processing_time_seconds: job.processing_time_seconds || null,
      error_message: job.error_message || null,
      is_saved: Boolean(job.is_saved),
      saved_photo_id: job.saved_photo_id || null,
      saved_photo_name: job.saved_photo_name || null,
      created_at: job.created_at || now,
      completed_at: job.completed_at || null,
      _sync_status: job._sync_status || 'synced',
      _local_updated_at: now,
    };

    await db.runAsync(
      `INSERT OR REPLACE INTO tryon_jobs (
        local_id, server_id, user_id, garment_id, brand_id, status,
        result_image_urls, local_image_paths, cache_tier, processing_time_seconds,
        error_message, is_saved, saved_photo_id, saved_photo_name,
        created_at, completed_at, _sync_status, _local_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        localJob.local_id,
        localJob.server_id,
        localJob.user_id,
        localJob.garment_id,
        localJob.brand_id,
        localJob.status,
        JSON.stringify(localJob.result_image_urls),
        JSON.stringify(localJob.local_image_paths),
        localJob.cache_tier,
        localJob.processing_time_seconds,
        localJob.error_message,
        localJob.is_saved ? 1 : 0,
        localJob.saved_photo_id,
        localJob.saved_photo_name,
        localJob.created_at,
        localJob.completed_at,
        localJob._sync_status,
        localJob._local_updated_at,
      ]
    );

    return localJob;
  }

  /**
   * Updates status and optional completion details of an existing Try-On job.
   */
  public static async updateTryOnStatus(
    localId: string,
    status: TryOnStatus,
    details?: {
      server_id?: string;
      result_image_urls?: string[];
      local_image_paths?: string[];
      error_message?: string;
      completed_at?: number;
    }
  ): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return;

    const existing = await this.getLookById(localId);
    if (!existing) return;

    const now = Date.now();
    const serverId = details?.server_id !== undefined ? details.server_id : existing.server_id;
    const resultUrls = details?.result_image_urls !== undefined ? details.result_image_urls : existing.result_image_urls;
    const localPaths = details?.local_image_paths !== undefined ? details.local_image_paths : existing.local_image_paths;
    const errorMsg = details?.error_message !== undefined ? details.error_message : existing.error_message;
    const completedAt = details?.completed_at !== undefined ? details.completed_at : (status === 'completed' ? now : existing.completed_at);

    await db.runAsync(
      `UPDATE tryon_jobs 
       SET status = ?, server_id = ?, result_image_urls = ?, local_image_paths = ?,
           error_message = ?, completed_at = ?, _local_updated_at = ?
       WHERE user_id = ? AND local_id = ?;`,
      [
        status,
        serverId,
        JSON.stringify(resultUrls),
        JSON.stringify(localPaths),
        errorMsg,
        completedAt,
        now,
        activeUserId,
        localId,
      ]
    );
  }

  /**
   * Toggles the favorite (is_saved) state of a look. Returns new boolean state.
   */
  public static async toggleSave(id: string): Promise<boolean> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return false;

    const existing = await this.getLookById(id);
    if (!existing) return false;

    const newSaved = !existing.is_saved;
    const now = Date.now();

    await db.runAsync(
      `UPDATE tryon_jobs 
       SET is_saved = ?, _sync_status = 'pending_mutation', _local_updated_at = ?
       WHERE user_id = ? AND (local_id = ? OR server_id = ?);`,
      [newSaved ? 1 : 0, now, activeUserId, id, id]
    );

    return newSaved;
  }

  /**
   * Deletes a look record locally (or marks pending_delete).
   */
  public static async deleteLook(id: string): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return;

    await db.runAsync(
      `DELETE FROM tryon_jobs WHERE user_id = ? AND (local_id = ? OR server_id = ?);`,
      [activeUserId, id, id]
    );
  }

  /**
   * Clears all try-on jobs for the active user.
   */
  public static async clearAll(): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return;

    await db.runAsync('DELETE FROM tryon_jobs WHERE user_id = ?;', [activeUserId]);
  }
}
