import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Clipboard, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../src/constants/theme';

export default function ContactSupport() {
  const supportEmail = 'support@fitmefashion.com';

  const handleCopyEmail = () => {
    Clipboard.setString(supportEmail);
    Alert.alert('Copied', 'Support email address copied to clipboard.');
  };

  const handleSendEmail = () => {
    Linking.openURL(`mailto:${supportEmail}`).catch(() => {
      handleCopyEmail();
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Contact Support" back />
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="mail-outline" size={44} color={Colors.accent} />
        </View>
        <Text style={styles.title}>How Can We Help?</Text>
        <Text style={styles.description}>
          Have questions, feedback, or need assistance with your try-ons or account? Reach out to our support team:
        </Text>
        
        <TouchableOpacity style={styles.emailContainer} onPress={handleSendEmail} activeOpacity={0.7}>
          <Ionicons name="mail" size={18} color={Colors.accent} />
          <Text style={styles.emailText}>{supportEmail}</Text>
          <Ionicons name="open-outline" size={16} color={Colors.mutedForeground} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.copyBtn} onPress={handleCopyEmail} activeOpacity={0.7}>
          <Ionicons name="copy-outline" size={14} color={Colors.mutedForeground} />
          <Text style={styles.tapToCopy}>Copy email to clipboard</Text>
        </TouchableOpacity>

        <View style={styles.webRow}>
          <Text style={styles.webText}>Official Website: </Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://fitmefashion.com')}>
            <Text style={styles.webLink}>fitmefashion.com</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xxl },
  iconWrap: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: Colors.accent + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  title: {
    fontFamily: 'serif',
    fontSize: 22,
    color: Colors.foreground,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  description: {
    fontSize: 14,
    color: Colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xxl,
  },
  emailContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.xl,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: Spacing.xs,
  },
  emailText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.foreground,
  },
  tapToCopy: {
    fontSize: 12,
    color: Colors.mutedForeground,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: Spacing.xl,
  },
  webRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.md,
  },
  webText: {
    fontSize: 13,
    color: Colors.mutedForeground,
  },
  webLink: {
    fontSize: 13,
    color: Colors.accent,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
