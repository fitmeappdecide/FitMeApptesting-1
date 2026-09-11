import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('screen');

const slides = [
  require('../assets/m-11.png'),
  require('../assets/m-22.png'),
  require('../assets/m-33.png'),
];

export default function Onboarding() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const page = Math.round(offsetX / SCREEN_WIDTH);
    if (page >= 0 && page < slides.length && page !== currentIndex) {
      setCurrentIndex(page);
    }
  };

  const completeOnboarding = async () => {
    try {
      await AsyncStorage.setItem('@fitme_has_onboarded', 'true');
    } catch (e) {
      console.warn('Failed to save onboarding flag:', e);
    }
    router.replace('/login');
  };

  const handleNext = async () => {
    if (currentIndex < slides.length - 1) {
      const nextIndex = currentIndex + 1;
      scrollRef.current?.scrollTo({
        x: nextIndex * SCREEN_WIDTH,
        animated: true,
      });
      setCurrentIndex(nextIndex);
    } else {
      await completeOnboarding();
    }
  };

  const handleDotPress = (index: number) => {
    scrollRef.current?.scrollTo({
      x: index * SCREEN_WIDTH,
      animated: true,
    });
    setCurrentIndex(index);
  };

  const handleSkip = async () => {
    await completeOnboarding();
  };

  // On dark background (slide 0), use light inactive dots; on light floors (slides 1, 2), use muted dark dots
  const isDarkBackground = currentIndex === 0;

  return (
    <View style={styles.container}>
      <StatusBar style="light" translucent />

      {/* Horizontal Swiping Carousel with Full-Bleed Artwork */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleScroll}
        bounces={false}
        scrollEventThrottle={16}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {slides.map((imageSource, index) => (
          <View key={index} style={styles.slide}>
            <Image
              source={imageSource}
              style={styles.screenImage}
              resizeMode="cover"
            />
          </View>
        ))}
      </ScrollView>

      {/* Fixed Native Top Header - 'Skip' Button */}
      <View
        style={[
          styles.headerOverlay,
          { top: Math.max(insets.top + 8, 20) },
        ]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          onPress={handleSkip}
          style={styles.skipButton}
          activeOpacity={0.6}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Fixed Native Bottom Controls (Floating directly over the photo/floor background) */}
      <View
        style={[
          styles.bottomControls,
          {
            paddingBottom: Math.max(insets.bottom + 16, 28),
          },
        ]}
        pointerEvents="box-none"
      >
        {/* Uniform Native Pagination Dots */}
        <View style={styles.dotsContainer}>
          {slides.map((_, index) => {
            const isActive = index === currentIndex;
            return (
              <TouchableOpacity
                key={index}
                onPress={() => handleDotPress(index)}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                activeOpacity={0.8}
                style={[
                  styles.dot,
                  isActive
                    ? styles.dotActive
                    : [
                        styles.dotInactive,
                        {
                          backgroundColor: isDarkBackground
                            ? 'rgba(255, 255, 255, 0.45)'
                            : 'rgba(44, 37, 32, 0.28)',
                        },
                      ],
                ]}
              />
            );
          })}
        </View>

        {/* Native Terracotta Pill Button */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleNext}
          activeOpacity={0.85}
        >
          <Text style={styles.actionButtonText}>
            {currentIndex === slides.length - 1 ? 'Get Started' : 'Continue'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E1917',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
  },
  slide: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
  },
  screenImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },

  // Fixed Top-Right Skip
  headerOverlay: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 50,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  skipButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  skipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FAF7F4',
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0, 0, 0, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // Fixed Bottom Bar (Floating directly over full background)
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    alignItems: 'center',
    zIndex: 50,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  dot: {
    height: 7,
    borderRadius: 3.5,
  },
  dotActive: {
    width: 26,
    backgroundColor: '#9E5334',
  },
  dotInactive: {
    width: 7,
  },
  actionButton: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: '#9E5334',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
