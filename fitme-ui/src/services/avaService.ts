/**
 * AVA API Service — Client for FitMe AVA AI Fashion Agent Backend API.
 * Local-First: Persists and reads conversation history from local SQLite.
 */

import { request, getAuthenticatedUserId, getSessionEpoch, getBaseUrl, getValidAccessToken } from './api';
import { DatabaseManager, AVARepository, LocalAVAConversation, LocalAVAMessage, generateConversationTitleFromPrompt } from '../repositories';

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
  description?: string;
  why?: string;
  tag?: string;
  budget_min?: number;
  budget_max?: number;
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
  messages?: AVAMessageItem[];
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
    last_message: conv.last_message,
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

export function isValidUUID(str?: string | null): boolean {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function sendAVAMessage(
  message: string,
  conversationId?: string,
  selectedOutfit?: AVAOutfitCard,
  imageBase64?: string,
  imageUri?: string
): Promise<AVAChatResponsePayload> {
  const activeUserId = getAuthenticatedUserId();
  const currentEpoch = getSessionEpoch();

  const safeConvId = isValidUUID(conversationId) ? conversationId : null;
  const payload = {
    message,
    conversation_id: safeConvId,
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
      const convId = (resp.conversation_id && isValidUUID(resp.conversation_id))
        ? resp.conversation_id
        : (isValidUUID(conversationId) ? conversationId! : generateUUID());
      const title = generateConversationTitleFromPrompt(message);
      const userMsgId = `usr_${Date.now()}`;
      const avaMsgId = `ava_${Date.now() + 1}`;
      const userPayload = (imageUri || imageBase64)
        ? {
            image_url:
              imageUri ||
              (imageBase64
                ? imageBase64.startsWith('data:')
                  ? imageBase64
                  : `data:image/jpeg;base64,${imageBase64}`
                : undefined),
          }
        : undefined;

      await AVARepository.createConversation(convId, title);
      await AVARepository.addMessage(userMsgId, convId, 'user', message, userPayload);
      await AVARepository.addMessage(
        avaMsgId,
        convId,
        'ava',
        resp.message,
        { outfits: resp.outfits, suggested_actions: resp.suggested_actions },
        resp.intent
      );
      try {
        const { useAVAStore } = require('./avaStore');
        useAVAStore.getState().addOrUpdateConversation({
          id: convId,
          title,
          last_message: message,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        useAVAStore.getState().appendMessageToConversation(convId, {
          id: userMsgId,
          sender: 'user',
          text: message,
          structured_payload: userPayload,
          created_at: new Date().toISOString(),
        });
        useAVAStore.getState().appendMessageToConversation(convId, {
          id: avaMsgId,
          sender: 'ava',
          text: resp.message || '',
          intent: resp.intent,
          structured_payload: { outfits: resp.outfits, suggested_actions: resp.suggested_actions },
          created_at: new Date().toISOString(),
        });
      } catch (_) {}
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

let activeStreamXhr: XMLHttpRequest | null = null;

export function abortActiveAVAChat(): void {
  if (activeStreamXhr) {
    try {
      activeStreamXhr.abort();
    } catch (_) {}
    activeStreamXhr = null;
  }
}

export async function streamAVAMessage(
  message: string,
  callbacks: AVAStreamCallbacks,
  conversationId?: string,
  selectedOutfit?: AVAOutfitCard,
  imageBase64?: string,
  imageUri?: string
): Promise<AVAChatResponsePayload> {
  const activeUserId = getAuthenticatedUserId();
  const currentEpoch = getSessionEpoch();

  const safeConvId = isValidUUID(conversationId) ? conversationId : null;
  const payload = {
    message,
    conversation_id: safeConvId,
    selected_outfit: selectedOutfit || null,
    image_base64: imageBase64 || null,
  };

  const currentBaseUrl = getBaseUrl();
  const token = await getValidAccessToken();

  return new Promise<AVAChatResponsePayload>((resolve, reject) => {
    let accumulatedText = '';
    let discoveredOutfits: AVAOutfitCard[] = [];
    let returnedConvId = isValidUUID(conversationId) ? conversationId : undefined;
    let suggestedActions: string[] = [];
    let lastProcessedIndex = 0;
    let isFinished = false;
    let wasAborted = false;

    const finalizeAndResolve = async () => {
      if (isFinished) return;
      isFinished = true;
      activeStreamXhr = null;

      const resolvedConvId = (returnedConvId && isValidUUID(returnedConvId))
        ? returnedConvId
        : (isValidUUID(conversationId) ? conversationId! : generateUUID());

      // Guard: discard if session changed during network call
      if (getSessionEpoch() !== currentEpoch || (activeUserId && getAuthenticatedUserId() !== activeUserId)) {
        resolve({
          conversation_id: resolvedConvId,
          message: accumulatedText,
          intent: 'gpt_stylist',
          mode: 'gpt_stream',
          outfits: discoveredOutfits,
          tool_calls_log: [],
          suggested_actions: suggestedActions,
        });
        return;
      }

      const cleanMsg = accumulatedText
        .replace(/I'm unable to analyze skin tone from images\.?\s*(However,\s*)?/gi, '')
        .replace(/(?:^|\n)#*\s*Explore Your Closet[\s\S]*?(?=(?:(?:^|\n)#*\s*Plan Your Next Outfit|(?:^|\n)#*\s*Accessorize Thoughtfully|(?:^|\n)#*\s*Shopping List|$))/gi, '')
        .replace(/(?:^|\n)#*\s*Plan Your Next Outfit[\s\S]*?(?=(?:(?:^|\n)#*\s*Accessorize Thoughtfully|(?:^|\n)#*\s*Shopping List|$))/gi, '')
        .replace(/(?:^|\n)#*\s*Accessorize Thoughtfully[\s\S]*?(?=(?:(?:^|\n)#*\s*Shopping List|$))/gi, '')
        .replace(/(?:^|\n)#*\s*Shopping List[\s\S]*?$/gi, '')
        .replace(/Finding Your Undertone[\s\S]*?(?=(?:Power Colors|Palette|Recommended Outfits|\*\*Power Colors|\n\n###|$))/gi, '')
        .replace(/\d+\.\s*\*\*Vein Test\*\*:[^\n]*\n(?:[^\n]*\n)*/gi, '')
        .replace(/\d+\.\s*\*\*Sun Reaction\*\*:[^\n]*\n(?:[^\n]*\n)*/gi, '')
        .replace(/\d+\.\s*\*\*Jewelry Test\*\*:[^\n]*\n(?:[^\n]*\n)*/gi, '')
        .trim();

      let finalMessageText = cleanMsg || accumulatedText;
      if (!finalMessageText) {
        if (wasAborted) {
          finalMessageText = "Styling generation stopped.";
        } else if (discoveredOutfits.length > 0) {
          finalMessageText = "Here are curated pieces styled especially for you based on our live catalog.";
        } else {
          finalMessageText = "I'm here to help style your outfits! Please let me know what occasion or look you'd like to explore.";
        }
      }

      const finalPayload: AVAChatResponsePayload = {
        conversation_id: resolvedConvId,
        message: finalMessageText,
        intent: 'gpt_stylist',
        mode: 'gpt_stream',
        outfits: discoveredOutfits,
        tool_calls_log: [],
        suggested_actions: suggestedActions,
      };

      if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
        try {
          const convId = finalPayload.conversation_id;
          const title = generateConversationTitleFromPrompt(message);
          const streamUserMsgId = `usr_${Date.now()}`;
          const streamAvaMsgId = `ava_${Date.now() + 1}`;
          const userPayload = (imageUri || imageBase64)
            ? {
                image_url:
                  imageUri ||
                  (imageBase64
                    ? imageBase64.startsWith('data:')
                      ? imageBase64
                      : `data:image/jpeg;base64,${imageBase64}`
                    : undefined),
              }
            : undefined;

          await AVARepository.createConversation(convId, title);
          await AVARepository.addMessage(streamUserMsgId, convId, 'user', message, userPayload);
          await AVARepository.addMessage(
            streamAvaMsgId,
            convId,
            'ava',
            finalPayload.message,
            { outfits: finalPayload.outfits, suggested_actions: finalPayload.suggested_actions },
            finalPayload.intent
          );
          try {
            const { useAVAStore } = require('./avaStore');
            useAVAStore.getState().addOrUpdateConversation({
              id: convId,
              title,
              last_message: message,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            useAVAStore.getState().appendMessageToConversation(convId, {
              id: streamUserMsgId,
              sender: 'user',
              text: message,
              structured_payload: userPayload,
              created_at: new Date().toISOString(),
            });
            useAVAStore.getState().appendMessageToConversation(convId, {
              id: streamAvaMsgId,
              sender: 'ava',
              text: finalPayload.message || '',
              intent: finalPayload.intent,
              structured_payload: {
                outfits: finalPayload.outfits,
                suggested_actions: finalPayload.suggested_actions,
              },
              created_at: new Date().toISOString(),
            });
          } catch (_) {}
        } catch (dbErr) {
          console.log('[avaService] SQLite persistence notice on stream message:', dbErr);
        }
      }

      callbacks.onDone?.(finalPayload);
      resolve(finalPayload);
    };

    const processBuffer = (fullResponseText: string) => {
      // Find the last complete newline to avoid cutting JSON objects in half
      const lastNewlineIndex = fullResponseText.lastIndexOf('\n');
      if (lastNewlineIndex < lastProcessedIndex) return;

      const completeChunk = fullResponseText.substring(lastProcessedIndex, lastNewlineIndex + 1);
      lastProcessedIndex = lastNewlineIndex + 1;

      const lines = completeChunk.split('\n');
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
    };

    const xhr = new XMLHttpRequest();
    activeStreamXhr = xhr;
    xhr.open('POST', `${currentBaseUrl}/api/v1/ava/chat/stream`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.onabort = () => {
      wasAborted = true;
      activeStreamXhr = null;
      finalizeAndResolve();
    };

    xhr.onprogress = () => {
      if (xhr.responseText) {
        processBuffer(xhr.responseText);
      }
    };

    xhr.onreadystatechange = () => {
      if (wasAborted) return;
      if (xhr.readyState === 3 && xhr.responseText) {
        processBuffer(xhr.responseText);
      } else if (xhr.readyState === 4) {
        activeStreamXhr = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          if (xhr.responseText) {
            processBuffer(xhr.responseText);
          }
          finalizeAndResolve();
        } else {
          if (wasAborted) return;
          console.log('[streamAVAMessage] Fallback to standard request due to HTTP status:', xhr.status);
          sendAVAMessage(message, conversationId, selectedOutfit, imageBase64, imageUri)
            .then(async (standardResp) => {
              if (wasAborted) return;
              const words = (standardResp.message || '').split(' ');
              for (let i = 0; i < words.length; i++) {
                if (wasAborted) break;
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
              resolve(standardResp);
            })
            .catch((err) => {
              if (wasAborted) return;
              callbacks.onError?.(err);
              reject(err);
            });
        }
      }
    };

    xhr.onerror = () => {
      if (wasAborted) return;
      console.log('[streamAVAMessage] XHR network error, falling back to standard request');
      sendAVAMessage(message, conversationId, selectedOutfit, imageBase64, imageUri)
        .then(async (standardResp) => {
          if (wasAborted) return;
          const words = (standardResp.message || '').split(' ');
          for (let i = 0; i < words.length; i++) {
            if (wasAborted) break;
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
          resolve(standardResp);
        })
        .catch((err) => {
          if (wasAborted) return;
          callbacks.onError?.(err);
          reject(err);
        });
    };

    xhr.send(JSON.stringify(payload));
  });
}

export async function getAVAConversations(): Promise<AVAConversationSummary[]> {
  const activeUserId = getAuthenticatedUserId();

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

  // Trigger non-blocking background fetch via store
  try {
    const { useAVAStore } = require('./avaStore');
    useAVAStore.getState().fetchConversations().catch(() => {});
  } catch (_) {}

  // If local conversations exist, return immediately (0ms UI latency!)
  if (localConvs.length > 0) {
    return localConvs;
  }

  // Fallback for brand-new users with zero local cache
  try {
    const remoteConvs = await request<AVAConversationSummary[]>('/api/v1/ava/conversations', { timeoutMs: 5000 });
    if (Array.isArray(remoteConvs)) {
      if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
        try {
          for (const conv of remoteConvs) {
            const createdAtMs = conv.created_at && !isNaN(Date.parse(conv.created_at)) ? Date.parse(conv.created_at) : Date.now();
            const updatedAtMs = conv.updated_at && !isNaN(Date.parse(conv.updated_at)) ? Date.parse(conv.updated_at) : Date.now();
            await AVARepository.createConversation(conv.id, conv.title || 'Fashion Styling Session', createdAtMs, updatedAtMs);
          }
        } catch (_) {}
      }
      return remoteConvs;
    }
  } catch (err: any) {
    console.log('[avaService] Remote conversation fetch notice:', err?.message || err);
  }

  return localConvs;
}

export async function getLocalAVAMessages(
  conversationId: string
): Promise<AVAMessageItem[]> {
  const activeUserId = getAuthenticatedUserId();
  if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
    try {
      const rows = await AVARepository.getMessages(conversationId);
      return rows.map(mapLocalMessageToItem);
    } catch (dbErr) {
      console.log('[avaService] SQLite read notice for local messages:', dbErr);
    }
  }
  return [];
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
      `/api/v1/ava/conversations/${conversationId}/messages`,
      { timeoutMs: 6000 }
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
      // 1. Batch persist fresh server messages to local SQLite inside a single transaction
      if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
        try {
          const batchItems = res.messages.map((m) => ({
            ...m,
            conversation_id: res.conversation_id || conversationId,
          }));
          await AVARepository.saveBatchMessages(batchItems);
        } catch (dbSaveErr) {
          console.log('[avaService] SQLite batch save notice for messages:', dbSaveErr);
        }
      }

      // 2. Update Zustand store in memory
      try {
        const { useAVAStore } = require('./avaStore');
        useAVAStore.getState().setConversationMessages(conversationId, res.messages);
      } catch (_) {}

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

  // Optimistic store removal
  try {
    const { useAVAStore } = require('./avaStore');
    useAVAStore.getState().removeConversation(conversationId);
  } catch (_) {}

  try {
    return await request<{ success: boolean }>(`/api/v1/ava/conversations/${conversationId}`, {
      method: 'DELETE',
    });
  } catch (err: any) {
    console.log('[avaService] Remote conversation delete notice:', err?.message || err);
    return { success: true };
  }
}

export async function renameAVAConversation(
  conversationId: string,
  newTitle: string
): Promise<{ success: boolean; title?: string }> {
  const activeUserId = getAuthenticatedUserId();

  // Optimistic SQLite rename
  if (activeUserId && DatabaseManager.getActiveUserId() === activeUserId) {
    try {
      await AVARepository.renameConversation(conversationId, newTitle);
    } catch (dbErr) {
      console.log('[avaService] SQLite rename notice:', dbErr);
    }
  }

  // Optimistic store rename
  try {
    const { useAVAStore } = require('./avaStore');
    useAVAStore.getState().renameConversationInStore(conversationId, newTitle);
  } catch (_) {}

  try {
    return await request<{ success: boolean; title?: string }>(
      `/api/v1/ava/conversations/${conversationId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ title: newTitle }),
      }
    );
  } catch (err: any) {
    console.log('[avaService] Remote conversation rename notice:', err?.message || err);
    return { success: true, title: newTitle };
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

export async function resolveExactProductUrl(
  title: string,
  seller?: string,
  currentUrl?: string
): Promise<{ direct_url: string; is_direct: boolean; retailer: string }> {
  try {
    return await request<{ direct_url: string; is_direct: boolean; retailer: string }>(
      '/api/v1/ava/resolve-pdp',
      {
        method: 'POST',
        body: JSON.stringify({
          title,
          seller,
          current_url: currentUrl,
        }),
      }
    );
  } catch (err) {
    console.warn('[avaService] resolveExactProductUrl failed:', err);
    return { direct_url: currentUrl || '', is_direct: false, retailer: seller || 'Store' };
  }
}


