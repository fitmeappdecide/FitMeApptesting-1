import { DatabaseManager } from './DatabaseManager';
import { LocalRecentItem } from './types';

export class RecentItemsRepository {
  /**
   * Saves or updates a recent item in the local SQLite database.
   */
  public static async saveRecentItem<T = any>(
    id: string,
    itemType: string,
    itemData: T,
    createdAt: number = Date.now()
  ): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const dataStr = typeof itemData === 'string' ? itemData : JSON.stringify(itemData);

    await db.runAsync(
      `INSERT OR REPLACE INTO recent_items (id, item_type, item_data, created_at)
       VALUES (?, ?, ?, ?);`,
      [id, itemType, dataStr, createdAt]
    );
  }

  /**
   * Retrieves recent items of a given type ordered from newest to oldest.
   */
  public static async getRecentItems<T = any>(
    itemType: string,
    limit: number = 10
  ): Promise<LocalRecentItem<T>[]> {
    const db = DatabaseManager.getDatabase();
    const rows = await db.getAllAsync<any>(
      `SELECT * FROM recent_items
       WHERE item_type = ?
       ORDER BY created_at DESC
       LIMIT ?;`,
      [itemType, limit]
    );

    return rows.map((row) => {
      let parsed = row.item_data;
      try {
        parsed = JSON.parse(row.item_data);
      } catch (_) {
        parsed = row.item_data;
      }
      return {
        id: row.id,
        item_type: row.item_type,
        item_data: parsed,
        created_at: Number(row.created_at),
      };
    });
  }

  /**
   * Deletes a specific recent item by ID.
   */
  public static async deleteRecentItem(id: string): Promise<void> {
    const db = DatabaseManager.getDatabase();
    await db.runAsync('DELETE FROM recent_items WHERE id = ?;', [id]);
  }

  /**
   * Clears all recent items of a given type.
   */
  public static async clearRecentItems(itemType?: string): Promise<void> {
    const db = DatabaseManager.getDatabase();
    if (itemType) {
      await db.runAsync('DELETE FROM recent_items WHERE item_type = ?;', [itemType]);
    } else {
      await db.runAsync('DELETE FROM recent_items;');
    }
  }
}
