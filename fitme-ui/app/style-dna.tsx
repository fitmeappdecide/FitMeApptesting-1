import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../src/constants/theme';

const preferredColors = ['#C97B5A', '#2C2520', '#9B9B9B', '#4A5568', '#2D3748'];
const fits = ['Tailored', 'Relaxed', 'Cropped', 'Oversized', 'Slim'];
const brands = ['Toteme', 'The Row', 'Khaite', 'Cos', 'Lemaire'];

export default function StyleDna() {
  const [selectedFits, setSelectedFits] = useState(['Tailored', 'Relaxed']);
  const [selectedBrands, setSelectedBrands] = useState(['Toteme', 'The Row', 'Khaite']);
  const [selectedColors, setSelectedColors] = useState([0, 1]);

  const toggle = (arr: any[], setArr: Function, val: any) => {
    setArr((prev: any[]) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Style DNA" back />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Colors */}
        <Text style={styles.sectionTitle}>Preferred colors</Text>
        <View style={styles.colorsRow}>
          {preferredColors.map((c, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.colorDot, { backgroundColor: c }, selectedColors.includes(i) && styles.colorDotSelected]}
              onPress={() => toggle(selectedColors, setSelectedColors, i)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            />
          ))}
        </View>

        {/* Fits */}
        <Text style={styles.sectionTitle}>Preferred fits</Text>
        <View style={styles.chipsRow}>
          {fits.map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.chip, selectedFits.includes(f) && styles.chipActive]}
              onPress={() => toggle(selectedFits, setSelectedFits, f)}
            >
              <Text style={[styles.chipText, selectedFits.includes(f) && styles.chipTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Brands */}
        <Text style={styles.sectionTitle}>Preferred brands</Text>
        <View style={styles.chipsRow}>
          {brands.map((b) => (
            <TouchableOpacity
              key={b}
              style={[styles.chip, selectedBrands.includes(b) && styles.chipActive]}
              onPress={() => toggle(selectedBrands, setSelectedBrands, b)}
            >
              <Text style={[styles.chipText, selectedBrands.includes(b) && styles.chipTextActive]}>{b}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Personality card */}
        <View style={styles.personalityCard}>
          <Text style={styles.personalityLabel}>PERSONALITY</Text>
          <Text style={styles.personalityTitle}>Quiet Luxury · Editorial</Text>
          <Text style={styles.personalityBody}>Refined neutrals, tactile fabrics, and considered silhouettes.</Text>
        </View>

        <TouchableOpacity style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Save preferences</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
  },
  sectionTitle: { fontSize: 15, fontWeight: '500', color: Colors.foreground, marginBottom: Spacing.md, marginTop: Spacing.xl },
  colorsRow: { flexDirection: 'row', gap: 12 },
  colorDot: { width: 36, height: 36, borderRadius: 18 },
  colorDotSelected: { borderWidth: 3, borderColor: Colors.accent },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.card, paddingHorizontal: 14, paddingVertical: 8,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.foreground },
  chipTextActive: { color: Colors.primaryForeground },
  personalityCard: {
    backgroundColor: Colors.card, borderRadius: Radii.xl,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.xl, marginTop: Spacing.xxl, marginBottom: Spacing.xl,
  },
  personalityLabel: { fontSize: 9, letterSpacing: 2, color: Colors.mutedForeground, textTransform: 'uppercase', marginBottom: 6 },
  personalityTitle: { fontFamily: 'serif', fontSize: 22, color: Colors.foreground, marginBottom: 6 },
  personalityBody: { fontSize: 13, color: Colors.mutedForeground, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radii.full,
    paddingVertical: 16,
    alignItems: 'center',
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  primaryBtnText: { color: Colors.primaryForeground, fontSize: 15, fontWeight: '500' },
});
