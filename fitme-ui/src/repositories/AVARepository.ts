// fitme-ui/src/repositories/AVARepository.ts

import { DatabaseManager } from './DatabaseManager';
import { LocalAVAConversation, LocalAVAMessage } from './types';

export class AVARepository {
  /**
   * Retrieves all styling conversations for the active user.
   */
  public static async getConversations(): Promise<LocalAVAConversation[]> {
    const db = DatabaseManager.getDatabase();
    const activeUserId = DatabaseManager.getActiveUserId();
    if (!activeUserId) return [];

    const rows = await db.getAllAsync<any>(
      `SELECT * FROM ava_conversations 
       WHERE user_id = ? 
       ORDER BY updated_at DESC;`,
      [activeUserId]
    );

    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      title: r.title,
      created_at: Number(r.created_at),
      updated_at: Number(r.updated_at),
      _sync_status: r._sync_status || 'synced',
      _local_updated_at: Number(r._local_updated_at),
    }));
  }

  /**
   * Creates or updates a conversation record locally.
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
      `INSERT OR REPLACE INTO ava_conversations (
        id, user_id, title, created_at, updated_at, _sync_status, _local_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
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

