/**
 * Central Affiliate Link Service for FitMe Mobile App.
 *
 * Wraps product link taps with best-effort backend affiliate conversion,
 * lightweight in-flight double-tap locking, and guaranteed canonical URL fallback.
 */
import { Linking } from 'react-native';
import { productIntelligenceApi } from './api';

// In-flight click lock set to prevent rapid double-tap requests
const inFlightUrls = new Set<string>();

export interface OpenAffiliateOptions {
  scan_id?: string;
  candidate_id?: string;
  retailer?: string;
}

/**
 * Opens a product URL, attempting dynamic affiliate conversion first.
 * If conversion fails, times out, or returns no affiliate URL, it cleanly
 * falls back to opening the canonical product URL without disrupting user UX.
 */
export async function openAffiliateProductUrl(
  canonicalUrl: string | null | undefined,
  options?: OpenAffiliateOptions
): Promise<void> {
  if (!canonicalUrl || typeof canonicalUrl !== 'string') {
    return;
  }

  const trimmedUrl = canonicalUrl.trim();
  if (!/^https?:\/\//i.test(trimmedUrl)) {
    console.warn('[Affiliate] Ignored non-HTTP URL:', trimmedUrl);
    return;
  }

  // Prevent rapid double-taps for the same product link
  if (inFlightUrls.has(trimmedUrl)) {
    return;
  }
  inFlightUrls.add(trimmedUrl);

  let targetUrl = trimmedUrl;

  try {
    const payload = options?.scan_id && options?.candidate_id
      ? { scan_id: options.scan_id, candidate_id: options.candidate_id }
      : { url: trimmedUrl, retailer: options?.retailer };

    const affRes = await productIntelligenceApi.affiliateClick(payload);
    if (affRes?.success && affRes?.affiliate_url && /^https?:\/\//i.test(affRes.affiliate_url)) {
      targetUrl = affRes.affiliate_url;
    }
  } catch (err) {
    console.warn('[Affiliate] Dynamic conversion fallback to canonical URL:', err);
  } finally {
    // Release double-tap lock after 1.5s
    setTimeout(() => {
      inFlightUrls.delete(trimmedUrl);
    }, 1500);
  }

  try {
    await Linking.openURL(targetUrl);
  } catch (linkErr) {
    console.warn('[Affiliate] Failed to open target URL:', targetUrl, linkErr);
    if (targetUrl !== trimmedUrl) {
      // Emergency fallback to canonical URL if affiliate tracking URL failed
      await Linking.openURL(trimmedUrl).catch(() => {});
    }
  }
}
