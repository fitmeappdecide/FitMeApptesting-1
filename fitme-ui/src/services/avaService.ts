/**
 * AVA API Service — Client for FitMe AVA AI Fashion Agent Backend API.
 * NO MOCK FALLBACKS: Directly communicates with POST /api/v1/ava/chat.
 */

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

import { request } from './api';

export async function sendAVAMessage(
  message: string,
  conversationId?: string,
  selectedOutfit?: AVAOutfitCard,
  imageBase64?: string
): Promise<AVAChatResponsePayload> {
  const payload = {
    message,
    conversation_id: conversationId || null,
    selected_outfit: selectedOutfit || null,
    image_base64: imageBase64 || null,
  };

  return await request<AVAChatResponsePayload>('/api/v1/ava/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function getAVAConversations(): Promise<AVAConversationSummary[]> {
  return await request<AVAConversationSummary[]>('/api/v1/ava/conversations');
}

export async function getAVAMessages(conversationId: string): Promise<{ conversation_id: string; title: string; messages: AVAMessageItem[] }> {
  return await request<{ conversation_id: string; title: string; messages: AVAMessageItem[] }>(
    `/api/v1/ava/conversations/${conversationId}/messages`
  );
}

export async function deleteAVAConversation(conversationId: string): Promise<{ success: boolean }> {
  return await request<{ success: boolean }>(`/api/v1/ava/conversations/${conversationId}`, {
    method: 'DELETE',
  });
}
