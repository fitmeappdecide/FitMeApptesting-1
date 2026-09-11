import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../../src/constants/theme';
import { useSession } from '../../src/services/session';
import { productIntelligenceApi, PICandidate } from '../../src/services/api';
import { extractProductFromUrl } from '../../src/services/extraction';

interface ProductResult {
  id: string;
  title: string;
  platform: string;
  price: string;
  originalPrice: string;
  discount: string;
  rating: string;
  image: string;
  url: string;
  confidence?: number;
  isExact?: boolean;
  matchType?: 'exact' | 'similar';
  favorite?: boolean;
}

const fallbackResults: ProductResult[] = [
  {
    id: 'res-1',
    title: 'Solid Cotton Shirt Dress',
    platform: 'Myntra',
    price: '₹1,299',
    originalPrice: '₹1,799',
    discount: '(28% OFF)',
    rating: '4.3 ★ · Free delivery',
    image: 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=400&q=80',
    url: 'https://www.myntra.com',
    isExact: true,
    matchType: 'exact',
  },
  {
    id: 'res-2',
    title: 'Women Beige Shirt Dress',
    platform: 'AJIO',
    price: '₹1,199',
    originalPrice: '₹1,699',
    discount: '(28% OFF)',
    rating: '4.2 ★ · Free delivery',
    image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=400&q=80',
    url: 'https://www.ajio.com',
    isExact: false,
    matchType: 'similar',
  },
  {
    id: 'res-3',
    title: 'Beige Shirt Style Dress',
    platform: 'Amazon',
    price: '₹1,349',
    originalPrice: '₹1,999',
    discount: '(33% OFF)',
    rating: '4.1 ★ · Free delivery',
    image: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=400&q=80',
    url: 'https://www.amazon.in',
    isExact: false,
    matchType: 'similar',
  },
];

import { formatRetailerName } from '../../src/constants/retailers';
import { RetailerLogo } from '../../src/components/RetailerLogo';

export default function FindProductResults() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scanId?: string }>();
  const scanId = params.scanId;

  const setProductImageUri = useSession((s) => s.setProductImageUri);
  const setSourceUrl = useSession((s) => s.setSourceUrl);
  const setProductId = useSession((s) => s.setProductId);

  const [loading, setLoading] = useState(Boolean(scanId));
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [results, setResults] = useState<ProductResult[]>(fallbackResults);
  const [selectedFilter, setSelectedFilter] = useState<string>('All');
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const mapCandidates = (candidates: PICandidate[]): ProductResult[] => {
    return candidates
      .filter((c: PICandidate) => c.price && c.price >= 100)
      .map((c: PICandidate, idx: number) => {
        const platform = formatRetailerName(c.retailer);
        const price = `₹${c.price!.toLocaleString('en-IN')}`;
        const originalPrice = c.original_price ? `₹${c.original_price.toLocaleString('en-IN')}` : '';
        const discount = c.discount_pct ? `(${c.discount_pct}% OFF)` : '';
        const rating = typeof c.rating === 'string' ? c.rating : (c.rating ? `${c.rating} ★ · Free delivery` : '4.3 ★ · Free delivery');
        return {
          id: c.id || `cand-${idx}`,
          title: c.title || 'Fashion Garment',
          platform,
          price,
          originalPrice,
          discount,
          rating,
          image: c.image_url || 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=400&q=80',
          url: c.url || 'https://www.google.com',
          confidence: c.confidence,
          isExact: Boolean(c.is_exact || c.match_type === 'exact'),
          matchType: (c.match_type || (c.is_exact ? 'exact' : 'similar')) as 'exact' | 'similar',
        };
      });
  };

  const resolvingUrlsRef = useRef<Set<string>>(new Set());

  const verifyExtractedProductIdentity = (
    candidate: ProductResult,
    extracted: { title?: string | null; brand?: string | null; price?: string | null; platform?: string | null }
  ): boolean => {
    if (!extracted.price || !extracted.title) return false;

    const candTitleNorm = candidate.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const extTitleNorm = extracted.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const extBrandNorm = (extracted.brand || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();

    // Stopwords for title token comparison
    const stopWords = new Set([
      'a', 'an', 'the', 'in', 'for', 'and', 'of', 'with', 'on', 'at', 'to', 'by', 'from',
      'buy', 'online', 'india', 'price', 'flat', 'off', 'rs', 'mrp', 'shop', 'store',
      'women', 'womens', 'men', 'mens', 'clothing', 'apparel', 'fashion'
    ]);

    const candTokens = candTitleNorm.split(/\s+/).filter((t) => t.length > 2 && !stopWords.has(t));
    const extCombined = `${extBrandNorm} ${extTitleNorm}`.trim();
    const extTokens = new Set(extCombined.split(/\s+/).filter((t) => t.length > 2 && !stopWords.has(t)));

    if (candTokens.length > 0) {
      const matchCount = candTokens.filter((t) => extTokens.has(t)).length;
      const overlapRatio = matchCount / candTokens.length;
      // Allow valid PDP extractions with token overlap >= 0.35 or if extracted title contains direct product tokens
      if (overlapRatio < 0.35 && matchCount < 2) {
        return false;
      }
    }

    return true;
  };

  const resolveLivePrices = (candidateList: ProductResult[]) => {
    // Find all candidates with missing price ("Check store")
    const missing = candidateList.filter(
      (c) => (c.price === 'Check store' || !c.price) && c.url && c.url.startsWith('http')
    );

    // Prioritize Exact candidates first, then Similar candidates
    const prioritized = [
      ...missing.filter((c) => c.isExact),
      ...missing.filter((c) => !c.isExact),
    ];

    for (const cand of prioritized) {
      if (resolvingUrlsRef.current.has(cand.url)) continue;
      resolvingUrlsRef.current.add(cand.url);

      (async () => {
        try {
          const extracted = await extractProductFromUrl(cand.url);
          if (!extracted || !extracted.price) return;

          // Identity verification guard for Exact candidates
          if (cand.isExact) {
            const isVerified = verifyExtractedProductIdentity(cand, extracted);
            if (!isVerified) {
              console.warn(`[Live Price Resolver] Extracted product for ${cand.url} failed identity verification`);
              return;
            }
          }

          const cleanPriceStr = extracted.price.replace(/[^0-9.]/g, '');
          const numPrice = parseFloat(cleanPriceStr);
          if (isNaN(numPrice) || numPrice <= 0) return;

          const formattedPrice = `₹${numPrice.toLocaleString('en-IN')}`;
          let formattedOriginal = '';
          let formattedDiscount = '';

          if (extracted.originalPrice) {
            const cleanOrigStr = extracted.originalPrice.replace(/[^0-9.]/g, '');
            const numOrig = parseFloat(cleanOrigStr);
            if (!isNaN(numOrig) && numOrig > numPrice) {
              formattedOriginal = `₹${numOrig.toLocaleString('en-IN')}`;
              const discPct = Math.round(((numOrig - numPrice) / numOrig) * 100);
              if (discPct > 0) {
                formattedDiscount = `(${discPct}% OFF)`;
              }
            }
          }

          // Update candidate card in place (Exact or Similar)
          setResults((prevResults) =>
            prevResults.map((item) => {
              if (item.id === cand.id) {
                return {
                  ...item,
                  price: formattedPrice,
                  originalPrice: formattedOriginal || item.originalPrice,
                  discount: formattedDiscount || item.discount,
                };
              }
              return item;
            })
          );
        } catch (err) {
          console.warn(`[Live Price Resolver] Could not resolve live price for ${cand.url}:`, err);
        }
      })();
    }
  };

  useEffect(() => {
    if (!scanId) return;

    let isMounted = true;
    async function loadScanResults() {
      try {
        setLoading(true);
        const statusDoc = await productIntelligenceApi.getStatus(scanId as string);
        if (!isMounted) return;

        if (typeof statusDoc.is_saved === 'boolean') {
          setIsSaved(statusDoc.is_saved);
        }

        if (statusDoc.candidates && statusDoc.candidates.length > 0) {
          const mapped = mapCandidates(statusDoc.candidates);
          setResults(mapped);
          resolveLivePrices(mapped);
        }

        // If price is stale (>12 hours), trigger background micro-refresh
        if (statusDoc.is_price_stale) {
          setRefreshingPrices(true);
          productIntelligenceApi
            .refreshPrices(scanId as string)
            .then((refreshed) => {
              if (!isMounted || !refreshed?.candidates) return;
              const refreshedMapped = mapCandidates(refreshed.candidates);
              setResults(refreshedMapped);
              resolveLivePrices(refreshedMapped);
            })
            .catch((err) => {
              console.warn('Background price refresh error:', err);
            })
            .finally(() => {
              if (isMounted) setRefreshingPrices(false);
            });
        }
      } catch (err: any) {
        console.warn('Failed to load scan candidates, using fallback list:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadScanResults();

    return () => {
      isMounted = false;
    };
  }, [scanId]);

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleScanSave = async () => {
    if (!scanId) return;
    try {
      setIsSaved((prev) => !prev);
      await productIntelligenceApi.toggleSave(scanId as string);
    } catch (err) {
      console.warn('Could not toggle save on scan:', err);
      setIsSaved((prev) => !prev);
    }
  };

  const handleTryOn = async (product: ProductResult) => {
    try {
      setActionLoadingId(product.id);
      setSourceUrl(product.url);
      setProductImageUri(product.image);

      if (scanId) {
        try {
          const bridgeRes = await productIntelligenceApi.selectCandidate(scanId, product.id);
          if (bridgeRes?.garment_id) {
            setProductId(bridgeRes.garment_id);
          }
        } catch (bridgeErr) {
          console.warn('Candidate bridge warning (using session product image fallback):', bridgeErr);
        }
      }

      router.push('/upload-photo');
    } catch (err: any) {
      console.error('Try on initiation error:', err);
      router.push('/upload-photo');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleViewStore = async (product: ProductResult) => {
    try {
      let targetUrl = product.url;

      if (scanId) {
        try {
          const affRes = await productIntelligenceApi.affiliateClick(scanId, product.id);
          if (affRes?.affiliate_url) {
            targetUrl = affRes.affiliate_url;
          }
        } catch (affErr) {
          console.warn('Affiliate link generation fallback to direct URL:', affErr);
        }
      }

      if (targetUrl) {
        const supported = await Linking.canOpenURL(targetUrl).catch(() => false);
        if (supported) {
          await Linking.openURL(targetUrl);
        }
      }
    } catch (err: any) {
      console.warn('Open store browser warning:', err?.message || err);
      if (product.url) {
        const fallbackSupported = await Linking.canOpenURL(product.url).catch(() => false);
        if (fallbackSupported) {
          await Linking.openURL(product.url).catch(() => {});
        }
      }
    }
  };

  const getPlatformRank = (platform: string): number => {
    const p = platform.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (p.includes('myntra')) return 1;
    if (p.includes('flipkart')) return 2;
    if (p.includes('ajio')) return 3;
    if (p.includes('nykaa')) return 4;
    if (p.includes('meesho')) return 5;
    if (p.includes('thehouseofrare') || p.includes('rarerabbit')) return 6;
    if (p.includes('tatacliq')) return 7;
    if (p.includes('amazon')) return 8;
    if (p.includes('libas')) return 9;
    if (p.includes('snitch')) return 10;
    return 20;
  };

  const parsePriceNum = (p: string) => {
    const clean = p.replace(/[^0-9.]/g, '');
    const n = parseFloat(clean);
    return isNaN(n) ? Infinity : n;
  };

  const allPlatforms = Array.from(new Set(results.map((r) => r.platform)));
  allPlatforms.sort((a, b) => getPlatformRank(a) - getPlatformRank(b));
  const availablePlatforms = ['All', ...allPlatforms];

  const filteredResults = selectedFilter === 'All'
    ? results
    : results.filter((r) => r.platform === selectedFilter);

  const sortedResults = [...filteredResults].sort((a, b) => {
    // 1. Top trusted fashion platforms stay first
    const rankA = getPlatformRank(a.platform);
    const rankB = getPlatformRank(b.platform);
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    // 2. Lowest price first within the same platform tier
    const priceA = parsePriceNum(a.price);
    const priceB = parsePriceNum(b.price);
    return priceA - priceB;
  });

  const renderProductCard = (item: ProductResult) => (
    <View key={item.id} style={styles.productCard}>
      {/* Top Row: Image & Details */}
      <View style={styles.cardMainRow}>
        <Image source={{ uri: item.image }} style={styles.productImg} />
        
        <View style={styles.cardDetails}>
          <View style={styles.titleFavRow}>
            <Text style={styles.productTitle} numberOfLines={1}>{item.title}</Text>
            <TouchableOpacity
              onPress={() => toggleFavorite(item.id)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={favorites[item.id] ? 'heart' : 'heart-outline'}
                size={18}
                color={favorites[item.id] ? Colors.destructive : Colors.mutedForeground}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.platformRow}>
            <RetailerLogo retailer={item.platform} size={15} />
            <Text style={styles.platformName}>{item.platform}</Text>
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.priceText}>{item.price}</Text>
            {item.originalPrice ? <Text style={styles.originalPriceText}>{item.originalPrice}</Text> : null}
            {item.discount ? <Text style={styles.discountText}>{item.discount}</Text> : null}
          </View>

          <Text style={styles.ratingText}>{item.rating}</Text>
        </View>
      </View>

      {/* Bottom Buttons Row */}
      <View style={styles.cardActionRow}>
        <TouchableOpacity
          style={styles.tryOnBtn}
          onPress={() => handleTryOn(item)}
          activeOpacity={0.88}
          disabled={actionLoadingId === item.id}
        >
          {actionLoadingId === item.id ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.tryOnBtnText}>Try on</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.viewStoreBtn}
          onPress={() => handleViewStore(item)}
          activeOpacity={0.8}
        >
          <Text style={styles.viewStoreBtnText}>View on {item.platform}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader
        title="Price Comparisons"
        back
        right={
          scanId ? (
            <TouchableOpacity
              onPress={handleToggleScanSave}
              style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isSaved ? 'heart' : 'heart-outline'}
                size={22}
                color={isSaved ? Colors.destructive : Colors.foreground}
              />
            </TouchableOpacity>
          ) : null
        }
      />
      
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Subheader Row */}
        <View style={styles.subheaderRow}>
          <Text style={styles.resultsCountText}>
            {loading ? 'Finding matching garments...' : `We found ${sortedResults.length} offer${sortedResults.length === 1 ? '' : 's'}`}
          </Text>
          <TouchableOpacity style={styles.filterBtn} activeOpacity={0.8}>
            <Ionicons name="options-outline" size={14} color={Colors.foreground} style={{ marginRight: 4 }} />
            <Text style={styles.filterBtnText}>Filter</Text>
          </TouchableOpacity>
        </View>

        {/* Platform Chips Bar */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
          {availablePlatforms.map((platform) => {
            const isActive = selectedFilter === platform;
            return (
              <TouchableOpacity
                key={platform}
                style={[styles.chip, isActive && styles.chipActive]}
                onPress={() => setSelectedFilter(platform)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {platform}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Loading Spinner State */}
        {loading && (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#A86248" />
            <Text style={styles.loadingText}>Verifying product identity & prices...</Text>
          </View>
        )}

        {/* Unified Results List */}
        {!loading && (
          <View style={styles.listContainer}>
            <View style={styles.cardsStack}>
              {sortedResults.map(renderProductCard)}
            </View>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xxxl,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },

  subheaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  resultsCountText: { fontSize: 13, color: Colors.mutedForeground },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: '#E8DED2',
    borderRadius: Radii.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterBtnText: { fontSize: 12, fontWeight: '600', color: Colors.foreground },

  chipsScroll: { marginBottom: Spacing.lg },
  chip: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: '#E8DED2',
    borderRadius: Radii.full,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: '#A86248',
    borderColor: '#A86248',
  },
  chipText: { fontSize: 13, fontWeight: '500', color: Colors.foreground },
  chipTextActive: { color: Colors.white, fontWeight: '700' },

  loadingBox: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.mutedForeground,
  },

  listContainer: { gap: Spacing.xl },
  sectionBlock: { gap: 8 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  exactBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionHeadingText: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.foreground,
    letterSpacing: 0.5,
  },
  sectionCountBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.mutedForeground,
    backgroundColor: '#EFE5DA',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  sectionSubText: {
    fontSize: 12,
    color: Colors.mutedForeground,
    marginBottom: 8,
  },
  cardsStack: {
    gap: Spacing.lg,
  },
  noExactBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF3EC',
    borderWidth: 1,
    borderColor: '#EFE5DA',
    borderRadius: Radii.lg,
    padding: 12,
    marginBottom: 4,
  },
  noExactTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: 2,
  },
  noExactSub: {
    fontSize: 11,
    color: Colors.mutedForeground,
    lineHeight: 15,
  },
  productCard: {
    backgroundColor: '#FAF5EE',
    borderWidth: 1,
    borderColor: '#E8DED2',
    borderRadius: Radii.xl,
    padding: Spacing.lg,
  },
  cardMainRow: { flexDirection: 'row' },
  productImg: {
    width: 105,
    height: 125,
    borderRadius: Radii.lg,
    backgroundColor: Colors.muted,
    resizeMode: 'cover',
  },
  cardDetails: { flex: 1, marginLeft: Spacing.md, justifyContent: 'space-between' },
  titleFavRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  productTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.foreground, marginRight: 6 },
  platformRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  platformName: { fontSize: 12, color: Colors.mutedForeground },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 },
  priceText: { fontSize: 16, fontWeight: '800', color: Colors.foreground },
  originalPriceText: { fontSize: 12, color: Colors.mutedForeground, textDecorationLine: 'line-through' },
  discountText: { fontSize: 12, fontWeight: '700', color: '#C57C5D' },

  ratingText: { fontSize: 12, color: Colors.mutedForeground, marginTop: 4 },

  cardActionRow: { flexDirection: 'row', gap: 10, marginTop: Spacing.lg },
  tryOnBtn: {
    flex: 1,
    backgroundColor: '#A86248',
    borderRadius: Radii.full,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tryOnBtnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },
  viewStoreBtn: {
    flex: 1,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: '#E8DED2',
    borderRadius: Radii.full,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewStoreBtnText: { color: Colors.foreground, fontSize: 13, fontWeight: '600' },
});
