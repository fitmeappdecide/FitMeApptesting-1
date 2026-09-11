import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logo } from '../src/components/Logo';
import { Colors, Spacing } from '../src/constants/theme';
import { loadStoredAuth } from '../src/services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SplashScreen() {
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const loaderAnim = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    // Immediately preload auth tokens into memory so downstream components have credentials ready
    loadStoredAuth().catch(() => {});

    Animated.loop(
      Animated.timing(loaderAnim, {
        toValue: 3,
        duration: 1600,
        useNativeDriver: true,
      })
    ).start();

    const timer = setTimeout(async () => {
      try {
        const hasOnboarded = await AsyncStorage.getItem('@fitme_has_onboarded');
        if (!hasOnboarded) {
          router.replace('/onboarding');
          return;
        }
      } catch (e) {
        console.warn('[Splash] Failed to read onboarding flag:', e);
      }
      router.replace('/(tabs)/home');
    }, 800);

    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <Logo size={48} />
        <Text style={styles.subtitle}>AI VIRTUAL TRY-ON</Text>
        <View style={styles.loaderTrack}>
          <Animated.View
            style={[
              styles.loaderBar,
              {
                transform: [{
                  translateX: loaderAnim.interpolate({
                    inputRange: [-1, 3],
                    outputRange: [-60, 120],
                  }),
                }],
              },
            ]}
          />
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    gap: Spacing.lg,
  },
  subtitle: {
    fontSize: 11,
    letterSpacing: 4,
    color: Colors.mutedForeground,
    marginTop: Spacing.sm,
  },
  loaderTrack: {
    width: 120,
    height: 2,
    backgroundColor: Colors.muted,
    borderRadius: 1,
    overflow: 'hidden',
    marginTop: Spacing.lg,
  },
  loaderBar: {
    width: 40,
    height: 2,
    backgroundColor: Colors.accent,
    borderRadius: 1,
  },
});
