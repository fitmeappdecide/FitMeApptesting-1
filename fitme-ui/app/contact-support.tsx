import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Clipboard, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../src/constants/theme';

export default function ContactSupport() {
  const supportEmail = 'support@fitme.app';

  const handleCopyEmail = () => {
    Clipboard.setString(supportEmail);
    Alert.alert('Copied', 'Support email address copied to clipboard.');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Support" back />
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="mail-unread-outline" size={48} color={Colors.accent} />
        </View>
        <Text style={styles.title}>Unable to open Mail</Text>
        <Text style={styles.description}>
          We couldn't detect a configured email client on your device. Please contact us manually at:
        </Text>
        
        <TouchableOpacity style={styles.emailContainer} onPress={handleCopyEmail} activeOpacity={0.7}>
          <Text style={styles.emailText}>{supportEmail}</Text>
          <Ionicons name="copy-outline" size={16} color={Colors.accent} />
        </TouchableOpacity>
        
        <Text style={styles.tapToCopy}>Tap email to copy to clipboard</Text>
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
});
