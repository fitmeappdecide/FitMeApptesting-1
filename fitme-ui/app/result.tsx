import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView,
  Modal, Alert, ActivityIndicator, Platform, Linking, useWindowDimensions, Share,
} from 'react-native';
import { useRouter, useLocalSearchParams, Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { AppHeader } from '../src/components/AppHeader';
import { CachedImage } from '../src/components/CachedImage';
import { ZoomableImageViewer } from '../src/components/ZoomableImageViewer';
import { RetailerLogo } from '../src/components/RetailerLogo';
import { Colors, Spacing, Radii } from '../src/constants/theme';
import { formatRetailerName } from '../src/constants/retailers';
import { useSession } from '../src/services/session';
import {
  tryOnApi,
  TryOnDetailResponse,
  productIntelligenceApi,
  PICandidate,
  linkComparisonApi,
  LinkComparisonOffer,
  productApi,
  RecommendedProduct,
  getAuthenticatedUserId,
} from '../src/services/api';
import { useLooksStore } from '../src/services/looksStore';
import { DatabaseManager, LooksRepository } from '../src/repositories';
import { openAffiliateProductUrl } from '../src/services/affiliate';
import { shareImageWithText } from 'fitme-extraction';

const FALLBACK_IMG =
  'https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=900&q=80';

// Set to true to re-enable the "Complete the look" section & recommendations
const ENABLE_COMPLETE_THE_LOOK = false;

// ─── helpers ────────────────────────────────────────────────────────────────

/** Downloads a remote URL to a local cache file and returns the local path. */
async function cacheRemoteImage(remoteUrl: string): Promise<string> {
  const ext = remoteUrl.split('?')[0].split('.').pop() ?? 'jpg';
  const filename = `fitme_tryon_${Date.now()}.${ext}`;
  const localUri = FileSystem.cacheDirectory + filename;
  const { uri } = await FileSystem.downloadAsync(remoteUrl, localUri);
  return uri;
}

/** Returns true if the uri is already a local file path. */
function isLocal(uri: string) {
  return uri.startsWith('file://') || uri.startsWith('/');
}

export type ComparisonState = 'initial' | 'loading' | 'results' | 'error';

export interface ComparisonCandidate {
  id: string;
  platform: string;
  price: string;
  numericPrice: number;
  originalPrice?: string;
  discount?: string;
  deliveryNote?: string;
  url?: string;
  imageUrl?: string;
}

// In-memory cache across result screen visits during the app session
const comparisonSessionCache: Record<
  string,
  {
    candidates: ComparisonCandidate[];
    bestCandidateId: string;
  }
> = {};

function parseNumericPrice(priceStr?: string | number | null): number {
  if (typeof priceStr === 'number') return priceStr;
  if (!priceStr) return Infinity;
  const match = String(priceStr).replace(/,/g, '').match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : Infinity;
}


// ─── component ──────────────────────────────────────────────────────────────

export default function Result() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const params = useLocalSearchParams<{ jobId?: string; scanId?: string; autoCompare?: string }>();
  const sessionJobId = useSession((s) => s.tryOnJobId);
  const activeJobId = (params.jobId || sessionJobId) as string | undefined;

  const [detail, setDetail] = useState<TryOnDetailResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(Boolean(activeJobId));
  const [isSaved, setIsSaved] = useState<boolean>(false);

  const [view, setView]         = useState<'original' | 'you'>('you');
  const [fullscreen, setFull]   = useState(false);
  const [fsView, setFsView]     = useState<'you' | 'original'>('you');
  const horizontalPagerRef = React.useRef<ScrollView>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  const [isSaving, setIsSaving]       = useState(false);
  const [isSharing, setIsSharing]     = useState(false);

  const router = useRouter();

  // In-flight session fallbacks
  const resultImageUrls  = useSession((s) => s.resultImageUrls);
  const extractedProduct = useSession((s) => s.extractedProduct);

  // Load real VTON job detail with Local-First SQLite precedence
  useEffect(() => {
    if (!activeJobId) return;
    let isMounted = true;
    const currentAuthUserId = getAuthenticatedUserId() || DatabaseManager.getActiveUserId();

    async function loadJobDetail() {
      let foundLocally = false;

      // 1. LOCAL-FIRST RESOLUTION: Check Zustand store & SQLite first
      try {
        // A. In-memory Zustand store (instant synchronous match)
        const state = useLooksStore.getState();
        const storeMatch =
          state.generatedLooks.find((l) => l.id === activeJobId) ||
          state.savedLooks.find((l) => l.id === activeJobId);

        if (storeMatch && isMounted) {
          setDetail({
            id: storeMatch.id,
            user_id: currentAuthUserId || '',
            garment_id: storeMatch.garment_id || '',
            status: storeMatch.status || 'completed',
            result_image_urls: storeMatch.result_image_urls || [],
            is_saved: Boolean(storeMatch.is_saved),
            saved_photo_id: storeMatch.saved_photo_id,
            saved_photo_name: storeMatch.saved_photo_name,
            created_at: storeMatch.created_at || new Date().toISOString(),
            title: storeMatch.title || 'Virtual Look',
            brand: storeMatch.brand || 'FitMe',
            platform: storeMatch.platform,
          });
          setIsSaved(Boolean(storeMatch.is_saved));
          setIsLoadingDetail(false);
          foundLocally = true;
        }

        // B. Persistent SQLite Database query if not in store
        if (!foundLocally && currentAuthUserId) {
          if (!DatabaseManager.isDatabaseOpen()) {
            try {
              await DatabaseManager.openUserDatabase(currentAuthUserId);
            } catch (_) {
              // Silently bypass if DB cannot be mounted in current state
            }
          }

          if (DatabaseManager.isDatabaseOpen()) {
            const localJob = await LooksRepository.getLookById(activeJobId!);
            if (localJob && localJob.user_id === currentAuthUserId && isMounted) {
              setDetail({
                id: localJob.server_id || localJob.local_id,
                user_id: localJob.user_id,
                garment_id: localJob.garment_id,
                status: localJob.status,
                result_image_urls:
                  localJob.result_image_urls && localJob.result_image_urls.length > 0
                    ? localJob.result_image_urls
                    : localJob.local_image_paths || [],
                is_saved: Boolean(localJob.is_saved),
                saved_photo_id: localJob.saved_photo_id,
                saved_photo_name: localJob.saved_photo_name,
                created_at:
                  typeof localJob.created_at === 'number'
                    ? new Date(localJob.created_at).toISOString()
                    : String(localJob.created_at || ''),
                title: localJob.saved_photo_name
                  ? `Look with ${localJob.saved_photo_name}`
                  : 'Virtual Look',
                brand: localJob.brand_id || 'FitMe',
              });
              setIsSaved(Boolean(localJob.is_saved));
              setIsLoadingDetail(false);
              foundLocally = true;
            }
          }
        }
      } catch (localErr) {
        // Log cleanly to console without triggering React Native Dev LogBox warning toasts
        console.log('[Result] Local look lookup notice:', localErr);
      }

      // If no local record exists, show loading indicator while waiting for network
      if (!foundLocally && isMounted) {
        setIsLoadingDetail(true);
      }

      // 2. BACKGROUND NETWORK REFRESH: Fetch latest server metadata if connected
      try {
        const res = await tryOnApi.getDetail(activeJobId!);
        if (isMounted && res) {
          // Account isolation check: ensure active user hasn't switched during transit
          const activeAfterFetch = getAuthenticatedUserId() || DatabaseManager.getActiveUserId();
          if (activeAfterFetch === currentAuthUserId) {
            setDetail(res);
            setIsSaved(Boolean(res.is_saved));
          }
        }
      } catch (netErr) {
        // Offline / disconnected: gracefully preserve local record without error
        if (!foundLocally) {
          console.warn('Could not load try-on job detail from network:', activeJobId, netErr);
        }
      } finally {
        if (isMounted) {
          setIsLoadingDetail(false);
        }
      }
    }

    loadJobDetail();
    return () => {
      isMounted = false;
    };
  }, [activeJobId]);

  // Resolve RESULT_IMG (ON YOU)
  const RESULT_IMG =
    detail?.result_image_urls && detail.result_image_urls.length > 0 && detail.result_image_urls[0]
      ? detail.result_image_urls[0]
      : resultImageUrls && resultImageUrls.length > 0 && resultImageUrls[0]
      ? resultImageUrls[0]
      : FALLBACK_IMG;

  // Resolve PRODUCT_IMG (ORIGINAL)
  const garmentImageFromList =
    detail?.garment_images && detail.garment_images.length > 0
      ? typeof detail.garment_images[0] === 'string'
        ? detail.garment_images[0]
        : (detail.garment_images[0] as { url?: string })?.url
      : null;

  const PRODUCT_IMG =
    detail?.garment_image_url ||
    garmentImageFromList ||
    extractedProduct?.imageUrl ||
    extractedProduct?.imageUrls?.[0] ||
    FALLBACK_IMG;

  // Modal image follows fsView
  const modalImageUri = fsView === 'you' ? RESULT_IMG : PRODUCT_IMG;

  // Resolve product metadata
  const productBrand = detail?.brand || extractedProduct?.brand || 'FitMe';
  const productTitle = detail?.title || extractedProduct?.title || 'Virtual Look';
  const productPrice =
    detail?.price ||
    (extractedProduct?.price
      ? extractedProduct.price.startsWith('₹') || extractedProduct.price.startsWith('$')
        ? extractedProduct.price
        : `₹${extractedProduct.price}`
      : null);
  const shopUrl = detail?.affiliate_url || detail?.product_url || extractedProduct?.sourceUrl || null;

  // Resolve Compare Prices State & Candidates (Strictly On-Demand)
  const sessionScanId = useSession((s) => s.scanId);
  const activeScanId = (params.scanId || sessionScanId) as string | undefined;
  const comparisonCacheKey = activeJobId || activeScanId || 'current_look';

  const [comparisonState, setComparisonState] = useState<ComparisonState>(() => {
    return comparisonSessionCache[comparisonCacheKey]?.candidates?.length ? 'results' : 'initial';
  });
  const [candidates, setCandidates] = useState<ComparisonCandidate[]>(() => {
    return comparisonSessionCache[comparisonCacheKey]?.candidates || [];
  });
  const [bestDealId, setBestDealId] = useState<string>(() => {
    return comparisonSessionCache[comparisonCacheKey]?.bestCandidateId || '';
  });

  const handleFetchPriceComparison = useCallback(async () => {
    setComparisonState('loading');
    try {
      let resolvedCandidates: ComparisonCandidate[] = [];
      let calculatedBestId = '';

      // 1. Try real scan candidate results if activeScanId is present (image-upload flow)
      if (activeScanId) {
        try {
          const res = await productIntelligenceApi.getStatus(activeScanId);
          if (res?.candidates && res.candidates.length > 0) {
            resolvedCandidates = res.candidates.map((c: PICandidate, idx: number) => {
              const numP = typeof c.price === 'number' ? c.price : parseNumericPrice(c.price);
              const origNumP = typeof c.original_price === 'number' ? c.original_price : parseNumericPrice(c.original_price);
              const discountText = c.discount_pct
                ? `${c.discount_pct}% OFF`
                : origNumP && origNumP > numP
                ? `${Math.round(((origNumP - numP) / origNumP) * 100)}% OFF`
                : undefined;
              return {
                id: c.id || `cand-${idx}`,
                platform: formatRetailerName(c.retailer),
                price: c.price ? `₹${numP.toLocaleString('en-IN')}` : 'Check price',
                numericPrice: numP,
                originalPrice: c.original_price ? `₹${origNumP.toLocaleString('en-IN')}` : undefined,
                discount: discountText,
                deliveryNote: typeof c.rating === 'string' && c.rating.includes('Free delivery') ? 'Free delivery' : undefined,
                url: c.url || undefined,
                imageUrl: c.image_url || PRODUCT_IMG,
              };
            });
          }
        } catch (scanErr) {
          console.warn('Scan status fetch error:', scanErr);
        }
      }

      // 2. Fall back to URL-based exact product price comparison if no candidates from visual scan
      if (!resolvedCandidates.length) {
        const targetUrl = shopUrl || detail?.product_url || extractedProduct?.sourceUrl;
        const targetTitle = productTitle !== 'Virtual Look' ? productTitle : undefined;
        const targetBrand = productBrand !== 'FitMe' ? productBrand : undefined;
        const rawPriceStr = productPrice || detail?.price || extractedProduct?.price;
        const numericBasePrice = parseNumericPrice(rawPriceStr) || undefined;
        const targetImage = PRODUCT_IMG !== FALLBACK_IMG ? PRODUCT_IMG : undefined;
        const targetRetailer = detail?.platform || extractedProduct?.platform;

        try {
          const res = await linkComparisonApi.compare({
            job_id: activeJobId,
            source_url: targetUrl || undefined,
            brand: targetBrand,
            title: targetTitle,
            price: numericBasePrice,
            image_url: targetImage,
            retailer: targetRetailer || undefined,
          });

          if (res?.candidates && res.candidates.length > 0) {
            resolvedCandidates = res.candidates.map((c: LinkComparisonOffer) => ({
              id: c.id,
              platform: c.platform || formatRetailerName(c.retailer),
              price: c.formatted_price,
              numericPrice: c.price || 0,
              originalPrice: c.formatted_original_price || undefined,
              discount: c.discount_text || undefined,
              deliveryNote: c.delivery_note || 'Free delivery',
              url: c.url || undefined,
              imageUrl: c.image_url || PRODUCT_IMG,
            }));
            calculatedBestId = res.best_deal_id || '';
          }
        } catch (linkErr) {
          console.warn('Link comparison fetch failed:', linkErr);
        }
      }

      // 3. Dynamically determine lowest selling price candidate as BEST DEAL if not set
      if (!calculatedBestId && resolvedCandidates.length > 0) {
        let minPrice = Infinity;
        resolvedCandidates.forEach((c) => {
          if (c.numericPrice > 0 && c.numericPrice < minPrice) {
            minPrice = c.numericPrice;
            calculatedBestId = c.id;
          }
        });
        if (!calculatedBestId) {
          calculatedBestId = resolvedCandidates[0].id;
        }
      }

      // Update state and cache
      setCandidates(resolvedCandidates);
      setBestDealId(calculatedBestId);
      if (resolvedCandidates.length > 0) {
        setComparisonState('results');
        comparisonSessionCache[comparisonCacheKey] = {
          candidates: resolvedCandidates,
          bestCandidateId: calculatedBestId,
        };
      } else {
        setComparisonState('error');
      }
    } catch (err) {
      console.warn('Price comparison request failed:', err);
      setComparisonState('error');
    }
  }, [
    activeScanId,
    activeJobId,
    comparisonCacheKey,
    shopUrl,
    detail,
    extractedProduct,
    productTitle,
    productBrand,
    productPrice,
    PRODUCT_IMG,
    FALLBACK_IMG,
  ]);

  useEffect(() => {
    if (params.autoCompare === '1' && comparisonState === 'initial' && (detail || extractedProduct || activeJobId)) {
      handleFetchPriceComparison();
    }
  }, [params.autoCompare, comparisonState, detail, extractedProduct, activeJobId, handleFetchPriceComparison]);

  const handleOpenCandidate = useCallback(
    async (candidateUrl?: string) => {
      const targetUrl = candidateUrl || shopUrl || detail?.product_url || extractedProduct?.sourceUrl;
      if (targetUrl) {
        try {
          await Linking.openURL(targetUrl);
        } catch (err) {
          console.warn('Could not open store URL:', err);
          Alert.alert('Store Link', 'Could not open the store page.');
        }
      } else {
        Alert.alert('Store Link', 'No product store link is available.');
      }
    },
    [shopUrl, detail?.product_url, extractedProduct?.sourceUrl]
  );

  const handleViewAllComparisons = useCallback(() => {
    if (activeScanId) {
      router.push(`/find-product/results?scanId=${activeScanId}` as any);
    } else {
      router.push('/price-comparisons' as any);
    }
  }, [activeScanId, router]);

  // ── Complete the Look (Asynchronous & Dynamic Recommendations) ──────────────
  const [lookTheme, setLookTheme] = useState<string>('Hand-picked pairings');
  const [recommendedLookProducts, setRecommendedLookProducts] = useState<RecommendedProduct[]>([]);
  const [isLoadingLook, setIsLoadingLook] = useState<boolean>(ENABLE_COMPLETE_THE_LOOK);

  useEffect(() => {
    if (!ENABLE_COMPLETE_THE_LOOK) {
      setIsLoadingLook(false);
      return;
    }
    let isMounted = true;
    async function fetchCompleteTheLook() {
      try {
        setIsLoadingLook(true);
        const extAny = extractedProduct as any;
        const res = await productApi.getCompleteTheLook({
          job_id: activeJobId,
          title: detail?.title || extractedProduct?.title,
          brand: detail?.brand || extractedProduct?.brand,
          category: detail?.garment_type || extAny?.category,
          gender: extAny?.gender,
          color: extAny?.color,
          image_url: PRODUCT_IMG,
        });

        if (isMounted && res) {
          if (res.theme) {
            setLookTheme(res.theme);
          }
          if (Array.isArray(res.recommendations)) {
            setRecommendedLookProducts(res.recommendations);
          }
        }
      } catch (err) {
        console.warn('Failed to load complete the look recommendations:', err);
      } finally {
        if (isMounted) {
          setIsLoadingLook(false);
        }
      }
    }

    if (activeJobId || detail?.title || extractedProduct?.title) {
      fetchCompleteTheLook();
    } else {
      setIsLoadingLook(false);
    }

    return () => {
      isMounted = false;
    };
  }, [activeJobId, detail?.title, detail?.brand, detail?.garment_type, extractedProduct?.title, extractedProduct?.brand, (extractedProduct as any)?.category, PRODUCT_IMG]);


  // ── Shop action ───────────────────────────────────────────────────────────
  const handleShop = useCallback(() => {
    if (shopUrl) {
      openAffiliateProductUrl(shopUrl);
    } else {
      Alert.alert('Store Link', 'No product store link is available for this item.');
    }
  }, [shopUrl]);

  const isSavingRef = React.useRef(false);

  // ── Save action ───────────────────────────────────────────────────────────
  const handleToggleSave = useCallback(async () => {
    if (!activeJobId) return;

    // Instant optimistic toggle for immediate visual response on every tap
    setIsSaved((prev) => !prev);

    try {
      await useLooksStore.getState().toggleSave(String(activeJobId));
    } catch (err) {
      console.warn('Could not toggle save on look:', err);
    }
  }, [activeJobId]);

  const isSharingRef = React.useRef(false);

  // ── Share action ──────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (Platform.OS === 'android') {
      if (isSharingRef.current) return;
      isSharingRef.current = true;
    } else {
      if (isSharing) return;
      setIsSharing(true);
    }

    try {
      const localUri = isLocal(RESULT_IMG) ? RESULT_IMG : await cacheRemoteImage(RESULT_IMG);
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Sharing unavailable', 'Your device does not support sharing.');
        return;
      }

      if (Platform.OS === 'android') {
        const shareTitle = productTitle && productTitle !== 'Virtual Look' ? `👗 ${productTitle}` : null;
        const sharePrice = productPrice ? `${productPrice}` : null;
        const productLine = [shareTitle, sharePrice].filter(Boolean).join('\n');

        const shareMessage = [
          '✨ Tried this look on FitMe!',
          productLine ? `\n${productLine}` : '',
          '\nSee how this outfit looks on me with AI Try-On.\n👗 Discover your next look with FitMe.',
        ].filter(Boolean).join('\n').trim();

        await shareImageWithText(localUri, shareMessage, 'Share your look');
      } else {
        await Sharing.shareAsync(localUri, { mimeType: 'image/jpeg', dialogTitle: 'Share your look' });
      }
    } catch (err: any) {
      if (!String(err?.message).includes('User did not share') && !String(err?.message).includes('dismissed') && !String(err?.message).includes('cancel')) {
        Alert.alert('Error', 'Could not share the image. Please try again.');
      }
    } finally {
      if (Platform.OS === 'android') {
        isSharingRef.current = false;
      } else {
        setIsSharing(false);
      }
    }
  }, [RESULT_IMG, isSharing, productTitle, productPrice]);

  // ── Fullscreen image viewer handlers (Page 0 = ORIGINAL, Page 1 = ON YOU)
  const openFullscreen = useCallback((initialView: 'original' | 'you') => {
    setFsView(initialView);
    setIsZoomed(false);
    setFull(true);
    setTimeout(() => {
      horizontalPagerRef.current?.scrollTo({
        x: initialView === 'original' ? 0 : windowWidth,
        animated: false,
      });
    }, 50);
  }, [windowWidth]);

  const handleMomentumScrollEnd = useCallback((e: any) => {
    const pageIndex = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
    const newView = pageIndex === 0 ? 'original' : 'you';
    setFsView(newView);
    setIsZoomed(false);
  }, [windowWidth]);

  const handleDotPress = useCallback((targetView: 'original' | 'you') => {
    setFsView(targetView);
    setIsZoomed(false);
    horizontalPagerRef.current?.scrollTo({
      x: targetView === 'original' ? 0 : windowWidth,
      animated: true,
    });
  }, [windowWidth]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader
        title="Your look"
        back
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/looks'))}
        right={
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={handleShare}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="share-outline" size={20} color={Colors.foreground} />
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Main image */}
        <View style={[styles.imgWrap, { height: Math.min(windowHeight * 0.46, 500) }]}>
          {isLoadingDetail ? (
            <View style={styles.loaderWrap}>
              <ActivityIndicator size="large" color={Colors.accent} />
            </View>
          ) : (
            <CachedImage
              uri={view === 'you' ? RESULT_IMG : PRODUCT_IMG}
              style={styles.mainImg}
            />
          )}
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => openFullscreen(view)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="eye-outline" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Toggle & Save Heart */}
        <View style={styles.toggleSaveRow}>
          <View style={styles.toggleRow}>
            {(['original', 'you'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.toggleBtn, view === v && styles.toggleBtnActive]}
                onPress={() => setView(v)}
                activeOpacity={0.8}
              >
                <Text style={[styles.toggleText, view === v && styles.toggleTextActive]}>
                  {v === 'original' ? 'ORIGINAL' : 'ON YOU'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={styles.saveHeartBtn}
            onPress={handleToggleSave}
            activeOpacity={0.7}
            disabled={Platform.OS === 'android' ? false : isSaving}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={isSaved ? 'Unsave look' : 'Save look'}
            accessibilityRole="button"
          >
            {Platform.OS === 'android' ? (
              <Ionicons
                name={isSaved ? 'heart' : 'heart-outline'}
                size={22}
                color={isSaved ? Colors.destructive : Colors.foreground}
              />
            ) : isSaving ? (
              <ActivityIndicator size="small" color={isSaved ? Colors.destructive : Colors.accent} />
            ) : (
              <Ionicons
                name={isSaved ? 'heart' : 'heart-outline'}
                size={22}
                color={isSaved ? Colors.destructive : Colors.foreground}
              />
            )}
          </TouchableOpacity>
        </View>

        {/* Product card */}
        <View style={styles.productCard}>
          <Image source={{ uri: PRODUCT_IMG }} style={styles.productThumb} />
          <View style={styles.productInfo}>
            <Text style={styles.productBrand} numberOfLines={1}>{productBrand}</Text>
            <Text style={styles.productTitle} numberOfLines={2}>{productTitle}</Text>
            <View style={styles.productPriceRow}>
              {productPrice ? (
                <Text style={styles.productPrice}>{productPrice}</Text>
              ) : (
                <Text style={[styles.productPrice, { color: Colors.mutedForeground, fontSize: 12 }]}>
                  {detail?.platform ? formatRetailerName(detail.platform) : 'FitMe Collection'}
                </Text>
              )}
              <TouchableOpacity onPress={handleShop} activeOpacity={0.7}>
                <Text style={styles.shopLink}>Shop →</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Compare Prices (On-Demand) */}
        <View style={styles.compareSection}>
          {/* Header Row */}
          <View style={styles.compareHeader}>
            <View style={styles.compareHeaderLeft}>
              <Ionicons name="pricetag-outline" size={16} color={Colors.accent} />
              <View>
                <Text style={styles.compareTitle}>Compare prices</Text>
                <Text style={styles.compareSubtitle}>Find the best deal for you</Text>
              </View>
            </View>
          </View>

          {/* STATE 1: INITIAL (Zero API calls) */}
          {comparisonState === 'initial' && (
            <TouchableOpacity
              style={styles.compareCtaBtn}
              onPress={handleFetchPriceComparison}
              activeOpacity={0.85}
              accessibilityLabel="Tap to compare prices"
              accessibilityRole="button"
            >
              <Ionicons name="pricetag-outline" size={16} color={Colors.white} />
              <Text style={styles.compareCtaBtnText}>Tap to compare prices</Text>
            </TouchableOpacity>
          )}

          {/* STATE 2: LOADING */}
          {comparisonState === 'loading' && (
            <View style={styles.compareLoadingBox}>
              <ActivityIndicator size="small" color="#A86248" />
              <Text style={styles.compareLoadingText}>Comparing prices across stores...</Text>
            </View>
          )}

          {/* STATE 3: RESULTS (Dynamic Best Deal Highlight) */}
          {comparisonState === 'results' && (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.compareCardsScroll}
              >
                {candidates.map((candidate) => {
                  const isBestDeal = candidate.id === bestDealId;
                  const candidateImg = candidate.imageUrl || PRODUCT_IMG;
                  return (
                    <TouchableOpacity
                      key={candidate.id}
                      style={[styles.candidateCard, isBestDeal && styles.candidateCardBest]}
                      onPress={() => handleOpenCandidate(candidate.url)}
                      activeOpacity={0.8}
                    >
                      {isBestDeal ? (
                        <View style={styles.bestDealBadge}>
                          <Text style={styles.bestDealText}>BEST DEAL</Text>
                        </View>
                      ) : (
                        <View style={styles.bestDealPlaceholder} />
                      )}

                      <Image
                        source={{ uri: candidateImg }}
                        style={styles.candidateProductImg}
                        resizeMode="cover"
                      />

                      <View style={styles.candidateRetailerRow}>
                        <RetailerLogo retailer={candidate.platform} size={14} />
                        <Text style={styles.candidatePlatform} numberOfLines={1}>
                          {candidate.platform}
                        </Text>
                      </View>

                      <Text style={styles.candidatePrice} numberOfLines={1}>
                        {candidate.price}
                      </Text>

                      {candidate.discount ? (
                        <View style={[styles.discountBadge, isBestDeal && styles.discountBadgeBest]}>
                          <Text style={[styles.discountText, isBestDeal && styles.discountTextBest]}>
                            {candidate.discount}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.discountPlaceholder} />
                      )}

                      <View style={styles.deliveryRow}>
                        <Ionicons name="car-outline" size={11} color="#8E8E93" />
                        <Text style={styles.deliveryNoteText} numberOfLines={1}>
                          {candidate.deliveryNote || 'Free delivery'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

            </>
          )}

          {/* STATE 4: ERROR */}
          {comparisonState === 'error' && (
            <View style={styles.compareErrorBox}>
              <Ionicons name="alert-circle-outline" size={18} color={Colors.destructive} />
              <Text style={styles.compareErrorText}>Unable to compare prices</Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={handleFetchPriceComparison}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh-outline" size={14} color={Colors.white} />
                <Text style={styles.retryBtnText}>Try again</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Complete the look */}
        {ENABLE_COMPLETE_THE_LOOK && (
          <>
            <Text style={styles.secTitle}>Complete the look</Text>
            <Text style={styles.secSub}>{lookTheme}</Text>
            {isLoadingLook ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll}>
                {[1, 2, 3].map((key) => (
                  <View key={key} style={styles.lookSkeletonCard}>
                    <View style={styles.lookSkeletonImg} />
                    <View style={styles.lookSkeletonLine1} />
                    <View style={styles.lookSkeletonLine2} />
                  </View>
                ))}
              </ScrollView>
            ) : recommendedLookProducts.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll}>
                {recommendedLookProducts.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.relatedCard}
                    activeOpacity={0.85}
                    onPress={() => {
                      if (p.product_url) {
                        Linking.openURL(p.product_url).catch((err) =>
                          console.warn('Could not open product URL:', err)
                        );
                      }
                    }}
                  >
                    <View style={styles.relatedImgContainer}>
                      <Image source={{ uri: p.image || FALLBACK_IMG }} style={styles.relatedImg} />
                      <View style={styles.categoryBadge}>
                        <Text style={styles.categoryBadgeText}>{p.category}</Text>
                      </View>
                    </View>
                    <Text style={styles.relatedTitle} numberOfLines={2}>{p.title}</Text>
                    <Text style={styles.relatedMeta}>{p.retailer || p.brand} · {p.price}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.emptyLookContainer}>
                <Ionicons name="sparkles-outline" size={18} color={Colors.mutedForeground} />
                <Text style={styles.emptyLookText}>No complementary pairings available for this item yet</Text>
              </View>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Fullscreen 2-page horizontal swipe & zoomable modal ─────────────── */}
      <Modal
        visible={fullscreen}
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={() => {
          setFull(false);
          setIsZoomed(false);
        }}
      >
        <View style={styles.fsWrap}>
          {/* Header row */}
          <View style={[styles.fsHeader, { paddingTop: Platform.OS === 'android' ? 36 : 54 }]}>
            <TouchableOpacity
              style={styles.fsClose}
              onPress={() => {
                setFull(false);
                setIsZoomed(false);
              }}
              activeOpacity={0.7}
              accessibilityLabel="Close fullscreen"
              accessibilityRole="button"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.fsLabel}>{fsView === 'original' ? 'ORIGINAL' : 'ON YOU'}</Text>
            <View style={{ width: 48 }} />
          </View>

          {/* 2-Page Horizontal Pager: Page 0 = ORIGINAL, Page 1 = ON YOU */}
          <ScrollView
            ref={horizontalPagerRef}
            horizontal
            pagingEnabled
            scrollEnabled={!isZoomed}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            style={styles.fsPager}
          >
            {/* Page 0: ORIGINAL */}
            <View style={[styles.fsPageContainer, { width: windowWidth }]}>
              <ZoomableImageViewer uri={PRODUCT_IMG} onZoomChange={setIsZoomed} />
            </View>

            {/* Page 1: ON YOU */}
            <View style={[styles.fsPageContainer, { width: windowWidth }]}>
              <ZoomableImageViewer uri={RESULT_IMG} onZoomChange={setIsZoomed} />
            </View>
          </ScrollView>

          {/* Dot selector — indicates & switches active page */}
          <View style={styles.fsDots}>
            {(['original', 'you'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                onPress={() => handleDotPress(v)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel={v === 'original' ? 'Show original photo' : 'Show try-on result'}
                accessibilityRole="button"
              >
                <View style={[styles.fsDot, fsView === v && styles.fsDotActive]} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: Colors.background },
  scroll:          { paddingHorizontal: Spacing.xl, maxWidth: 640, width: '100%', alignSelf: 'center' },
  iconBtn:         { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  imgWrap:         { borderRadius: Radii.xxl, overflow: 'hidden', backgroundColor: Colors.muted, marginBottom: Spacing.lg, position: 'relative' },
  loaderWrap:      { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  mainImg:         { width: '100%', height: '100%', resizeMode: 'cover' },
  eyeBtn:          { position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  toggleSaveRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: Spacing.lg, width: '100%' },
  toggleRow:       { flexDirection: 'row', borderRadius: Radii.full, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, padding: 3, minWidth: 200 },
  toggleBtn:       { flex: 1, paddingVertical: 8, paddingHorizontal: 16, borderRadius: Radii.full, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: Colors.primary },
  toggleText:      { fontSize: 10, letterSpacing: 2, color: Colors.mutedForeground, textTransform: 'uppercase' },
  toggleTextActive:{ color: Colors.primaryForeground },
  saveHeartBtn:    { position: 'absolute', right: 0, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  productCard:     { flexDirection: 'row', gap: 12, backgroundColor: Colors.card, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, marginBottom: Spacing.lg },
  productThumb:    { width: 64, height: 80, borderRadius: Radii.md, resizeMode: 'cover', backgroundColor: Colors.muted },
  productInfo:     { flex: 1, justifyContent: 'center' },
  productBrand:    { fontSize: 10, letterSpacing: 1.5, color: Colors.mutedForeground, textTransform: 'uppercase' },
  productTitle:    { fontFamily: 'serif', fontSize: 16, color: Colors.foreground, marginTop: 2 },
  productPriceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  productPrice:    { fontSize: 14, fontWeight: '500', color: Colors.foreground },
  shopLink:        { fontSize: 12, color: Colors.accent },
  // Compare Prices section
  compareSection:       { backgroundColor: '#FAF6F0', borderRadius: Radii.xl, borderWidth: 1, borderColor: '#EFE7DC', padding: Spacing.lg, marginBottom: Spacing.xxl },
  compareHeader:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  compareHeaderLeft:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  compareTitle:         { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  compareSubtitle:      { fontSize: 11, color: Colors.mutedForeground, marginTop: 1 },
  viewAllRow:           { flexDirection: 'row', alignItems: 'center', gap: 4 },
  viewAllText:          { fontSize: 12, fontWeight: '600', color: Colors.accent },
  compareCtaBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#A86248', borderRadius: Radii.full, paddingVertical: 12, paddingHorizontal: 20, gap: 8, marginTop: 4 },
  compareCtaBtnText:    { color: Colors.white, fontSize: 13, fontWeight: '700' },
  compareLoadingBox:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  compareLoadingText:   { fontSize: 13, color: Colors.mutedForeground, fontWeight: '500' },
  compareCardsScroll:   { flexDirection: 'row', gap: 10, paddingVertical: 2 },
  candidateCard:        { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#EFE6DC', padding: 8, alignItems: 'center', width: 104, position: 'relative' },
  candidateCardBest:    { borderColor: '#2E7D32', borderWidth: 1.5, backgroundColor: '#FFFFFF' },
  bestDealBadge:        { backgroundColor: '#E8F5E9', borderColor: '#A5D6A7', borderWidth: 1, borderRadius: Radii.full, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 6, alignSelf: 'center' },
  bestDealText:         { fontSize: 8, fontWeight: '800', color: '#2E7D32', letterSpacing: 0.5 },
  bestDealPlaceholder:  { height: 16, marginBottom: 6 },
  candidateProductImg:  { width: 88, height: 98, borderRadius: 12, backgroundColor: '#F5F2EC' },
  candidateRetailerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 8, width: '100%' },
  candidatePlatform:    { fontSize: 11, fontWeight: '600', color: '#1C1C1E', textAlign: 'center' },
  candidatePrice:       { fontSize: 14, fontWeight: '700', color: '#1C1C1E', marginTop: 4, textAlign: 'center' },
  discountBadge:        { backgroundColor: '#FFF0E6', borderRadius: Radii.full, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4, alignSelf: 'center' },
  discountBadgeBest:    { backgroundColor: '#E8F5E9' },
  discountText:         { fontSize: 9, fontWeight: '700', color: '#D97746' },
  discountTextBest:     { color: '#2E7D32' },
  discountPlaceholder:  { height: 16, marginTop: 4 },
  deliveryRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 6 },
  deliveryNoteText:     { fontSize: 9, color: '#8E8E93' },
  trackPriceBanner:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFF7F2', borderRadius: 16, padding: 10, marginTop: 14, borderWidth: 1, borderColor: '#F3E5DC' },
  trackPriceLeft:       { flexDirection: 'row', alignItems: 'center', flex: 1 },
  trackPriceIconCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FDECE4', alignItems: 'center', justifyContent: 'center' },
  trackPriceTextCol:    { marginLeft: 8, flex: 1 },
  trackPriceTitle:      { fontSize: 12, fontWeight: '700', color: '#1C1C1E' },
  trackPriceSub:        { fontSize: 10, color: '#8E8E93', marginTop: 1 },
  trackPriceBtn:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8DED2', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, gap: 4 },
  trackPriceBtnText:    { fontSize: 11, fontWeight: '600', color: '#C86D51' },
  compareErrorBox:      { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  compareErrorText:     { fontSize: 13, color: Colors.mutedForeground, fontWeight: '500' },
  retryBtn:             { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#A86248', borderRadius: Radii.full, paddingVertical: 8, paddingHorizontal: 18 },
  retryBtnText:         { color: Colors.white, fontSize: 12, fontWeight: '600' },
  secTitle:        { fontFamily: 'serif', fontSize: 20, color: Colors.foreground, marginBottom: 4 },
  secSub:          { fontSize: 12, color: Colors.mutedForeground, marginTop: 2, marginBottom: 12 },
  hScroll:         { marginHorizontal: -Spacing.xl, paddingHorizontal: Spacing.xl },
  relatedCard:     { width: 130, marginRight: 12 },
  relatedImgContainer: { width: 130, height: 174, borderRadius: Radii.xl, overflow: 'hidden', position: 'relative', backgroundColor: Colors.muted },
  relatedImg:      { width: 130, height: 174, borderRadius: Radii.xl, resizeMode: 'cover' },
  categoryBadge:   { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  categoryBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  relatedTitle:    { fontSize: 12, color: Colors.foreground, marginTop: 8, lineHeight: 17 },
  relatedMeta:     { fontSize: 11, color: Colors.mutedForeground, marginTop: 2 },
  lookSkeletonCard: { width: 130, marginRight: 12 },
  lookSkeletonImg:  { width: 130, height: 174, borderRadius: Radii.xl, backgroundColor: '#EFEBE4' },
  lookSkeletonLine1: { width: 100, height: 10, borderRadius: 4, backgroundColor: '#EFEBE4', marginTop: 8 },
  lookSkeletonLine2: { width: 70, height: 8, borderRadius: 4, backgroundColor: '#EFEBE4', marginTop: 6 },
  emptyLookContainer: { paddingVertical: 18, paddingHorizontal: 16, backgroundColor: '#FAF7F2', borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 6, marginVertical: 8, borderWidth: 1, borderColor: '#EFE6DC' },
  emptyLookText:   { fontSize: 12, color: Colors.mutedForeground, textAlign: 'center', fontWeight: '500' },
  primaryBtn:      { backgroundColor: Colors.primary, borderRadius: Radii.full, paddingVertical: 16, alignItems: 'center', marginTop: Spacing.lg },
  primaryBtnText:  { color: Colors.primaryForeground, fontSize: 15, fontWeight: '500' },

  // Fullscreen modal
  fsWrap:          { flex: 1, backgroundColor: '#000' },
  fsHeader:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md, zIndex: 10 },
  fsClose:         { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  fsLabel:         { fontSize: 10, letterSpacing: 3, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' },
  fsPager:         { flex: 1, width: '100%' },
  fsPageContainer: { height: '100%' },
  fsScrollView:    { flex: 1, width: '100%' },
  fsScrollContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  fsTouchWrap:     { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  fsImg:           { height: '100%' },
  fsDots:          { flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: Spacing.xxl },
  fsDot:           { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  fsDotActive:     { width: 24, backgroundColor: '#fff' },
});
