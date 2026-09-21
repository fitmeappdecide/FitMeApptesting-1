// fitme-ui/src/repositories/SavedPhotosRepository.ts

import { DatabaseManager } from './DatabaseManager';
import { LocalUserSavedPhoto } from './types';

function mapRowToPhoto(row: any): LocalUserSavedPhoto {
  return {
    id: row.id,
    user_id: row.user_id,
    storage_path: row.storage_path,
    local_file_uri: row.local_file_uri,
    display_name: row.display_name,
    original_filename: row.original_filename || null,
    mime_type: row.mime_type || 'image/jpeg',
    content_hash: row.content_hash || null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    _sync_status: row._sync_status || 'synced',
    _local_updated_at: Number(row._local_updated_at),
  };
}

export class SavedPhotosRepository {
  /**
   * Retrieves all saved model photos for the active user.
   */
  public static async getPhotos(): Promise<LocalUserSavedPhoto[]> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return [];

    const rows = await db.getAllAsync<any>(
      `SELECT * FROM user_saved_photos 
       WHERE user_id = ? AND _sync_status != 'pending_delete'
       ORDER BY created_at DESC;`,
      [activeUserId]
    );

    return rows.map(mapRowToPhoto);
  }

  /**
   * Retrieves a single photo by ID.
   */
  public static async getPhotoById(id: string): Promise<LocalUserSavedPhoto | null> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return null;

    const row = await db.getFirstAsync<any>(
      `SELECT * FROM user_saved_photos WHERE user_id = ? AND id = ?;`,
      [activeUserId, id]
    );

    if (!row) return null;
    return mapRowToPhoto(row);
  }

  /**
   * Saves or updates a photo record in the local database.
   */
  public static async savePhoto(photo: {
    id: string;
    storage_path?: string;
    local_file_uri: string;
    display_name: string;
    original_filename?: string | null;
    mime_type?: string;
    content_hash?: string | null;
    created_at?: number;
    updated_at?: number;
    _sync_status?: any;
  }): Promise<LocalUserSavedPhoto> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) throw new Error('No active user database');

    const now = Date.now();
    const localPhoto: LocalUserSavedPhoto = {
      id: photo.id,
      user_id: activeUserId,
      storage_path: photo.storage_path || '',
      local_file_uri: photo.local_file_uri,
      display_name: photo.display_name,
      original_filename: photo.original_filename || null,
      mime_type: photo.mime_type || 'image/jpeg',
      content_hash: photo.content_hash || null,
      created_at: photo.created_at || now,
      updated_at: photo.updated_at || now,
      _sync_status: photo._sync_status || 'synced',
      _local_updated_at: now,
    };

    await db.runAsync(
      `INSERT OR REPLACE INTO user_saved_photos (
        id, user_id, storage_path, local_file_uri, display_name,
        original_filename, mime_type, content_hash, created_at,
        updated_at, _sync_status, _local_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        localPhoto.id,
        localPhoto.user_id,
        localPhoto.storage_path,
        localPhoto.local_file_uri,
        localPhoto.display_name,
        localPhoto.original_filename,
        localPhoto.mime_type,
        localPhoto.content_hash,
        localPhoto.created_at,
        localPhoto.updated_at,
        localPhoto._sync_status,
        localPhoto._local_updated_at,
      ]
    );

    return localPhoto;
  }

  /**
   * Renames a photo locally and marks sync status as pending_rename.
   */
  public static async renamePhoto(id: string, newName: string): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return;

    const now = Date.now();
    await db.runAsync(
      `UPDATE user_saved_photos 
       SET display_name = ?, updated_at = ?, _sync_status = 'pending_rename', _local_updated_at = ?
       WHERE user_id = ? AND id = ?;`,
      [newName, now, now, activeUserId, id]
    );
  }

  /**
   * Deletes a photo record locally.
   */
  public static async deletePhoto(id: string): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return;

    await db.runAsync(
      `DELETE FROM user_saved_photos WHERE user_id = ? AND id = ?;`,
      [activeUserId, id]
    );
  }

  /**
   * Clears all photos for the active user.
   */
  public static async clearAll(): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return;

    await db.runAsync('DELETE FROM user_saved_photos WHERE user_id = ?;', [activeUserId]);
  }
}
