// fitme-ui/src/repositories/ProductRepository.ts

import { DatabaseManager } from './DatabaseManager';
import { LocalProductCache } from './types';

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class ProductRepository {
  /**
   * Retrieves a non-expired cached product by its canonical key.
   */
  public static async getCachedProduct(canonicalKey: string): Promise<LocalProductCache | null> {
    const db = DatabaseManager.getDatabase();
    const now = Date.now();

    const row = await db.getFirstAsync<any>(
      `SELECT * FROM product_cache 
       WHERE canonical_key = ? AND expires_at > ?;`,
      [canonicalKey, now]
    );

    if (!row) return null;

    let productJson = null;
    try {
      productJson = row.product_json ? JSON.parse(row.product_json) : null;
    } catch (_) {
      productJson = null;
    }

    return {
      canonical_key: row.canonical_key,
      url: row.url,
      title: row.title,
      brand: row.brand || null,
      price: row.price !== null ? Number(row.price) : null,
      image_url: row.image_url,
      product_json: productJson,
      cached_at: Number(row.cached_at),
      expires_at: Number(row.expires_at),
    };
  }

  /**
   * Stores a normalized product in the local Tier 0 product cache table.
   */
  public static async setCachedProduct(
    canonicalKey: string,
    url: string,
    title: string,
    imageUrl: string,
    productJson: any,
    ttlMs: number = DEFAULT_TTL_MS,
    brand?: string | null,
    price?: number | null
  ): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const now = Date.now();
    const expiresAt = now + ttlMs;

    await db.runAsync(
      `INSERT OR REPLACE INTO product_cache (
        canonical_key, url, title, brand, price, image_url,
        product_json, cached_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        canonicalKey,
        url,
        title,
        brand || null,
        price !== undefined && price !== null ? price : null,
        imageUrl,
        JSON.stringify(productJson || {}),
        now,
        expiresAt,
      ]
    );
  }

  /**
   * Purges all expired product cache entries.
   */
  public static async purgeExpired(): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const now = Date.now();
    await db.runAsync('DELETE FROM product_cache WHERE expires_at <= ?;', [now]);
  }
}
