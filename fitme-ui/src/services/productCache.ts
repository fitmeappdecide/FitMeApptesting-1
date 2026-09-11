import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NormalizedProduct } from './extraction';

export function isBlockedOrInvalidTitle(title: string | null | undefined): boolean {
  if (!title || !title.trim()) return true;
  const lower = title.trim().toLowerCase();
  const blockedKeywords = [
    'access denied',
    'just a moment',
    'attention required',
    'cloudflare',
    '403 forbidden',
    'robot or human',
    'security check',
    'pardon our interruption',
    'service unavailable',
    'blocked'
  ];
  return blockedKeywords.some(keyword => lower.includes(keyword));
}

const CACHE_PREFIX = 'fitme_prod_v1:';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days TTL

export interface CachedProductEntry {
  product: NormalizedProduct;
  cachedAt: number;
  canonicalKey: string;
}

/**
 * Deterministically resolves a canonical product cache key from any retailer URL.
 * Matches the canonical identity rules:
 * - Myntra: myntra:<style_id>
 * - Amazon: amazon:<asin>
 * - AJIO: ajio:<product_code>
 * - Flipkart: flipkart:<pid>
 * - General: <platform>:<clean_normalized_url>
 */
export function getCanonicalProductKey(url: string): string {
  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();

  // 1. Myntra: style ID
  if (lower.includes('myntra.com')) {
    const match = trimmed.match(/\/(\d{6,10})(?:\/buy|\.html|\/|$|\?)/i) || trimmed.match(/[\?&]pdp_id=(\d{6,10})/i);
    if (match && match[1]) {
      return `${CACHE_PREFIX}myntra:${match[1]}`;
    }
  }

  // 2. Amazon: ASIN
  if (lower.includes('amazon.') || lower.includes('amzn.')) {
    const match = trimmed.match(/\/(?:dp|gp\/product|product|d)\/([A-Z0-9]{10})(?:[\/?]|$)/i);
    if (match && match[1]) {
      return `${CACHE_PREFIX}amazon:${match[1].toUpperCase()}`;
    }
  }

  // 3. AJIO: Product Code (e.g. 469034928_black or 469034928)
  if (lower.includes('ajio.com')) {
    const match = trimmed.match(/\/p\/([a-zA-Z0-9_\-]+)(?:[\/?]|$)/i) || trimmed.match(/\/(\d{8,12})(?:[\/?]|$)/i);
    if (match && match[1]) {
      return `${CACHE_PREFIX}ajio:${match[1].toLowerCase()}`;
    }
  }

  // 4. Flipkart: Product ID (pid)
  if (lower.includes('flipkart.com')) {
    const match = trimmed.match(/[\?&]pid=([A-Z0-9]{16})/i) || trimmed.match(/\/p\/([a-zA-Z0-9]+)(?:[\/?]|$)/i);
    if (match && match[1]) {
      return `${CACHE_PREFIX}flipkart:${match[1]}`;
    }
  }

  // 5. General Fallback: Clean URL without tracking parameters
  try {
    const parsed = new URL(trimmed);
    const clean = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
    const platform = lower.includes('nykaa') ? 'nykaa' : lower.includes('zara') ? 'zara' : lower.includes('hm.com') ? 'hm' : 'general';
    return `${CACHE_PREFIX}${platform}:${clean.toLowerCase()}`;
  } catch {
    return `${CACHE_PREFIX}raw:${trimmed.toLowerCase()}`;
  }
}

/**
 * Retrieve verified product from Tier 0 Local AsyncStorage.
 */
export async function getLocalProductCache(url: string): Promise<NormalizedProduct | null> {
  try {
    const key = getCanonicalProductKey(url);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;

    const entry: CachedProductEntry = JSON.parse(raw);
    if (!entry || !entry.product) return null;

    // Check TTL
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      AsyncStorage.removeItem(key).catch(() => {});
      return null;
    }

    const p = entry.product;
    const isBlocked = isBlockedOrInvalidTitle(p.title);
    const hasValidImage = p.imageUrl && (p.imageUrl.startsWith('http://') || p.imageUrl.startsWith('https://'));

    // Strict completeness check: must have title, genuine non-blocked content, and valid images
    if (
      p.title &&
      p.title.trim() &&
      !isBlocked &&
      hasValidImage &&
      p.imageUrls &&
      p.imageUrls.length > 0
    ) {
      return p;
    } else {
      // Purge invalid/incomplete entry so subsequent extractions re-fetch
      AsyncStorage.removeItem(key).catch(() => {});
    }
  } catch (err) {
    console.warn('[LocalProductCache] Read error:', err);
  }
  return null;
}

/**
 * Persist verified product into Tier 0 Local AsyncStorage.
 */
export async function setLocalProductCache(url: string, product: NormalizedProduct): Promise<void> {
  try {
    if (!product || !product.title || !product.imageUrl) return;
    if (isBlockedOrInvalidTitle(product.title)) return;
    const hasValidImage = product.imageUrl.startsWith('http://') || product.imageUrl.startsWith('https://');
    if (!hasValidImage) return;

    const key = getCanonicalProductKey(url);
    const entry: CachedProductEntry = {
      product,
      cachedAt: Date.now(),
      canonicalKey: key,
    };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
    console.log('[LocalProductCache] Saved entry for key:', key);
  } catch (err) {
    console.warn('[LocalProductCache] Write error:', err);
  }
}
