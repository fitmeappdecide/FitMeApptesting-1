// fitme-ui/src/repositories/types.ts

export type SyncStatus = 'synced' | 'pending_mutation' | 'pending_upload' | 'pending_rename' | 'pending_delete' | 'pending_send' | 'deleted';

export type TryOnStatus = 'queued' | 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface LocalUser {
  id: string; // UUID string
  email: string;
  full_name: string | null;
  avatar_uri: string | null;
  try_on_count: number;
  saved_count: number;
  is_premium: boolean;
  created_at: number; // Unix Epoch MS
  updated_at: number;
  _sync_status: SyncStatus;
  _local_updated_at: number;
}

export interface LocalTryOnJob {
  local_id: string; // Client UUID
  server_id: string | null; // Supabase UUID if synced
  user_id: string;
  garment_id: string;
  brand_id: string | null;
  status: TryOnStatus;
  result_image_urls: string[]; // Decoded from JSON array
  local_image_paths: string[]; // Decoded from JSON array
  cache_tier: string | null;
  processing_time_seconds: number | null;
  error_message: string | null;
  is_saved: boolean;
  saved_photo_id: string | null;
  saved_photo_name: string | null;
  created_at: number;
  completed_at: number | null;
  _sync_status: SyncStatus;
  _local_updated_at: number;
}

export interface LocalUserSavedPhoto {
  id: string;
  user_id: string;
  storage_path: string;
  local_file_uri: string;
  display_name: string;
  original_filename: string | null;
  mime_type: string;
  content_hash: string | null;
  created_at: number;
  updated_at: number;
  _sync_status: SyncStatus;
  _local_updated_at: number;
}

export interface LocalAVAConversation {
  id: string;
  user_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  _sync_status: SyncStatus;
  _local_updated_at: number;
}

export interface LocalAVAMessage {
  id: string;
  conversation_id: string;
  sender: 'user' | 'ava';
  text_content: string;
  intent: string | null;
  structured_payload: any | null; // Parsed from JSON
  created_at: number;
  _sync_status: SyncStatus;
  _local_updated_at: number;
}

export interface LocalProductCache {
  canonical_key: string;
  url: string;
  title: string;
  brand: string | null;
  price: number | null;
  image_url: string;
  product_json: any; // Parsed from JSON
  cached_at: number;
  expires_at: number;
}

export interface LocalRecentItem<T = any> {
  id: string;
  item_type: 'comparison' | 'tryon' | 'price_comparison' | string;
  item_data: T; // Parsed from JSON
  created_at: number;
}

export interface LocalSyncOutboxItem {
  id: string;
  user_id: string;
  entity_type: 'tryon_job' | 'user_saved_photo' | 'user_profile' | 'ava_message';
  entity_id: string;
  mutation_type: 'INSERT' | 'UPDATE' | 'DELETE' | 'UPLOAD' | 'TOGGLE_SAVE';
  payload: Record<string, any>; // Parsed from JSON
  created_at: number;
  retry_count: number;
  status: 'pending' | 'in_flight' | 'failed';
  last_error: string | null;
  locked_until: number;
}

export interface LocalSyncMetadata {
  key: string;
  value: string;
  updated_at: number;
}
