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

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

export async function sendAVAMessage(
  message: string,
  conversationId?: string,
  selectedOutfit?: AVAOutfitCard,
  imageBase64?: string
): Promise<AVAChatResponsePayload> {
  const requestUrl = `${BACKEND_URL}/api/v1/ava/chat`;
  const payload = {
    message,
    conversation_id: conversationId || null,
    selected_outfit: selectedOutfit || null,
    image_base64: imageBase64 || null,
  };

  console.log(`[avaService] POST ${requestUrl}`, JSON.stringify(payload));

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[avaService] API Error (${response.status}):`, errText);
    throw new Error(`AVA Backend Error (${response.status}): ${errText || 'Network request failed'}`);
  }

  const data: AVAChatResponsePayload = await response.json();
  console.log(`[avaService] Received Response:`, data);
  return data;
}

export async function getAVAConversations(): Promise<AVAConversationSummary[]> {
  const requestUrl = `${BACKEND_URL}/api/v1/ava/conversations`;
  console.log(`[avaService] GET ${requestUrl}`);
  const response = await fetch(requestUrl);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch conversations (${response.status}): ${errText}`);
  }
  return await response.json();
}

export async function getAVAMessages(conversationId: string): Promise<{ conversation_id: string; title: string; messages: AVAMessageItem[] }> {
  const requestUrl = `${BACKEND_URL}/api/v1/ava/conversations/${conversationId}/messages`;
  console.log(`[avaService] GET ${requestUrl}`);
  const response = await fetch(requestUrl);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch messages for ${conversationId} (${response.status}): ${errText}`);
  }
  return await response.json();
}

export async function deleteAVAConversation(conversationId: string): Promise<{ success: boolean }> {
  const requestUrl = `${BACKEND_URL}/api/v1/ava/conversations/${conversationId}`;
  console.log(`[avaService] DELETE ${requestUrl}`);
  const response = await fetch(requestUrl, { method: 'DELETE' });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to delete conversation (${response.status}): ${errText}`);
  }
  return await response.json();
}
