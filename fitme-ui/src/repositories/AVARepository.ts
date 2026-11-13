// fitme-ui/src/repositories/AVARepository.ts

import { DatabaseManager } from './DatabaseManager';
import { LocalAVAConversation, LocalAVAMessage } from './types';

/**
 * Auto-generates a clean title using the first 6-8 words of the prompt.
 */
export function generateConversationTitleFromPrompt(prompt: string): string {
  if (!prompt || typeof prompt !== 'string') return 'Fashion Styling Session';
  const trimmed = prompt.trim();
  if (!trimmed) return 'Fashion Styling Session';

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Fashion Styling Session';

  const titleWords = words.slice(0, 7);
  let title = titleWords.join(' ');
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return title;
}

export class AVARepository {
  /**
   * Retrieves all styling conversations for the active user with last message and auto-repaired titles.
   */
  public static async getConversations(): Promise<LocalAVAConversation[]> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return [];

    const rows = await db.getAllAsync<any>(
      `SELECT 
         c.*,
         (
           SELECT m.text_content 
           FROM ava_messages m 
           WHERE m.conversation_id = c.id AND m.sender = 'user' 
           ORDER BY m.created_at DESC 
           LIMIT 1
         ) as last_user_message,
         (
           SELECT m.text_content 
           FROM ava_messages m 
           WHERE m.conversation_id = c.id AND m.sender = 'user' 
           ORDER BY m.created_at ASC 
           LIMIT 1
         ) as first_user_message
       FROM ava_conversations c 
       WHERE c.user_id = ? 
       ORDER BY c.updated_at DESC;`,
      [activeUserId]
    );

    const conversations: LocalAVAConversation[] = [];

    for (const r of rows) {
      let title = r.title;
      // Auto-repair existing generic titles if user messages exist
      if (
        (!title || title === 'Fashion Styling Session' || title === 'Outfit styling session') &&
        (r.first_user_message || r.last_user_message)
      ) {
        const sourceText = r.first_user_message || r.last_user_message;
        title = generateConversationTitleFromPrompt(sourceText);
        db.runAsync(
          `UPDATE ava_conversations SET title = ?, _local_updated_at = ? WHERE id = ?;`,
          [title, Date.now(), r.id]
        ).catch(() => {});
      }

      conversations.push({
        id: r.id,
        user_id: r.user_id,
        title: title || 'Fashion Styling Session',
        created_at: Number(r.created_at),
        updated_at: Number(r.updated_at),
        _sync_status: r._sync_status || 'synced',
        _local_updated_at: Number(r._local_updated_at),
        last_message: r.last_user_message || '',
      });
    }

    return conversations;
  }

  /**
   * Creates or updates a conversation record locally without clobbering custom titles.
   */
  public static async createConversation(
    id: string,
    title = 'Fashion Styling Session',
    createdAt?: number,
    updatedAt?: number
  ): Promise<LocalAVAConversation> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) throw new Error('No active user database');

    const now = Date.now();
    const conv: LocalAVAConversation = {
      id,
      user_id: activeUserId,
      title,
      created_at: createdAt || now,
      updated_at: updatedAt || now,
      _sync_status: 'synced',
      _local_updated_at: now,
    };

    await db.runAsync(
      `INSERT INTO ava_conversations (
        id, user_id, title, created_at, updated_at, _sync_status, _local_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        _local_updated_at = excluded._local_updated_at,
        title = CASE
          WHEN ava_conversations.title IS NULL OR ava_conversations.title = 'Fashion Styling Session' OR ava_conversations.title = 'Outfit styling session'
          THEN excluded.title
          ELSE ava_conversations.title
        END;`,
      [conv.id, conv.user_id, conv.title, conv.created_at, conv.updated_at, conv._sync_status, conv._local_updated_at]
    );

    return conv;
  }

  /**
   * Retrieves all messages for a specific conversation in chronological order.
   */
  public static async getMessages(conversationId: string): Promise<LocalAVAMessage[]> {
    const db = DatabaseManager.getDatabase();

    const rows = await db.getAllAsync<any>(
      `SELECT * FROM ava_messages 
       WHERE conversation_id = ? 
       ORDER BY created_at ASC;`,
      [conversationId]
    );

    return rows.map((r) => {
      let payload = null;
      try {
        payload = r.structured_payload ? JSON.parse(r.structured_payload) : null;
      } catch (_) {
        payload = null;
      }

      return {
        id: r.id,
        conversation_id: r.conversation_id,
        sender: r.sender as 'user' | 'ava',
        text_content: r.text_content,
        intent: r.intent || null,
        structured_payload: payload,
        created_at: Number(r.created_at),
        _sync_status: r._sync_status || 'synced',
        _local_updated_at: Number(r._local_updated_at),
      };
    });
  }

  /**
   * Appends a message to a conversation locally and updates conversation updated_at.
   */
  public static async addMessage(
    id: string,
    conversationId: string,
    sender: 'user' | 'ava',
    textContent: string,
    payload?: any,
    intent?: string,
    createdAt?: number
  ): Promise<LocalAVAMessage> {
    const db = DatabaseManager.getDatabase();
    const now = Date.now();

    const msg: LocalAVAMessage = {
      id,
      conversation_id: conversationId,
      sender,
      text_content: textContent,
      intent: intent || null,
      structured_payload: payload || null,
      created_at: createdAt || now,
      _sync_status: 'synced',
      _local_updated_at: now,
    };

    await DatabaseManager.withTransaction(async (txDb) => {
      await txDb.runAsync(
        `INSERT OR REPLACE INTO ava_messages (
          id, conversation_id, sender, text_content, intent,
          structured_payload, created_at, _sync_status, _local_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          msg.id,
          msg.conversation_id,
          msg.sender,
          msg.text_content,
          msg.intent,
          msg.structured_payload ? JSON.stringify(msg.structured_payload) : null,
          msg.created_at,
          msg._sync_status,
          msg._local_updated_at,
        ]
      );

      await txDb.runAsync(
        `UPDATE ava_conversations SET updated_at = ?, _local_updated_at = ? WHERE id = ?;`,
        [now, now, conversationId]
      );
    });

    return msg;
  }

  /**
   * Persists a batch of messages inside a single transaction (high performance).
   */
  public static async saveBatchMessages(
    messages: {
      id: string;
      conversation_id: string;
      sender: 'user' | 'ava';
      text?: string;
      text_content?: string;
      structured_payload?: any;
      intent?: string | null;
      created_at?: string | number;
    }[]
  ): Promise<void> {
    if (!messages || messages.length === 0) return;
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return;

    await DatabaseManager.withTransaction(async (txDb) => {
      const now = Date.now();

      // Guarantee the parent conversation row exists (FK ava_messages.conversation_id)
      const convIds = Array.from(new Set(messages.map((m) => m.conversation_id)));
      for (const convId of convIds) {
        await txDb.runAsync(
          `INSERT OR IGNORE INTO ava_conversations (
            id, user_id, title, created_at, updated_at, _sync_status, _local_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [convId, activeUserId, 'Fashion Styling Session', now, now, 'synced', now]
        );
      }
      for (const m of messages) {
        const createdAtMs =
          typeof m.created_at === 'number'
            ? m.created_at
            : m.created_at && !isNaN(Date.parse(m.created_at))
            ? Date.parse(m.created_at)
            : now;
        const text = m.text !== undefined ? m.text : (m.text_content || '');
        const payloadStr = m.structured_payload ? JSON.stringify(m.structured_payload) : null;

        await txDb.runAsync(
          `INSERT OR REPLACE INTO ava_messages (
            id, conversation_id, sender, text_content, intent,
            structured_payload, created_at, _sync_status, _local_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            m.id,
            m.conversation_id,
            m.sender,
            text,
            m.intent || null,
            payloadStr,
            createdAtMs,
            'synced',
            now,
          ]
        );
      }
    });
  }

  /**
   * Retrieves all messages across conversations grouped by conversation_id (for 0ms instant startup pre-hydration).
   */
  public static async getAllMessagesByConversation(): Promise<Record<string, LocalAVAMessage[]>> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return {};

    try {
      const rows = await db.getAllAsync<any>(
        `SELECT m.* FROM ava_messages m
         JOIN ava_conversations c ON m.conversation_id = c.id
         WHERE c.user_id = ?
         ORDER BY m.created_at ASC;`,
        [activeUserId]
      );

      const result: Record<string, LocalAVAMessage[]> = {};
      for (const r of rows) {
        let payload = null;
        try {
          payload = r.structured_payload ? JSON.parse(r.structured_payload) : null;
        } catch (_) {
          payload = null;
        }

        const item: LocalAVAMessage = {
          id: r.id,
          conversation_id: r.conversation_id,
          sender: r.sender as 'user' | 'ava',
          text_content: r.text_content,
          intent: r.intent || null,
          structured_payload: payload,
          created_at: Number(r.created_at),
          _sync_status: r._sync_status || 'synced',
          _local_updated_at: Number(r._local_updated_at),
        };

        if (!result[r.conversation_id]) {
          result[r.conversation_id] = [];
        }
        result[r.conversation_id].push(item);
      }
      return result;
    } catch (err) {
      console.warn('[AVARepository] getAllMessagesByConversation notice:', err);
      return {};
    }
  }

  /**
   * Renames a conversation locally.
   */
  public static async renameConversation(conversationId: string, newTitle: string): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return;

    const now = Date.now();
    await db.runAsync(
      `UPDATE ava_conversations 
       SET title = ?, updated_at = ?, _sync_status = 'pending_rename', _local_updated_at = ?
       WHERE user_id = ? AND id = ?;`,
      [newTitle, now, now, activeUserId, conversationId]
    );
  }

  /**
   * Deletes a conversation and its messages.
   */
  public static async deleteConversation(conversationId: string): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return;

    await db.runAsync(
      `DELETE FROM ava_conversations WHERE user_id = ? AND id = ?;`,
      [activeUserId, conversationId]
    );
  }

  /**
   * Clears all conversations and messages for the active user.
   */
  public static async clearAll(): Promise<void> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return;

    await db.runAsync(`DELETE FROM ava_conversations WHERE user_id = ?;`, [activeUserId]);
  }
}

