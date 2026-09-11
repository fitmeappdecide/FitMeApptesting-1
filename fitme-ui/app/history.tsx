import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { historyItems } from '../src/data/mockData';
import { Colors, Spacing, Radii } from '../src/constants/theme';

export default function History() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Try-on history" back />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {historyItems.map((item) => (
          <View key={item.id} style={styles.row}>
            <Image source={{ uri: item.image }} style={styles.thumb} />
            <View style={styles.info}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.meta}>{item.brand} · {item.date}</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/result')} style={styles.retryBtn}>
              <Ionicons name="refresh-outline" size={18} color={Colors.foreground} />
            </TouchableOpacity>
          </View>
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.card, borderRadius: Radii.xl,
    borderWidth: 1, borderColor: Colors.border,
    padding: 12, marginBottom: 10,
  },
  thumb: { width: 56, height: 70, borderRadius: Radii.md, resizeMode: 'cover', backgroundColor: Colors.muted },
  info: { flex: 1 },
  title: { fontSize: 14, color: Colors.foreground, fontWeight: '500' },
  meta: { fontSize: 12, color: Colors.mutedForeground, marginTop: 3 },
  retryBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.muted, alignItems: 'center', justifyContent: 'center',
  },
});
