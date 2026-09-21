// fitme-ui/src/repositories/DatabaseManager.ts

import * as SQLite from 'expo-sqlite';

export const SCHEMA_VERSION = 1;

export class DatabaseError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * Strictly validates user ID format to prevent SQL injection or path traversal.
 * Accepts standard UUID format or safe alphanumeric IDs (up to 64 chars).
 */
export function validateUserId(userId: string | null | undefined): string {
  if (!userId || typeof userId !== 'string') {
    throw new DatabaseError('Invalid user ID: user ID must be a non-empty string', 'INVALID_USER_ID');
  }
  const clean = userId.trim();
  if (!/^[a-zA-Z0-9_\-.]{1,64}$/.test(clean)) {
    throw new DatabaseError(`Invalid user ID format: "${userId}". Only alphanumeric, hyphens, and underscores are allowed.`, 'MALFORMED_USER_ID');
  }
  return clean;
}

/**
 * Returns deterministic SQLite database file name for a validated user.
 */
export function getDatabaseName(userId: string): string {
  const validated = validateUserId(userId);
  return `fitme_user_${validated}.db`;
}

class DatabaseManagerService {
  private activeDb: SQLite.SQLiteDatabase | null = null;
  private activeUserId: string | null = null;
  private isInitializing: boolean = false;

  /**
   * Returns the currently active user ID whose database is open.
   */
  public getActiveUserId(): string | null {
    return this.activeUserId;
  }

  /**
   * Returns true if an active user database is open and ready.
   */
  public isDatabaseOpen(): boolean {
    return this.activeDb !== null && this.activeUserId !== null;
  }

  /**
   * Returns the currently active SQLiteDatabase instance, or throws if not mounted.
   */
  public getDatabase(): SQLite.SQLiteDatabase {
    if (!this.activeDb || !this.activeUserId) {
      throw new DatabaseError('No active user database is open. Please call openUserDatabase(userId) first.', 'NO_ACTIVE_DB');
    }
    return this.activeDb;
  }

  /**
   * Opens the isolated per-user SQLite database, runs migrations, and configures PRAGMAs.
   */
  public async openUserDatabase(userId: string): Promise<SQLite.SQLiteDatabase> {
    const validated = validateUserId(userId);

    // If the requested user's database is already active, return it
    if (this.activeDb && this.activeUserId === validated) {
      return this.activeDb;
    }

    // If another user's database is active, close it first
    if (this.activeDb) {
      await this.closeActiveDatabase();
    }

    this.isInitializing = true;
    try {
      const dbName = getDatabaseName(validated);
      const db = await SQLite.openDatabaseAsync(dbName);

      // 1. Enable WAL mode and foreign keys
      await db.execAsync('PRAGMA journal_mode = WAL;');
      await db.execAsync('PRAGMA foreign_keys = ON;');
      await db.execAsync('PRAGMA synchronous = NORMAL;');

      // 2. Initialize sync_metadata table if not present
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sync_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      // 3. Run schema migrations
      await this.migrate(db);

      this.activeDb = db;
      this.activeUserId = validated;
      return db;
    } catch (err: any) {
      this.activeDb = null;
      this.activeUserId = null;
      throw new DatabaseError(`Failed to open SQLite database for user ${validated}: ${err?.message || err}`, 'DB_OPEN_FAILED');
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Closes the active database cleanly and unmounts connection.
   */
  public async closeActiveDatabase(): Promise<void> {
    if (this.activeDb) {
      try {
        await this.activeDb.closeAsync();
      } catch (err) {
        console.warn('[DatabaseManager] Notice during database close:', err);
      } finally {
        this.activeDb = null;
        this.activeUserId = null;
      }
    }
  }

  /**
   * Permanently deletes the active user's SQLite database file from disk.
   */
  public async deleteActiveDatabase(): Promise<void> {
    const userId = this.activeUserId;
    await this.closeActiveDatabase();
    if (userId) {
      const dbName = `fitme_user_${userId}.db`;
      try {
        await SQLite.deleteDatabaseAsync(dbName);
      } catch (err) {
        console.warn('[DatabaseManager] Notice during database delete:', err);
      }
    }
  }

  /**
   * Executes a callback within an atomic SQLite transaction.
   * Commits on success; automatically rolls back on any error.
   */
  public async withTransaction<T>(callback: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
    const db = this.getDatabase();
    await db.execAsync('BEGIN TRANSACTION;');
    try {
      const result = await callback(db);
      await db.execAsync('COMMIT;');
      return result;
    } catch (err) {
      try {
        await db.execAsync('ROLLBACK;');
      } catch (rollbackErr) {
        console.warn('[DatabaseManager] Rollback notice:', rollbackErr);
      }
      throw err;
    }
  }

  /**
   * Applies schema migrations sequentially and idempotently.
   */
  private async migrate(db: SQLite.SQLiteDatabase): Promise<void> {
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_metadata WHERE key = ?;', ['schema_version']);
    const currentVersion = row ? parseInt(row.value, 10) : 0;

    if (currentVersion < 1) {
      await db.execAsync('BEGIN TRANSACTION;');
      try {
        // Migration V1 Schema
        await db.execAsync(`
          -- 1. USERS TABLE
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            full_name TEXT,
            avatar_uri TEXT,
            try_on_count INTEGER NOT NULL DEFAULT 0,
            saved_count INTEGER NOT NULL DEFAULT 0,
            is_premium INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            _sync_status TEXT NOT NULL DEFAULT 'synced',
            _local_updated_at INTEGER NOT NULL
          );

          -- 2. TRYON_JOBS TABLE (Corrected Phase 2B Specification)
          CREATE TABLE IF NOT EXISTS tryon_jobs (
            local_id TEXT PRIMARY KEY,
            server_id TEXT,
            user_id TEXT NOT NULL,
            garment_id TEXT NOT NULL,
            brand_id TEXT,
            status TEXT NOT NULL,
            result_image_urls TEXT DEFAULT '[]',
            local_image_paths TEXT DEFAULT '[]',
            cache_tier TEXT,
            processing_time_seconds REAL,
            error_message TEXT,
            is_saved INTEGER NOT NULL DEFAULT 0,
            saved_photo_id TEXT,
            saved_photo_name TEXT,
            created_at INTEGER NOT NULL,
            completed_at INTEGER,
            _sync_status TEXT NOT NULL DEFAULT 'synced',
            _local_updated_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_tryon_jobs_user_status ON tryon_jobs(user_id, status);
          CREATE INDEX IF NOT EXISTS idx_tryon_jobs_saved ON tryon_jobs(user_id, is_saved);
          CREATE INDEX IF NOT EXISTS idx_tryon_jobs_created ON tryon_jobs(created_at DESC);

          -- 3. USER_SAVED_PHOTOS TABLE
          CREATE TABLE IF NOT EXISTS user_saved_photos (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            storage_path TEXT NOT NULL,
            local_file_uri TEXT NOT NULL,
            display_name TEXT NOT NULL,
            original_filename TEXT,
            mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
            content_hash TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            _sync_status TEXT NOT NULL DEFAULT 'synced',
            _local_updated_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_user_saved_photos_user ON user_saved_photos(user_id);

          -- 4. AVA_CONVERSATIONS TABLE
          CREATE TABLE IF NOT EXISTS ava_conversations (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT 'Fashion Styling Session',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            _sync_status TEXT NOT NULL DEFAULT 'synced',
            _local_updated_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          );

          -- 5. AVA_MESSAGES TABLE
          CREATE TABLE IF NOT EXISTS ava_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            text_content TEXT NOT NULL,
            intent TEXT,
            structured_payload TEXT,
            created_at INTEGER NOT NULL,
            _sync_status TEXT NOT NULL DEFAULT 'synced',
            _local_updated_at INTEGER NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES ava_conversations(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_ava_messages_conv ON ava_messages(conversation_id, created_at ASC);

          -- 6. PRODUCT_CACHE TABLE
          CREATE TABLE IF NOT EXISTS product_cache (
            canonical_key TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            title TEXT NOT NULL,
            brand TEXT,
            price REAL,
            image_url TEXT NOT NULL,
            product_json TEXT NOT NULL,
            cached_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_product_cache_expires ON product_cache(expires_at);

          -- 7. RECENT_ITEMS TABLE
          CREATE TABLE IF NOT EXISTS recent_items (
            id TEXT PRIMARY KEY,
            item_type TEXT NOT NULL,
            item_data TEXT NOT NULL,
            created_at INTEGER NOT NULL
          );

          -- 8. SYNC_OUTBOX TABLE
          CREATE TABLE IF NOT EXISTS sync_outbox (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            mutation_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            retry_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            last_error TEXT,
            locked_until INTEGER NOT NULL DEFAULT 0
          );
          CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending ON sync_outbox(user_id, status, created_at ASC);

          -- Record migration completion
          INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
          VALUES ('schema_version', '1', ${Date.now()});
        `);

        await db.execAsync('COMMIT;');
      } catch (migrationErr) {
        await db.execAsync('ROLLBACK;');
        throw new DatabaseError(`Migration V1 failed: ${migrationErr}`, 'MIGRATION_FAILED');
      }
    }
  }
}

export const DatabaseManager = new DatabaseManagerService();
