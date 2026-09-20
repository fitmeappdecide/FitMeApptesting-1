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
    console.log(`⏱️ [CLIENT TELEMETRY START] startPipeline() @ T+0.00ms`);
    setErrorType(null);
    setErrorMsg(null);

    let activeScanId = scanId;
    let activeSavedPhotoId = savedPhotoId;

    try {
      // 1. STRICT PRIORITY: If localPhotoUri exists (new camera/gallery capture), it MUST be used for this Try-On.
      // Ignore any stale activeSavedPhotoId from previous sessions.
      if (localPhotoUri) {
        activeSavedPhotoId = null;
        activeScanId = null;
        targetProgressRef.current = 25;

        const tu0 = performance.now();
        console.log(`⏱️ [CLIENT TELEMETRY] Initiating single savedPhotosApi.upload() @ T+${(tu0 - t0).toFixed(2)}ms`);
        const savedRes = await savedPhotosApi.upload(localPhotoUri);
        const tu1 = performance.now();
        console.log(`⏱️ [CLIENT TELEMETRY] savedPhotosApi.upload() completed in ${(tu1 - tu0).toFixed(2)}ms`);

        if (savedRes?.id) {
          activeSavedPhotoId = savedRes.id;
          setSavedPhotoId(savedRes.id);
          setSavedPhotoName(savedRes.display_name);
          if (savedRes.scan_id) {
            activeScanId = savedRes.scan_id;
            setScanId(activeScanId);
          }
          console.log('⏱️ [CLIENT] Photo auto-saved to library with ID:', savedRes.id, 'and scan_id:', savedRes.scan_id);
        }

        setLocalPhotoUri(null);
      }

      // 2. Prepare garment & Start Try-On Job (using activeScanId and/or activeSavedPhotoId)
      if ((activeScanId || activeSavedPhotoId) && productId) {
        targetProgressRef.current = 48;

        const ts0 = performance.now();
        console.log(`⏱️ [CLIENT TELEMETRY] Initiating tryOnApi.start() @ T+${(ts0 - t0).toFixed(2)}ms`);
        const { job_id } = await tryOnApi.start(activeScanId, productId, activeSavedPhotoId);
        const ts1 = performance.now();
        console.log(`⏱️ [CLIENT TELEMETRY] tryOnApi.start() returned job_id in ${(ts1 - ts0).toFixed(2)}ms`);
        setTryOnJobId(job_id);

        // 3. Poll status
        targetProgressRef.current = 75;

        let pollCount = 0;
        const tp0 = performance.now();
        const result = await tryOnApi.waitForResult(job_id, (status) => {
          pollCount++;
          const tNow = performance.now();
          console.log(`⏱️ [CLIENT TELEMETRY] Poll #${pollCount} @ T+${(tNow - tp0).toFixed(2)}ms -> status: ${status.status}`);
          if (status.status === 'queued') {
            targetProgressRef.current = Math.max(targetProgressRef.current, 55);
          } else if (status.status === 'uploading') {
            targetProgressRef.current = Math.max(targetProgressRef.current, 65);
          } else if (status.status === 'processing') {
            const currentPct = status.progress_pct ?? 80;
            targetProgressRef.current = Math.max(targetProgressRef.current, currentPct);
          }
        });

        const tEnd = performance.now();
        console.log(`⏱️ [CLIENT TELEMETRY END] Total TryOn Pipeline Time: ${(tEnd - t0).toFixed(2)}ms (${((tEnd - t0) / 1000).toFixed(2)}s)`);

        targetProgressRef.current = 100;
        setProgress(100);
        setStatusText('Your look is ready!');
        setResultImageUrls(result.result_image_urls);

        // Pre-cache the result image in background so result screen opens instantly
        if (result.result_image_urls && result.result_image_urls.length > 0) {
          const firstUrl = result.result_image_urls[0];
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

        setTimeout(() => router.replace({ pathname: '/result', params: { jobId: job_id } } as any), 450);
      }
    } catch (e) {
      console.error(e);
      isPipelineRunningRef.current = false;
      const isUploadError = !activeScanId && !savedPhotoId;
      setErrorType(isUploadError ? 'upload' : 'tryon');
      setErrorMsg(e instanceof ApiError ? e.message : 'An unexpected error occurred.');
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
