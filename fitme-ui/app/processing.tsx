import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Image, Animated, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii, Fonts } from '../src/constants/theme';
import * as FileSystem from 'expo-file-system';
import { useSession } from '../src/services/session';
import { scanApi, tryOnApi, savedPhotosApi, ApiError } from '../src/services/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const VIDEO_SIZE = Math.min(SCREEN_WIDTH * 0.78, SCREEN_HEIGHT * 0.34, 320);

interface StyleTip {
  eyebrow: string;
  before: string;
  italic: string;
  after: string;
  image: any;
}

const STYLE_TIPS: StyleTip[] = [
  {
    eyebrow: 'STYLE TIP',
    before: 'Tailored shoulders balance a ',
    italic: 'relaxed',
    after: ' silhouette.',
    image: require('../assets/images/tip-1.png'),
  },
  {
    eyebrow: 'STYLE TIP',
    before: 'Monochrome tones elongate with an ',
    italic: 'effortless',
    after: ' line.',
    image: require('../assets/images/tip-2.png'),
  },
  {
    eyebrow: 'STYLE TIP',
    before: 'Structured waistlines create a balanced, ',
    italic: 'flattering',
    after: ' drape.',
    image: require('../assets/images/tip-3.png'),
  },
];

export default function Processing() {
  const [progress, setProgress] = useState(5);
  const [statusText, setStatusText] = useState('Uploading photo...');
  const [errorType, setErrorType] = useState<'upload' | 'tryon' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [tipIndex, setTipIndex] = useState(0);
  const tipFadeAnim = useRef(new Animated.Value(1)).current;

  const targetProgressRef = useRef(15);
  const pipelineStartedRef = useRef(false);
  const isPipelineRunningRef = useRef(false);
  const router = useRouter();

  const productId = useSession((s) => s.productId);
  const setProductId = useSession((s) => s.setProductId);
  const localPhotoUri = useSession((s) => s.localPhotoUri);
  const setLocalPhotoUri = useSession((s) => s.setLocalPhotoUri);
  const savedPhotoId = useSession((s) => s.savedPhotoId);
  const setSavedPhotoId = useSession((s) => s.setSavedPhotoId);
  const setSavedPhotoName = useSession((s) => s.setSavedPhotoName);
  const scanId = useSession((s) => s.scanId);
  const setScanId = useSession((s) => s.setScanId);
  const setTryOnJobId = useSession((s) => s.setTryOnJobId);
  const setResultImageUrls = useSession((s) => s.setResultImageUrls);

  // Smooth continuous progress ticker so the screen NEVER feels frozen or stuck
  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) return 100;

        if (Platform.OS === 'android') {
          const target = targetProgressRef.current;
          if (prev < target) {
            const diff = target - prev;
            const step = Math.max(0.3, diff * 0.1);
            return Math.min(target, prev + step);
          } else if (prev < 99) {
            // Asymptotic creep towards 99% ceiling so Android progress is continuously active during VTON inference
            const creep = Math.max(0.04, (99 - prev) * 0.02);
            return Math.min(99, prev + creep);
          }
          return prev;
        }

        // Original iOS ticker behavior (UNTOUCHED)
        const target = targetProgressRef.current;
        if (prev < target) {
          const diff = target - prev;
          const step = Math.max(0.4, diff * 0.12);
          return Math.min(target, prev + step);
        } else if (target < 95 && prev < 95) {
          return prev + 0.18;
        }
        return prev;
      });
    }, 75);
    return () => clearInterval(interval);
  }, []);

  // Dynamic status text update as progress advances
  useEffect(() => {
    if (progress >= 95) {
      setStatusText('Finishing touches...');
    } else if (progress >= 85) {
      setStatusText('Blending lighting & shadows...');
    } else if (progress >= 70) {
      setStatusText('Fitting fabric & drape...');
    } else if (progress >= 55) {
      setStatusText('Generating AI Try-On...');
    } else if (progress >= 30) {
      setStatusText('Preparing garment & texture...');
    } else if (progress >= 10) {
      setStatusText('Uploading photo...');
    }
  }, [progress]);

  const params = useLocalSearchParams<{ preview?: string }>();

  // Redirect if no local photo URI and no existing scanId and no savedPhotoId
  useEffect(() => {
    if (params.preview === '1') return;
    if (!localPhotoUri && !scanId && !savedPhotoId) {
      router.replace('/upload-photo');
    }
  }, [localPhotoUri, scanId, savedPhotoId, params.preview]);

  const handleNextTip = () => {
    Animated.timing(tipFadeAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setTipIndex((prev) => (prev + 1) % STYLE_TIPS.length);
      Animated.timing(tipFadeAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    });
  };

  useEffect(() => {
    const timer = setInterval(() => {
      handleNextTip();
    }, 4500);
    return () => clearInterval(timer);
  }, []);

  const startPipeline = async () => {
    if (isPipelineRunningRef.current) {
      console.log('⚠️ [CLIENT] startPipeline() already running, skipping duplicate invocation.');
      return;
    }
    isPipelineRunningRef.current = true;

    const t0 = performance.now();
    const t0Date = new Date();
    const formatTime = (d: Date | null) => d ? d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0') : '-';

    let t1GarmentStart = 0;
    let t1Date: Date | null = null;
    let t2GarmentEnd = 0;
    let t2Date: Date | null = null;

    let t3UserStart = 0;
    let t3Date: Date | null = null;
    let t4UserEnd = 0;
    let t4Date: Date | null = null;

    let t5TryOnStart = 0;
    let t5Date: Date | null = null;
    let t6TryOnEnd = 0;
    let t6Date: Date | null = null;

    let t7ProcessStart = 0;
    let t7Date: Date | null = null;
    let t8DisplayEnd = 0;
    let t8Date: Date | null = null;

    console.log(`⏱️ [CLIENT TIMING] T0 Processing screen mounted at ${formatTime(t0Date)}`);
    setErrorType(null);
    setErrorMsg(null);

    let activeScanId = scanId;
    let activeSavedPhotoId = savedPhotoId;
    let activeProductId = productId;

    try {
      // 1. Concurrently resolve Garment Registration & User Photo Upload in parallel
      targetProgressRef.current = 25;

      const garmentPromise = useSession.getState().garmentRegistrationPromise;

      const garmentTask = (async () => {
        t1GarmentStart = performance.now();
        t1Date = new Date();
        if (garmentPromise) {
          try {
            const gRes = await garmentPromise;
            if (gRes?.product_id) {
              activeProductId = gRes.product_id;
              setProductId(gRes.product_id);
            }
          } catch (gErr: any) {
            console.error('[PROCESSING] Garment registration failed:', gErr);
            throw gErr;
          } finally {
            useSession.getState().setGarmentRegistrationPromise(null);
          }
        }
        t2GarmentEnd = performance.now();
        t2Date = new Date();
        if (!activeProductId) {
          throw new Error('Garment product reference is missing.');
        }
        return activeProductId;
      })();

      const userPhotoTask = (async () => {
        t3UserStart = performance.now();
        t3Date = new Date();
        if (localPhotoUri) {
          activeSavedPhotoId = null;
          activeScanId = null;

          const inFlightPhotoPromise = useSession.getState().userPhotoUploadPromise;
          let savedRes: any;

          if (inFlightPhotoPromise) {
            savedRes = await inFlightPhotoPromise;
          } else {
            savedRes = await savedPhotosApi.upload(localPhotoUri);
          }

          // Clean up in-flight promise reference
          useSession.getState().setUserPhotoUploadPromise(null);

          if (savedRes?.id) {
            activeSavedPhotoId = savedRes.id;
            setSavedPhotoId(savedRes.id);
            setSavedPhotoName(savedRes.display_name);
            if (savedRes.scan_id) {
              activeScanId = savedRes.scan_id;
              setScanId(activeScanId);
            }
          }
          setLocalPhotoUri(null);
        } else {
          useSession.getState().setUserPhotoUploadPromise(null);
        }
        t4UserEnd = performance.now();
        t4Date = new Date();
        return { activeSavedPhotoId, activeScanId };
      })();

      const [resolvedProductId, resolvedPhoto] = await Promise.all([garmentTask, userPhotoTask]);
      activeProductId = resolvedProductId;
      activeSavedPhotoId = resolvedPhoto.activeSavedPhotoId;
      activeScanId = resolvedPhoto.activeScanId;

      // 2. Prepare garment & Start Try-On Job (using activeScanId and/or activeSavedPhotoId)
      if ((activeScanId || activeSavedPhotoId) && activeProductId) {
        targetProgressRef.current = 48;

        t5TryOnStart = performance.now();
        t5Date = new Date();
        const startRes = await tryOnApi.start(activeScanId, activeProductId, activeSavedPhotoId);
        t6TryOnEnd = performance.now();
        t6Date = new Date();
        const job_id = startRes.job_id;
        setTryOnJobId(job_id);

        let finalResultUrls: string[] = [];

        // Direct Fast-Path: if /tryon/start returned completed image URLs directly, use them immediately
        if (startRes.result_image_urls && startRes.result_image_urls.length > 0) {
          finalResultUrls = startRes.result_image_urls;
        } else {
          // Fallback Polling Path: if async/queued or result URLs absent in /start, poll as fallback
          targetProgressRef.current = 75;
          let pollCount = 0;
          const tp0 = performance.now();
          const result = await tryOnApi.waitForResult(job_id, (status) => {
            pollCount++;
            const tNow = performance.now();
            console.log(`⏱️ [CLIENT TELEMETRY] Poll #${pollCount} @ T+${((tNow - tp0)/1000).toFixed(2)}s -> status: ${status.status}`);
            if (status.status === 'queued') {
              targetProgressRef.current = Math.max(targetProgressRef.current, 55);
            } else if (status.status === 'uploading') {
              targetProgressRef.current = Math.max(targetProgressRef.current, 65);
            } else if (status.status === 'processing') {
              const currentPct = status.progress_pct ?? 80;
              targetProgressRef.current = Math.max(targetProgressRef.current, currentPct);
            }
          });
          finalResultUrls = result.result_image_urls || [];
        }

        targetProgressRef.current = 100;
        setProgress(100);
        setStatusText('Your look is ready!');
        setResultImageUrls(finalResultUrls);

        t7ProcessStart = performance.now();
        t7Date = new Date();

        // Non-blocking background pre-cache
        if (finalResultUrls.length > 0) {
          const firstUrl = finalResultUrls[0];
          if (firstUrl && (firstUrl.startsWith('http://') || firstUrl.startsWith('https://'))) {
            try {
              const cacheFolder = `${FileSystem.cacheDirectory}fitme_img_cache/`;
              const cleanUrl = firstUrl.split('?')[0];
              let hash = 0;
              for (let i = 0; i < cleanUrl.length; i++) {
                hash = (hash << 5) - hash + cleanUrl.charCodeAt(i);
                hash |= 0;
              }
              const ext = cleanUrl.split('.').pop() || 'jpg';
              const localPath = `${cacheFolder}cached_${Math.abs(hash)}.${ext}`;
              FileSystem.downloadAsync(firstUrl, localPath).catch(() => {});
            } catch {
              // Ignore pre-cache error
            }
          }
        }

        t8DisplayEnd = performance.now();
        t8Date = new Date();

        const garmentDuration = ((t2GarmentEnd - t1GarmentStart) / 1000).toFixed(2);
        const userDuration = ((t4UserEnd - t3UserStart) / 1000).toFixed(2);
        const uploadsCombined = ((Math.max(t2GarmentEnd, t4UserEnd) - t0) / 1000).toFixed(2);
        const tryonNetworkDuration = ((t6TryOnEnd - t5TryOnStart) / 1000).toFixed(2);
        const preCacheDuration = ((t8DisplayEnd - t7ProcessStart) / 1000).toFixed(2);
        const totalPipelineDuration = ((t8DisplayEnd - t0) / 1000).toFixed(2);

        console.log(`
==================================================
TRYON TIMING - CLIENT
Processing mounted:       ${formatTime(t0Date)} (T+0.00s)
Garment upload start:     ${formatTime(t1Date)} (T+${((t1GarmentStart - t0) / 1000).toFixed(2)}s)
Garment upload end:       ${formatTime(t2Date)} (T+${((t2GarmentEnd - t0) / 1000).toFixed(2)}s)  (+${garmentDuration}s)
User upload start:        ${formatTime(t3Date)} (T+${((t3UserStart - t0) / 1000).toFixed(2)}s)
User upload end:          ${formatTime(t4Date)} (T+${((t4UserEnd - t0) / 1000).toFixed(2)}s)  (+${userDuration}s)
Both uploads finished:    T+${uploadsCombined}s
TryOn request start:      ${formatTime(t5Date)} (T+${((t5TryOnStart - t0) / 1000).toFixed(2)}s)
TryOn response received:  ${formatTime(t6Date)} (T+${((t6TryOnEnd - t0) / 1000).toFixed(2)}s)  (+${tryonNetworkDuration}s)
Result cache & display:   ${formatTime(t7Date)} -> ${formatTime(t8Date)}  (+${preCacheDuration}s)
--------------------------------------------------
TOTAL Processing -> Result: ${totalPipelineDuration}s
==================================================
`);

        setTimeout(() => router.replace({ pathname: '/result', params: { jobId: job_id } } as any), 450);
      }
    } catch (e) {
      console.error(e);
      isPipelineRunningRef.current = false;
      const isUploadError = !activeScanId && !savedPhotoId;
      setErrorType(isUploadError ? 'upload' : 'tryon');
      setErrorMsg(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : 'An unexpected error occurred.'));
    }
  };

  useEffect(() => {
    if (pipelineStartedRef.current) return;
    if (localPhotoUri || scanId || savedPhotoId) {
      pipelineStartedRef.current = true;
      startPipeline();
    }
  }, [localPhotoUri, scanId, savedPhotoId, productId]);

  const handleRetry = () => {
    isPipelineRunningRef.current = false;
    pipelineStartedRef.current = false;
    setErrorType(null);
    setErrorMsg(null);
    useSession.getState().setGarmentRegistrationPromise(null);
    useSession.getState().setUserPhotoUploadPromise(null);
    // Reset stale product ID if try-on failed so fresh registration occurs
    if (useSession.getState().productImageUri) {
      useSession.getState().setProductId('');
    }
    setTimeout(() => {
      pipelineStartedRef.current = true;
      startPipeline();
    }, 50);
  };

  const handleCancel = () => {
    // Clear state & navigate back to upload screen
    useSession.getState().setGarmentRegistrationPromise(null);
    useSession.getState().setUserPhotoUploadPromise(null);
    setLocalPhotoUri(null);
    setScanId(null);
    setSavedPhotoId(null);
    setSavedPhotoName(null);
    router.replace('/upload-photo');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Just a moment" back />
      <View style={styles.content}>
        {errorType ? (
          <View style={styles.errorContainer}>
            <View style={styles.errorIconWrap}>
              <Ionicons name="alert-circle-outline" size={48} color={Colors.destructive} />
            </View>
            <Text style={styles.errorTitle}>
              {errorType === 'upload' ? 'Upload failed.' : 'Unable to generate Try-On.'}
            </Text>
            <Text style={styles.errorDescription}>{errorMsg}</Text>

            <View style={styles.errorBtns}>
              <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
                <Text style={styles.cancelBtnText}>
                  {errorType === 'upload' ? 'Cancel' : 'Back'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.mainContainer}>
            <View style={styles.videoContainer}>
              <Video
                source={require('../assets/images/rendering-1.mp4')}
                style={styles.video}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                isLooping
                isMuted
                useNativeControls={false}
              />
            </View>

            <View style={styles.infoContainer}>
              <Text style={styles.percentText}>
                {Platform.OS === 'android'
                  ? (progress >= 100 ? 100 : Math.min(99, Math.floor(progress)))
                  : Math.min(100, Math.round(progress))}%
              </Text>
              <Text style={styles.statusText}>{statusText}</Text>

              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(100, Math.max(0, progress))}%` },
                  ]}
                />
              </View>
            </View>

            {/* Editorial Style Tip Card */}
            <View style={styles.cardContainer}>
              <TouchableOpacity
                style={styles.tipCard}
                onPress={handleNextTip}
                activeOpacity={0.92}
              >
                {/* Left Text Column */}
                <View style={styles.tipTextCol}>
                  <Text style={styles.tipEyebrow}>{STYLE_TIPS[tipIndex].eyebrow}</Text>

                  <Animated.View style={[styles.tipQuoteWrap, { opacity: tipFadeAnim }]}>
                    <Text style={styles.tipQuote}>
                      {STYLE_TIPS[tipIndex].before}
                      <Text style={styles.tipQuoteItalic}>{STYLE_TIPS[tipIndex].italic}</Text>
                      {STYLE_TIPS[tipIndex].after}
                    </Text>
                  </Animated.View>

                  {/* Pagination Dash Track */}
                  <View style={styles.paginationRow}>
                    <View style={styles.dashTrack}>
                      {STYLE_TIPS.map((_, i) => (
                        <View
                          key={i}
                          style={[
                            styles.dash,
                            i === tipIndex ? styles.dashActive : styles.dashInactive,
                          ]}
                        />
                      ))}
                    </View>
                  </View>
                </View>

                {/* Right Illustration Column with Smooth Fade Animation */}
                <View style={styles.illustrationCol} pointerEvents="none">
                  <Animated.Image
                    source={STYLE_TIPS[tipIndex].image}
                    style={[styles.illustrationImg, { opacity: tipFadeAnim }]}
                    resizeMode="contain"
                  />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
  },
  mainContainer: {
    flex: 1,
    alignItems: 'center',
    paddingTop: Spacing.xs,
  },
  videoContainer: {
    width: VIDEO_SIZE,
    height: VIDEO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  video: {
    width: VIDEO_SIZE,
    height: VIDEO_SIZE,
  },
  infoContainer: {
    width: '100%',
    paddingHorizontal: Spacing.xl + 4,
    alignItems: 'center',
    marginTop: 0,
  },
  percentText: {
    fontFamily: Fonts.display,
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '600',
    color: '#A86248',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  statusText: {
    fontSize: 14,
    color: Colors.mutedForeground,
    marginTop: 4,
    marginBottom: 14,
    textAlign: 'center',
    fontWeight: '400',
  },
  progressBarTrack: {
    width: '100%',
    height: 10,
    backgroundColor: '#E2DCD5',
    borderRadius: Radii.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#A86248',
    borderRadius: Radii.full,
  },

  // Editorial Style Tip Card Styles
  cardContainer: {
    width: '100%',
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  tipCard: {
    width: '100%',
    height: 144,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#ECE4DA',
    flexDirection: 'row',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#2C2520',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  tipTextCol: {
    flex: 1.15,
    paddingVertical: 16,
    paddingLeft: 20,
    paddingRight: 6,
    justifyContent: 'space-between',
    zIndex: 2,
  },
  tipEyebrow: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#A86248',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  tipQuoteWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tipQuote: {
    fontFamily: Fonts.display,
    fontSize: 15,
    lineHeight: 21,
    color: '#2C2520',
  },
  tipQuoteItalic: {
    fontStyle: 'italic',
    fontFamily: Fonts.display,
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
  },
  paginationCount: {
    fontSize: 11,
    fontWeight: '500',
    color: '#A86248',
    letterSpacing: 0.5,
  },
  dashTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dash: {
    height: 3.5,
    borderRadius: 2,
  },
  dashActive: {
    width: 24,
    backgroundColor: '#A86248',
  },
  dashInactive: {
    width: 13,
    backgroundColor: '#DFD5CA',
  },
  illustrationCol: {
    width: 136,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingRight: 6,
    paddingVertical: 6,
  },
  illustrationImg: {
    width: '100%',
    height: '100%',
  },
  nextBtn: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F3DEC9',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#3D2517',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },

  // Error UI Styles
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: Spacing.xl,
  },
  errorIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.destructive + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  errorTitle: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.foreground,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  errorDescription: {
    fontSize: 14,
    color: Colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.xxxl,
  },
  errorBtns: {
    width: '100%',
    gap: Spacing.md,
  },
  retryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radii.full,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
  },
  retryBtnText: {
    color: Colors.primaryForeground,
    fontSize: 15,
    fontWeight: '500',
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.full,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
  },
  cancelBtnText: {
    color: Colors.foreground,
    fontSize: 15,
    fontWeight: '500',
  },
});
