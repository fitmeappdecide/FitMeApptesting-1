import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, Dimensions, NativeSyntheticEvent, NativeScrollEvent,
  Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../src/constants/theme';
import { useUserStore } from '../src/services/userStore';

const { width: SCREEN_W } = Dimensions.get('window');


/* ─── Feature row component ─────────────────────────── */

function Feature({
  text, included, isPro,
}: { text: string; included: boolean; isPro: boolean }) {
  const icon   = included ? (isPro ? 'sparkles' : 'checkmark') : 'close';
  const color  = included ? (isPro ? Colors.accent : Colors.success) : Colors.mutedForeground;
  const tColor = included ? Colors.foreground : Colors.mutedForeground;

  return (
    <View style={fStyles.row}>
      <View style={[fStyles.icon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon as any} size={13} color={color} />
      </View>
      <Text style={[fStyles.text, !included && fStyles.textMuted]}>{text}</Text>
    </View>
  );
}

const fStyles = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon:     { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  text:     { flex: 1, fontSize: 14, color: Colors.foreground },
  textMuted:{ color: Colors.mutedForeground, textDecorationLine: 'line-through' },
});

/* ─── Main screen ───────────────────────────────────── */

export default function Subscription() {
  const { isPremium, setPremium } = useUserStore();
  const scrollRef  = useRef<ScrollView>(null);
  const [activePg, setActivePg] = useState(0);

  const scrollTo = (i: number) => {
    scrollRef.current?.scrollTo({ x: i * SCREEN_W, animated: true });
    setActivePg(i);
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const pg = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    setActivePg(pg);
  };

  /* Billing actions ── TODO: wire RevenueCat ───────── */
  const handleUpgrade = () => {
    // TODO: Present RevenueCat paywall (Offerings.current) for Pro purchase
    Alert.alert(
      'Upgrade to Pro',
      'This will open the native purchase flow.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mock Purchase ✓', onPress: () => setPremium(true) },
      ],
    );
  };

  const handleManage = () => {
    // TODO: Open RevenueCat CustomerCenter or native subscription management
    if (Platform.OS === 'ios') {
      Linking.openURL('https://apps.apple.com/account/subscriptions').catch(() =>
        Alert.alert('Manage Subscription', 'Unable to open subscription management. Please go to Settings → Apple ID → Subscriptions.'),
      );
    } else {
      Linking.openURL('https://play.google.com/store/account/subscriptions').catch(() =>
        Alert.alert('Manage Subscription', 'Unable to open subscription management. Please visit the Play Store.'),
      );
    }
  };

  const handleRestore = () => {
    // TODO: Call RevenueCat.restorePurchases() and sync isPremium state
    Alert.alert('Restore Purchases', 'Checking for previous purchases…\n\n(RevenueCat integration pending)');
  };

  const handleBilling = () => {
    // TODO: Fetch billing history from RevenueCat or App Store / Play billing API
    Alert.alert('Billing History', 'Retrieving your billing history…\n\n(RevenueCat integration pending)');
  };

  /* ─── Render ──────────────────────────────────────── */

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Subscription" back />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Current plan hero ─────────────────────── */}
        <View style={styles.planHero}>
          <View style={styles.planHeroLeft}>
            <Text style={styles.planHeroLabel}>Current Plan</Text>
            <Text style={styles.planHeroName}>
              {isPremium ? 'FitMe Pro' : 'FitMe Free'}
            </Text>
            {isPremium ? (
              <Text style={styles.planHeroSub}>Active · All features unlocked</Text>
            ) : (
              <Text style={styles.planHeroSub}>Limited · Swipe to compare plans</Text>
            )}
          </View>

          <View style={[styles.planHeroBadge, isPremium && styles.planHeroBadgePro]}>
            {isPremium
              ? <Ionicons name="sparkles" size={22} color={Colors.accent} />
              : <Ionicons name="person-outline" size={22} color={Colors.mutedForeground} />
            }
          </View>
        </View>

        {/* ── Plan toggle tabs ──────────────────────── */}
        <View style={styles.segmentBar}>
          {['Free', 'Pro'].map((label, i) => (
            <TouchableOpacity
              key={label}
              style={[styles.segmentBtn, activePg === i && styles.segmentBtnActive]}
              onPress={() => scrollTo(i)}
              activeOpacity={0.8}
            >
              {i === 1 && <Ionicons name="sparkles" size={11} color={activePg === 1 ? Colors.accent : Colors.mutedForeground} style={{ marginRight: 4 }} />}
              <Text style={[styles.segmentText, activePg === i && styles.segmentTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Swipeable comparison cards ────────────── */}
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          decelerationRate="fast"
          style={styles.swiper}
        >
          {/* FREE CARD */}
          <View style={{ width: SCREEN_W, paddingHorizontal: Spacing.xl }}>
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <Text style={styles.cardTier}>FREE</Text>
                {!isPremium && <View style={styles.currentBadge}><Text style={styles.currentBadgeText}>Current</Text></View>}
              </View>

              <View style={styles.priceRow}>
                <Text style={styles.priceInt}>$0</Text>
                <Text style={styles.pricePeriod}> / month</Text>
              </View>
              <Text style={styles.priceNote}>No credit card required</Text>

              <View style={styles.cardDivider} />

              <View style={styles.featureList}>
                <Feature text="10 try-ons per month"       included isPro={false} />
                <Feature text="Store up to 3 photos"       included isPro={false} />
                <Feature text="Standard processing"        included isPro={false} />
                <Feature text="Standard resolution output" included isPro={false} />
                <Feature text="Unlimited try-ons"          included={false} isPro={false} />
                <Feature text="AI Stylist"                 included={false} isPro={false} />
                <Feature text="Priority processing"        included={false} isPro={false} />
              </View>

              <View style={styles.currentPlanBtn}>
                <Text style={styles.currentPlanBtnText}>
                  {isPremium ? 'Free Tier' : 'Your Plan'}
                </Text>
              </View>
            </View>
          </View>

          {/* PRO CARD */}
          <View style={{ width: SCREEN_W, paddingHorizontal: Spacing.xl }}>
            <View style={[styles.card, styles.proCard]}>
              {/* Most popular ribbon */}
              <View style={styles.popularRibbon}>
                <Ionicons name="sparkles" size={10} color={Colors.accent} />
                <Text style={styles.popularText}>Most Popular</Text>
              </View>

              <View style={styles.cardTopRow}>
                <Text style={[styles.cardTier, styles.proTier]}>PRO</Text>
                {isPremium && <View style={styles.currentBadge}><Text style={styles.currentBadgeText}>Current</Text></View>}
              </View>

              <View style={styles.priceRow}>
                <Text style={[styles.priceInt, styles.proPriceInt]}>$9.99</Text>
                <Text style={styles.pricePeriod}> / month</Text>
              </View>
              <Text style={styles.priceNote}>Cancel anytime · No hidden fees</Text>

              <View style={styles.cardDivider} />

              <View style={styles.featureList}>
                <Feature text="Unlimited try-ons"       included isPro />
                <Feature text="Store up to 5 photos"    included isPro />
                <Feature text="Priority processing"     included isPro />
                <Feature text="Highest quality output"  included isPro />
                <Feature text="AI Stylist recommendations" included isPro />
                <Feature text="Faster generation"       included isPro />
                <Feature text="Early access to new features" included isPro />
              </View>

              {isPremium ? (
                <View style={styles.proActiveRow}>
                  <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                  <Text style={styles.proActiveText}>You're a Pro Member</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.upgradeBtn} onPress={handleUpgrade} activeOpacity={0.85}>
                  <Ionicons name="sparkles" size={16} color={Colors.primaryForeground} />
                  <Text style={styles.upgradeBtnText}>Upgrade to Pro — $9.99/mo</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </ScrollView>



        {/* ── Billing management ────────────────────── */}
        <Text style={styles.sectionTitle}>Manage</Text>
        <View style={styles.menuCard}>
          <TouchableOpacity style={styles.menuRowBorder} onPress={handleManage} activeOpacity={0.7}>
            <View style={styles.menuIcon}>
              <Ionicons name="card-outline" size={17} color={Colors.foreground} />
            </View>
            <Text style={styles.menuLabel}>Manage Subscription</Text>
            <Ionicons name="chevron-forward" size={15} color={Colors.mutedForeground} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRowBorder} onPress={handleRestore} activeOpacity={0.7}>
            <View style={styles.menuIcon}>
              <Ionicons name="refresh-outline" size={17} color={Colors.foreground} />
            </View>
            <Text style={styles.menuLabel}>Restore Purchases</Text>
            <Ionicons name="chevron-forward" size={15} color={Colors.mutedForeground} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow} onPress={handleBilling} activeOpacity={0.7}>
            <View style={styles.menuIcon}>
              <Ionicons name="receipt-outline" size={17} color={Colors.foreground} />
            </View>
            <Text style={styles.menuLabel}>Billing History</Text>
            <Ionicons name="chevron-forward" size={15} color={Colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <Text style={styles.legalNote}>
          Subscriptions automatically renew unless cancelled at least 24 hours before the end
          of the current period. Manage or cancel in your{' '}
          {Platform.OS === 'ios' ? 'App Store account settings' : 'Google Play account'}.
        </Text>

        <View style={{ height: Spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll:    { paddingTop: Spacing.md },

  /* Plan hero */
  planHero: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.xl,
    backgroundColor: Colors.card,
    borderRadius: Radii.xxl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  planHeroLeft: { flex: 1 },
  planHeroLabel: {
    fontSize: 10, letterSpacing: 1.8, color: Colors.mutedForeground,
    textTransform: 'uppercase', marginBottom: 4,
  },
  planHeroName: { fontFamily: 'serif', fontSize: 26, color: Colors.foreground, marginBottom: 4 },
  planHeroSub:  { fontSize: 12, color: Colors.mutedForeground },
  planHeroBadge: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  planHeroBadgePro: { backgroundColor: Colors.accent + '15' },

  /* Segment bar */
  segmentBar: {
    flexDirection: 'row',
    backgroundColor: Colors.muted,
    borderRadius: Radii.full,
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    padding: 3,
  },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderRadius: Radii.full,
  },
  segmentBtnActive: { backgroundColor: Colors.card, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  segmentText:       { fontSize: 13, fontWeight: '600', color: Colors.mutedForeground },
  segmentTextActive: { color: Colors.foreground },

  /* Swiper */
  swiper: { marginBottom: Spacing.sm },

  /* Card */
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xxl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.foreground,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  proCard: {
    borderColor: Colors.accent,
    borderWidth: 2,
  },

  /* Popular ribbon */
  popularRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: Colors.accent + '15',
    borderRadius: Radii.full,
    paddingHorizontal: 10, paddingVertical: 4,
    gap: 4,
    marginBottom: Spacing.md,
  },
  popularText: { fontSize: 10, fontWeight: '700', color: Colors.accent, letterSpacing: 0.8 },

  cardTopRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  cardTier:    { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: Colors.mutedForeground },
  proTier:     { color: Colors.accent },

  currentBadge:     { backgroundColor: Colors.success + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radii.full },
  currentBadgeText: { fontSize: 10, color: Colors.success, fontWeight: '600' },

  priceRow:   { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2 },
  priceInt:   { fontFamily: 'serif', fontSize: 40, color: Colors.foreground, lineHeight: 44 },
  proPriceInt:{ color: Colors.foreground },
  pricePeriod:{ fontSize: 14, color: Colors.mutedForeground, marginBottom: 6 },
  priceNote:  { fontSize: 11, color: Colors.mutedForeground, marginBottom: Spacing.lg },

  cardDivider: { height: 1, backgroundColor: Colors.border, marginBottom: Spacing.lg },

  featureList: { gap: 11, marginBottom: Spacing.xl },

  /* Buttons */
  currentPlanBtn: {
    backgroundColor: Colors.muted, paddingVertical: 14,
    borderRadius: Radii.full, alignItems: 'center',
  },
  currentPlanBtnText: { color: Colors.mutedForeground, fontSize: 15, fontWeight: '600' },

  upgradeBtn: {
    backgroundColor: Colors.primary, paddingVertical: 15,
    borderRadius: Radii.full, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: 8,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  upgradeBtnText: { color: Colors.primaryForeground, fontSize: 15, fontWeight: '700' },

  proActiveRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.success + '15', paddingVertical: 14,
    borderRadius: Radii.full,
  },
  proActiveText: { fontSize: 14, color: Colors.success, fontWeight: '600' },

  /* Dots */
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: Spacing.md },
  dot:          { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.border },
  dotActiveFree:{ backgroundColor: Colors.foreground, width: 18 },
  dotActivePro: { backgroundColor: Colors.accent,     width: 18 },

  /* Trust row */
  trustRow: {
    flexDirection: 'row', justifyContent: 'center',
    gap: 20, marginBottom: Spacing.xl, paddingHorizontal: Spacing.xl,
  },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  trustText: { fontSize: 11, color: Colors.mutedForeground },

  /* Section title */
  sectionTitle: {
    fontSize: 10, letterSpacing: 1.8, color: Colors.mutedForeground,
    textTransform: 'uppercase', marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },

  /* Menu card */
  menuCard: {
    backgroundColor: Colors.card, borderRadius: Radii.xl,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    marginHorizontal: Spacing.xl, marginBottom: Spacing.lg,
  },
  menuRowBorder: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: Spacing.xl,
    borderBottomWidth: 1, borderBottomColor: Colors.border, minHeight: 52,
  },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: Spacing.xl, minHeight: 52,
  },
  menuIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: Colors.muted, alignItems: 'center', justifyContent: 'center',
  },
  menuLabel: { flex: 1, fontSize: 14, color: Colors.foreground, fontWeight: '500' },

  /* Legal note */
  legalNote: {
    fontSize: 11, color: Colors.mutedForeground,
    lineHeight: 17, textAlign: 'center',
    paddingHorizontal: Spacing.xxl,
    marginBottom: Spacing.xl,
  },
});
