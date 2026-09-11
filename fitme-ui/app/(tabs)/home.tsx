import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Image, Animated, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, Link, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Logo } from '../../src/components/Logo';
import { ProMemberBadge } from '../../src/components/ProMemberBadge';
import { trendingProducts } from '../../src/data/mockData';
import { Colors, Spacing, Radii } from '../../src/constants/theme';
import { formatRetailerName, supportedPlatforms } from '../../src/constants/retailers';
import { RetailerLogo } from '../../src/components/RetailerLogo';
import { useSession } from '../../src/services/session';
import { useUserStore } from '../../src/services/userStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CachedImage } from '../../src/components/CachedImage';
import { productIntelligenceApi, PIHistoryItem, tryOnApi, TryOnHistoryItem } from '../../src/services/api';
import { useLooksStore } from '../../src/services/looksStore';

function getComparisonImageUri(item: PIHistoryItem): string {
  if (!item) return 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=80';

  // 1. Candidate product image matching the best retailer
  if (item.candidates && item.candidates.length > 0) {
    const bestCand = item.candidates.find(
      (c) => c.retailer?.toLowerCase() === item.best_retailer?.toLowerCase()
    );
    const bestImg = bestCand?.image_url || (bestCand as any)?.imageUrl || (bestCand as any)?.image;
    if (bestImg && typeof bestImg === 'string' && bestImg.trim().length > 0) {
      return bestImg.trim();
    }

    // Any candidate with a valid image URL
    for (const c of item.candidates) {
      const candImg = c.image_url || (c as any)?.imageUrl || (c as any)?.image;
      if (candImg && typeof candImg === 'string' && candImg.trim().length > 0) {
        return candImg.trim();
      }
    }
  }

  // 2. User's original uploaded image thumbnail (Base64)
  if (item.thumbnail_b64 && typeof item.thumbnail_b64 === 'string' && item.thumbnail_b64.trim().length > 0) {
    const b64 = item.thumbnail_b64.trim();
    return b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`;
  }

  // 3. User's original uploaded image (stored on Storage CDN or local)
  if (item.profile?.image_cdn_url && typeof item.profile.image_cdn_url === 'string') {
    return item.profile.image_cdn_url;
  }
  if (item.profile?.image_url && typeof item.profile.image_url === 'string') {
    return item.profile.image_url;
  }

  // 4. Direct item image fields
  if ((item as any).image_url && typeof (item as any).image_url === 'string') {
    return (item as any).image_url;
  }
  if ((item as any).thumbnail_url && typeof (item as any).thumbnail_url === 'string') {
    return (item as any).thumbnail_url;
  }
  if ((item as any).garment_image_url && typeof (item as any).garment_image_url === 'string') {
    return (item as any).garment_image_url;
  }

  // 5. High-quality fashion fallback
  return 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=80';
}

function getComparisonTitle(item: PIHistoryItem): string {
  if (item.candidates && item.candidates.length > 0) {
    const bestCand = item.candidates.find(
      (c) => c.retailer?.toLowerCase() === item.best_retailer?.toLowerCase()
    );
    if (bestCand?.title) return bestCand.title;
    if (item.candidates[0]?.title) return item.candidates[0].title;
  }
  return item.profile?.detected_title || item.match_label || 'Garment Item';
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [recentComparisons, setRecentComparisons] = useState<PIHistoryItem[]>([]);
  const [cachedTryons, setCachedTryons] = useState<TryOnHistoryItem[]>([]);
  const { generatedLooks, fetchLooks, toggleSave: toggleLookSave, loading: looksLoading } = useLooksStore();
  const recentTryons = generatedLooks.length > 0 ? generatedLooks.slice(0, 8) : cachedTryons.slice(0, 8);
  const router = useRouter();
  const params = useLocalSearchParams<{ error?: string }>();
  
  const setSourceUrl = useSession((s) => s.setSourceUrl);
  const setProductImageUri = useSession((s) => s.setProductImageUri);
  const setExtractedProduct = useSession((s) => s.setExtractedProduct);
  const { isPremium } = useUserStore();

  const [inlineMsg, setInlineMsg] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const urlInputRef = useRef<TextInput>(null);

  const handleToggleTryonSave = async (jobId: string) => {
    try {
      await toggleLookSave(jobId);
    } catch (err) {
      console.warn('Could not toggle save on tryon from home:', err);
    }
  };

  const showMessage = (msg: string) => {
    setInlineMsg(msg);
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setInlineMsg(null);
      });
    }, 5000);
  };

  useEffect(() => {
    if (params.error) {
      showMessage(params.error);
      router.setParams({ error: '' });
    }
  }, [params.error]);

  // Keep local cachedTryons in sync with store
  useEffect(() => {
    if (generatedLooks.length > 0) {
      setCachedTryons(generatedLooks.slice(0, 8));
      AsyncStorage.setItem('fitme_home_recent_tryons', JSON.stringify(generatedLooks.slice(0, 8))).catch(() => {});
    }
  }, [generatedLooks]);

  // Instant load from mobile device storage on mount
  useEffect(() => {
    let isMounted = true;
    async function loadFromCache() {
      try {
        const [cachedComp, cachedTry] = await Promise.all([
          AsyncStorage.getItem('fitme_home_recent_comparisons'),
          AsyncStorage.getItem('fitme_home_recent_tryons'),
        ]);
        if (isMounted) {
          if (cachedComp) {
            const p = JSON.parse(cachedComp);
            if (Array.isArray(p)) setRecentComparisons(p);
          }
          if (cachedTry) {
            const t = JSON.parse(cachedTry);
            if (Array.isArray(t)) setCachedTryons(t);
          }
        }
      } catch (e) {
        // Cache read error ignored
      }
    }
    loadFromCache();
    // Proactively refresh looks on mount
    fetchLooks(false).catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [fetchLooks]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      async function loadHomeData() {
        try {
          await Promise.allSettled([
            fetchLooks(false).catch((err) => {
              console.log('[Home] Recent try-ons load status:', err?.message || err);
            }),
            productIntelligenceApi.getHistory({ status: 'done', limit: 4 }).then((compData) => {
              if (isMounted && Array.isArray(compData)) {
                setRecentComparisons(compData);
                AsyncStorage.setItem('fitme_home_recent_comparisons', JSON.stringify(compData)).catch(() => {});
              }
            }).catch((err) => {
              console.log('[Home] Recent comparisons load status:', err?.message || err);
            }),
          ]);
        } catch (err) {
          console.log('[Home] Data load status:', err);
        }
      }
      loadHomeData();
      return () => {
        isMounted = false;
      };
    }, [fetchLooks])
  );

  const handleUrlChange = (text: string) => {
    setUrl(text);
    if (inlineMsg) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      fadeAnim.setValue(0);
      setInlineMsg(null);
    }
  };

  const handleTryOn = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      showMessage('Please paste a product link to continue.');
      return;
    }
    setExtractedProduct(null);
    setProductImageUri(null);
    setSourceUrl(trimmed);
    router.push('/import');
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Enable camera access to take a photo of a product.');
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setExtractedProduct(null);
      setSourceUrl(null);
      setProductImageUri(result.assets[0].uri);
      router.push('/import');
    }
  };

  const uploadPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Enable photo access to choose a product image.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setExtractedProduct(null);
      setSourceUrl(null);
      setProductImageUri(result.assets[0].uri);
      router.push('/import');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <Logo size={24} />
            {isPremium && <ProMemberBadge variant="compact" />}
          </View>
          <Link href="/notifications" asChild>
            <TouchableOpacity style={styles.bellBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="notifications-outline" size={20} color={Colors.foreground} />
            </TouchableOpacity>
          </Link>
        </View>

        {/* Hero card */}
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>AI TRY-ON</Text>
          <Text style={styles.heroTitle}>See any outfit{'\n'}on you.</Text>
          <Text style={styles.heroBody}>Paste a link. We extract, fit and render — in seconds.</Text>
          <View style={[styles.urlRow, !!inlineMsg && { borderColor: Colors.destructive, borderWidth: 1 }]}>
            <Ionicons name="link-outline" size={16} color={Colors.mutedForeground} style={{ marginLeft: 12 }} />
            <TextInput
              ref={urlInputRef}
              style={styles.urlInput}
              placeholder="Paste a product URL"
              placeholderTextColor={Colors.mutedForeground}
              value={url}
              onChangeText={handleUrlChange}
              autoCapitalize="none"
              returnKeyType="go"
              onSubmitEditing={handleTryOn}
            />
            <TouchableOpacity style={styles.tryBtn} onPress={handleTryOn} activeOpacity={0.85}>
              <Text style={styles.tryBtnText}>Try{'\n'}on</Text>
            </TouchableOpacity>
          </View>
          
          {/* Inline validation/error message */}
          {inlineMsg && (
            <Animated.View style={[styles.inlineMsgRow, { opacity: fadeAnim }]}>
              <Ionicons name="information-circle-outline" size={14} color={Colors.destructive} />
              <Text style={styles.inlineMsgText}>{inlineMsg}</Text>
            </Animated.View>
          )}

          {/* Manual photo upload row */}
          <View style={styles.manualRow}>
            <TouchableOpacity
              style={styles.manualBtn}
              onPress={takePhoto}
              activeOpacity={0.8}
            >
              <Ionicons name="camera-outline" size={16} color={Colors.accent} />
              <Text style={styles.manualBtnText}>Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.manualBtn}
              onPress={uploadPhoto}
              activeOpacity={0.8}
            >
              <Ionicons name="image-outline" size={16} color={Colors.accent} />
              <Text style={styles.manualBtnText}>Upload photo</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Platforms */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SUPPORTED ON</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
            {supportedPlatforms.map((p) => (
              <View key={p} style={styles.chip}>
                <RetailerLogo retailer={p} size={14} />
                <Text style={styles.chipText}>{p}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* Find this product banner card (Image 1) */}
        <TouchableOpacity
          style={styles.findProductCard}
          onPress={() => router.push('/find-product' as any)}
          activeOpacity={0.88}
        >
          <View style={styles.findProductLeft}>
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>NEW</Text>
            </View>
            <Text style={styles.findProductTitle}>Find this product</Text>
            <Text style={styles.findProductSubtitle}>
              Upload a garment photo or tag and find similar products instantly.
            </Text>
          </View>
          <View style={styles.findProductRight}>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=300&q=80' }}
              style={styles.findProductImg}
            />
            <View style={styles.findProductArrowBtn}>
              <Ionicons name="arrow-forward" size={16} color={Colors.white} />
            </View>
          </View>
        </TouchableOpacity>

        {/* Recent try-ons */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent try-ons</Text>
            <Link href="/(tabs)/looks" asChild>
              <TouchableOpacity style={styles.seeAllRow} activeOpacity={0.7}>
                <Text style={styles.seeAllText}>See all</Text>
                <Ionicons name="arrow-forward" size={12} color={Colors.accent} />
              </TouchableOpacity>
            </Link>
          </View>
          {recentTryons.length === 0 ? (
            looksLoading ? (
              <View style={[styles.emptyTryonBox, { paddingVertical: 28 }]}>
                <ActivityIndicator size="small" color="#A86248" />
              </View>
            ) : (
              <View style={styles.emptyTryonBox}>
                <Text style={styles.emptyTryonTitle}>No recent try-ons yet.</Text>
                <TouchableOpacity
                  style={styles.emptyTryonBtn}
                  onPress={() => urlInputRef.current?.focus()}
                  activeOpacity={0.85}
                >
                  <Text style={styles.emptyTryonBtnText}>Try On a Product</Text>
                </TouchableOpacity>
              </View>
            )
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {recentTryons.map((p) => {
                const imgUri =
                  p.result_image_urls && p.result_image_urls.length > 0
                    ? p.result_image_urls[0]
                    : 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=400&q=80';
                return (
                  <Link href={{ pathname: '/result', params: { jobId: p.id } } as any} key={p.id} asChild>
                    <TouchableOpacity style={styles.productCard} activeOpacity={0.85}>
                      <CachedImage uri={imgUri} style={styles.productImg} />
                      <View style={styles.productInfo}>
                        <View style={styles.productTitleRow}>
                          <Text style={styles.productTitle} numberOfLines={1} ellipsizeMode="tail">
                            {p.title || 'Virtual Look'}
                          </Text>
                          <TouchableOpacity
                            onPress={() => handleToggleTryonSave(p.id)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            activeOpacity={0.7}
                          >
                            <Ionicons
                              name={p.is_saved ? 'heart' : 'heart-outline'}
                              size={15}
                              color={p.is_saved ? Colors.destructive : Colors.accent}
                            />
                          </TouchableOpacity>
                        </View>
                        <View style={styles.productPlatformRow}>
                          <RetailerLogo retailer={p.platform || p.brand} size={12} />
                          <Text style={styles.productPlatform} numberOfLines={1}>
                            {formatRetailerName(p.platform || p.brand)}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </Link>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Recent Price Comparisons (Replaces Trending now) */}
        <View style={[styles.section, { paddingBottom: 100 }]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Price Comparisons</Text>
            <Link href={"/price-comparisons" as any} asChild>
              <TouchableOpacity style={styles.seeAllRow} activeOpacity={0.7}>
                <Text style={styles.seeAllText}>See all</Text>
                <Ionicons name="arrow-forward" size={12} color={Colors.accent} />
              </TouchableOpacity>
            </Link>
          </View>

          {recentComparisons.length === 0 ? (
            <View style={styles.emptyCompCard}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="pricetags-outline" size={24} color="#A86248" />
              </View>
              <Text style={styles.emptyCompTitle}>No price comparisons yet.</Text>
              <Text style={styles.emptyCompBody}>
                Find a product and compare prices across stores.
              </Text>
              <TouchableOpacity
                style={styles.emptyCompBtn}
                onPress={() => router.push('/find-product' as any)}
                activeOpacity={0.85}
              >
                <Text style={styles.emptyCompBtnText}>Find a Product</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.compMasonry}>
              <View style={styles.compCol}>
                {recentComparisons.filter((_, i) => i % 2 === 0).map((item) => (
                  <Link href={`/find-product/results?scanId=${item.scan_id}` as any} key={item.scan_id} asChild>
                    <TouchableOpacity style={styles.compCard} activeOpacity={0.85}>
                      <CachedImage
                        uri={getComparisonImageUri(item)}
                        style={styles.compImg}
                      />
                      <View style={styles.compInfo}>
                        <Text style={styles.compTitle} numberOfLines={1}>
                          {getComparisonTitle(item)}
                        </Text>
                        <View style={styles.compRetailerRow}>
                          <RetailerLogo retailer={item.best_retailer} size={12} />
                          <Text style={styles.compRetailer} numberOfLines={1}>
                            {formatRetailerName(item.best_retailer)}
                          </Text>
                        </View>
                        <View style={styles.compPriceRow}>
                          <Text style={styles.compPrice}>
                            {item.best_price ? `₹${item.best_price.toLocaleString('en-IN')}` : 'Check price'}
                          </Text>
                          <Text style={styles.compBestBadge}>Best price</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </Link>
                ))}
              </View>
              <View style={styles.compCol}>
                {recentComparisons.filter((_, i) => i % 2 === 1).map((item) => (
                  <Link href={`/find-product/results?scanId=${item.scan_id}` as any} key={item.scan_id} asChild>
                    <TouchableOpacity style={styles.compCard} activeOpacity={0.85}>
                      <CachedImage
                        uri={getComparisonImageUri(item)}
                        style={styles.compImg}
                      />
                      <View style={styles.compInfo}>
                        <Text style={styles.compTitle} numberOfLines={1}>
                          {getComparisonTitle(item)}
                        </Text>
                        <View style={styles.compRetailerRow}>
                          <RetailerLogo retailer={item.best_retailer} size={12} />
                          <Text style={styles.compRetailer} numberOfLines={1}>
                            {formatRetailerName(item.best_retailer)}
                          </Text>
                        </View>
                        <View style={styles.compPriceRow}>
                          <Text style={styles.compPrice}>
                            {item.best_price ? `₹${item.best_price.toLocaleString('en-IN')}` : 'Check price'}
                          </Text>
                          <Text style={styles.compBestBadge}>Best price</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </Link>
                ))}
              </View>
            </View>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: 100,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  bellBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  heroCard: { backgroundColor: '#EFE4D7', borderRadius: Radii.xxl, padding: Spacing.xl, paddingTop: Spacing.xxl, marginBottom: Spacing.xl },
  heroEyebrow: { fontSize: 10, letterSpacing: 3, color: Colors.mutedForeground, textTransform: 'uppercase', marginBottom: 8 },
  heroTitle: { fontFamily: 'serif', fontSize: 34, color: Colors.foreground, lineHeight: 40, marginBottom: 10 },
  heroBody: { fontSize: 13, color: Colors.mutedForeground, marginBottom: 18, lineHeight: 20 },
  urlRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card,
    borderRadius: Radii.full, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  urlInput: { flex: 1, fontSize: 13, color: Colors.foreground, paddingVertical: 12, paddingLeft: 8 },
  tryBtn: { backgroundColor: Colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: Radii.full, margin: 4, alignItems: 'center', justifyContent: 'center' },
  tryBtnText: { color: Colors.primaryForeground, fontSize: 11, fontWeight: '600', textAlign: 'center', lineHeight: 14 },
  inlineMsgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 8 },
  inlineMsgText: { fontSize: 12, color: Colors.destructive },
  manualRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  manualBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: Radii.full,
    paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)',
  },
  manualBtnText: { fontSize: 13, fontWeight: '500', color: Colors.foreground },
  section: { marginBottom: Spacing.xxl },
  sectionLabel: { fontSize: 10, letterSpacing: 2, color: Colors.mutedForeground, textTransform: 'uppercase', marginBottom: 10 },
  chipsScroll: { marginHorizontal: -Spacing.xl, paddingHorizontal: Spacing.xl },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.card, borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8 },
  chipText: { fontSize: 12, color: Colors.foreground },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontFamily: 'serif', fontSize: 20, color: Colors.foreground },
  trendingTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  seeAllRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  seeAllText: { fontSize: 12, color: Colors.accent },
  productCard: {
    width: 148,
    marginRight: 12,
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  productImg: {
    width: '100%',
    aspectRatio: 3 / 4,
    resizeMode: 'cover',
    backgroundColor: Colors.muted,
  },
  productInfo: {
    padding: 10,
    paddingBottom: 12,
  },
  productTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  productTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.foreground,
  },
  productPlatformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  productPlatform: {
    fontSize: 11,
    color: Colors.mutedForeground,
  },
  productBrand: { fontSize: 11, color: Colors.mutedForeground, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridCard: { width: '47.5%', backgroundColor: Colors.card, borderRadius: Radii.xl, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  gridImg: { width: '100%', aspectRatio: 3 / 4, resizeMode: 'cover', backgroundColor: Colors.muted },
  gridInfo: { padding: 10 },
  gridTitle: { fontSize: 13, color: Colors.foreground },
  gridMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  gridBrand: { fontSize: 11, color: Colors.mutedForeground },
  gridPrice: { fontSize: 11, fontWeight: '600', color: Colors.foreground },

  /* Find this product banner (Image 1) */
  findProductCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFE4D7',
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.xxl,
    borderWidth: 1,
    borderColor: '#DFD1C1',
  },
  findProductLeft: { flex: 1, paddingRight: Spacing.sm },
  newBadge: {
    backgroundColor: '#C57C5D',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  newBadgeText: { color: Colors.white, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  findProductTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground, marginBottom: 4 },
  findProductSubtitle: { fontSize: 12, color: Colors.mutedForeground, lineHeight: 16, maxWidth: 200 },
  findProductRight: { position: 'relative', width: 90, height: 90 },
  findProductImg: { width: 90, height: 90, borderRadius: Radii.lg, backgroundColor: Colors.muted, resizeMode: 'cover' },
  findProductArrowBtn: {
    position: 'absolute',
    right: -8,
    bottom: -8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#A86248',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },

  /* Recent Price Comparisons 2-column masonry matching Your Looks */
  compMasonry: { flexDirection: 'row', gap: 10 },
  compCol: { flex: 1, gap: 10 },
  compCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  compImg: {
    width: '100%',
    aspectRatio: 3 / 4,
    resizeMode: 'cover',
    backgroundColor: Colors.muted,
  },
  compInfo: { padding: 10, paddingBottom: 12 },
  compTitle: { fontSize: 13, fontWeight: '600', color: Colors.foreground, lineHeight: 18 },
  compRetailerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  compRetailer: { fontSize: 11, color: Colors.mutedForeground },
  compPriceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  compPrice: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  compBestBadge: { fontSize: 10, fontWeight: '600', color: '#A86248', textTransform: 'uppercase' },

  /* Empty state */
  emptyCompCard: {
    backgroundColor: '#FAF5EE',
    borderRadius: Radii.xl,
    padding: Spacing.xxl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8DED2',
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FAF3EC',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  emptyCompTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, marginBottom: 4 },
  emptyCompBody: { fontSize: 12, color: Colors.mutedForeground, textAlign: 'center', lineHeight: 18, marginBottom: 16 },
  emptyCompBtn: {
    backgroundColor: '#A86248',
    borderRadius: Radii.full,
    paddingVertical: 10,
    paddingHorizontal: 22,
  },
  emptyCompBtnText: { color: Colors.white, fontSize: 13, fontWeight: '700' },

  emptyTryonBox: {
    backgroundColor: '#FAF5EE',
    borderRadius: Radii.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8DED2',
    marginTop: 4,
  },
  emptyTryonTitle: {
    fontFamily: 'serif',
    fontSize: 15,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: 12,
    textAlign: 'center',
  },
  emptyTryonBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radii.full,
    paddingVertical: 10,
    paddingHorizontal: 22,
  },
  emptyTryonBtnText: {
    color: Colors.primaryForeground,
    fontSize: 13,
    fontWeight: '700',
  },
});
