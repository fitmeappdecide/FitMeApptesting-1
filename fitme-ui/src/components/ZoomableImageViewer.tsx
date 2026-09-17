import React, { useRef, useEffect } from 'react';
import { View, PanResponder, Animated, StyleSheet, useWindowDimensions } from 'react-native';
import { CachedImage } from './CachedImage';

interface ZoomableImageViewerProps {
  uri: string;
  onZoomChange?: (isZoomed: boolean) => void;
}

export function ZoomableImageViewer({ uri, onZoomChange }: ZoomableImageViewerProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const scaleVal = useRef(1);
  const translateXVal = useRef(0);
  const translateYVal = useRef(0);

  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef(1);
  const lastTouchTime = useRef(0);

  const lastPanX = useRef(0);
  const lastPanY = useRef(0);

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

  const resetZoom = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  };

  const getDistance = (touches: any[]) => {
    const [t1, t2] = touches;
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          initialDistance.current = getDistance(touches);
          initialScale.current = scaleVal.current;
        } else if (touches.length === 1) {
          lastPanX.current = translateXVal.current;
          lastPanY.current = translateYVal.current;

          const now = Date.now();
          if (now - lastTouchTime.current < 300) {
            if (scaleVal.current > 1.05) {
              resetZoom();
            } else {
              Animated.parallel([
                Animated.spring(scale, { toValue: 2.5, useNativeDriver: true }),
                Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
                Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
              ]).start();
            }
          }
          lastTouchTime.current = now;
        }
      },

      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2 && initialDistance.current) {
          const currentDist = getDistance(touches);
          const newScale = Math.min(
            Math.max(initialScale.current * (currentDist / initialDistance.current), 1),
            4.5
          );
          scale.setValue(newScale);

          if (newScale <= 1.05) {
            translateX.setValue(0);
            translateY.setValue(0);
          }
        } else if (touches.length === 1 && scaleVal.current > 1.05) {
          const currentScale = scaleVal.current;
          const maxTx = (windowWidth * (currentScale - 1)) / 2;
          const maxTy = (windowHeight * (currentScale - 1)) / 2;

          let newTx = lastPanX.current + gestureState.dx;
          let newTy = lastPanY.current + gestureState.dy;

          newTx = Math.min(Math.max(newTx, -maxTx), maxTx);
          newTy = Math.min(Math.max(newTy, -maxTy), maxTy);

          translateX.setValue(newTx);
          translateY.setValue(newTy);
        }
      },

      onPanResponderRelease: () => {
        initialDistance.current = null;
        if (scaleVal.current < 1.05) {
          resetZoom();
        }
      },

      onPanResponderTerminate: () => {
        initialDistance.current = null;
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
