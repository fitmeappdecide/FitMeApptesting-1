import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { CachedImage } from '../src/components/CachedImage';
import { savedLooks } from '../src/data/mockData';
import { Colors, Spacing, Radii } from '../src/constants/theme';

export default function Saved() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Saved looks" back />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {savedLooks.map((look) => (
            <TouchableOpacity key={look.id} style={styles.card} onPress={() => router.push('/result')} activeOpacity={0.85}>
              <CachedImage uri={look.image} style={styles.img} />
              <View style={styles.info}>
                <Text style={styles.title}>{look.title}</Text>
                {/* FIX: outline icons, properly aligned */}
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.actionBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="heart-outline" size={18} color={Colors.foreground} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="share-social-outline" size={18} color={Colors.foreground} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={18} color={Colors.foreground} />
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll:    { paddingHorizontal: Spacing.xl, maxWidth: 640, width: '100%', alignSelf: 'center' },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card:      { width: '47.5%', backgroundColor: Colors.card, borderRadius: Radii.xl, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  img:       { width: '100%', aspectRatio: 3 / 4, resizeMode: 'cover', backgroundColor: Colors.muted },
  info:      { padding: 10 },
  title:     { fontSize: 13, color: Colors.foreground, marginBottom: 8 },
  actions:   { flexDirection: 'row', gap: 14, alignItems: 'center' },
  actionBtn: { padding: 2 },
});
