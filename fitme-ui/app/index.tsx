import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logo } from '../src/components/Logo';
import { Colors, Spacing } from '../src/constants/theme';
import { loadStoredAuth, getAuthenticatedUserId } from '../src/services/api';
import { initializeUserSession } from '../src/services/sessionManager';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SplashScreen() {
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const loaderAnim = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
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

        const isAuthenticated = await loadStoredAuth();
        if (isAuthenticated) {
          const userId = getAuthenticatedUserId();
          if (userId) {
            await initializeUserSession({ id: userId });
          }
          router.replace('/(tabs)/home');
          return;
        }
      } catch (e) {
        console.warn('[Splash] Auth initialization notice:', e);
      }
      router.replace('/login');
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
