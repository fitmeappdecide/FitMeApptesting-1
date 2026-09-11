import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../src/constants/theme';

const sections = [
  {
    icon: 'lock-closed-outline' as const,
    title: 'Your Data',
    bullets: ['Photos are private.', 'Photos are never shared with other users.', 'Photos are encrypted during upload and storage.'],
  },
  {
    icon: 'image-outline' as const,
    title: 'Your Images',
    bullets: ['Used only to generate try-ons.', 'Not used for advertising.', 'Not sold to third parties.'],
  },
  {
    icon: 'trash-outline' as const,
    title: 'Delete My Data',
    bullets: ['Remove uploaded photos.', 'Remove generated looks.', 'Delete account permanently.'],
  },
];

export default function PrivacySecurity() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Privacy & Security" back right={<View style={{ width: 36 }} />} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>We take your privacy seriously. Here's how your data is protected.</Text>

        {sections.map((s) => (
          <View key={s.title} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconWrap}>
                <Ionicons name={s.icon} size={18} color={Colors.accent} />
              </View>
              <Text style={styles.cardTitle}>{s.title}</Text>
            </View>
            {s.bullets.map((b) => (
              <View key={b} style={styles.bulletRow}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        ))}

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconWrap}>
              <Ionicons name="mail-outline" size={18} color={Colors.accent} />
            </View>
            <Text style={styles.cardTitle}>Contact Privacy Team</Text>
          </View>
          <TouchableOpacity>
            <Text style={styles.email}>support@fitme.app</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.background },
  scroll:      { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxxl },
  intro:       { fontSize: 13, color: Colors.mutedForeground, lineHeight: 20, marginBottom: Spacing.xl },
  card:        { backgroundColor: Colors.card, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.xl, marginBottom: Spacing.md },
  cardHeader:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: Spacing.md },
  iconWrap:    { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.accent + '15', alignItems: 'center', justifyContent: 'center' },
  cardTitle:   { fontFamily: 'serif', fontSize: 15, color: Colors.foreground },
  bulletRow:   { flexDirection: 'row', gap: 8, marginBottom: 6, alignItems: 'flex-start' },
  bulletDot:   { width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.mutedForeground, marginTop: 7, flexShrink: 0 },
  bulletText:  { fontSize: 13, color: Colors.mutedForeground, flex: 1, lineHeight: 20 },
  email:       { fontSize: 13, color: Colors.accent },
});
