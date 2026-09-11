import React from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Linking, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../src/constants/theme';

const WEBSITE = 'https://fitme.app';
const INSTAGRAM = 'https://instagram.com/fitme';

export default function About() {
  const router = useRouter();
  const currentYear = new Date().getFullYear();

  const openLink = (url: string) => {
    Linking.openURL(url).catch(() =>
      Alert.alert('Error', 'Unable to open this link. Please try again.'),
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="About FitMe" back />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* App Identity */}
        <View style={styles.identity}>
          <View style={styles.logoWrap}>
            <Image
              source={require('../assets/eva.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.appName}>FitMe</Text>
        </View>

        {/* Application Info */}
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.rowBorder}
            onPress={() => openLink(WEBSITE)}
            activeOpacity={0.7}
          >
            <Text style={styles.rowLabel}>Official Website</Text>
            <View style={styles.rowRight}>
              <Text style={styles.rowValueLink}>fitme.app</Text>
              <Ionicons name="open-outline" size={15} color={Colors.mutedForeground} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rowBorder}
            onPress={() => router.push('/open-source-licenses' as any)}
            activeOpacity={0.7}
          >
            <Text style={styles.rowLabel}>Open Source Licenses</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.mutedForeground} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.row}
            onPress={() => openLink(INSTAGRAM)}
            activeOpacity={0.7}
          >
            <View style={styles.socialRow}>
              <Ionicons name="logo-instagram" size={18} color={Colors.foreground} />
              <Text style={styles.rowLabel}>Instagram</Text>
            </View>
            <Ionicons name="open-outline" size={15} color={Colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Copyright */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>© {currentYear} FitMe</Text>
          <Text style={styles.footerText}>All rights reserved.</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl },

  identity: { alignItems: 'center', marginBottom: Spacing.xxl },
  logoWrap: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  logo: { width: 44, height: 44, tintColor: Colors.foreground },
  appName: { fontFamily: 'serif', fontSize: 28, color: Colors.foreground },

  card: {
    backgroundColor: Colors.card, borderRadius: Radii.xl,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    marginBottom: Spacing.xxl,
  },
  rowBorder: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: 16,
  },
  rowLabel: { fontSize: 15, color: Colors.foreground },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowValueLink: { fontSize: 14, color: Colors.accent },
  socialRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  footer: { alignItems: 'center', marginBottom: Spacing.xxl, marginTop: Spacing.sm },
  footerText: { fontSize: 12, color: Colors.mutedForeground, marginTop: 4 },
});
