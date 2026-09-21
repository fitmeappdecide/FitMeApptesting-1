import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logo } from '../src/components/Logo';
import { Colors, Spacing, Radii } from '../src/constants/theme';
import { authApi, ApiError } from '../src/services/api';
import { initializeUserSession, purgeAllSessionState } from '../src/services/sessionManager';

const fields = [
  { label: 'NAME', key: 'name', placeholder: 'Your name', type: 'default' },
  { label: 'EMAIL', key: 'email', placeholder: 'you@fitme.app', type: 'email-address' },
  { label: 'PHONE', key: 'phone', placeholder: '+91 98765 43210', type: 'phone-pad' },
  { label: 'PASSWORD', key: 'password', placeholder: 'Choose a password', type: 'default', secure: true },
] as const;

export default function Signup() {
  const router = useRouter();
  const [vals, setVals] = useState({ name: '', email: '', phone: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateAccount = async () => {
    if (!vals.email || !vals.password) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Note: the backend's /auth/register only accepts email, password, full_name —
      // phone isn't part of the current schema, so it's collected here but not sent yet.
      const res = await authApi.register(vals.email.trim(), vals.password, vals.name.trim() || undefined);
      if (res?.user) {
        await initializeUserSession({
          id: res.user.id,
          email: res.user.email,
          full_name: res.user.full_name,
        });
      }
      router.replace('/(tabs)/home');
    } catch (e) {
      try {
        await purgeAllSessionState();
      } catch (_) {}
      setError(e instanceof ApiError ? e.message : 'Could not create your account. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.logoBlock}>
            <Logo size={32} />
            <Text style={styles.subtitle}>Create your FitMe account</Text>
          </View>

          <View style={styles.form}>
            {fields.map((f) => (
              <View key={f.key} style={styles.fieldGroup}>
                <Text style={styles.label}>{f.label}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={f.placeholder}
                  placeholderTextColor={Colors.mutedForeground}
                  value={vals[f.key]}
                  onChangeText={(v) => setVals((prev) => ({ ...prev, [f.key]: v }))}
                  keyboardType={f.type as any}
                  secureTextEntry={'secure' in f ? (f as any).secure : false}
                  autoCapitalize="none"
                />
              </View>
            ))}

            {error && <Text style={styles.errorText}>{error}</Text>}

            <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.6 }]} onPress={handleCreateAccount} disabled={loading}>
              <Text style={styles.primaryBtnText}>{loading ? 'Creating account…' : 'Create account'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Link href="/login" asChild>
              <TouchableOpacity>
                <Text style={styles.footerLink}>Sign in</Text>
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
  fieldGroup: { marginBottom: Spacing.md },
  label: { fontSize: 10, letterSpacing: 1.5, color: Colors.mutedForeground, textTransform: 'uppercase', marginBottom: 6 },
  input: {
    backgroundColor: Colors.card, borderRadius: Radii.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.lg, paddingVertical: 14,
    fontSize: 14, color: Colors.foreground,
  },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radii.full,
    paddingVertical: 16, alignItems: 'center', marginTop: Spacing.lg,
  },
  primaryBtnText: { color: Colors.primaryForeground, fontSize: 15, fontWeight: '500' },
  errorText: { fontSize: 12, color: Colors.destructive, marginTop: Spacing.md, textAlign: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.xxxl },
  footerText: { fontSize: 14, color: Colors.mutedForeground },
  footerLink: { fontSize: 14, color: Colors.accent, fontWeight: '500' },
});
