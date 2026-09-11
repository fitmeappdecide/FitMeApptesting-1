import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { CachedImage } from '../src/components/CachedImage';
import { historyItems as mockHistoryItems } from '../src/data/mockData';
import { tryOnApi, TryOnHistoryItem } from '../src/services/api';
import { Colors, Spacing, Radii } from '../src/constants/theme';

export default function History() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      setLoading(true);
      const res = await tryOnApi.getHistory({ status: 'completed' });
      if (res && res.length > 0) {
        setItems(
          res.map((j: TryOnHistoryItem) => ({
            id: j.id,
            title: j.title || 'Virtual Try-On Look',
            brand: j.brand || 'FitMe',
            date: j.created_at ? new Date(j.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent',
            image: (j.result_image_urls && j.result_image_urls[0]) || j.thumbnail_url || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800',
          }))
        );
      } else {
        setItems(mockHistoryItems);
      }
    } catch (e) {
      console.warn('[History] Error loading real tryon history, using fallback:', e);
      setItems(mockHistoryItems);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Try-on history" back />
      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {items.map((item) => (
            <View key={item.id} style={styles.row}>
              <CachedImage uri={item.image} style={styles.thumb} />
              <View style={styles.info}>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.meta}>{item.brand} · {item.date}</Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/(tabs)/ava', params: { initialQuery: `Recommend products for ${item.title}` } } as any)}
                style={styles.retryBtn}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="sparkles" size={16} color={Colors.foreground} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.xl, maxWidth: 640, width: '100%', alignSelf: 'center' },
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
