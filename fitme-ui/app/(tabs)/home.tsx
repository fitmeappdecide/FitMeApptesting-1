import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Image, Animated, Alert, ActivityIndicator, StatusBar, useWindowDimensions, Keyboard,
} from 'react-native';
import { useRouter, Link, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Logo } from '../../src/components/Logo';
import { ProMemberBadge } from '../../src/components/ProMemberBadge';
import { trendingProducts } from '../../src/data/mockData';
import { Colors, Spacing, Radii, Fonts } from '../../src/constants/theme';
import { formatRetailerName, supportedPlatforms } from '../../src/constants/retailers';
import { RetailerLogo } from '../../src/components/RetailerLogo';
import { useSession } from '../../src/services/session';
import { useUserStore } from '../../src/services/userStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CachedImage } from '../../src/components/CachedImage';
import { productIntelligenceApi, PIHistoryItem, tryOnApi, TryOnHistoryItem } from '../../src/services/api';
import { useLooksStore } from '../../src/services/looksStore';
import { usePriceComparisonStore } from '../../src/services/priceComparisonStore';
import { normalizeProductUrl } from '../../src/utils/url';

// Feature flag: set to false to instantly revert to previous beige box hero
const SHOW_EDITORIAL_HERO = true;
const ENABLE_RECENT_PRICE_COMPARISONS = false;

function getComparisonImageUri(item: any): string {
  if (!item) return 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=80';

  // 1. Extracted garment image (STRICT PRIORITY - never on-model try-on result)
  if (item.garment_image_url && typeof item.garment_image_url === 'string' && item.garment_image_url.trim().length > 0) {
    return item.garment_image_url.trim();
  }
  if (item.product_image_url && typeof item.product_image_url === 'string' && item.product_image_url.trim().length > 0) {
    return item.product_image_url.trim();
  }
  if (item.image_url && typeof item.image_url === 'string' && item.image_url.trim().length > 0) {
    return item.image_url.trim();
  }

  // 2. Candidate product image matching the best retailer
  if (item.candidates && item.candidates.length > 0) {
    const bestCand = item.candidates.find(
      (c: any) => (c.retailer || c.platform)?.toLowerCase() === item.best_retailer?.toLowerCase()
    );
    const bestImg = bestCand?.image_url || bestCand?.imageUrl || bestCand?.image;
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

  // 3. User's original uploaded image thumbnail (Base64)
  if (item.thumbnail_b64 && typeof item.thumbnail_b64 === 'string' && item.thumbnail_b64.trim().length > 0) {
    const b64 = item.thumbnail_b64.trim();
    return b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`;
  }

  // 4. User's original uploaded image (stored on Storage CDN or local)
  if (item.profile?.image_cdn_url && typeof item.profile.image_cdn_url === 'string') {
    return item.profile.image_cdn_url;
  }
  if (item.profile?.image_url && typeof item.profile.image_url === 'string') {
    return item.profile.image_url;
  }

  // 5. High-quality fashion fallback
  return 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=80';
}

function getComparisonTitle(item: any): string {
  if (item.title && typeof item.title === 'string' && item.title.trim().length > 0) {
    return item.title.trim();
  }
  if (item.candidates && item.candidates.length > 0) {
    const bestCand = item.candidates.find(
      (c: any) => (c.retailer || c.platform)?.toLowerCase() === item.best_retailer?.toLowerCase()
    );
    if (bestCand?.title) return bestCand.title;
    if (item.candidates[0]?.title) return item.candidates[0].title;
  }
  return item.profile?.detected_title || item.match_label || 'Garment Item';
}

function getTryOnCardImageUri(item: any): string {
  if (!item) return 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=400&q=80';

  // 0. Direct permanent local disk paths (100% offline access)
  if (Array.isArray(item.local_image_paths) && item.local_image_paths.length > 0) {
    const localFirst = item.local_image_paths[0];
    if (typeof localFirst === 'string' && localFirst.trim().length > 0) {
      return localFirst.trim();
    }
  }

  // 1. Check thumbnail_url (local cached image URI or remote CDN thumbnail)
  if (item.thumbnail_url && typeof item.thumbnail_url === 'string' && item.thumbnail_url.trim().length > 0) {
    return item.thumbnail_url.trim();
  }

  // 2. Check result_image_urls array
  if (Array.isArray(item.result_image_urls) && item.result_image_urls.length > 0) {
    const first = item.result_image_urls[0];
    if (typeof first === 'string' && first.trim().length > 0) {
      return first.trim();
    }
    if (first && typeof first === 'object' && first.url && typeof first.url === 'string' && first.url.trim().length > 0) {
      return first.url.trim();
    }
  }

  // 3. Stringified result_image_urls
  if (typeof item.result_image_urls === 'string' && item.result_image_urls.trim().length > 0) {
    try {
      const parsed = JSON.parse(item.result_image_urls);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const pFirst = parsed[0];
        if (typeof pFirst === 'string' && pFirst.trim().length > 0) return pFirst.trim();
        if (pFirst && typeof pFirst === 'object' && pFirst.url) return pFirst.url.trim();
      }
    } catch {
      return item.result_image_urls.trim();
    }
  }

  // 4. Single result_image_url / result_url / image_url / url
  if (item.result_image_url && typeof item.result_image_url === 'string' && item.result_image_url.trim().length > 0) {
    return item.result_image_url.trim();
  }
  if (item.result_url && typeof item.result_url === 'string' && item.result_url.trim().length > 0) {
    return item.result_url.trim();
  }

  // 5. Garment image URLs as fallback
  if (item.garment_image_url && typeof item.garment_image_url === 'string' && item.garment_image_url.trim().length > 0) {
    return item.garment_image_url.trim();
  }
  if (Array.isArray(item.garment_images) && item.garment_images.length > 0) {
    const gFirst = item.garment_images[0];
    if (typeof gFirst === 'string' && gFirst.trim().length > 0) return gFirst.trim();
    if (gFirst && typeof gFirst === 'object' && gFirst.url) return gFirst.url.trim();
  }

  // 6. Generic fields
  if (item.image_url && typeof item.image_url === 'string' && item.image_url.trim().length > 0) {
    return item.image_url.trim();
  }
  if (item.image && typeof item.image === 'string' && item.image.trim().length > 0) {
    return item.image.trim();
  }

  return 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=400&q=80';
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();

  // Hero image geometry, as fractions of screen width, measured for Hero-image1.PNG (1196x1315).
  // Flush with the top and left edges (left: 0, top: 0) so the warm wall seamlessly
  // flows behind the status bar, logo, and title without any seam or edge bands,
  // while the bronze rack and hanging shirts bleed gracefully off the right edge of the screen.
  const heroW = screenW * 1.15;
  const heroH = heroW * (1315 / 1196);
  const heroLeft = 0;
  const heroTop = 0;
  const pedestalBaseY = heroTop + heroH * (1250 / 1315);
  // Header + title block height so the URL pill (marginTop 10) starts at the pedestal base.
  const heroTextAreaHeight = pedestalBaseY - 10;

  const [url, setUrl] = useState('');
  const storedComparisons = usePriceComparisonStore((s) => s.comparisons);
  const recentComparisons = storedComparisons.slice(0, 4);
  const [cachedTryons, setCachedTryons] = useState<TryOnHistoryItem[]>([]);
  const { generatedLooks, savedLooks, fetchLooks, toggleSave: toggleLookSave, loading: looksLoading } = useLooksStore();

  const allLooks = React.useMemo(() => {
    const map = new Map<string, TryOnHistoryItem>();
    [...generatedLooks, ...savedLooks, ...cachedTryons].forEach((item) => {
      if (item && item.id && !map.has(item.id)) {
        map.set(item.id, item);
      }
    });
    return Array.from(map.values());
  }, [generatedLooks, savedLooks, cachedTryons]);

  const recentTryons = allLooks.slice(0, 8);
  const router = useRouter();
  const params = useLocalSearchParams<{ error?: string }>();
  
  const setSourceUrl = useSession((s) => s.setSourceUrl);
  const setProductImageUri = useSession((s) => s.setProductImageUri);
  const setExtractedProduct = useSession((s) => s.setExtractedProduct);
  const setProductId = useSession((s) => s.setProductId);
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

  // One-time cleanup: wipe legacy visual-search comparison history so it starts 100% fresh
  useEffect(() => {
    async function purgeLegacyComparisons() {
      try {
        const isPurged = await AsyncStorage.getItem('fitme_legacy_comparisons_purged_v2');
        if (!isPurged) {
          await usePriceComparisonStore.getState().clearAll();
          await AsyncStorage.removeItem('fitme_home_recent_comparisons');
          await AsyncStorage.setItem('fitme_legacy_comparisons_purged_v2', 'true');
        }
      } catch (e) {
        console.warn('Could not purge legacy comparisons:', e);
      }
    }
    purgeLegacyComparisons();
  }, []);

  // Keep local cachedTryons in sync with store while preserving titles & platforms
  useEffect(() => {
    const list = generatedLooks.length > 0 ? generatedLooks : savedLooks;
    if (list.length > 0) {
      setCachedTryons((prev) => {
        const prevMap = new Map(prev.map((item) => [item.id, item]));
        const merged = list.slice(0, 8).map((item) => ({
          ...item,
          title: item.title || prevMap.get(item.id)?.title || null,
          platform: item.platform || prevMap.get(item.id)?.platform || null,
        }));
        AsyncStorage.setItem('fitme_home_recent_tryons', JSON.stringify(merged)).catch(() => {});
        return merged;
      });
    }
  }, [generatedLooks, savedLooks]);

  // Instant load from mobile device storage on mount
  useEffect(() => {
    let isMounted = true;
    async function loadFromCache() {
      try {
        const cachedTry = await AsyncStorage.getItem('fitme_home_recent_tryons');
        if (isMounted && cachedTry) {
          const t = JSON.parse(cachedTry);
          if (Array.isArray(t)) setCachedTryons(t);
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
      fetchLooks(false).catch((err) => {
        console.log('[Home] Recent try-ons load status:', err?.message || err);
      });
    }, [fetchLooks])
  );

  const handleUrlChange = (text: string) => {
    const normalized = normalizeProductUrl(text);
    // If pasting formatted text (e.g. Markdown link or text with URL), normalize in input field immediately
    const nextVal = (text.includes('[http') || (text.includes('http') && !text.trim().startsWith('http')))
      ? normalized
      : text;
    setUrl(nextVal);
    if (inlineMsg) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      fadeAnim.setValue(0);
      setInlineMsg(null);
    }
  };

  const handleClearUrl = () => {
    setUrl('');
    if (inlineMsg) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      fadeAnim.setValue(0);
      setInlineMsg(null);
    }
  };

  const handleTryOn = () => {
    Keyboard.dismiss();
    const normalized = normalizeProductUrl(url);
    if (!normalized || !/^https?:\/\//i.test(normalized)) {
      showMessage('Please paste a product link to continue.');
      return;
    }
    setExtractedProduct(null);
    setProductImageUri(null);
    setSourceUrl(normalized);
    router.push('/import');
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Enable camera access to take a photo of a product.');
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
    });
    if (!result.canceled && result.assets[0]) {
      setExtractedProduct(null);
      setSourceUrl(null);
      setProductId('');
      setProductImageUri(result.assets[0].uri);
      router.push('/import');
    }
  };

  const uploadPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Enable photo access to choose a product image.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
    });
    if (!result.canceled && result.assets[0]) {
      setExtractedProduct(null);
      setSourceUrl(null);
      setProductId('');
      setProductImageUri(result.assets[0].uri);
      router.push('/import');
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>

        {SHOW_EDITORIAL_HERO ? (
          /* Editorial Arch Hero (Image-2) */
          <View style={styles.editorialHeroContainer}>
            {/* Hero image positioned to match the Image-2 mockup (geometry measured from mockup) */}
            <Image
              source={require('../../assets/hero-image1.png')}
              style={{ position: 'absolute', top: heroTop, left: heroLeft, width: heroW, height: heroH }}
              resizeMode="cover"
              fadeDuration={0}
            />


            {/* Header + title area; height chosen so the URL pill sits at the pedestal base */}
            <View style={{ minHeight: heroTextAreaHeight }}>
              <View style={[styles.header, { paddingTop: Math.max(insets.top, 14), paddingHorizontal: Spacing.xl }]}>
                <View style={styles.logoRow}>
                  <Logo size={28} />
                  {isPremium && <ProMemberBadge variant="compact" />}
                </View>
              </View>

              {/* Editorial Title & Eyebrow */}
              <View style={styles.editorialTextContent}>
                <View style={styles.editorialEyebrowRow}>
                  <Text style={styles.editorialEyebrow}>AI TRY-ON</Text>
                  <View style={styles.editorialEyebrowLine} />
                </View>
                <View style={styles.editorialTitleGroup}>
                  <Text style={styles.editorialTitle}>See it</Text>
                  <Text style={styles.editorialTitleAccent}>on you.</Text>
                </View>
              </View>
            </View>

            {/* Floating URL Input Pill */}
            <View style={[styles.editorialUrlPill, !!inlineMsg && { borderColor: Colors.destructive, borderWidth: 1 }]}>
              <Ionicons name="link-outline" size={18} color={Colors.mutedForeground} style={{ marginLeft: 16 }} />
              <TextInput
                ref={urlInputRef}
                style={styles.editorialUrlInput}
                placeholder="Paste a product URL"
                placeholderTextColor={Colors.mutedForeground}
                value={url}
                onChangeText={handleUrlChange}
                autoCapitalize="none"
                returnKeyType="go"
                onSubmitEditing={handleTryOn}
              />
              {url.length > 0 && (
                <TouchableOpacity
                  style={styles.editorialClearBtn}
                  onPress={handleClearUrl}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear URL"
                >
                  <Ionicons name="close" size={13} color={Colors.mutedForeground} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.editorialArrowBtn}
                onPress={handleTryOn}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Try on"
              >
                <Ionicons name="arrow-forward" size={18} color={Colors.primaryForeground} />
              </TouchableOpacity>
            </View>

            {/* Inline validation/error message */}
            {inlineMsg && (
              <Animated.View style={[styles.inlineMsgRow, { opacity: fadeAnim, marginHorizontal: Spacing.xl }]}>
                <Ionicons name="information-circle-outline" size={14} color={Colors.destructive} />
                <Text style={styles.inlineMsgText}>{inlineMsg}</Text>
              </Animated.View>
            )}

            {/* Manual photo upload tiles: Take photo & Upload photo */}
            <View style={styles.editorialActionRow}>
              <TouchableOpacity
                style={styles.editorialActionTile}
                onPress={takePhoto}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Take photo"
              >
                <Ionicons name="camera-outline" size={24} color={Colors.accent} />
                <Text style={styles.editorialActionTileText}>Take photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.editorialActionTile}
                onPress={uploadPhoto}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Upload photo"
              >
                <Ionicons name="image-outline" size={24} color={Colors.accent} />
                <Text style={styles.editorialActionTileText}>Upload photo</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Original Layout */
          <>
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 14) }]}>
              <View style={styles.logoRow}>
                <Logo size={28} />
                {isPremium && <ProMemberBadge variant="compact" />}
              </View>
            </View>

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
                {url.length > 0 && (
                  <TouchableOpacity
                    style={styles.editorialClearBtn}
                    onPress={handleClearUrl}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Clear URL"
                  >
                    <Ionicons name="close" size={13} color={Colors.mutedForeground} />
                  </TouchableOpacity>
                )}
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
          </>
        )}


        {/* Recent try-ons */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent try-ons</Text>
            <TouchableOpacity
              style={styles.seeAllRow}
              activeOpacity={0.7}
              hitSlop={{ top: 16, bottom: 16, left: 24, right: 16 }}
              onPress={() => router.navigate('/(tabs)/looks')}
            >
              <Text style={styles.seeAllText}>See all</Text>
              <Ionicons name="arrow-forward" size={12} color={Colors.accent} />
            </TouchableOpacity>
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
                const imgUri = getTryOnCardImageUri(p);
                return (
                  <Link
                    href={{
                      pathname: '/result',
                      params: {
                        jobId: p.id,
                        initialTitle: p.title || (p.brand && p.brand !== 'FitMe' ? `${p.brand} Look` : (p.saved_photo_name ? `Look with ${p.saved_photo_name}` : '')),
                        initialBrand: p.brand || '',
                        initialPlatform: p.platform || '',
                        initialResultUrl: p.result_image_urls?.[0] || p.thumbnail_url || imgUri || '',
                        initialGarmentUrl: p.garment_image_url || '',
                        initialPrice: p.price !== null && p.price !== undefined ? String(p.price) : '',
                        initialProductUrl: p.product_url || '',
                      },
                    } as any}
                    key={p.id}
                    asChild
                  >
                    <TouchableOpacity style={styles.productCard} activeOpacity={0.85}>
                      <CachedImage uri={imgUri} style={styles.productImg} />
                      <View style={styles.productInfo}>
                        <View style={styles.productTitleRow}>
                          <Text style={styles.productTitle} numberOfLines={1} ellipsizeMode="tail">
                            {p.title || (p.brand && p.brand !== 'FitMe' ? `${p.brand} Look` : (p.saved_photo_name ? `Look with ${p.saved_photo_name}` : 'Virtual Look'))}
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
        {ENABLE_RECENT_PRICE_COMPARISONS && (
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
                  Tap 'Compare prices' on any generated try-on to find and compare deals across stores.
                </Text>
                <TouchableOpacity
                  style={styles.emptyCompBtn}
                  onPress={() => router.push('/(tabs)/looks' as any)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.emptyCompBtnText}>View Your Looks</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.compMasonry}>
                <View style={styles.compCol}>
                  {recentComparisons.filter((_, i) => i % 2 === 0).map((item) => (
                    <Link
                      href={`/find-product/results?comparisonId=${item.id}${item.scan_id ? `&scanId=${item.scan_id}` : ''}` as any}
                      key={item.id}
                      asChild
                    >
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
                    <Link
                      href={`/find-product/results?comparisonId=${item.id}${item.scan_id ? `&scanId=${item.scan_id}` : ''}` as any}
                      key={item.id}
                      asChild
                    >
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
        )}

      </ScrollView>
    </View>
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

  bellBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  heroCard: { backgroundColor: '#EFE4D7', borderRadius: Radii.xxl, padding: Spacing.xl, paddingTop: Spacing.xxl, marginBottom: Spacing.xl },
  heroEyebrow: { fontSize: 10, letterSpacing: 3, color: Colors.mutedForeground, textTransform: 'uppercase', marginBottom: 8 },
  heroTitle: { fontFamily: Fonts.display, fontSize: 34, color: Colors.foreground, lineHeight: 40, marginBottom: 10 },
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

  /* Editorial Arch Hero Styles (Image-2) */
  editorialHeroContainer: {
    marginHorizontal: -Spacing.xl,
    position: 'relative',
    paddingBottom: Spacing.md,
    marginBottom: Spacing.xl,
    overflow: 'hidden',
  },
  editorialHeroBgImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '120%',
    aspectRatio: 1086 / 1448,
  },

  editorialTextContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: 62,
    paddingBottom: 4,
    minHeight: 160,
    justifyContent: 'flex-start',
  },
  editorialEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  editorialEyebrow: {
    fontSize: 10,
    letterSpacing: 2.5,
    color: Colors.mutedForeground,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  editorialEyebrowLine: {
    width: 24,
    height: 1,
    backgroundColor: Colors.mutedForeground,
  },
  editorialTitleGroup: {
    gap: 0,
  },
  editorialTitle: {
    fontFamily: Fonts.display,
    fontSize: 46,
    color: Colors.foreground,
    lineHeight: 46,
    letterSpacing: -0.5,
  },
  editorialTitleAccent: {
    fontFamily: Fonts.displayItalic,
    fontSize: 46,
    color: Colors.accent,
    lineHeight: 46,
    letterSpacing: -0.5,
    marginTop: -7,
  },
  editorialUrlPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    marginHorizontal: Spacing.xl,
    borderRadius: Radii.full,
    height: 52,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#1A1410',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    marginTop: 10,
  },
  editorialUrlInput: {
    flex: 1,
    fontSize: 13,
    color: Colors.foreground,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 8,
  },
  editorialClearBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  editorialArrowBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.20,
    shadowRadius: 4,
    elevation: 2,
  },
  editorialActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: Spacing.xl,
    marginTop: 14,
  },
  editorialActionTile: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#1A1410',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  editorialActionTileText: {
    fontSize: 12.5,
    fontWeight: '500',
    color: Colors.foreground,
  },

  section: { marginBottom: Spacing.xxl },
  sectionLabel: { fontSize: 10, letterSpacing: 2, color: Colors.mutedForeground, textTransform: 'uppercase', marginBottom: 10 },
  chipsScroll: { marginHorizontal: -Spacing.xl, paddingHorizontal: Spacing.xl },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.card, borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8 },
  chipText: { fontSize: 12, color: Colors.foreground },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontFamily: Fonts.display, fontSize: 20, color: Colors.foreground },
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
    fontFamily: Fonts.display,
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
