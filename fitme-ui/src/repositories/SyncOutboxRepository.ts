// fitme-ui/src/repositories/SyncOutboxRepository.ts

import { DatabaseManager } from './DatabaseManager';
import { LocalSyncOutboxItem } from './types';

export class SyncOutboxRepository {
  /**
   * Enqueues a persistent offline mutation into sync_outbox.
   */
  public static async enqueueMutation(
    id: string,
    entityType: 'tryon_job' | 'user_saved_photo' | 'user_profile' | 'ava_message',
    entityId: string,
    mutationType: 'INSERT' | 'UPDATE' | 'DELETE' | 'UPLOAD' | 'TOGGLE_SAVE',
    payload: Record<string, any>
  ): Promise<LocalSyncOutboxItem> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) throw new Error('No active user database');

    const now = Date.now();
    const item: LocalSyncOutboxItem = {
      id,
      user_id: activeUserId,
      entity_type: entityType,
      entity_id: entityId,
      mutation_type: mutationType,
      payload,
      created_at: now,
      retry_count: 0,
      status: 'pending',
      last_error: null,
      locked_until: 0,
    };

    await db.runAsync(
      `INSERT OR REPLACE INTO sync_outbox (
        id, user_id, entity_type, entity_id, mutation_type,
        payload, created_at, retry_count, status, last_error, locked_until
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        item.id,
        item.user_id,
        item.entity_type,
        item.entity_id,
        item.mutation_type,
        JSON.stringify(item.payload),
        item.created_at,
        item.retry_count,
        item.status,
        item.last_error,
        item.locked_until,
      ]
    );

    return item;
  }

  /**
   * Peeks the next batch of pending mutations ready for sync push.
   */
  public static async peekPending(limit = 20): Promise<LocalSyncOutboxItem[]> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return [];

    const now = Date.now();
    const rows = await db.getAllAsync<any>(
      `SELECT * FROM sync_outbox 
       WHERE user_id = ? AND status = 'pending' AND locked_until <= ?
       ORDER BY created_at ASC 
       LIMIT ?;`,
      [activeUserId, now, limit]
    );

    return rows.map((r) => {
      let parsedPayload = {};
      try {
        parsedPayload = r.payload ? JSON.parse(r.payload) : {};
      } catch (_) {
        parsedPayload = {};
      }

      return {
        id: r.id,
        user_id: r.user_id,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        mutation_type: r.mutation_type,
        payload: parsedPayload,
        created_at: Number(r.created_at),
        retry_count: Number(r.retry_count),
        status: r.status,
        last_error: r.last_error || null,
        locked_until: Number(r.locked_until),
      };
    });
  }

  /**
   * Marks a batch of outbox mutations as completed (deletes them from outbox).
   */
  public static async markCompleted(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return;

    const placeholders = ids.map(() => '?').join(',');
    await db.runAsync(
      `DELETE FROM sync_outbox WHERE user_id = ? AND id IN (${placeholders});`,
      [activeUserId, ...ids]
    );
  }

  /**
   * Marks a mutation as failed and applies backoff locking.
   */
  public static async markFailed(id: string, error: string, lockDurationMs = 5000): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return;

    const now = Date.now();
    await db.runAsync(
      `UPDATE sync_outbox 
       SET status = 'pending', retry_count = retry_count + 1,
           last_error = ?, locked_until = ?
       WHERE user_id = ? AND id = ?;`,
      [error, now + lockDurationMs, activeUserId, id]
    );
  }

  /**
   * Returns total count of pending mutations.
   */
  public static async getPendingCount(): Promise<number> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return 0;

    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM sync_outbox WHERE user_id = ? AND status = 'pending';`,
      [activeUserId]
    );

    return row ? Number(row.count) : 0;
  }
}
