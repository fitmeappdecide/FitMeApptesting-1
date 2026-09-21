/**
 * Thin wrapper around the native `fitme-extraction` Expo module.
 *
 * This is the single entry point the UI should use to extract product data
 * from a URL. The actual extraction logic lives natively:
 *   iOS:     native/ios-extraction-core/WebViewExtractor.swift
 *   Android: native/android-extraction-core (ExtractionFacade / WebExtractionEngine)
 *
 * Do not reimplement extraction logic in JS — this file only bridges to it.
 */
import { extractProduct as nativeExtractProduct, addExtractionProgressListener, Product } from 'fitme-extraction';
import type { ExtractedProductInput } from './api';
import { productApi } from './api';
import { getLocalProductCache, setLocalProductCache, isBlockedOrInvalidTitle } from './productCache';
import { normalizeProductUrl } from '../utils/url';

export { isBlockedOrInvalidTitle, normalizeProductUrl };

export interface NormalizedProduct extends Product {
  sourceType: 'url' | 'image_upload';
  sourceUrl: string | null;
  platform: string | null;
}

export class ExtractionError extends Error {}

export function sanitizeImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  let u = url.trim();

  // AJIO & Shein India CDN High-Res Transformer: upgrade thumbnail dimensions (-78Wx98H-, -473Wx593H-, -286Wx362H-, -111Wx142H-) to full HD 1000Wx1500H
  if (u.includes('ajio') || u.includes('shein') || u.includes('jiocdn')) {
    u = u.replace(/-[0-9]+Wx[0-9]+H-/gi, '-1000Wx1500H-');
    u = u.replace(/-[0-9]+Wx[0-9]+H(?=\.)/gi, '-1000Wx1500H');
  }

  // Nykaa / Nykaa Fashion / ImageKit High-Res Transformer: remove path-embedded transforms like /tr:h-400,w-300,cm-pad_resize/
  if (u.includes('nykaa') || u.includes('hsapps.com') || u.includes('imagekit')) {
    u = u.replace(/\/tr:[^\/]+\//g, '/');
    u = u.replace(/([?&]tr=)([^&]+)/gi, '$1w-1000,q-90');
  }

  // Myntra CDN High-Res Transformer
  if (u.includes('myntassets.com') || u.includes('myntra')) {
    u = u.replace(/\/h_[0-9]+,w_[0-9]+\//g, '/h_1440,w_1080/');
  }

  return u;
}

export function sanitizeImageUrls(urls: string[] | null | undefined): string[] {
  if (!urls || urls.length === 0) return [];
  return urls.map(sanitizeImageUrl).filter(Boolean);
}

export async function extractProductFromUrl(url: string): Promise<NormalizedProduct> {
  const trimmed = normalizeProductUrl(url);
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ExtractionError('Please enter a valid product URL (starting with http:// or https://).');
  }

  const t0 = Date.now();
  console.log(`[T0] URL submitted: ${trimmed}`);

  // TIER 0: Local AsyncStorage Cache Check (Instant <10ms)
  console.log(`[T1] Tier-0 cache lookup started (+${Date.now() - t0}ms)`);
  try {
    const localHit = await getLocalProductCache(trimmed);
    if (localHit) {
      console.log(`[Tier 0 Local Cache HIT] Reusing cached product instantly (+${Date.now() - t0}ms):`, localHit.title);
      console.log(`[T8] Product preview returned (+${Date.now() - t0}ms)`);
      return localHit;
    }
  } catch (err) {
    console.warn('[Tier 0 Local Cache] Check error:', err);
  }
  console.log(`[T2] Tier-0 cache MISS (+${Date.now() - t0}ms)`);

  // P0 PARALLEL RACE DISPATCH: Start both native extraction and backend lookup concurrently
  console.log(`[T3] Native extraction started (+${Date.now() - t0}ms)`);
  const nativePromise: Promise<NormalizedProduct> = (async () => {
    const rawProduct = await nativeExtractProduct(trimmed);
    const isBlocked = isBlockedOrInvalidTitle(rawProduct.title);
    const sanitizedImageUrls = sanitizeImageUrls(rawProduct.imageUrls ?? (rawProduct.imageUrl ? [rawProduct.imageUrl] : []));
    const modelImages = sanitizedImageUrls.filter(img => 
      !/SWATCH|brand-logo|banner|sticky|icon/i.test(img)
    );
    const finalImageUrl = modelImages[0] ?? sanitizeImageUrl(rawProduct.imageUrl);

    if (isBlocked || !rawProduct.title || !finalImageUrl) {
      console.warn(`[T6] Native extraction invalid/blocked (+${Date.now() - t0}ms): "${rawProduct.title}"`);
      throw new Error(`On-device extraction returned blocked or invalid product: ${rawProduct.title}`);
    }

    const normalized: NormalizedProduct = {
      ...rawProduct,
      imageUrl: finalImageUrl,
      imageUrls: sanitizedImageUrls.length > 0 ? sanitizedImageUrls : [finalImageUrl],
      sourceType: 'url',
      sourceUrl: trimmed,
      platform: detectPlatformFromUrl(trimmed),
    };

    console.log(`[T6] Native extraction completed (+${Date.now() - t0}ms): ${normalized.title}`);

    // 1. Save to Tier 0 local cache immediately for subsequent instant visits
    setLocalProductCache(trimmed, normalized).catch(() => {});

    // 2. Background backend synchronization (non-blocking)
    productApi.fromExtraction(toExtractedProductInput(normalized)).catch((err) => {
      console.warn('[Background Backend Sync] Sync skipped or failed:', err?.message);
    });

    return normalized;
  })();

  console.log(`[T4] Tier-1 lookup started (+${Date.now() - t0}ms)`);
  const tier1Promise: Promise<NormalizedProduct | null> = (async () => {
    try {
      const res = await productApi.lookupKnown(trimmed, { timeoutMs: 1200 });
      console.log(`[T5] Tier-1 response (+${Date.now() - t0}ms): found=${res?.found}`);
      if (res && res.found && res.product && res.product_id) {
        const prod = res.product;
        const rawUrls: string[] = (prod.image_urls ?? (prod.images ?? []).map((img: any) =>
          typeof img === 'string' ? img : img?.url ?? ''
        )).filter(Boolean);

        const sanitized = sanitizeImageUrls(rawUrls);
        const modelImages = sanitized.filter(img => 
          !/SWATCH|brand-logo|banner|sticky|icon/i.test(img)
        );
        const finalImageUrl = modelImages[0] ?? sanitized[0];

        // Strict validation: Title, verified brand, verified price, and at least 1 image required
        if (prod.title && !isBlockedOrInvalidTitle(prod.title) && prod.brand && prod.brand.trim() && prod.price && finalImageUrl) {
          const normalized: NormalizedProduct = {
            title: prod.title.trim(),
            brand: prod.brand.trim(),
            price: String(prod.price).trim(),
            imageUrl: finalImageUrl,
            imageUrls: sanitized.length > 0 ? sanitized : [finalImageUrl],
            sourceType: 'url',
            sourceUrl: trimmed,
            platform: prod.platform || detectPlatformFromUrl(trimmed),
          };
          // Populate Tier 0 cache for subsequent instant hits
          setLocalProductCache(trimmed, normalized).catch(() => {});
          return normalized;
        }
      }
    } catch (err: any) {
      console.log(`[T5] Tier-1 response (+${Date.now() - t0}ms): Error/Timeout - ${err?.message ?? 'Bypass'}`);
    }
    return null;
  })();

  // SINGLE CONTROLLED DECISION PATH:
  // If Tier 1 finishes first with a valid complete product -> Tier 1 wins immediately.
  // If Tier 1 misses or times out -> await native extraction.
  // If Native extraction finishes first with valid data -> Native wins immediately.
  return new Promise<NormalizedProduct>((resolve, reject) => {
    let isSettled = false;

    // Listener for Tier 1
    tier1Promise.then((tier1Product) => {
      if (isSettled) return;
      if (tier1Product) {
        isSettled = true;
        console.log(`[T7] Winner selected: Tier-1 Backend Pre-Check (+${Date.now() - t0}ms)`);
        console.log(`[T8] Product preview returned (+${Date.now() - t0}ms)`);
        resolve(tier1Product);
      }
    }).catch(() => {});

    // Listener for Native Extraction
    nativePromise.then((nativeProduct) => {
      if (isSettled) return;
      if (isBlockedOrInvalidTitle(nativeProduct.title)) {
        console.warn(`[T7] Native extraction rejected due to anti-bot block title: "${nativeProduct.title}"`);
        return; // Do not settle — allow fallback or rejection below
      }
      isSettled = true;
      console.log(`[T7] Winner selected: Native On-Device Extraction (+${Date.now() - t0}ms)`);
      console.log(`[T8] Product preview returned (+${Date.now() - t0}ms)`);
      resolve(nativeProduct);
    }).catch((err) => {
      if (isSettled) return;
      tier1Promise.then((tier1Product) => {
        if (isSettled) return;
        isSettled = true;
        if (tier1Product) {
          console.log(`[T7] Winner selected: Tier-1 Fallback (+${Date.now() - t0}ms)`);
          console.log(`[T8] Product preview returned (+${Date.now() - t0}ms)`);
          resolve(tier1Product);
        } else {
          reject(new ExtractionError(err?.message ?? 'Could not extract product details from that link.'));
        }
      }).catch(() => {
        if (isSettled) return;
        isSettled = true;
        reject(new ExtractionError(err?.message ?? 'Could not extract product details from that link.'));
      });
    });
  });
}

export async function extractProductFromImage(imageUri: string): Promise<NormalizedProduct> {
  // Call the Product Intelligence Engine (Gemini 2.5 Flash) on the backend.
  // The backend crops the garment, uploads to Supabase, and returns normalized metadata.
  try {
    const result = await productApi.extractScreenshot(imageUri);

    // Backend returns images as list of {url, angle} dicts or plain strings
    const rawImages: string[] = (result.images ?? []).map((img: any) =>
      typeof img === 'string' ? img : img?.url ?? ''
    ).filter(Boolean);

    const imageUrl = rawImages[0] ?? imageUri;

    return {
      title: result.title ?? '',
      brand: result.brand ?? '',
      price: result.price ?? '',
      imageUrl,
      imageUrls: rawImages.length > 0 ? rawImages : [imageUri],
      sourceType: 'image_upload',
      sourceUrl: null,
      platform: null,
    };
  } catch (e: any) {
    throw new ExtractionError(e?.message ?? 'Failed to analyse the screenshot. Please try again.');
  }
}

export { addExtractionProgressListener };

import { normalizeRetailer } from '../constants/retailers';

/** Best-effort platform name detection, mirrors the native detectPlatform() for display purposes. */
export function detectPlatformFromUrl(url: string): string {
  const normalized = normalizeProductUrl(url);
  return normalizeRetailer(normalized || url).name;
}

export function toExtractedProductInput(product: NormalizedProduct): ExtractedProductInput {
  return {
    title: product.title,
    brand: product.brand,
    price: product.price,
    images: product.imageUrls ?? (product.imageUrl ? [product.imageUrl] : []),
    source_type: product.sourceType,
    source_url: product.sourceUrl,
    platform: product.platform,
  };
}
