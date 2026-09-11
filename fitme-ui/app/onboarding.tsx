import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radii } from '../src/constants/theme';

const { width } = Dimensions.get('window');

const slides = [
  {
    eyebrow: 'AI Virtual Try-On',
    title: 'See Yourself\nIn Any Outfit',
    body: 'Paste a product link, add your photo, and see yourself wearing it.',
  },
  {
    eyebrow: 'From your favorite stores',
    title: 'Studio Quality\nVirtual Try-On',
    body: 'Realistic fit, fabric and lighting from any fashion shop.',
  },
  {
    eyebrow: 'Meet Ava',
    title: 'Your Personal\nAI Stylist',
    body: 'Shoes, bags, jackets — Ava completes the look.',
  },
];

import { RetailerLogo } from '../src/components/RetailerLogo';

const beforeImg = 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=600&h=800&q=80';
const afterImg = 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=600&h=800&q=80';
const platforms = ['Myntra', 'AJIO', 'Amazon', 'H&M', 'Nykaa', 'Meesho'];

export default function Onboarding() {
  const [idx, setIdx] = useState(0);
  const router = useRouter();
  const slide = slides[idx];

  const next = () => {
    if (idx < slides.length - 1) setIdx(idx + 1);
    else router.replace('/login');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.skipRow}>
        <TouchableOpacity onPress={() => router.replace('/login')}>
          <Text style={styles.skip}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Visual card */}
        <View style={styles.card}>
          <View style={styles.eyebrowRow}>
            <Ionicons name="link-outline" size={12} color={Colors.mutedForeground} />
            <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
          </View>

          {idx === 0 && (
            <View style={styles.tryOnVisual}>
              <View style={styles.beforeImg}>
                <Image source={{ uri: beforeImg }} style={styles.imgFull} />
                <View style={styles.productBubble}>
                  <Image source={{ uri: afterImg }} style={styles.bubbleThumb} />
                  <View>
                    <Text style={styles.bubbleStore}>Myntra</Text>
                    <Text style={styles.bubbleName}>Floral Puff Dress</Text>
                    <Text style={styles.bubblePrice}>₹2,299</Text>
                  </View>
                </View>
              </View>
              <View style={styles.afterImg}>
                <Image source={{ uri: afterImg }} style={styles.imgFull} />
                <View style={styles.onYouBadge}>
                  <Ionicons name="sparkles" size={8} color={Colors.accent} />
                  <Text style={styles.onYouText}>ON YOU</Text>
                </View>
              </View>
            </View>
          )}

          {idx === 1 && (
            <View style={styles.platformsVisual}>
              <View style={styles.platformGrid}>
                {platforms.map((p) => (
                  <View key={p} style={styles.platformChip}>
                    <RetailerLogo retailer={p} size={14} />
                    <Text style={styles.platformText}>{p}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.arrowDown}>
                <Ionicons name="arrow-down" size={16} color={Colors.accent} />
              </View>
              <View style={styles.tryOnPair}>
                <Image source={{ uri: beforeImg }} style={styles.pairImg} />
                <View style={styles.pairImgHighlight}>
                  <Image source={{ uri: afterImg }} style={styles.imgFull} />
                  <View style={styles.onYouBadgeSmall}>
                    <Text style={styles.onYouTextSmall}>ON YOU</Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {idx === 2 && (
            <View style={styles.stylistVisual}>
              <View style={styles.avaMain}>
                <Image source={{ uri: afterImg }} style={styles.imgFull} />
                <View style={styles.avaBubble}>
                  <View style={styles.avaBubbleIcon}>
                    <Ionicons name="sparkles" size={10} color={Colors.accent} />
                  </View>
                  <View>
                    <Text style={styles.avaName}>Ava</Text>
                    <Text style={styles.avaMsg}>Here are picks to complete it.</Text>
                  </View>
                </View>
              </View>
              <View style={styles.avaAccessories}>
                {['Sneakers', 'Bag', 'Necklace', 'Watch'].map((item, i) => (
                  <View key={item} style={styles.accessoryItem}>
                    <View style={styles.accessoryImg}>
                      <Image
                        source={{ uri: `https://images.unsplash.com/photo-${i === 0 ? '1542291026-7eec264c27ff' : i === 1 ? '1548036328-c9fa89d128fa' : i === 2 ? '1611652022419-a9419f74343d' : '1524592094714-0f0654e20314'}?auto=format&fit=crop&w=200&q=80` }}
                        style={styles.imgFull}
                      />
                    </View>
                    <Text style={styles.accessoryLabel}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        <View style={styles.textBlock}>
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.body}>{slide.body}</Text>
        </View>

        <View style={styles.dots}>
          {slides.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === idx ? styles.dotActive : styles.dotInactive]}
            />
          ))}
        </View>

        <TouchableOpacity style={styles.btn} onPress={next}>
          <Text style={styles.btnText}>{idx < slides.length - 1 ? 'Continue' : 'Get Started'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  skipRow: { alignItems: 'flex-end', paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm },
  skip: { fontSize: 14, color: Colors.mutedForeground },
  scroll: { padding: Spacing.xl, paddingTop: Spacing.md },
  card: {
    backgroundColor: '#EFE4D7',
    borderRadius: Radii.xxl,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  eyebrowRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.7)', alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radii.full,
    marginBottom: Spacing.lg,
  },
  eyebrow: { fontSize: 10, letterSpacing: 2, color: Colors.foreground, textTransform: 'uppercase' },
  tryOnVisual: { flexDirection: 'row', gap: 8, height: 220 },
  beforeImg: { flex: 1, borderRadius: Radii.xl, overflow: 'hidden', position: 'relative', backgroundColor: Colors.muted },
  afterImg: { flex: 1, borderRadius: Radii.xl, overflow: 'hidden', position: 'relative', backgroundColor: Colors.muted, borderWidth: 2, borderColor: Colors.accent + '66' },
  imgFull: { width: '100%', height: '100%', resizeMode: 'cover' },
  productBubble: {
    position: 'absolute', bottom: 8, left: 8, right: 8,
    backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 10, padding: 6,
    flexDirection: 'row', gap: 6, alignItems: 'center',
  },
  bubbleThumb: { width: 32, height: 40, borderRadius: 6, resizeMode: 'cover' },
  bubbleStore: { fontSize: 8, color: Colors.mutedForeground, textTransform: 'uppercase' },
  bubbleName: { fontSize: 9, color: Colors.foreground },
  bubblePrice: { fontSize: 9, color: Colors.accent },
  onYouBadge: {
    position: 'absolute', top: 6, left: 6,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 20,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  onYouText: { fontSize: 8, letterSpacing: 1.5, color: Colors.accent, textTransform: 'uppercase' },
  platformsVisual: { alignItems: 'center', gap: 12 },
  platformGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  platformChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  platformText: { fontSize: 12, color: Colors.foreground },
  arrowDown: { marginVertical: 4 },
  tryOnPair: { flexDirection: 'row', gap: 8, height: 160 },
  pairImg: { flex: 1, borderRadius: Radii.xl, resizeMode: 'cover', backgroundColor: Colors.muted },
  pairImgHighlight: { flex: 1, borderRadius: Radii.xl, overflow: 'hidden', borderWidth: 2, borderColor: Colors.accent + '66', backgroundColor: Colors.muted },
  onYouBadgeSmall: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 20, paddingHorizontal: 6, paddingVertical: 2 },
  onYouTextSmall: { fontSize: 7, letterSpacing: 1, color: Colors.accent, textTransform: 'uppercase' },
  stylistVisual: { flexDirection: 'row', gap: 8, height: 220 },
  avaMain: { flex: 1.1, borderRadius: Radii.xl, overflow: 'hidden', position: 'relative', backgroundColor: Colors.muted },
  avaBubble: {
    position: 'absolute', bottom: 8, left: 6, right: 6,
    backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 10, padding: 8,
    flexDirection: 'row', gap: 6, alignItems: 'center',
  },
  avaBubbleIcon: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.accent + '22', alignItems: 'center', justifyContent: 'center' },
  avaName: { fontSize: 9, fontWeight: '600', color: Colors.foreground },
  avaMsg: { fontSize: 8, color: Colors.mutedForeground },
  avaAccessories: { flex: 1, flexWrap: 'wrap', gap: 4 },
  accessoryItem: { width: '47%', borderRadius: 10, overflow: 'hidden', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  accessoryImg: { height: 60, backgroundColor: Colors.muted },
  accessoryLabel: { fontSize: 8, color: Colors.mutedForeground, textTransform: 'uppercase', padding: 4 },
  textBlock: { marginBottom: Spacing.xl },
  title: { fontFamily: 'serif', fontSize: 30, color: Colors.foreground, lineHeight: 36, marginBottom: Spacing.sm },
  body: { fontSize: 14, color: Colors.mutedForeground, lineHeight: 22 },
  dots: { flexDirection: 'row', gap: 6, marginBottom: Spacing.xxl },
  dot: { height: 6, borderRadius: 3 },
  dotActive: { width: 28, backgroundColor: Colors.accent },
  dotInactive: { width: 6, backgroundColor: Colors.border },
  btn: {
    backgroundColor: Colors.primary, borderRadius: Radii.full,
    paddingVertical: 16, alignItems: 'center',
  },
  btnText: { color: Colors.primaryForeground, fontSize: 15, fontWeight: '500' },
});
