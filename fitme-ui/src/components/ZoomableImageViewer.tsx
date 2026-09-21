import React, { useRef, useEffect } from 'react';
import { View, PanResponder, Animated, StyleSheet, useWindowDimensions } from 'react-native';
import { CachedImage } from './CachedImage';

interface ZoomableImageViewerProps {
  uri: string;
  onZoomChange?: (isZoomed: boolean) => void;
}

const MIN_SCALE = 1.0;
const MAX_SCALE = 4.5;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_DELAY = 300;
const DOUBLE_TAP_MAX_DISTANCE = 40;

export function ZoomableImageViewer({ uri, onZoomChange }: ZoomableImageViewerProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const scaleVal = useRef(1);
  const translateXVal = useRef(0);
  const translateYVal = useRef(0);

  // Gesture state tracking
  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef(1);
  const initialMidpoint = useRef<{ x: number; y: number } | null>(null);
  const initialTranslate = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const lastPanX = useRef(0);
  const lastPanY = useRef(0);
  const touchCount = useRef(0);

  // Double-tap tracking
  const lastTapTime = useRef(0);
  const lastTapPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const scaleSub = scale.addListener(({ value }) => {
      scaleVal.current = value;
      onZoomChange?.(value > 1.05);
    });
    const txSub = translateX.addListener(({ value }) => {
      translateXVal.current = value;
    });
    const tySub = translateY.addListener(({ value }) => {
      translateYVal.current = value;
    });

    return () => {
      scale.removeListener(scaleSub);
      translateX.removeListener(txSub);
      translateY.removeListener(tySub);
    };
  }, [scale, translateX, translateY, onZoomChange]);

  const resetZoom = (animated = true) => {
    if (animated) {
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 7, tension: 40 }),
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7, tension: 40 }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 7, tension: 40 }),
      ]).start();
    } else {
      scale.setValue(1);
      translateX.setValue(0);
      translateY.setValue(0);
    }
  };

  const getDistance = (t1: { pageX: number; pageY: number }, t2: { pageX: number; pageY: number }) => {
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getMidpoint = (t1: { pageX: number; pageY: number }, t2: { pageX: number; pageY: number }) => {
    return {
      x: (t1.pageX + t2.pageX) / 2,
      y: (t1.pageY + t2.pageY) / 2,
    };
  };

  const clampTranslation = (tx: number, ty: number, currentScale: number) => {
    const maxTx = Math.max(0, (windowWidth * (currentScale - 1)) / 2);
    const maxTy = Math.max(0, (windowHeight * (currentScale - 1)) / 2);
    return {
      x: Math.min(Math.max(tx, -maxTx), maxTx),
      y: Math.min(Math.max(ty, -maxTy), maxTy),
    };
  };

  const handleDoubleTap = (tapX: number, tapY: number) => {
    if (scaleVal.current > 1.05) {
      // If currently zoomed, double-tap returns to fit-to-screen
      resetZoom(true);
    } else {
      // Zoom in centered around the tap location (focal point)
      const targetScale = DOUBLE_TAP_SCALE;
      const centerX = windowWidth / 2;
      const centerY = windowHeight / 2;

      // Focal point translation math:
      // Point P on image moves to center: Tx = -(targetScale - 1) * (Px - Cx)
      const targetTx = -(targetScale - 1) * (tapX - centerX);
      const targetTy = -(targetScale - 1) * (tapY - centerY);

      const clamped = clampTranslation(targetTx, targetTy, targetScale);

      Animated.parallel([
        Animated.spring(scale, {
          toValue: targetScale,
          useNativeDriver: true,
          friction: 7,
          tension: 40,
        }),
        Animated.spring(translateX, {
          toValue: clamped.x,
          useNativeDriver: true,
          friction: 7,
          tension: 40,
        }),
        Animated.spring(translateY, {
          toValue: clamped.y,
          useNativeDriver: true,
          friction: 7,
          tension: 40,
        }),
      ]).start();
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        touchCount.current = touches.length;

        if (touches.length === 2) {
          // Initialize two-finger pinch
          const t1 = touches[0];
          const t2 = touches[1];
          initialDistance.current = getDistance(t1, t2);
          initialScale.current = scaleVal.current;
          initialMidpoint.current = getMidpoint(t1, t2);
          initialTranslate.current = {
            x: translateXVal.current,
            y: translateYVal.current,
          };
        } else if (touches.length === 1) {
          lastPanX.current = translateXVal.current;
          lastPanY.current = translateYVal.current;

          const t = touches[0];
          const now = Date.now();
          const prevTime = lastTapTime.current;
          const prevPos = lastTapPos.current;

          // Check for double-tap gesture
          if (
            prevPos &&
            now - prevTime < DOUBLE_TAP_DELAY &&
            Math.hypot(t.pageX - prevPos.x, t.pageY - prevPos.y) < DOUBLE_TAP_MAX_DISTANCE
          ) {
            handleDoubleTap(t.pageX, t.pageY);
            lastTapTime.current = 0;
            lastTapPos.current = null;
          } else {
            lastTapTime.current = now;
            lastTapPos.current = { x: t.pageX, y: t.pageY };
          }
        }
      },

      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;

        // Transition from 1 touch to 2 touches during active gesture
        if (touches.length === 2) {
          const t1 = touches[0];
          const t2 = touches[1];
          const currentDist = getDistance(t1, t2);
          const currentMid = getMidpoint(t1, t2);

          if (!initialDistance.current || touchCount.current !== 2) {
            initialDistance.current = currentDist;
            initialScale.current = scaleVal.current;
            initialMidpoint.current = currentMid;
            initialTranslate.current = {
              x: translateXVal.current,
              y: translateYVal.current,
            };
            touchCount.current = 2;
            return;
          }

          const scaleRatio = currentDist / initialDistance.current;
          const newScale = Math.min(Math.max(initialScale.current * scaleRatio, MIN_SCALE), MAX_SCALE);
          scale.setValue(newScale);

          // Focal-point shift during two-finger pinch
          const centerX = windowWidth / 2;
          const centerY = windowHeight / 2;
          const mid0 = initialMidpoint.current || { x: centerX, y: centerY };
          const s0 = initialScale.current || 1;
          const tx0 = initialTranslate.current.x;
          const ty0 = initialTranslate.current.y;

          const focalTx = (currentMid.x - centerX) - (newScale / s0) * (mid0.x - centerX - tx0);
          const focalTy = (currentMid.y - centerY) - (newScale / s0) * (mid0.y - centerY - ty0);

          const clamped = clampTranslation(focalTx, focalTy, newScale);
          translateX.setValue(clamped.x);
          translateY.setValue(clamped.y);
        } else if (touches.length === 1) {
          // Transition from 2 touches back to 1 touch without jumping
          if (touchCount.current === 2) {
            lastPanX.current = translateXVal.current;
            lastPanY.current = translateYVal.current;
            touchCount.current = 1;
            initialDistance.current = null;
            return;
          }

          touchCount.current = 1;

          // Single-finger pan when zoomed in beyond 1.05x
          if (scaleVal.current > 1.05) {
            const rawTx = lastPanX.current + gestureState.dx;
            const rawTy = lastPanY.current + gestureState.dy;

            const clamped = clampTranslation(rawTx, rawTy, scaleVal.current);
            translateX.setValue(clamped.x);
            translateY.setValue(clamped.y);
          }
        }
      },

      onPanResponderRelease: () => {
        initialDistance.current = null;
        initialMidpoint.current = null;
        touchCount.current = 0;

        // If scale was pinched below 1.05x, snap smoothly back to fit-to-screen
        if (scaleVal.current < 1.05) {
          resetZoom(true);
        } else {
          // Clamp translation smoothly in case of over-drag
          const clamped = clampTranslation(translateXVal.current, translateYVal.current, scaleVal.current);
          if (clamped.x !== translateXVal.current || clamped.y !== translateYVal.current) {
            Animated.parallel([
              Animated.spring(translateX, { toValue: clamped.x, useNativeDriver: true, friction: 7, tension: 40 }),
              Animated.spring(translateY, { toValue: clamped.y, useNativeDriver: true, friction: 7, tension: 40 }),
            ]).start();
          }
        }
      },

      onPanResponderTerminate: () => {
        initialDistance.current = null;
        initialMidpoint.current = null;
        touchCount.current = 0;
        if (scaleVal.current < 1.05) {
          resetZoom(true);
        }
      },
    })
  ).current;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <Animated.View
        style={[
          styles.imageContainer,
          {
            transform: [
              { translateX },
              { translateY },
              { scale },
            ],
          },
        ]}
      >
        <CachedImage
          uri={uri}
          style={{ width: windowWidth, height: windowHeight * 0.75 }}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  imageContainer: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
