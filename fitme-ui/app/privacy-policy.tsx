import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii, Fonts } from '../src/constants/theme';

const WEB_URL = 'https://fitmefashion.com/privacy-policy';
const SUPPORT_EMAIL = 'support@fitmefashion.com';

const sections = [
  {
    title: '1. Overview & Commitment',
    content:
      'FitMe ("we," "our," or "us") provides an AI-powered virtual try-on mobile application. We respect your privacy and are committed to protecting the personal information you share with us. This Privacy Policy describes how we collect, use, store, and safeguard your data when you use the FitMe mobile application and our website at https://fitmefashion.com.',
  },
  {
    title: '2. Information We Collect',
    bullets: [
      'Account Information: Email address, display name, and authentication tokens provided when creating an account or signing in via Google or Apple.',
      'User Photos & Images: Full-body photos or selfies you choose to upload to create your virtual try-on model, as well as clothing images you import for styling.',
      'Styling & Try-On History: The virtual try-on garments, saved looks, and favorites you create within the app.',
      'Device & Diagnostics: Device model, operating system version, crash reports, and performance metrics to ensure app stability.',
    ],
  },
  {
    title: '3. How We Process Photos & AI Virtual Try-On',
    bullets: [
      'Purpose Limitation: Uploaded photos are used exclusively to process and generate your virtual try-on visualizations.',
      'No Foundation Model Training: We do NOT use your personal photos, likeness, or private try-on images to train public artificial intelligence foundation models.',
      'No Sale to Third Parties: We do NOT sell, rent, monetize, or trade your photos or personal likeness to third-party data brokers, marketers, or advertisers.',
      'Private to Your Account: Your uploaded photos and generated try-ons are private to your authenticated account and are not shared on any public feed.',
    ],
  },
  {
    title: '4. Data Storage & Security',
    content:
      'We implement industry-standard administrative, technical, and physical security measures to protect your information. All photo uploads and API communications are encrypted in transit using Transport Layer Security (TLS 1.3). Photos and user data are stored on secure cloud servers with AES-256 encryption at rest.',
  },
  {
    title: '5. Data Retention & Deletion Rights',
    bullets: [
      'Photo Management: You can delete any uploaded photo at any time directly in the app under Account > My Photos.',
      'Account Deletion: You can permanently delete your entire account, all uploaded photos, try-on history, and personal profile data at any time via Profile > Danger Zone > Delete Account.',
      'Immediate Purge: When you delete your account, your data is permanently and irreversibly purged from our active databases and cloud storage buckets.',
    ],
  },
  {
    title: '6. Third-Party Service Providers',
    bullets: [
      'Authentication: Google Firebase Authentication (Google LLC) and Sign in with Apple (Apple Inc.) for secure account authorization.',
      'Cloud & AI Processing: Secure cloud infrastructure providers used solely to execute the virtual try-on rendering pipelines.',
      'In-App Purchases (Future): Payment transactions are securely processed directly by Apple App Store (Apple Inc.) or Google Play (Google LLC). FitMe does not collect or store credit card numbers.',
    ],
  },
  {
    title: '7. Children\'s Privacy',
    content:
      'FitMe is not directed to individuals under the age of 13 (or under 16 in the European Economic Area and UK). We do not knowingly collect personal information or photographs from children. If we discover that a child has provided us with personal data, we will immediately delete such information.',
  },
  {
    title: '8. Privacy Rights (GDPR & CCPA/CPRA)',
    content:
      'Depending on your jurisdiction, you may have statutory rights under the General Data Protection Regulation (GDPR) or California Consumer Privacy Act (CCPA/CPRA), including the right to access, rectify, or erase your personal data, or restrict processing. You can exercise these rights directly within the app or by contacting our privacy team.',
  },
  {
    title: '9. Changes to this Policy',
    content:
      'We may update this Privacy Policy from time to time. Any material changes will be reflected in the app with an updated "Effective Date." Continued use of FitMe after changes indicates acceptance of the updated policy.',
  },
];

export default function PrivacyPolicy() {
  const handleOpenWeb = () => {
    Linking.openURL(WEB_URL).catch(() =>
      Alert.alert('Notice', 'Unable to open browser. The full policy is displayed below.'),
    );
  };

  const handleEmailSupport = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() =>
      Alert.alert('Contact Support', `Please email our privacy team at:\n${SUPPORT_EMAIL}`),
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader
        title="Privacy Policy"
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
            <Ionicons name="shield-checkmark" size={14} color={Colors.accent} />
            <Text style={styles.badgeText}>Effective: November 2026</Text>
          </View>
          <Text style={styles.subtitle}>FitMe Virtual Try-On Privacy Policy</Text>
        </View>

        {/* Quick Highlights Card */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Key Privacy Commitments</Text>
          <View style={styles.summaryItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.accent} />
            <Text style={styles.summaryText}>Your photos are private and used only for virtual try-on.</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.accent} />
            <Text style={styles.summaryText}>We never sell or rent your photos to third parties or advertisers.</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.accent} />
            <Text style={styles.summaryText}>We do not use your personal photos to train general AI models.</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.accent} />
            <Text style={styles.summaryText}>You can permanently delete your photos and account at any time.</Text>
          </View>
        </View>

        {/* Detailed Policy Sections */}
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

        {/* Contact Us Card */}
        <View style={styles.contactCard}>
          <View style={styles.contactHeader}>
            <Ionicons name="mail" size={18} color={Colors.accent} />
            <Text style={styles.contactTitle}>10. Contact Privacy Team</Text>
          </View>
          <Text style={styles.contactDesc}>
            If you have questions, data deletion requests, or privacy concerns, please contact us at:
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
