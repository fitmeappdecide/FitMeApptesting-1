import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../src/constants/theme';

const fields = [
  { label: 'Height', value: "5'7\"" },
  { label: 'Weight', value: '132 lb' },
  { label: 'Body shape', value: 'Hourglass' },
  { label: 'Bust', value: '34 in' },
  { label: 'Waist', value: '27 in' },
  { label: 'Hips', value: '38 in' },
];

export default function Measurements() {
  const [vals, setVals] = useState(Object.fromEntries(fields.map((f) => [f.label, f.value])));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Measurements" back />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.desc}>Used to tailor every try-on to your body.</Text>

        <View style={styles.card}>
          {fields.map((f, i) => (
            <View key={f.label} style={[styles.row, i === fields.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={styles.rowLabel}>{f.label}</Text>
              <TextInput
                style={styles.rowInput}
                value={vals[f.label]}
                onChangeText={(v) => setVals((p) => ({ ...p, [f.label]: v }))}
              />
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Save changes</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxxl, maxWidth: 520, width: '100%', alignSelf: 'center' },
  desc: { fontSize: 13, color: Colors.mutedForeground, marginBottom: Spacing.xl, lineHeight: 20 },
  card: {
    backgroundColor: Colors.card, borderRadius: Radii.xl,
    borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.xl, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  rowLabel: { fontSize: 14, color: Colors.foreground },
  rowInput: { flex: 1, fontSize: 14, color: Colors.mutedForeground, textAlign: 'right', marginLeft: 16 },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radii.full,
    paddingVertical: 16, alignItems: 'center', maxWidth: 520, width: '100%', alignSelf: 'center',
  },
  primaryBtnText: { color: Colors.primaryForeground, fontSize: 15, fontWeight: '500' },
});
