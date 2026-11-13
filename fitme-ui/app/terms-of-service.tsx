import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii, Fonts } from '../src/constants/theme';

const WEB_URL = 'https://fitmefashion.com/terms-and-conditions';
const SUPPORT_EMAIL = 'support@fitmefashion.com';

const sections = [
  {
    title: '1. Acceptance of Terms & Eligibility',
    content:
      'By creating an account, downloading, or using the FitMe mobile application ("FitMe," "the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the application. You must be at least 13 years of age (or 16 in the European Economic Area/UK) to use FitMe.',
  },
  {
    title: '2. Description of the Service',
    content:
      'FitMe provides an artificial intelligence-assisted visualization tool that superimposes garments onto user-uploaded photographs to simulate how clothing may appear on the user ("Virtual Try-On"). FitMe is an interactive visualization application and does not sell, manufacture, or ship physical apparel.',
  },
  {
    title: '3. User Accounts & Security',
    content:
      'You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized access or breach of security at support@fitmefashion.com.',
  },
  {
    title: '4. User-Uploaded Photos & Content Standards',
    bullets: [
      'Ownership: You retain full ownership and intellectual property rights in any photographs you upload to FitMe.',
      'License to Process: You grant FitMe a non-exclusive, worldwide, royalty-free license solely to process, render, and display your photos for the purpose of generating your virtual try-ons.',
      'Representation & Warranties: You represent and warrant that you own or have obtained all necessary rights and consent to upload any photo of yourself or garments.',
      'Prohibited Content: You may NOT upload photographs containing nudity, sexually explicit content, violence, hate speech, illegal material, or photos of individuals without their explicit consent.',
      'Enforcement: FitMe reserves the right to remove non-compliant content and immediately terminate accounts that violate our community standards.',
    ],
  },
  {
    title: '5. AI Virtual Try-On Simulation Disclaimer',
    bullets: [
      'Visual Simulation Only: Virtual try-on outputs are generated through artificial intelligence models and are intended solely for creative visualization and styling ideas.',
      'No Sizing Guarantee: AI-generated images do not represent an exact guarantee of physical garment fit, fabric drape, color accuracy, or material texture in real life.',
      'Merchant Independence: FitMe is independent of third-party apparel brands and merchants. We are not responsible for pricing, quality, availability, or returns of physical garments.',
    ],
  },
  {
    title: '6. Subscriptions & In-App Purchases',
    bullets: [
      'Pro Subscriptions: Optional Pro subscriptions or premium try-on tiers may be offered with recurring monthly or annual billing.',
      'Billing Management: Subscriptions purchased via iOS are billed through your Apple ID; purchases via Android are billed through Google Play.',
      'Automatic Renewal: Subscriptions automatically renew unless cancelled at least 24 hours prior to the end of the current billing cycle.',
      'Cancellation & Refunds: You may manage or cancel your subscription at any time in your Apple App Store or Google Play account settings. Refunds are subject to Apple and Google refund policies.',
    ],
  },
  {
    title: '7. Intellectual Property',
    content:
      'All rights, title, and interest in the FitMe application, including software code, interfaces, algorithms, visual designs, brand names, and trademarks, remain the exclusive property of FitMe. You receive a limited, revocable, non-transferable license to use the app for personal, non-commercial purposes.',
  },
  {
    title: '8. Account Termination',
    content:
      'You may stop using the Service and permanently delete your account, photos, and personal data at any time via Profile > Danger Zone > Delete Account. We reserve the right to suspend or terminate accounts that breach these Terms without prior notice.',
  },
  {
    title: '9. Disclaimer of Warranties & Limitation of Liability',
    content:
      'THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. IN NO EVENT SHALL FITME BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING OUT OF YOUR USE OF THE SERVICE OR AI-GENERATED OUTPUTS.',
  },
  {
    title: '10. Changes to Terms',
    content:
      'We may modify these Terms periodically. We will provide notice of significant updates within the application. Continued use of FitMe constitutes your agreement to the updated Terms.',
  },
];

export default function TermsOfService() {
  const handleOpenWeb = () => {
    Linking.openURL(WEB_URL).catch(() =>
      Alert.alert('Notice', 'Unable to open browser. The full terms are displayed below.'),
    );
  };

  const handleEmailSupport = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() =>
      Alert.alert('Contact Support', `Please email our legal team at:\n${SUPPORT_EMAIL}`),
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader
        title="Terms of Service"
        back
        right={
          <TouchableOpacity
            onPress={handleOpenWeb}
            style={styles.webIconBtn}
            activeOpacity={0.7}
            accessibilityLabel="Open in Web Browser"
          >
            <Ionicons name="open-outline" size={20} color={Colors.foreground} />
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header Badge */}
        <View style={styles.badgeWrap}>
          <View style={styles.badge}>
            <Ionicons name="document-text" size={14} color={Colors.accent} />
            <Text style={styles.badgeText}>Effective: November 2026</Text>
          </View>
          <Text style={styles.subtitle}>FitMe Terms & Conditions</Text>
        </View>

        {/* Overview Box */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Terms Summary</Text>
          <View style={styles.summaryItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.accent} />
            <Text style={styles.summaryText}>You own the photos you upload to FitMe.</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.accent} />
            <Text style={styles.summaryText}>No inappropriate, nude, or unauthorized photo uploads.</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.accent} />
            <Text style={styles.summaryText}>Try-on images are AI visual simulations, not sizing guarantees.</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.accent} />
            <Text style={styles.summaryText}>Self-serve account deletion is always available in your Profile.</Text>
          </View>
        </View>

        {/* Detailed Terms Sections */}
        {sections.map((s) => (
          <View key={s.title} style={styles.sectionCard}>
            <Text style={styles.sectionHeading}>{s.title}</Text>
            {s.content && <Text style={styles.sectionBody}>{s.content}</Text>}
            {s.bullets &&
              s.bullets.map((b, idx) => (
                <View key={idx} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>{b}</Text>
                </View>
              ))}
          </View>
        ))}

        {/* Contact Support Card */}
        <View style={styles.contactCard}>
          <View style={styles.contactHeader}>
            <Ionicons name="help-circle" size={18} color={Colors.accent} />
            <Text style={styles.contactTitle}>11. Questions & Support</Text>
          </View>
          <Text style={styles.contactDesc}>
            If you have questions regarding these Terms of Service, please reach out to us:
          </Text>
          <TouchableOpacity style={styles.emailBtn} onPress={handleEmailSupport} activeOpacity={0.7}>
            <Ionicons name="mail-outline" size={16} color={Colors.accent} />
            <Text style={styles.emailText}>{SUPPORT_EMAIL}</Text>
          </TouchableOpacity>
          <Text style={styles.domainText}>Website: https://fitmefashion.com</Text>
        </View>

        <View style={{ height: Spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.xxxl },
  webIconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  badgeWrap: { alignItems: 'center', marginBottom: Spacing.lg },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.accent + '15',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radii.full,
    marginBottom: Spacing.xs,
  },
  badgeText: { fontSize: 12, fontWeight: '600', color: Colors.accent },
  subtitle: { fontSize: 13, color: Colors.mutedForeground, marginTop: 4 },

  summaryCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  summaryTitle: {
    fontFamily: Fonts.display,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.foreground,
    marginBottom: Spacing.md,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  summaryText: {
    fontSize: 13,
    color: Colors.foreground,
    lineHeight: 19,
    flex: 1,
  },

  sectionCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
    marginBottom: Spacing.md,
  },
  sectionHeading: {
    fontFamily: Fonts.display,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.foreground,
    marginBottom: Spacing.sm,
  },
  sectionBody: {
    fontSize: 13,
    color: Colors.mutedForeground,
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 6,
  },
  bulletDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.accent,
    marginTop: 8,
    flexShrink: 0,
  },
  bulletText: {
    fontSize: 13,
    color: Colors.mutedForeground,
    lineHeight: 20,
    flex: 1,
  },

  contactCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
    marginTop: Spacing.xs,
    marginBottom: Spacing.xl,
  },
  contactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.sm,
  },
  contactTitle: {
    fontFamily: Fonts.display,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.foreground,
  },
  contactDesc: {
    fontSize: 13,
    color: Colors.mutedForeground,
    lineHeight: 19,
    marginBottom: Spacing.md,
  },
  emailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: Colors.muted,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radii.lg,
    marginBottom: Spacing.sm,
  },
  emailText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.accent,
  },
  domainText: {
    fontSize: 12,
    color: Colors.mutedForeground,
  },
});
