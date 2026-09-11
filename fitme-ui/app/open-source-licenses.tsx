import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../src/constants/theme';

// TODO: Auto-generate this list using a licenses tool (e.g. license-checker or expo-community-packages)
// The packages listed here match the direct dependencies in package.json as of build 98.
const LICENSES: {
  name: string;
  version: string;
  license: string;
  copyright: string;
  url: string;
}[] = [
  {
    name: 'react',
    version: '18.x',
    license: 'MIT',
    copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.',
    url: 'https://github.com/facebook/react',
  },
  {
    name: 'react-native',
    version: '0.74.x',
    license: 'MIT',
    copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.',
    url: 'https://github.com/facebook/react-native',
  },
  {
    name: 'expo',
    version: '51.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)',
    url: 'https://github.com/expo/expo',
  },
  {
    name: 'expo-router',
    version: '3.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2023-present 650 Industries, Inc.',
    url: 'https://github.com/expo/expo/tree/main/packages/expo-router',
  },
  {
    name: 'expo-image-picker',
    version: '15.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc.',
    url: 'https://github.com/expo/expo/tree/main/packages/expo-image-picker',
  },
  {
    name: 'expo-store-review',
    version: '7.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc.',
    url: 'https://github.com/expo/expo/tree/main/packages/expo-store-review',
  },
  {
    name: 'expo-web-browser',
    version: '13.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc.',
    url: 'https://github.com/expo/expo/tree/main/packages/expo-web-browser',
  },
  {
    name: 'react-native-safe-area-context',
    version: '4.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2019 Th3rdwave',
    url: 'https://github.com/th3rdwave/react-native-safe-area-context',
  },
  {
    name: '@expo/vector-icons',
    version: '14.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present Krister Kari, Joel Arvidsson',
    url: 'https://github.com/expo/vector-icons',
  },
  {
    name: 'zustand',
    version: '4.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2019-present Paul Henschel (PMNDRS)',
    url: 'https://github.com/pmndrs/zustand',
  },
  {
    name: '@react-native-async-storage/async-storage',
    version: '1.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2015-present Krzysztof Magiera',
    url: 'https://github.com/react-native-async-storage/async-storage',
  },
  {
    name: 'axios',
    version: '1.x',
    license: 'MIT',
    copyright: 'Copyright (c) 2014-present Matt Zabriskie & Collaborators',
    url: 'https://github.com/axios/axios',
  },
];

export default function OpenSourceLicenses() {
  const openLink = (url: string) => {
    Linking.openURL(url).catch(() =>
      Alert.alert('Error', 'Unable to open link.'),
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Open Source Licenses" back />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <Text style={styles.intro}>
          FitMe is built with open source software. We're grateful to the following
          projects and their contributors.
        </Text>

        {LICENSES.map((pkg) => (
          <TouchableOpacity
            key={pkg.name}
            style={styles.card}
            onPress={() => openLink(pkg.url)}
            activeOpacity={0.75}
          >
            <View style={styles.cardHead}>
              <View style={styles.cardHeadLeft}>
                <Text style={styles.pkgName}>{pkg.name}</Text>
                <Text style={styles.pkgVersion}>v{pkg.version}</Text>
              </View>
              <View style={styles.licensePill}>
                <Text style={styles.licensePillText}>{pkg.license}</Text>
              </View>
            </View>

            <Text style={styles.copyright}>{pkg.copyright}</Text>

            <View style={styles.linkRow}>
              <Ionicons name="open-outline" size={12} color={Colors.accent} />
              <Text style={styles.linkText}>View on GitHub</Text>
            </View>
          </TouchableOpacity>
        ))}

        <Text style={styles.footer}>
          All packages are used under their respective licenses. Tap any package to view its repository.
        </Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll:    { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg },

  intro: {
    fontSize: 13,
    color: Colors.mutedForeground,
    lineHeight: 20,
    marginBottom: Spacing.xl,
  },

  card: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  cardHeadLeft: { flex: 1, gap: 2 },
  pkgName:    { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  pkgVersion: { fontSize: 11, color: Colors.mutedForeground },

  licensePill: {
    backgroundColor: Colors.muted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.sm,
    alignSelf: 'flex-start',
  },
  licensePillText: { fontSize: 10, fontWeight: '700', color: Colors.mutedForeground, letterSpacing: 0.5 },

  copyright: {
    fontSize: 12,
    color: Colors.mutedForeground,
    lineHeight: 18,
    marginBottom: 8,
  },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkText: { fontSize: 12, color: Colors.accent },

  footer: {
    fontSize: 11,
    color: Colors.mutedForeground,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
});
