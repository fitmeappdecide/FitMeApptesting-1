// fitme-ui/src/repositories/UserRepository.ts

import { DatabaseManager } from './DatabaseManager';
import { LocalUser } from './types';

export class UserRepository {
  /**
   * Retrieves the local profile record for the active user.
   */
  public static async getUser(userId?: string): Promise<LocalUser | null> {
    const db = DatabaseManager.getDatabase();
    const activeId = userId || DatabaseManager.getActiveUserId();
    if (!activeId) return null;

    const row = await db.getFirstAsync<any>(
      'SELECT * FROM users WHERE id = ?;',
      [activeId]
    );

    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      avatar_uri: row.avatar_uri,
      try_on_count: Number(row.try_on_count || 0),
      saved_count: Number(row.saved_count || 0),
      is_premium: Boolean(row.is_premium),
      created_at: Number(row.created_at),
      updated_at: Number(row.updated_at),
      _sync_status: row._sync_status,
      _local_updated_at: Number(row._local_updated_at),
    };
  }

  /**
   * Upserts the local user profile record.
   */
  public static async upsertUser(user: Partial<LocalUser> & { id: string; email: string }): Promise<LocalUser> {
    const db = DatabaseManager.getDatabase();
    const now = Date.now();

    const existing = await this.getUser(user.id);

    const merged: LocalUser = {
      id: user.id,
      email: user.email,
      full_name: user.full_name !== undefined ? user.full_name : existing?.full_name || null,
      avatar_uri: user.avatar_uri !== undefined ? user.avatar_uri : existing?.avatar_uri || null,
      try_on_count: typeof user.try_on_count === 'number' ? user.try_on_count : existing?.try_on_count || 0,
      saved_count: typeof user.saved_count === 'number' ? user.saved_count : existing?.saved_count || 0,
      is_premium: typeof user.is_premium === 'boolean' ? user.is_premium : existing?.is_premium || false,
      created_at: existing?.created_at || user.created_at || now,
      updated_at: user.updated_at || now,
      _sync_status: user._sync_status || 'synced',
      _local_updated_at: now,
    };

    await db.runAsync(
      `INSERT OR REPLACE INTO users (
        id, email, full_name, avatar_uri, try_on_count, saved_count,
        is_premium, created_at, updated_at, _sync_status, _local_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        merged.id,
        merged.email,
        merged.full_name,
        merged.avatar_uri,
        merged.try_on_count,
        merged.saved_count,
        merged.is_premium ? 1 : 0,
        merged.created_at,
        merged.updated_at,
        merged._sync_status,
        merged._local_updated_at,
      ]
    );

    return merged;
  }

  /**
   * Updates only profile counters (try_on_count, saved_count).
   */
  public static async updateCounters(tryOnCount?: number, savedCount?: number): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const activeId = DatabaseManager.getActiveUserId();
    if (!activeId) return;

    const existing = await this.getUser(activeId);
    if (!existing) return;

    const newTryOn = typeof tryOnCount === 'number' ? tryOnCount : existing.try_on_count;
    const newSaved = typeof savedCount === 'number' ? savedCount : existing.saved_count;
    const now = Date.now();

    await db.runAsync(
      'UPDATE users SET try_on_count = ?, saved_count = ?, _local_updated_at = ? WHERE id = ?;',
      [newTryOn, newSaved, now, activeId]
    );
  }

  /**
   * Deletes user record locally.
   */
  public static async deleteUser(userId: string): Promise<void> {
    const db = DatabaseManager.getDatabase();
    await db.runAsync('DELETE FROM users WHERE id = ?;', [userId]);
  }
}
