import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ScrollView, Image, Alert,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Logo } from '../src/components/Logo';
import { Colors, Spacing, Radii } from '../src/constants/theme';
import { authApi, ApiError } from '../src/services/api';
import { loginWithGoogle } from '../src/firebase/auth';

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
      await authApi.login(email.trim(), password);
      router.replace('/(tabs)/home');
    } catch (e) {
      console.error('[SignIn] Technical error:', e);
      setError(e instanceof ApiError ? e.message : 'Could not sign in. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await loginWithGoogle();
      router.replace('/(tabs)/home');
    } catch (e: any) {
      console.error('[GoogleSignIn] Technical error:', e);
      const { isCancelled, message: cleanMessage } = getSanitizedAuthErrorMessage(e);
      Alert.alert(isCancelled ? 'Sign-in cancelled' : 'Sign-in error', cleanMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.logoBlock}>
            <Logo size={32} />
            <Text style={styles.subtitle}>Welcome back</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor={Colors.mutedForeground}
            />

            <Text style={[styles.label, { marginTop: Spacing.md }]}>PASSWORD</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, { flex: 1, borderWidth: 0, paddingRight: 40 }]}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPass}
                placeholderTextColor={Colors.mutedForeground}
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPass(!showPass)}>
                <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <View style={[styles.inputBorder]} />

            <TouchableOpacity style={styles.forgotRow}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.6 }]} onPress={handleSignIn} disabled={loading}>
              <Text style={styles.primaryBtnText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.socialBtns}>
            <TouchableOpacity style={styles.socialBtn} onPress={handleGoogleSignIn} disabled={loading} activeOpacity={0.7}>
              <View style={styles.socialIconWrap}>
                <Image
                  source={require('../assets/images/google-logo.png')}
                  style={{ width: 17, height: 17 }}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.socialBtnText}>Continue with Google</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.socialBtn} onPress={() => Alert.alert('Coming soon', 'Sign in with Apple requires capability setup — see README for adding it.')} activeOpacity={0.7}>
              <View style={styles.socialIconWrap}>
                <Ionicons name="logo-apple" size={17} color={Colors.foreground} />
              </View>
              <Text style={styles.socialBtnText}>Continue with Apple</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.socialBtn} onPress={() => Alert.alert('Coming soon', 'Phone sign-in is not wired up yet.')} activeOpacity={0.7}>
              <View style={styles.socialIconWrap}>
                <Ionicons name="call-outline" size={16} color={Colors.foreground} />
              </View>
              <Text style={styles.socialBtnText}>Continue with Phone</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>New here? </Text>
            <Link href="/signup" asChild>
              <TouchableOpacity>
                <Text style={styles.footerLink}>Create an account</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: {
    padding: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  logoBlock: { alignItems: 'center', marginTop: Spacing.xxl, marginBottom: Spacing.xxxl },
  subtitle: { fontSize: 14, color: Colors.mutedForeground, marginTop: 6 },
  form: { gap: 4 },
  label: { fontSize: 10, letterSpacing: 1.5, color: Colors.mutedForeground, textTransform: 'uppercase', marginBottom: 6 },
  input: {
    backgroundColor: Colors.card, borderRadius: Radii.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.lg, paddingVertical: 14,
    fontSize: 14, color: Colors.foreground,
  },
  passwordRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: Radii.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingLeft: Spacing.lg,
  },
  eyeBtn: { padding: 12 },
  inputBorder: { height: 0 },
  forgotRow: { alignSelf: 'flex-end', marginTop: 4 },
  forgotText: { fontSize: 12, color: Colors.accent },
  errorText: { fontSize: 12, color: Colors.destructive, marginTop: Spacing.md },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radii.full,
    paddingVertical: 16, alignItems: 'center', marginTop: Spacing.xl,
  },
  primaryBtnText: { color: Colors.primaryForeground, fontSize: 15, fontWeight: '500' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: Spacing.xxl },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: 12, color: Colors.mutedForeground },
  socialBtns: { gap: 10 },
  socialBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    borderRadius: Radii.full, borderWidth: 1, borderColor: '#E8E2D8',
    backgroundColor: '#F9F5EF', paddingVertical: 13,
  },
  socialIconWrap: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialBtnText: { fontSize: 14, fontWeight: '500', color: Colors.foreground },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.xxxl, paddingBottom: Spacing.xl },
  footerText: { fontSize: 14, color: Colors.mutedForeground },
  footerLink: { fontSize: 14, color: Colors.accent, fontWeight: '500' },
});
