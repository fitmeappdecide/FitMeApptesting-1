import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Alert, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Logo } from '../src/components/Logo';
import { Colors, Spacing, Radii } from '../src/constants/theme';
import { authApi, ApiError } from '../src/services/api';
import { loginWithGoogle } from '../src/firebase/auth';
import { initializeUserSession, purgeAllSessionState } from '../src/services/sessionManager';

function getSanitizedAuthErrorMessage(e: any): { isCancelled: boolean; message: string } {
  const code = e?.code ? String(e.code) : '';
  const rawMsg = typeof e?.message === 'string' ? e.message : '';
  const combined = `${code} ${rawMsg}`.toLowerCase();

  // 1. Google Sign-In Cancellation
  if (
    code === 'SIGN_IN_CANCELLED' ||
    code === '12501' ||
    code === '-5' ||
    combined.includes('cancel') ||
    combined.includes('code=-5') ||
    (combined.includes('gidsignin') && combined.includes('cancel'))
  ) {
    return { isCancelled: true, message: 'Google sign-in was cancelled.' };
  }

  // 2. Sign-in in progress
  if (
    code === 'IN_PROGRESS' ||
    combined.includes('in_progress') ||
    combined.includes('in progress')
  ) {
    return { isCancelled: false, message: 'Sign-in is already in progress. Please wait.' };
  }

  // 3. Play Services not available (Android)
  if (
    code === 'PLAY_SERVICES_NOT_AVAILABLE' ||
    combined.includes('play_services')
  ) {
    return { isCancelled: false, message: 'Google Play Services are unavailable on this device.' };
  }

  // 4. Network / Connection errors
  if (
    (e instanceof ApiError && (e.status === 0 || e.status === 408 || e.status === 503 || e.status === 504)) ||
    combined.includes('network') ||
    combined.includes('connection') ||
    combined.includes('timed out') ||
    combined.includes('timeout') ||
    combined.includes('fetch failed')
  ) {
    return { isCancelled: false, message: 'Unable to connect. Please check your internet connection and try again.' };
  }

  // 5. Backend ApiError messages
  if (e instanceof ApiError) {
    if (e.code === 'INVALID_CREDENTIALS') {
      return { isCancelled: false, message: 'The email or password is incorrect.' };
    }
    if (e.code === 'EMAIL_EXISTS') {
      return { isCancelled: false, message: 'This email is already registered.' };
    }
    if (e.code === 'INVALID_TOKEN') {
      return { isCancelled: false, message: 'Unable to verify Google credentials. Please try again.' };
    }
    if (e.message && !e.message.toLowerCase().includes('traceback') && !e.message.toLowerCase().includes('exception')) {
      return { isCancelled: false, message: e.message };
    }
  }

  // 6. Generic safe fallback
  return { isCancelled: false, message: 'Unable to sign in with Google. Please try again.' };
}

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await authApi.login(email.trim(), password);
      if (res?.user) {
        await initializeUserSession({
          id: res.user.id,
          email: res.user.email,
          full_name: res.user.full_name,
        });
      }
      router.replace('/(tabs)/home');
    } catch (e) {
      console.error('[SignIn] Technical error:', e);
      try {
        await purgeAllSessionState();
      } catch (_) {}
      setError(e instanceof ApiError ? e.message : 'Could not sign in. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const user = await loginWithGoogle();
      if (!user) {
        throw new Error('Google sign-in returned no authenticated user.');
      }
      router.replace('/(tabs)/home');
    } catch (e: any) {
      console.error('[GoogleSignIn] Technical error:', e);
      try {
        await purgeAllSessionState();
      } catch (_) {}
      const { isCancelled, message: cleanMessage } = getSanitizedAuthErrorMessage(e);
      Alert.alert(isCancelled ? 'Sign-in cancelled' : 'Sign-in error', cleanMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = () => {
    Alert.alert('Coming soon', 'Sign in with Apple requires capability setup — see README for adding it.');
  };

  const handleTerms = () => {
    Linking.openURL('https://fitme.app/terms');
  };

  const handlePrivacy = () => {
    Linking.openURL('https://fitme.app/privacy');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Top: Logo */}
        <View style={styles.logoBlock}>
          <Logo size={32} />
        </View>

        {/* Center: Illustration Image */}
        <View style={styles.imageContainer}>
          <Image
            source={require('../assets/sign-image.png')}
            style={styles.heroImage}
            resizeMode="contain"
          />
        </View>

        {/* Bottom: Auth Buttons & Legal Text */}
        <View style={styles.bottomSection}>
          <View style={styles.buttonGroup}>
            {/* Continue with Google */}
            <TouchableOpacity
              style={styles.authBtn}
              onPress={handleGoogleSignIn}
              disabled={loading}
              activeOpacity={0.8}
            >
              <View style={styles.btnContent}>
                <View style={styles.iconWrap}>
                  <Image
                    source={require('../assets/images/google-logo.png')}
                    style={styles.googleIcon}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.btnText}>Continue with Google</Text>
              </View>
            </TouchableOpacity>

            {/* Continue with Apple */}
            <TouchableOpacity
              style={styles.authBtn}
              onPress={handleAppleSignIn}
              activeOpacity={0.8}
            >
              <View style={styles.btnContent}>
                <View style={styles.iconWrap}>
                  <Ionicons name="logo-apple" size={19} color={Colors.foreground} />
                </View>
                <Text style={styles.btnText}>Continue with Apple</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Legal Text */}
          <View style={styles.legalBlock}>
            <Text style={styles.legalText}>By continuing, you agree to our</Text>
            <View style={styles.legalLinksRow}>
              <TouchableOpacity onPress={handleTerms} activeOpacity={0.7}>
                <Text style={styles.legalLink}>Terms of Service</Text>
              </TouchableOpacity>
              <Text style={styles.legalText}> and </Text>
              <TouchableOpacity onPress={handlePrivacy} activeOpacity={0.7}>
                <Text style={styles.legalLink}>Privacy Policy</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  logoBlock: {
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  imageContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: Spacing.md,
  },
  heroImage: {
    width: '85%',
    height: 280,
    maxHeight: 280,
  },
  bottomSection: {
    width: '100%',
    alignItems: 'center',
  },
  buttonGroup: {
    width: '100%',
    gap: 12,
    marginBottom: Spacing.xxl,
  },
  authBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: '#E8E2D8',
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIcon: {
    width: 18,
    height: 18,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.foreground,
  },
  legalBlock: {
    alignItems: 'center',
    gap: 2,
    marginBottom: Spacing.xs,
  },
  legalLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  legalText: {
    fontSize: 12,
    color: Colors.mutedForeground,
    textAlign: 'center',
  },
  legalLink: {
    fontSize: 12,
    color: Colors.accent,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});
