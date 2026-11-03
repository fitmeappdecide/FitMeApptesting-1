/**
 * AVA API Service — Client for FitMe AVA AI Fashion Agent Backend API.
 * Local-First: Persists and reads conversation history from local SQLite.
 */

import { request, getAuthenticatedUserId, getSessionEpoch, getBaseUrl, getValidAccessToken } from './api';
import { DatabaseManager, AVARepository, LocalAVAConversation, LocalAVAMessage } from '../repositories';

export interface AVAProductItem {
  category?: string;
  product_id?: string;
  name?: string;
  title?: string;
  brand?: string;
  price?: number;
  currency?: string;
  image_url?: string;
  image?: string;
  retailer?: string;
  seller?: string;
  product_url?: string;
  canonical_product_url?: string;
  affiliate_url?: string;
  url?: string;
  is_shoppable?: boolean;
  source_type?: string;
}

export interface AVAOutfitCard {
  id: string;
  name: string;
  occasion?: string;
  style?: string;
  items: AVAProductItem[];
  total_price: number;
  original_price?: number;
  savings?: number;
  reason?: string;
  actions?: string[];
}

export interface AVAChatResponsePayload {
  conversation_id: string;
  message: string;
  intent: string;
  mode: string;
  outfits: AVAOutfitCard[];
  tool_calls_log: Array<{ tool: string; time_ms?: number; status?: string }>;
  suggested_actions: string[];
}

export interface AVAConversationSummary {
  id: string;
  title: string;
  last_message?: string;
  created_at: string;
  updated_at: string;
}

export interface AVAMessageItem {
  id: string;
  sender: 'user' | 'ava';
  text: string;
  intent?: string;
  structured_payload?: any;
  created_at?: string;
}

export function mapLocalConversationToSummary(conv: LocalAVAConversation): AVAConversationSummary {
  return {
    id: conv.id,
    title: conv.title,
    created_at:
      typeof conv.created_at === 'number'
        ? new Date(conv.created_at).toISOString()
        : String(conv.created_at || ''),
    updated_at:
      typeof conv.updated_at === 'number'
        ? new Date(conv.updated_at).toISOString()
        : String(conv.updated_at || ''),
  };
}

export function mapLocalMessageToItem(msg: LocalAVAMessage): AVAMessageItem {
  return {
    id: msg.id,
    sender: msg.sender,
    text: msg.text_content,
    intent: msg.intent || undefined,
    structured_payload: msg.structured_payload || undefined,
    created_at:
      typeof msg.created_at === 'number'
        ? new Date(msg.created_at).toISOString()
        : String(msg.created_at || ''),
  };
}

export async function sendAVAMessage(
  message: string,
  conversationId?: string,
  selectedOutfit?: AVAOutfitCard,
  imageBase64?: string
): Promise<AVAChatResponsePayload> {
  const activeUserId = getAuthenticatedUserId();
  const currentEpoch = getSessionEpoch();

  const payload = {
    message,
    conversation_id: conversationId || null,
    selected_outfit: selectedOutfit || null,
    image_base64: imageBase64 || null,
  };

  const resp = await request<AVAChatResponsePayload>('/api/v1/ava/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  // Guard: discard if session changed during network call
  if (getSessionEpoch() !== currentEpoch || (activeUserId && getAuthenticatedUserId() !== activeUserId)) {
    return resp;
  }

  // Persist live conversation & messages to local SQLite
  if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
    try {
      const convId = resp.conversation_id || conversationId || `conv_${Date.now()}`;
      await AVARepository.createConversation(convId, 'Fashion Styling Session');
      await AVARepository.addMessage(`usr_${Date.now()}`, convId, 'user', message);
      await AVARepository.addMessage(
        `ava_${Date.now()}`,
        convId,
        'ava',
        resp.message,
        { outfits: resp.outfits, suggested_actions: resp.suggested_actions },
        resp.intent
      );
    } catch (dbErr) {
      console.log('[avaService] SQLite persistence notice on send message:', dbErr);
    }
  }

  return resp;
}

export type AVAStreamCallbacks = {
  onToken: (chunk: string) => void;
  onStatus?: (status: string) => void;
  onOutfit?: (outfit: AVAOutfitCard) => void;
  onDone?: (payload: AVAChatResponsePayload) => void;
  onError?: (err: any) => void;
};

export async function streamAVAMessage(
  message: string,
  callbacks: AVAStreamCallbacks,
  conversationId?: string,
  selectedOutfit?: AVAOutfitCard,
  imageBase64?: string
): Promise<AVAChatResponsePayload> {
  const activeUserId = getAuthenticatedUserId();
  const currentEpoch = getSessionEpoch();

  const payload = {
    message,
    conversation_id: conversationId || null,
    selected_outfit: selectedOutfit || null,
    image_base64: imageBase64 || null,
  };

  const currentBaseUrl = getBaseUrl();
  const token = await getValidAccessToken();

  let accumulatedText = '';
  let discoveredOutfits: AVAOutfitCard[] = [];
  let returnedConvId = conversationId;
  let suggestedActions: string[] = [];

  try {
    const response = await fetch(`${currentBaseUrl}/api/v1/ava/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const rawText = await response.text();
    const lines = rawText.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        try {
          const data = JSON.parse(trimmed.slice(6));
          if (data.event === 'start' && data.conversation_id) {
            returnedConvId = data.conversation_id;
          } else if (data.event === 'token' && data.chunk) {
            accumulatedText += data.chunk;
            callbacks.onToken(data.chunk);
          } else if (data.event === 'status' && data.status) {
            callbacks.onStatus?.(data.status);
          } else if (data.event === 'outfit' && data.outfit) {
            discoveredOutfits.push(data.outfit);
            callbacks.onOutfit?.(data.outfit);
          } else if (data.event === 'done') {
            if (data.conversation_id) returnedConvId = data.conversation_id;
            if (data.outfits && data.outfits.length > 0) discoveredOutfits = data.outfits;
            if (data.suggested_actions) suggestedActions = data.suggested_actions;
          }
        } catch (_) {}
      }
    }
  } catch (err: any) {
    console.log('[streamAVAMessage] Fallback to standard request due to:', err?.message || err);
    // Graceful fallback to standard request with simulated typing
    const standardResp = await sendAVAMessage(message, conversationId, selectedOutfit, imageBase64);
    const words = (standardResp.message || '').split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = words[i] + (i < words.length - 1 ? ' ' : '');
      callbacks.onToken(chunk);
      await new Promise((r) => setTimeout(r, 15));
    }
    if (standardResp.outfits) {
      for (const o of standardResp.outfits) {
        callbacks.onOutfit?.(o);
      }
    }
    callbacks.onDone?.(standardResp);
    return standardResp;
  }

  const finalPayload: AVAChatResponsePayload = {
    conversation_id: returnedConvId || conversationId || `conv_${Date.now()}`,
    message: accumulatedText,
    intent: 'gpt_stylist',
    mode: 'gpt_stream',
    outfits: discoveredOutfits,
    tool_calls_log: [],
    suggested_actions: suggestedActions,
  };

  if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
    try {
      const convId = finalPayload.conversation_id;
      await AVARepository.createConversation(convId, 'Fashion Styling Session');
      await AVARepository.addMessage(`usr_${Date.now()}`, convId, 'user', message);
      await AVARepository.addMessage(
        `ava_${Date.now()}`,
        convId,
        'ava',
        finalPayload.message,
        { outfits: finalPayload.outfits, suggested_actions: finalPayload.suggested_actions },
        finalPayload.intent
      );
    } catch (dbErr) {
      console.log('[avaService] SQLite persistence notice on stream message:', dbErr);
    }
  }

  callbacks.onDone?.(finalPayload);
  return finalPayload;
}

export async function getAVAConversations(): Promise<AVAConversationSummary[]> {
  const activeUserId = getAuthenticatedUserId();
  const currentEpoch = getSessionEpoch();

  let localConvs: AVAConversationSummary[] = [];

  // 1. Read SQLite first (0ms UI latency)
  if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
    try {
      const rows = await AVARepository.getConversations();
      localConvs = rows.map(mapLocalConversationToSummary);
    } catch (dbErr) {
      console.log('[avaService] SQLite read notice for conversations:', dbErr);
    }
  }

  try {
    const remoteConvs = await request<AVAConversationSummary[]>('/api/v1/ava/conversations');

    // Guard: discard if session changed during network fetch
    if (getSessionEpoch() !== currentEpoch || (activeUserId && getAuthenticatedUserId() !== activeUserId)) {
      return localConvs;
    }

    if (Array.isArray(remoteConvs)) {
      // Persist fresh server conversations to local SQLite
      if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
        try {
          for (const conv of remoteConvs) {
            const createdAtMs = conv.created_at
              ? !isNaN(Date.parse(conv.created_at))
                ? Date.parse(conv.created_at)
                : Date.now()
              : Date.now();
            const updatedAtMs = conv.updated_at
              ? !isNaN(Date.parse(conv.updated_at))
                ? Date.parse(conv.updated_at)
                : Date.now()
              : Date.now();

            await AVARepository.createConversation(
              conv.id,
              conv.title || 'Fashion Styling Session',
              createdAtMs,
              updatedAtMs
            );
          }
        } catch (dbSaveErr) {
          console.log('[avaService] SQLite save notice for conversations:', dbSaveErr);
        }
      }
      return remoteConvs;
    }
  } catch (err: any) {
    console.log('[avaService] Remote conversation fetch notice, returning local history:', err?.message || err);
  }

  return localConvs;
}

export async function getAVAMessages(
  conversationId: string
): Promise<{ conversation_id: string; title: string; messages: AVAMessageItem[] }> {
  const activeUserId = getAuthenticatedUserId();
  const currentEpoch = getSessionEpoch();

  let localMessages: AVAMessageItem[] = [];

  // 1. Read SQLite first (0ms UI latency)
  if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
    try {
      const rows = await AVARepository.getMessages(conversationId);
      localMessages = rows.map(mapLocalMessageToItem);
    } catch (dbErr) {
      console.log('[avaService] SQLite read notice for messages:', dbErr);
    }
  }

  try {
    const res = await request<{ conversation_id: string; title: string; messages: AVAMessageItem[] }>(
      `/api/v1/ava/conversations/${conversationId}/messages`
    );

    // Guard: discard if session changed during network fetch
    if (getSessionEpoch() !== currentEpoch || (activeUserId && getAuthenticatedUserId() !== activeUserId)) {
      return {
        conversation_id: conversationId,
        title: 'Fashion Styling Session',
        messages: localMessages,
      };
    }

    if (res && Array.isArray(res.messages)) {
      // Persist fresh server messages to local SQLite
      if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
        try {
          for (const m of res.messages) {
            const createdAtMs = m.created_at
              ? !isNaN(Date.parse(m.created_at))
                ? Date.parse(m.created_at)
                : Date.now()
              : Date.now();

            await AVARepository.addMessage(
              m.id,
              res.conversation_id || conversationId,
              m.sender,
              m.text || '',
              m.structured_payload,
              m.intent,
              createdAtMs
            );
          }
        } catch (dbSaveErr) {
          console.log('[avaService] SQLite save notice for messages:', dbSaveErr);
        }
      }
      return res;
    }
  } catch (err: any) {
    console.log('[avaService] Remote messages fetch notice, returning local messages:', err?.message || err);
  }

  return {
    conversation_id: conversationId,
    title: 'Fashion Styling Session',
    messages: localMessages,
  };
}

export async function deleteAVAConversation(conversationId: string): Promise<{ success: boolean }> {
  const activeUserId = getAuthenticatedUserId();

  // Optimistic SQLite deletion
  if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
    try {
      await AVARepository.deleteConversation(conversationId);
    } catch (dbErr) {
      console.log('[avaService] SQLite delete notice:', dbErr);
    }
  }

  try {
    return await request<{ success: boolean }>(`/api/v1/ava/conversations/${conversationId}`, {
      method: 'DELETE',
    });
  } catch (err: any) {
    console.log('[avaService] Remote conversation delete notice:', err?.message || err);
    return { success: true };
  }
}

export interface AVAPreferences {
  style_dna?: Record<string, number>;
  preferred_colors?: string[];
  disliked_colors?: string[];
  disliked_items?: string[];
  preferred_fits?: string[];
  favorite_brands?: string[];
  favorite_retailers?: string[];
  budget_range_min?: number | null;
  budget_range_max?: number | null;
}

export async function getAVAPreferences(): Promise<AVAPreferences> {
  return await request<AVAPreferences>('/api/v1/ava/preferences', {
    method: 'GET',
  });
}

export async function updateAVAPreferences(preferences: Partial<AVAPreferences>): Promise<{ status: string; preferences: AVAPreferences }> {
  return await request<{ status: string; preferences: AVAPreferences }>('/api/v1/ava/preferences', {
    method: 'PUT',
    body: JSON.stringify(preferences),
  });
}

