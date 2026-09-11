import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, Animated, Easing, Alert, Image, ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { AppHeader } from '../../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../../src/constants/theme';
import { useSession } from '../../src/services/session';
import { productIntelligenceApi } from '../../src/services/api';

export default function FindProductSearching() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    garmentUri?: string;
    tagUri?: string;
    userBrand?: string;
    userTitle?: string;
  }>();
  const sessionProductImageUri = useSession((s) => s.productImageUri);
  const sessionProductImageBase64 = useSession((s) => s.productImageBase64);
  const [step, setStep] = useState(1);
  const spinValue = useRef(new Animated.Value(0)).current;
  const pulseValue = useRef(new Animated.Value(1)).current;

  const garmentImageUri = params.garmentUri || sessionProductImageUri;

  useEffect(() => {
    // Spin animation for circular scanner ring
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 3200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Subtle pulse animation for center garment image
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          toValue: 1.025,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseValue, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    let isMounted = true;

    async function executeScan() {
      try {
        const imageUri = params.garmentUri || sessionProductImageUri;
        let imageBase64 = sessionProductImageBase64 || '';
        let mime = 'image/jpeg';

        if (!imageBase64 && imageUri) {
          if (imageUri.startsWith('data:image')) {
            const parts = imageUri.split(',');
            imageBase64 = parts[1] || '';
            const mimeMatch = parts[0].match(/:(.*?);/);
            if (mimeMatch) mime = mimeMatch[1];
          } else if (imageUri.startsWith('file://') || imageUri.startsWith('/')) {
            try {
              imageBase64 = await FileSystem.readAsStringAsync(imageUri, {
                encoding: FileSystem.EncodingType.Base64,
              });
            } catch (readErr) {
              console.warn('Could not read image file as base64:', readErr);
            }
          }
        }

        // Fallback for simulator or missing image: provide dummy base64
        if (!imageBase64) {
          imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        }

        let tagBase64: string | undefined = undefined;
        if (params.tagUri && (params.tagUri.startsWith('file://') || params.tagUri.startsWith('/'))) {
          try {
            tagBase64 = await FileSystem.readAsStringAsync(params.tagUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
          } catch (tErr) {
            console.warn('Could not read tag photo as base64:', tErr);
          }
        }

        if (isMounted) setStep(1); // Image uploaded

        // Call real Product Intelligence Scan API with optional user brand & title
        const scanRes = await productIntelligenceApi.scan({
          image_base64: imageBase64,
          mime,
          source: 'camera',
          tag_image_base64: tagBase64,
          user_brand: params.userBrand || undefined,
          user_title: params.userTitle || undefined,
        });

        if (isMounted) setStep(2); // Analyzing garment

        // Poll for scan completion
        const scanId = scanRes.scan_id;
        const maxAttempts = 30;
        let attempts = 0;
        let completed = false;

        while (attempts < maxAttempts && !completed && isMounted) {
          await new Promise((r) => setTimeout(r, 600));
          attempts++;

          if (attempts === 2 && isMounted) setStep(3); // Matching products
          if (attempts === 4 && isMounted) setStep(4); // Getting best results

          const statusRes = await productIntelligenceApi.getStatus(scanId);
          if (statusRes.status === 'done') {
            completed = true;
            if (isMounted) {
              setStep(4);
              setTimeout(() => {
                router.replace({
                  pathname: '/find-product/results',
                  params: { scanId },
                } as any);
              }, 400);
            }
            break;
          } else if (statusRes.status === 'error') {
            throw new Error(statusRes.error || 'Scan processing failed');
          }
        }

        if (!completed && isMounted) {
          // If still processing after polling window, navigate with scanId so results can poll
          router.replace({
            pathname: '/find-product/results',
            params: { scanId },
          } as any);
        }
      } catch (err: any) {
        console.error('Visual search scan error:', err);
        if (isMounted) {
          Alert.alert(
            'Search Error',
            err?.message || 'Could not complete visual search. Please try again.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
        }
      }
    }

    executeScan();

    return () => {
      isMounted = false;
    };
  }, []);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const stepsData = [
    {
      id: 1,
      title: 'Image uploaded',
      subtitle: 'Image received successfully',
    },
    {
      id: 2,
      title: 'Analyzing garment',
      subtitle: 'Detecting colors, pattern & style',
    },
    {
      id: 3,
      title: 'Matching products',
      subtitle: 'Searching across top fashion stores',
    },
    {
      id: 4,
      title: 'Getting best results',
      subtitle: 'Comparing prices & deals',
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header matching Image 2 */}
      <AppHeader title="Finding similar products" back right={null} />
      <Text style={styles.headerSubtitle}>We're finding the best deals for you ✨</Text>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Central Scanner Composition (Image 2) */}
        <View style={styles.scannerWrapper}>
          {/* Outer Dashed Ring */}
          <View style={styles.dashedOuterRing} />

          {/* Animated Spinning Progress Arc Ring */}
          <Animated.View style={[styles.spinRing, { transform: [{ rotate: spin }] }]} />

          {/* Inner Circle Container holding actual Garment Photo */}
          <Animated.View style={[styles.centerGarmentBox, { transform: [{ scale: pulseValue }] }]}>
            {garmentImageUri ? (
              <Image
                source={{ uri: garmentImageUri }}
                style={styles.garmentImage}
                resizeMode="cover"
              />
            ) : (
              <Ionicons name="shirt-outline" size={54} color="#A86248" />
            )}
          </Animated.View>

          {/* Floating Decorative Badges (Image 2) */}
          <View style={[styles.floatingBadge, styles.badgeTopLeft]}>
            <Ionicons name="search-outline" size={18} color="#B86B4D" />
          </View>
          <View style={[styles.floatingBadge, styles.badgeTopRight]}>
            <Ionicons name="pricetag-outline" size={18} color="#B86B4D" />
          </View>
          <View style={[styles.floatingBadge, styles.badgeBottomLeft]}>
            <Ionicons name="bag-handle-outline" size={18} color="#B86B4D" />
          </View>
          <View style={[styles.floatingBadge, styles.badgeBottomRight]}>
            <Ionicons name="shirt-outline" size={18} color="#B86B4D" />
          </View>

          {/* Decorative Sparkles */}
          <Text style={[styles.sparkleText, { top: 46, left: 2 }]}>✦</Text>
          <Text style={[styles.sparkleText, { top: 110, right: 2 }]}>✨</Text>
        </View>

        {/* Main Status Text */}
        <Text style={styles.searchingTitle}>Scanning & searching...</Text>
        <Text style={styles.searchingSub}>This may take a few seconds.</Text>

        {/* Progress Checklist Card (Image 2) */}
        <View style={styles.progressCard}>
          {stepsData.map((item, idx) => {
            const isCompleted = step > item.id;
            const isActive = step === item.id;
            const isLast = idx === stepsData.length - 1;

            return (
              <View key={item.id} style={styles.stepRowWrapper}>
                {/* Connecting Line between steps */}
                {!isLast && (
                  <View
                    style={[
                      styles.connectingLine,
                      isCompleted && styles.connectingLineActive,
                    ]}
                  />
                )}

                {/* Left Column: Step Indicator Icon */}
                <View style={styles.indicatorCol}>
                  {isCompleted ? (
                    <View style={styles.completedCircle}>
                      <Ionicons name="checkmark" size={13} color="#FFFFFF" />
                    </View>
                  ) : isActive ? (
                    <View style={styles.activeCircle}>
                      <View style={styles.activeInnerDot} />
                    </View>
                  ) : (
                    <View style={styles.pendingCircle} />
                  )}
                </View>

                {/* Middle Column: Title & Subtitle */}
                <View style={styles.stepTextCol}>
                  <Text
                    style={[
                      styles.stepTitle,
                      (isCompleted || isActive) && styles.stepTitleActive,
                    ]}
                  >
                    {item.title}
                  </Text>
                  <Text style={styles.stepSub}>{item.subtitle}</Text>
                </View>

                {/* Right Column: Green Checkmark for completed steps */}
                <View style={styles.rightCheckCol}>
                  {isCompleted && (
                    <Ionicons name="checkmark" size={18} color="#5A8A60" />
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* Bottom Promotional Card ("Great deals ahead!") */}
        <View style={styles.promoCard}>
          <View style={styles.promoLeft}>
            <View style={styles.promoIconBadge}>
              <Ionicons name="pricetag-outline" size={20} color="#C86D51" />
            </View>
            <View style={styles.promoTextGroup}>
              <Text style={styles.promoTitle}>Great deals ahead!</Text>
              <Text style={styles.promoSub}>
                We find the best prices so{'\n'}you don't have to.
              </Text>
            </View>
          </View>

          {/* Right Side Shopping Bag Illustration */}
          <View style={styles.promoBagGroup}>
            <View style={styles.bagBody}>
              <Ionicons name="bag-handle" size={38} color="#E0A48D" />
            </View>
            <Ionicons name="sparkles" size={13} color="#D88A6E" style={styles.promoBagSparkle} />
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#95897A',
    textAlign: 'center',
    marginTop: -4,
    marginBottom: 8,
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxl,
    alignItems: 'center',
  },

  /* Scanner Composition */
  scannerWrapper: {
    width: 240,
    height: 240,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 8,
    position: 'relative',
  },
  dashedOuterRing: {
    position: 'absolute',
    width: 236,
    height: 236,
    borderRadius: 118,
    borderWidth: 1.5,
    borderColor: '#E8DACD',
    borderStyle: 'dashed',
  },
  spinRing: {
    position: 'absolute',
    width: 206,
    height: 206,
    borderRadius: 103,
    borderWidth: 6,
    borderColor: '#F6ECE2',
    borderTopColor: '#C86D51',
    borderRightColor: '#C86D51',
  },
  centerGarmentBox: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#FFFDFB',
    borderWidth: 1,
    borderColor: '#F0E5D8',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#A86248',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
    overflow: 'hidden',
  },
  garmentImage: {
    width: 160,
    height: 160,
    borderRadius: 80,
  },

  /* Floating Badges */
  floatingBadge: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFDFB',
    borderWidth: 1,
    borderColor: '#F0E5D8',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  badgeTopLeft: { top: 8, left: 8 },
  badgeTopRight: { top: 8, right: 8 },
  badgeBottomLeft: { bottom: 8, left: 8 },
  badgeBottomRight: { bottom: 8, right: 8 },
  sparkleText: {
    position: 'absolute',
    fontSize: 14,
    color: '#D89E82',
  },

  /* Status Text */
  searchingTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.foreground,
    marginTop: 8,
    marginBottom: 4,
    textAlign: 'center',
  },
  searchingSub: {
    fontSize: 13,
    color: Colors.mutedForeground,
    textAlign: 'center',
    marginBottom: 18,
  },

  /* Progress Checklist Card */
  progressCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE7DC',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  stepRowWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    position: 'relative',
  },
  connectingLine: {
    position: 'absolute',
    left: 11,
    top: 30,
    height: 28,
    width: 1.5,
    backgroundColor: '#EFE7DC',
    zIndex: 0,
  },
  connectingLineActive: {
    backgroundColor: '#8C533E',
  },
  indicatorCol: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  completedCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#8C533E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#8C533E',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeInnerDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#8C533E',
  },
  pendingCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#D8CEBE',
    backgroundColor: 'transparent',
  },
  stepTextCol: {
    flex: 1,
    paddingLeft: 12,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#998E80',
  },
  stepTitleActive: {
    fontWeight: '700',
    color: '#1C1C1E',
  },
  stepSub: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
  rightCheckCol: {
    width: 24,
    alignItems: 'flex-end',
  },

  /* Bottom Promotional Card */
  promoCard: {
    width: '100%',
    backgroundColor: '#FFF5ED',
    borderWidth: 1,
    borderColor: '#F2E4D8',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  promoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  promoIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE3D8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  promoTextGroup: {
    flex: 1,
  },
  promoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  promoSub: {
    fontSize: 12,
    color: '#8E8E93',
    lineHeight: 16,
    marginTop: 2,
  },
  promoBagGroup: {
    position: 'relative',
    paddingLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bagBody: {
    padding: 2,
  },
  promoBagSparkle: {
    position: 'absolute',
    top: -2,
    right: -2,
  },
});
