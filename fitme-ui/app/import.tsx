import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../src/constants/theme';
import { useSession } from '../src/services/session';
import { extractProductFromUrl, detectPlatformFromUrl, ExtractionError, toExtractedProductInput, NormalizedProduct } from '../src/services/extraction';
import { productApi } from '../src/services/api';

function formatPrice(val?: string | number | null): string | null {
  if (!val) return null;
  const str = String(val).trim();
  if (!str || str.toLowerCase() === 'unknown') return null;
  if (str.startsWith('₹') || str.startsWith('$')) return str;
  const num = parseFloat(str.replace(/[^0-9.]/g, ''));
  if (!isNaN(num) && num > 0) {
    return `₹${num.toLocaleString('en-IN')}`;
  }
  return `₹${str}`;
}

import { formatRetailerName } from '../src/constants/retailers';
import { RetailerLogo } from '../src/components/RetailerLogo';

function extractSizeFromTitle(title?: string | null): string | null {
  if (!title) return null;
  // 1. Check for explicit "Size: X" or "Size X"
  const explicitMatch = title.match(/\bSize\s*[:\-]?\s*([XSML0-9]{1,4}|Small|Medium|Large|Extra Large|[0-9]{2})\b/i);
  if (explicitMatch && explicitMatch[1]) {
    const raw = explicitMatch[1].trim();
    if (/^small$/i.test(raw)) return 'Size S';
    if (/^medium$/i.test(raw)) return 'Size M';
    if (/^large$/i.test(raw)) return 'Size L';
    if (/^extra large$/i.test(raw)) return 'Size XL';
    return `Size ${raw.toUpperCase()}`;
  }

  // 2. Check for bracketed or trailing size e.g. "(S)", "-(M)", "/ (L)", "(XL)"
  const bracketMatch = title.match(/(?:[\s(\[\/\-–—])([XSML0-9]{1,4}|[0-9]{2})(?:[\s)\]\/\-–—]|$)/i);
  if (bracketMatch && bracketMatch[1]) {
    const s = bracketMatch[1].toUpperCase();
    if (['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '28', '30', '32', '34', '36', '38', '40'].includes(s)) {
      return `Size ${s}`;
    }
  }
  return null;
}

function cleanDisplayTitle(title?: string | null, brand?: string | null): string {
  if (!title) return 'Product Item';
  let cleaned = title.trim();

  // Remove leading "Buy ..."
  cleaned = cleaned.replace(/^Buy\s+/i, '');

  // Remove brand if present at beginning of title
  if (brand && brand.trim()) {
    const brandRegex = new RegExp(`^${brand.trim()}\\s*[-–—|:]?\\s*`, 'i');
    cleaned = cleaned.replace(brandRegex, '');
  }

  // Remove trailing platform markers like "- Myntra", "| Nykaa", etc.
  cleaned = cleaned.replace(/\s*[-–—|]\s*(?:Myntra|Nykaa|Amazon|Ajio|Flipkart|Meesho|Tata\s*CLiQ|H&M|Zara).*$/i, '');

  // Remove trailing "(Online)" or "Online"
  cleaned = cleaned.replace(/\s*\(\s*online\s*\)/gi, '');
  cleaned = cleaned.replace(/\s+online\s*$/i, '');

  // Remove bracketed size or trailing size tokens, e.g. "(S)", "(M)", "(XL)", "(Size S)", "(Size: S)"
  cleaned = cleaned.replace(/\s*\(\s*(?:Size\s*[:\-]?\s*)?[XSML0-9]{1,4}\s*\)/gi, '');
  cleaned = cleaned.replace(/\s*\[\s*(?:Size\s*[:\-]?\s*)?[XSML0-9]{1,4}\s*\]/gi, '');
  cleaned = cleaned.replace(/\s*[-–—/]\s*(?:Size\s*[:\-]?\s*)?[XSML0-9]{1,4}\s*$/gi, '');
  cleaned = cleaned.replace(/\s*\bSize\s*[:\-]?\s*[A-Z0-9]+\b/gi, '');

  // Remove any remaining trailing "(Online)", "Online", or hanging separators
  cleaned = cleaned.replace(/\s*\(\s*online\s*\)/gi, '');
  cleaned = cleaned.replace(/\s+online\s*$/i, '');
  cleaned = cleaned.replace(/\s*[-–—/:]\s*$/g, '');

  cleaned = cleaned.trim();
  return cleaned || title;
}

/**
 * Safely derive a crisp, mobile-optimized preview image URL for UI rendering.
 * CRITICAL INVARIANT: The canonical extracted URL in NormalizedProduct.imageUrl
 * remains 100% untouched for Try-On, Vertex AI, and backend storage.
 */
export function getPreviewImageUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();

  // Myntra: transform high-res /h_1440,q_75,w_1080/ into crisp mobile /h_720,q_75,w_540/
  if (trimmed.includes('assets.myntassets.com')) {
    return trimmed.replace(/\/h_\d+(?:,q_\d+)?,w_\d+\//, '/h_720,q_75,w_540/');
  }

  // Amazon: transform high-res _AC_UY1100_ / _UL1500_ into mobile _AC_UY600_
  if (trimmed.includes('media-amazon.com') || trimmed.includes('images-amazon.com')) {
    return trimmed.replace(/\._(?:AC_)?(?:UY|UL|SX|SY)\d+_\./, '._AC_UY600_.');
  }

  // Flipkart: transform high-res /image/1500/1500/ into mobile /image/600/600/
  if (trimmed.includes('flixcart.com')) {
    return trimmed.replace(/\/image\/\d+\/\d+\//, '/image/600/600/');
  }

  // AJIO / Others: preserve already-extracted mobile resolution as-is
  return trimmed;
}

export default function Import() {
  const router = useRouter();
  const sourceUrl = useSession((s) => s.sourceUrl);
  const productImageUri = useSession((s) => s.productImageUri);
  const extractedProduct = useSession((s) => s.extractedProduct);
  const setExtractedProduct = useSession((s) => s.setExtractedProduct);
  const setProductId = useSession((s) => s.setProductId);
  // Clear transient try-on state on every new try-on so processing.tsx
  // never re-uses a stale scanId, job, or result from a previous session.
  const setScanId = useSession((s) => s.setScanId);
  const setTryOnJobId = useSession((s) => s.setTryOnJobId);
  const setResultImageUrls = useSession((s) => s.setResultImageUrls);
  const setLocalPhotoUri = useSession((s) => s.setLocalPhotoUri);

  const [savingProduct, setSavingProduct] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(sourceUrl));

  // Compute canonical image URI and derived preview URI for on-screen display
  const canonicalImageUri = extractedProduct?.imageUrl || extractedProduct?.imageUrls?.[0] || (productImageUri ? productImageUri : undefined);
  // For user-uploaded photos, display the local file URI directly
  const previewImageUri = productImageUri ? productImageUri : getPreviewImageUrl(canonicalImageUri);

  useEffect(() => {
    if (!sourceUrl && !productImageUri) {
      router.replace({ pathname: '/(tabs)/home', params: { error: 'No product source provided.' } });
      return;
    }
    
    let cancelled = false;

    if (sourceUrl) {
      setExtractedProduct(null);
      setLoading(true);
      
      extractProductFromUrl(sourceUrl)
        .then((product) => {
          if (cancelled) return;
          setExtractedProduct(product);
        })
        .catch((e: ExtractionError) => {
          if (cancelled) return;
          router.replace({ pathname: '/(tabs)/home', params: { error: e.message } });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else if (productImageUri) {
      // Photo Upload: Immediately unblock UI and display the selected photo directly (ZERO API calls, ZERO Gemini cost)
      setLoading(false);
      const initialLocalProduct: NormalizedProduct = {
        title: 'Uploaded Garment',
        brand: '',
        price: '',
        imageUrl: productImageUri,
        imageUrls: [productImageUri],
        sourceType: 'image_upload',
        sourceUrl: null,
        platform: null,
      };
      setExtractedProduct(initialLocalProduct);
    }

    return () => {
      cancelled = true;
    };
  }, [sourceUrl, productImageUri]);

  const rawPlatform = extractedProduct?.platform || (sourceUrl ? detectPlatformFromUrl(sourceUrl) : null);
  const displayPlatform = formatRetailerName(rawPlatform);
  const rawBrand = extractedProduct?.brand?.trim();
  const displayBrand = rawBrand && rawBrand.toLowerCase() !== 'fitme' ? rawBrand : '';
  const displayTitle = cleanDisplayTitle(extractedProduct?.title || (productImageUri ? 'Uploaded Garment' : ''), extractedProduct?.brand);
  const extractedSize = extractSizeFromTitle(extractedProduct?.title);
  const metaLine = extractedSize ? `${extractedSize} · ${displayPlatform}` : displayPlatform;
  const formattedPrice = formatPrice(extractedProduct?.price);
  const targetUrl = sourceUrl || extractedProduct?.sourceUrl;

  const handleViewOriginal = () => {
    if (targetUrl) {
      Linking.openURL(targetUrl).catch((err) => {
        console.warn('Could not open product URL:', err);
      });
    }
  };

  const isSubmittingRef = useRef(false);

  const handleContinue = async () => {
    if (!extractedProduct && !productImageUri) return;

    // Single-flight guard: Lock immediately on the first tap synchronously to prevent duplicate taps or swallowed gestures on Android
    if (isSubmittingRef.current) {
      if (Platform.OS === 'android') {
        console.log('[Android Telemetry] Duplicate tap ignored via isSubmittingRef guard');
      }
      return;
    }
    isSubmittingRef.current = true;

    const tStart = performance.now();
    if (Platform.OS === 'android') {
      console.log('[Android Telemetry] Phase A: First tap registered in handler at', tStart.toFixed(2), 'ms');
    }

    setSavingProduct(true);
    setSaveError(null);

    // Reset transient try-on state
    setScanId(null);
    setTryOnJobId(null);
    setResultImageUrls([]);
    setLocalPhotoUri(null);

    // Create background registration promise so network request runs in parallel
    const promise = (async () => {
      if (productImageUri) {
        console.log('[PHOTO] Uploading original selected image bytes to Supabase Storage...');
        return productApi.uploadGarment(productImageUri, {
          title: extractedProduct?.title || 'Uploaded Garment',
          brand: extractedProduct?.brand || '',
          price: extractedProduct?.price || '',
        });
      } else if (extractedProduct) {
        return productApi.fromExtraction(toExtractedProductInput(extractedProduct));
      } else {
        throw new Error('No product to prepare.');
      }
    })();

    // Store promise in session store so upload-photo page can await it if user proceeds before upload completes
    useSession.getState().setGarmentRegistrationPromise(promise);

    // Dispatch router.push('/upload-photo') INSTANTLY (<50ms)!
    const tNavStart = performance.now();
    if (Platform.OS === 'android') {
      console.log('[Android Telemetry] Phase F: Dispatching router.push(/upload-photo), total elapsed:', (tNavStart - tStart).toFixed(2), 'ms');
    }
    router.push('/upload-photo');

    // Handle resolution asynchronously in background
    promise
      .then((res) => {
        setProductId(res.product_id);
        useSession.getState().setGarmentRegistrationPromise(null);
      })
      .catch((e: any) => {
        console.warn('Background garment registration error:', e);
        setSaveError(e.message || 'Unable to prepare this product. Please try again.');
        useSession.getState().setGarmentRegistrationPromise(null);
      })
      .finally(() => {
        isSubmittingRef.current = false;
        setSavingProduct(false);
      });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Product preview" back />

      {loading && (
        <View style={styles.centerState}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.stateText}>
            {sourceUrl ? 'Reading product page…' : 'Analyzing product image…'}
          </Text>
        </View>
      )}

      {!loading && (extractedProduct || productImageUri) && (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Product Image */}
          <View style={styles.imgCard}>
            <Image
              source={{ uri: previewImageUri || canonicalImageUri }}
              style={styles.img}
            />
          </View>

          {/* Premium Product Information Card */}
          <View style={styles.productSummaryCard}>
            {/* Brand (rendered only when verified brand is present) */}
            {displayBrand ? (
              <Text style={styles.brandText} numberOfLines={1}>
                {displayBrand}
              </Text>
            ) : null}

            {/* Product Title (Max 2 lines) */}
            <Text style={styles.productTitle} numberOfLines={2} ellipsizeMode="tail">
              {displayTitle}
            </Text>

            {/* Size · Platform & Price */}
            <View style={styles.metaPriceRow}>
              <Text style={styles.metaText} numberOfLines={1}>
                {metaLine}
              </Text>
              {formattedPrice ? (
                <Text style={styles.priceText}>{formattedPrice}</Text>
              ) : null}
            </View>

            {/* Divider */}
            <View style={styles.cardDivider} />

            {/* Retailer Row with View Original */}
            <View style={styles.retailerRow}>
              <View style={styles.retailerLeft}>
                <RetailerLogo retailer={rawPlatform} size={24} />
                <Text style={styles.retailerName} numberOfLines={1}>
                  {displayPlatform}
                </Text>
              </View>

              {targetUrl ? (
                <>
                  <View style={styles.verticalDivider} />
                  <TouchableOpacity
                    style={styles.viewOriginalBtn}
                    onPress={handleViewOriginal}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.viewOriginalText}>View Original</Text>
                    <Ionicons name="open-outline" size={14} color={Colors.foreground} />
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          </View>
          
          {saveError && (
            <Text style={styles.saveErrorText}>{saveError}</Text>
          )}

          {/* Primary CTA */}
          <TouchableOpacity 
            style={[styles.primaryBtn, savingProduct && { opacity: 0.7 }]} 
            onPress={handleContinue}
            disabled={savingProduct}
            activeOpacity={0.85}
          >
            {savingProduct ? (
              <ActivityIndicator color={Colors.primaryForeground} />
            ) : (
              <>
                <Ionicons name="sparkles" size={16} color={Colors.primaryForeground} />
                <Text style={styles.primaryBtnText}>Try On Now</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.ctaSubtitle}>See it on you in seconds</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxxl },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: Spacing.xl },
  stateText: { fontSize: 14, color: Colors.mutedForeground, textAlign: 'center' },
  retryBtn: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 20, borderRadius: Radii.full, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  retryBtnText: { color: Colors.foreground, fontSize: 13, fontWeight: '500' },
  imgCard: {
    borderRadius: Radii.xl, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.lg,
  },
  img: { width: '100%', aspectRatio: 4 / 5, resizeMode: 'cover', backgroundColor: Colors.muted },
  productSummaryCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  brandText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8B4513',
    marginBottom: 4,
  },
  productTitle: {
    fontFamily: 'serif',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    color: Colors.foreground,
    marginBottom: 12,
  },
  metaPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaText: {
    flex: 1,
    fontSize: 13,
    color: Colors.mutedForeground,
    marginRight: 8,
  },
  priceText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
  },
  cardDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 14,
  },
  retailerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  retailerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  retailerName: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.foreground,
  },
  verticalDivider: {
    width: 1,
    height: 18,
    backgroundColor: Colors.border,
    marginHorizontal: 12,
  },
  viewOriginalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  viewOriginalText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.foreground,
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radii.full,
    flexDirection: 'row',
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryBtnText: {
    color: Colors.primaryForeground,
    fontSize: 16,
    fontWeight: '600',
  },
  ctaSubtitle: {
    fontSize: 12,
    color: Colors.mutedForeground,
    textAlign: 'center',
    marginTop: 10,
  },
  saveErrorText: { color: Colors.destructive, fontSize: 13, textAlign: 'center', marginBottom: Spacing.md },
});
