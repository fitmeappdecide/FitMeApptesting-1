/**
 * FitMe API Service
 *
 * Wired to the real FastAPI backend at `fit me backend/fashion/backend`
 * (see app/main.py + app/api/*.py for the source of truth on routes).
 *
 * IMPORTANT: Product *extraction* itself is NOT an API call — it happens
 * on-device via the native `fitme-extraction` module (see src/services/extraction.ts).
 * This file only persists the already-extracted product to the backend
 * (`product.fromExtraction`) and drives auth / body-scan / try-on / profile.
 *
 * Set EXPO_PUBLIC_API_URL in a `.env` file, e.g.:
 *   EXPO_PUBLIC_API_URL=http://localhost:8000   (iOS simulator / web)
 *   EXPO_PUBLIC_API_URL=http://10.0.2.2:8000    (Android emulator -> host machine)
 */
import * as SecureStore from 'expo-secure-store';

// Determine API base URL, handling Android emulator vs real device networking
import { Platform } from 'react-native';

const envUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

function resolveBaseUrl(): string {
  if (envUrl) {
    // If it's already a real LAN/WAN IP (not loopback), use it directly on all platforms
    if (!envUrl.includes('127.0.0.1') && !envUrl.includes('localhost')) {
      return envUrl;
    }
    // On Android, rewrite loopback to emulator host alias
    if (Platform.OS === 'android') {
      return envUrl.replace('127.0.0.1', '10.0.2.2').replace('localhost', '10.0.2.2');
    }
    return envUrl.replace('localhost', '127.0.0.1');
  }
  // Fallback defaults
  return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
}

export const BASE_URL = resolveBaseUrl();


const ACCESS_TOKEN_KEY = 'fitme_access_token';
const REFRESH_TOKEN_KEY = 'fitme_refresh_token';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshPromise: Promise<string> | null = null;

function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return true;
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const decoded = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
    const parsed = JSON.parse(decoded);
    if (parsed.exp && typeof parsed.exp === 'number') {
      // Considered expired if within 30 seconds of expiry
      return Date.now() >= (parsed.exp * 1000 - 30_000);
    }
    return false;
  } catch {
    return false;
  }
}

async function performTokenRefresh(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  if (!refreshToken) {
    refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  }
  if (!refreshToken) {
    await clearAuth();
    throw new ApiError(401, 'Session expired. Please log in again.', 'SESSION_EXPIRED');
  }

  refreshPromise = (async () => {
    try {
      const refreshed = await request<{ access_token: string; token_type: string }>(
        '/api/v1/auth/refresh',
        { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) },
        false
      );
      accessToken = refreshed.access_token;
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, refreshed.access_token);
      return refreshed.access_token;
    } catch (err) {
      await clearAuth();
      throw new ApiError(401, 'Session expired. Please log in again.', 'SESSION_EXPIRED');
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function loadStoredAuth(): Promise<boolean> {
  accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (accessToken && isTokenExpired(accessToken) && refreshToken) {
    try {
      await performTokenRefresh();
    } catch {
      // Refresh error handled, auth state reflects validity
    }
  }
  return !!accessToken;
}

async function getValidAccessToken(): Promise<string | null> {
  if (!accessToken) {
    accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  }
  if (accessToken && isTokenExpired(accessToken) && refreshToken) {
    try {
      await performTokenRefresh();
    } catch {
      // Handled by refresh
    }
  }
  return accessToken;
}

async function persistAuth(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
}

export async function clearAuth() {
  accessToken = null;
  refreshToken = null;
  refreshPromise = null;
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

/** Matches FastAPI's uniform error envelope: {error, message, message_hi} */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type RequestOptions = RequestInit & { timeoutMs?: number; silentTimeout?: boolean };

export async function request<T>(endpoint: string, options: RequestOptions = {}, retry = true): Promise<T> {
  console.log('REQUEST FUNCTION CALLED');
  console.log('BASE_URL:', BASE_URL);
  const isForm = options.body instanceof FormData;
  console.log('Endpoint:', endpoint);
  console.log('Method:', options.method ?? 'GET');
  console.log('Headers before merge:', options.headers);
  console.log('Body (type):', options.body ? (options.body instanceof FormData ? 'FormData' : typeof options.body) : 'undefined');

  let response: Response;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    console.log('REQUEST URL:', `${BASE_URL}${endpoint}`);
    console.log('Sending request...');
    const token = await getValidAccessToken();
    const finalHeaders = {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    };
    console.log('Final headers being sent:', finalHeaders);
    response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: finalHeaders,
      signal: controller.signal,
    });
  } catch (err: any) {
    console.log("============= FETCH ERROR =============");
    console.log("Endpoint:", endpoint);
    console.log("URL Called:", `${BASE_URL}${endpoint}`);
    console.log("Error Name:", err?.name);
    console.log("Error Message:", err?.message);
    console.log("Error Cause:", err?.cause);
    console.log("============= END FETCH ERROR =============");
    if (err?.name === 'AbortError') {
      console.log(`[Network Timeout/Abort] ${endpoint}`);
      if (options.silentTimeout) {
        return null as unknown as T;
      }
      throw new ApiError(408, 'Network request timed out. Please check your connection or server status.', 'TIMEOUT');
    }
    console.warn(`[Network Error] ${endpoint}:`, err?.message || err);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401 && retry) {
    try {
      await performTokenRefresh();
      return request<T>(endpoint, options, false);
    } catch {
      throw new ApiError(401, 'Session expired. Please log in again.', 'SESSION_EXPIRED');
    }
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code: string | undefined;
    try {
      const body = await response.json();
      console.warn(`[API ERROR ${response.status}] ${endpoint}:`, JSON.stringify(body));
      if (typeof body.detail === 'string') {
        message = body.detail;
      } else if (Array.isArray(body.detail) && body.detail.length > 0) {
        message = body.detail
          .map((d: any) => `${d.loc ? d.loc.filter((l: any) => l !== 'body').join('.') + ': ' : ''}${d.msg}`)
          .join(', ');
      } else if (body.message) {
        message = body.message;
      }
      code = body.error || (typeof body.detail === 'string' ? body.detail : undefined);
    } catch {
      /* non-JSON error body, keep default message */
    }
    throw new ApiError(response.status, message, code);
  }

    console.log('Response status:', response.status);
  const respText = await response.text();
  console.log('Response body (text):', respText);
  if (response.status === 204) return undefined as T;
  // Try to parse JSON if possible, otherwise return raw text
  try {
    return JSON.parse(respText) as T;
  } catch {
    return respText as unknown as T;
  }
  return response.json() as Promise<T>;
}

// ─── AUTH ── /api/v1/auth ───────────────────────────────────────────
export type UserPublic = { id: string; email: string; full_name: string | null; is_active: boolean; created_at: string };
export type TokenResponse = { access_token: string; refresh_token: string; token_type: string; user: UserPublic };

export const authApi = {
  register: async (email: string, password: string, full_name?: string) => {
    const res = await request<TokenResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name }),
    });
    await persistAuth(res.access_token, res.refresh_token);
    return res;
  },

  login: async (email: string, password: string) => {
    const res = await request<TokenResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    await persistAuth(res.access_token, res.refresh_token);
    return res;
  },

  /** Exchange a Firebase ID token for backend JWTs.
   *  Sends token in Authorization header as Bearer token.
   */
  loginWithFirebase: async (firebaseIdToken: string) => {
    const res = await request<TokenResponse>('/api/v1/auth/firebase', {
      method: 'POST',
      body: JSON.stringify({ token: firebaseIdToken }),
    });
    await persistAuth(res.access_token, res.refresh_token);
    return res;
  },

  logout: async () => {
    try {
      await request('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      await clearAuth();
    }
  },

  isLoggedIn: () => !!accessToken,
};

// ─── PRODUCT ── /api/v1/product ─────────────────────────────────────
// The RN app extracts on-device (native module). This just persists the result.
export type ExtractedProductInput = {
  title: string;
  brand?: string;
  price?: string;
  images: string[];
  sizes?: string[];
  source_type: 'url' | 'image_upload';
  source_url: string | null;
  platform: string | null;
};
export type ProductResponse = { product_id: string; status: string; product: Record<string, unknown>; fallback_required: boolean };

export type LookupKnownProductResponse = {
  found: boolean;
  product_id?: string;
  product?: {
    title?: string;
    brand?: string;
    price?: string;
    garment_type?: string;
    images?: Array<{ url: string; angle?: string } | string>;
    image_urls?: string[];
    image_url?: string;
    url?: string;
    platform?: string;
    status?: string;
  };
};

export const productApi = {
  /** Lightweight pre-check: query backend for existing known complete Garment before launching on-device extraction. */
  lookupKnown: (url: string, options?: RequestOptions) =>
    request<LookupKnownProductResponse>('/api/v1/product/lookup-known', {
      method: 'POST',
      body: JSON.stringify({ url }),
      silentTimeout: true,
      ...options,
    }),

  /** Persist a product that was extracted on-device via the native module. */
  fromExtraction: async (data: ExtractedProductInput): Promise<ProductResponse> => {
    try {
      return await request<ProductResponse>('/api/v1/product/from-extension', {
        method: 'POST',
        body: JSON.stringify({ ...data, sizes: data.sizes ?? [] }),
      });
    } catch (err: any) {
      console.warn('Product registration endpoint unavailable or timed out, using fallback:', err?.message);
      return {
        product_id: 'product-' + Date.now(),
        status: 'fetched',
        product: { title: data.title, brand: data.brand, price: data.price },
        fallback_required: true,
      };
    }
  },

  /** Fallback path: let the backend attempt extraction server-side (e.g. web platform, no native module). */
  fromUrl: (url: string) =>
    request<ProductResponse>('/api/v1/product/from-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  /** Upload an uncropped, original garment image file to Supabase Storage and register the garment */
  uploadGarment: async (imageUri: string, metadata?: { title?: string; brand?: string; price?: string }): Promise<ProductResponse> => {
    const formData = new FormData();
    const filename = imageUri.split('/').pop() || 'garment.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1].toLowerCase()}` : 'image/jpeg';
    formData.append('image', { uri: imageUri, name: filename, type } as any);
    if (metadata?.title) formData.append('title', metadata.title);
    if (metadata?.brand) formData.append('brand', metadata.brand);
    if (metadata?.price) formData.append('price', metadata.price);

    return request<ProductResponse>('/api/v1/product/upload-garment', {
      method: 'POST',
      body: formData,
      timeoutMs: 60_000,
    });
  },

  /** Extract normalized product data from a screenshot using the Product Intelligence Engine */
  extractScreenshot: (imageUri: string) => {
    const formData = new FormData();
    formData.append('image', { uri: imageUri, type: 'image/jpeg', name: 'screenshot.jpg' } as any);
    return request<Record<string, any>>('/api/v1/product/extract-screenshot', {
      method: 'POST',
      body: formData,
      timeoutMs: 90_000,
    });
  },

  /** Fetch real outfit-specific complementary product recommendations for Complete the Look */
  getCompleteTheLook: (params?: {
    job_id?: string;
    garment_id?: string;
    title?: string;
    brand?: string;
    category?: string;
    gender?: string;
    color?: string;
    image_url?: string;
  }) => {
    const queryParts: string[] = [];
    if (params?.job_id) queryParts.push(`job_id=${encodeURIComponent(params.job_id)}`);
    if (params?.garment_id) queryParts.push(`garment_id=${encodeURIComponent(params.garment_id)}`);
    if (params?.title) queryParts.push(`title=${encodeURIComponent(params.title)}`);
    if (params?.brand) queryParts.push(`brand=${encodeURIComponent(params.brand)}`);
    if (params?.category) queryParts.push(`category=${encodeURIComponent(params.category)}`);
    if (params?.gender) queryParts.push(`gender=${encodeURIComponent(params.gender)}`);
    if (params?.color) queryParts.push(`color=${encodeURIComponent(params.color)}`);
    if (params?.image_url) queryParts.push(`image_url=${encodeURIComponent(params.image_url)}`);
    const qs = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    return request<CompleteTheLookResponse>(`/api/v1/product/complete-the-look${qs}`);
  },
};

export type RecommendedProduct = {
  id: string;
  slot: string;
  title: string;
  brand: string;
  price: string;
  numeric_price?: number | null;
  image: string;
  category: string;
  retailer: string;
  product_url: string;
};

export type CompleteTheLookResponse = {
  theme: string;
  source_garment?: Record<string, any>;
  recommendations: RecommendedProduct[];
};


// ─── BODY SCAN ── /api/v1/scan ──────────────────────────────────────
export type ScanUploadResponse = { scan_id: string; status: string };
export type ScanStatusResponse = {
  id: string;
  status: string;
  body_profile: Record<string, unknown> | null;
  measurements: Record<string, unknown>;
  cluster_key: string | null;
  created_at: string;
};

export const scanApi = {
  upload: async (photos: { front: string; back?: string; left?: string; right?: string }, consentGiven: boolean) => {
    const formData = new FormData();
    const attach = (field: string, uri?: string) => {
      if (!uri) return;
      formData.append(field, { uri, type: 'image/jpeg', name: `${field}.jpg` } as any);
    };
    attach('front', photos.front);
    attach('back', photos.back);
    attach('left', photos.left);
    attach('right', photos.right);

    return request<ScanUploadResponse>('/api/v1/scan/upload', {
      method: 'POST',
      body: formData,
      headers: { 'X-Consent-Given': consentGiven ? 'true' : 'false' },
    });
  },

  getStatus: (scanId: string) => request<ScanStatusResponse>(`/api/v1/scan/${scanId}`),

  delete: (scanId: string) => request(`/api/v1/scan/${scanId}`, { method: 'DELETE' }),
};

// ─── TRY-ON ── /api/v1/tryon ─────────────────────────────────────────
export type TryOnStartResponse = { job_id: string; estimated_seconds: number; cache_tier: string | null };
export type TryOnStatusResponse = {
  id: string;
  status: string;
  progress_pct: number;
  current_step: string;
  error_message?: string | null;
};
export type TryOnResultResponse = {
  result_image_urls: string[];
  fit_analysis: Record<string, unknown>;
  size_recommendation: Record<string, unknown>;
  processing_time_seconds: number | null;
};
export type TryOnHistoryItem = {
  id: string;
  garment_id: string;
  status: string;
  result_image_urls: string[];
  thumbnail_url?: string | null;
  created_at: string;
  is_saved?: boolean;
  saved_photo_id?: string | null;
  saved_photo_name?: string | null;
  title?: string | null;
  brand?: string | null;
  platform?: string | null;
};

export type TryOnDetailResponse = {
  id: string;
  user_id: string;
  garment_id: string;
  status: string;
  result_image_urls: string[];
  is_saved: boolean;
  saved_photo_id?: string | null;
  saved_photo_name?: string | null;
  created_at: string;
  completed_at?: string | null;
  title: string;
  brand: string;
  platform?: string | null;
  product_url?: string | null;
  affiliate_url?: string | null;
  garment_image_url?: string | null;
  garment_images?: Array<{ url?: string; angle?: string } | string>;
  garment_type?: string | null;
  price?: string | null;
  size_recommendation?: Record<string, unknown> | null;
  fit_analysis?: Record<string, unknown> | null;
  processing_time_seconds?: number | null;
};

export const tryOnApi = {
  start: (scanId: string | null | undefined, garmentId: string, savedPhotoId?: string | null) => {
    const isUuid = (val?: string | null): boolean =>
      typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());

    const body: Record<string, any> = {
      garment_id: garmentId,
    };
    if (isUuid(scanId)) {
      body.scan_id = scanId!.trim();
    }
    if (isUuid(savedPhotoId)) {
      body.saved_photo_id = savedPhotoId!.trim();
    }

    return request<TryOnStartResponse>('/api/v1/tryon/start', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 90_000,
    });
  },

  getStatus: (jobId: string) => request<TryOnStatusResponse>(`/api/v1/tryon/${jobId}`),

  getResult: (jobId: string) => request<TryOnResultResponse>(`/api/v1/tryon/${jobId}/result`),

  getDetail: (jobId: string) => request<TryOnDetailResponse>(`/api/v1/tryon/${jobId}/detail`),

  getHistory: (params?: { limit?: number; status?: string; saved_only?: boolean; saved_photo_id?: string; page?: number }) => {
    const queryParts: string[] = [];
    if (params?.limit) queryParts.push(`limit=${params.limit}`);
    if (params?.status) queryParts.push(`status=${encodeURIComponent(params.status)}`);
    if (params?.saved_only) queryParts.push(`saved_only=true`);
    if (params?.saved_photo_id) queryParts.push(`saved_photo_id=${encodeURIComponent(params.saved_photo_id)}`);
    if (params?.page) queryParts.push(`page=${params.page}`);
    const qs = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    return request<TryOnHistoryItem[]>(`/api/v1/tryon/history${qs}`);
  },

  toggleSave: (jobId: string) =>
    request<{ success: boolean; job_id: string; is_saved: boolean }>(`/api/v1/tryon/${jobId}/toggle-save`, {
      method: 'POST',
    }),

  delete: (jobId: string) =>
    request<{ success: boolean; deleted: number }>(`/api/v1/tryon/${jobId}`, {
      method: 'DELETE',
    }),

  clearAllHistory: () =>
    request<{ success: boolean; deleted: number }>('/api/v1/tryon/history', {
      method: 'DELETE',
    }),

  /** Polls status until the job leaves the "processing"/"queued" state. */
  waitForResult: async (jobId: string, onProgress?: (s: TryOnStatusResponse) => void, intervalMs = 1500, timeoutMs = 120_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await tryOnApi.getStatus(jobId);
      onProgress?.(status);
      if (status.status === 'completed' || status.status === 'done') {
        return tryOnApi.getResult(jobId);
      }
      if (status.status === 'failed' || status.status === 'error') {
        throw new ApiError(
          500,
          status.error_message || 'Try-on generation temporarily failed. Please ensure a clear full-body photo is uploaded.',
          'TRYON_FAILED'
        );
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new ApiError(408, 'Try-on generation timed out.', 'TRYON_TIMEOUT');
  },
};

// ─── LINK PRODUCT COMPARISON ── /api/v1/link-comparison ─────────────
export type LinkComparisonOffer = {
  id: string;
  retailer: string;
  platform: string;
  title: string;
  url: string;
  image_url?: string | null;
  price: number | null;
  formatted_price: string;
  original_price?: number | null;
  formatted_original_price?: string | null;
  discount_pct?: number | null;
  discount_text?: string | null;
  is_exact: boolean;
  match_confidence: number;
  is_best_deal: boolean;
  price_source?: string | null;
  delivery_note?: string | null;
};

export type LinkComparisonResponse = {
  source_product: Record<string, any>;
  best_deal_id?: string | null;
  best_price?: number | null;
  best_retailer?: string | null;
  candidates: LinkComparisonOffer[];
  total_exact_stores: number;
};

export const linkComparisonApi = {
  compare: (data: {
    job_id?: string | null;
    source_url?: string | null;
    brand?: string | null;
    title?: string | null;
    price?: number | null;
    original_price?: number | null;
    image_url?: string | null;
    retailer?: string | null;
  }) =>
    request<LinkComparisonResponse>('/api/v1/link-comparison/compare', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ─── USER ── /api/v1/user ────────────────────────────────────────────
export const userApi = {
  getProfile: () => request<Record<string, unknown>>('/api/v1/user/profile'),
  updateProfile: (data: Record<string, unknown>) =>
    request<UserPublic>('/api/v1/user/profile', { method: 'PUT', body: JSON.stringify(data) }),
  deleteAccount: () => request('/api/v1/user/account', { method: 'DELETE' }),
};

// ─── HEALTH ───────────────────────────────────────────────────────────
export const healthApi = {
  check: () => request<{ status: string }>('/health'),
};

// ─── PRODUCT INTELLIGENCE ── /api/v1/product-intelligence ────────────
export type PICandidate = {
  id: string;
  title: string;
  retailer: string;
  price: number | null;
  currency?: string;
  original_price?: number | null;
  discount_pct?: number | null;
  url: string;
  image_url: string;
  confidence?: number;
  rating?: number | string;
  match_type?: 'exact' | 'similar';
  is_exact?: boolean;
  evidence?: Record<string, any>;
};

export type PIScanResponse = {
  scan_id: string;
  status: string;
};

export type PIScanStatusResponse = {
  scan_id: string;
  status: 'processing' | 'done' | 'error';
  is_saved?: boolean;
  last_price_checked_at?: string | null;
  last_price_check_attempted_at?: string | null;
  is_price_stale?: boolean;
  has_unverified_prices?: boolean;
  match_status?: string | null;
  match_label?: string | null;
  top_confidence?: number | null;
  best_price?: number | null;
  best_retailer?: string | null;
  candidates?: PICandidate[];
  profile?: Record<string, any>;
  error?: string | null;
  created_at?: string | null;
};

export type PISelectCandidateResponse = {
  success: boolean;
  garment_id: string;
  garment: Record<string, unknown>;
};

export type PIAffiliateClickResponse = {
  success: boolean;
  click_id: string;
  retailer: string;
  affiliate_url?: string;
  error?: string;
};

export type PIHistoryItem = {
  scan_id: string;
  user_id?: string;
  status: string;
  is_saved?: boolean;
  last_price_checked_at?: string | null;
  last_price_check_attempted_at?: string | null;
  is_price_stale?: boolean;
  has_unverified_prices?: boolean;
  thumbnail_b64?: string | null;
  match_status?: string | null;
  match_label?: string | null;
  top_confidence?: number | null;
  best_price?: number | null;
  best_retailer?: string | null;
  profile?: Record<string, any>;
  candidates?: PICandidate[];
  created_at?: string | null;
};

export type PIRefreshPricesResponse = {
  success: boolean;
  scan_id: string;
  last_price_checked_at?: string | null;
  last_price_check_attempted_at?: string | null;
  is_price_stale: boolean;
  has_unverified_prices: boolean;
  successful_refreshes: number;
  failed_refreshes: number;
  best_price?: number | null;
  best_retailer?: string | null;
  candidates: PICandidate[];
};

export const productIntelligenceApi = {
  scan: (payload: {
    image_base64: string;
    mime?: string;
    source?: string;
    tag_image_base64?: string;
    tag_mime?: string;
    user_brand?: string;
    user_title?: string;
  }) =>
    request<PIScanResponse>('/api/v1/product-intelligence/scan', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getStatus: (scanId: string) =>
    request<PIScanStatusResponse>(`/api/v1/product-intelligence/scan/${scanId}`),

  selectCandidate: (scanId: string, candidateId: string) =>
    request<PISelectCandidateResponse>(`/api/v1/product-intelligence/scan/${scanId}/select`, {
      method: 'POST',
      body: JSON.stringify({ candidate_id: candidateId }),
    }),

  affiliateClick: (
    payload:
      | { scan_id?: string; candidate_id?: string; url?: string; retailer?: string }
      | string,
    candidateId?: string
  ) => {
    const body =
      typeof payload === 'string'
        ? { scan_id: payload, candidate_id: candidateId }
        : payload;

    return request<PIAffiliateClickResponse>('/api/v1/product-intelligence/affiliate/click', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getHistory: (params?: { limit?: number; status?: string; saved_only?: boolean }) => {
    const queryParts: string[] = [];
    if (params?.limit) queryParts.push(`limit=${params.limit}`);
    if (params?.status) queryParts.push(`status=${encodeURIComponent(params.status)}`);
    if (params?.saved_only) queryParts.push(`saved_only=true`);
    const qs = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    return request<PIHistoryItem[]>(`/api/v1/product-intelligence/history${qs}`);
  },

  refreshPrices: (scanId: string) =>
    request<PIRefreshPricesResponse>(`/api/v1/product-intelligence/scan/${scanId}/refresh-prices`, {
      method: 'POST',
    }),

  toggleSave: (scanId: string) =>
    request<{ success: boolean; scan_id: string; is_saved: boolean }>(`/api/v1/product-intelligence/scan/${scanId}/toggle-save`, {
      method: 'POST',
    }),

  clearAllHistory: () =>
    request<{ success: boolean; deleted: number }>('/api/v1/product-intelligence/history', {
      method: 'DELETE',
    }),

  deleteHistory: (scanId: string) =>
    request<{ deleted: number }>(`/api/v1/product-intelligence/history/${scanId}`, {
      method: 'DELETE',
    }),
};

// ─── SAVED PHOTOS ── /api/v1/photos ─────────────────────────────────
export type SavedPhoto = {
  id: string;
  user_id: string;
  display_name: string;
  storage_path: string;
  original_filename?: string | null;
  mime_type?: string;
  signed_url?: string | null;
  created_at: string;
  updated_at: string;
};

export const savedPhotosApi = {
  upload: async (imageUri: string, displayName?: string): Promise<SavedPhoto> => {
    const formData = new FormData();
    const filename = imageUri.split('/').pop() || 'photo.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1].toLowerCase()}` : 'image/jpeg';
    formData.append('file', { uri: imageUri, name: filename, type } as any);
    if (displayName && displayName.trim()) {
      formData.append('display_name', displayName.trim());
    }
    return request<SavedPhoto>('/api/v1/photos/upload', {
      method: 'POST',
      body: formData,
      timeoutMs: 60_000,
    });
  },

  list: (): Promise<SavedPhoto[]> =>
    request<SavedPhoto[]>('/api/v1/photos/'),

  getSignedUrl: (photoId: string): Promise<{ url: string; photo_id: string }> =>
    request<{ url: string; photo_id: string }>(`/api/v1/photos/${photoId}/url`),

  rename: (photoId: string, displayName: string): Promise<SavedPhoto> =>
    request<SavedPhoto>(`/api/v1/photos/${photoId}`, {
      method: 'PATCH',
      body: JSON.stringify({ display_name: displayName }),
    }),

  delete: (photoId: string): Promise<{ status: string; id: string }> =>
    request<{ status: string; id: string }>(`/api/v1/photos/${photoId}`, {
      method: 'DELETE',
    }),
};

