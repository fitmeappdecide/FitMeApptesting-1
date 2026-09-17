import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Modal, Linking, Alert, Platform, Image,
} from 'react-native';
import { useRouter, Link, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../../src/constants/theme';
import { useUserStore } from '../../src/services/userStore';
import { ProMemberBadge } from '../../src/components/ProMemberBadge';
import * as ImagePicker from 'expo-image-picker';
import { userApi } from '../../src/services/api';
import { logout, deleteCurrentUserFromFirebase } from '../../src/firebase/auth';
import { auth } from '../../src/firebase';


/* ─── Types ─────────────────────────────────────────── */

type MenuRowProps = {
  label: string;
  sublabel?: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconBg?: string;
  iconColor?: string;
  onPress?: () => void;
  href?: string;
  hasBorder?: boolean;
  rightElement?: React.ReactNode;
};

/* ─── Menu Row ──────────────────────────────────────── */

function MenuRow({
  label, sublabel, icon,
  onPress, href, hasBorder = true, rightElement,
}: MenuRowProps) {
  const bg    = Colors.muted;
  const color = Colors.foreground;

  const content = (
    <View style={[styles.menuRow, hasBorder && styles.menuRowBorder]}>
      <View style={[styles.menuIconWrap, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <View style={styles.menuLabelGroup}>
        <Text style={styles.menuLabel}>{label}</Text>
        {sublabel ? <Text style={styles.menuSublabel}>{sublabel}</Text> : null}
      </View>
      {rightElement ?? (
        <Ionicons name="chevron-forward" size={15} color={Colors.mutedForeground} />
      )}
    </View>
  );

  if (href) {
    return (
      <Link href={href as any} asChild>
        <TouchableOpacity activeOpacity={0.7}>{content}</TouchableOpacity>
      </Link>
    );
  }
  return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>;
}

/* ─── Main Screen ───────────────────────────────────── */

export default function Profile() {
  const router = useRouter();
  const { isPremium, profile, setProfile, clearProfile } = useUserStore();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const firebaseUser = auth?.currentUser;

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      // 1. Instantly hydrate userStore with firebase user if present
      if (firebaseUser) {
        setProfile({
          full_name: firebaseUser.displayName || profile?.full_name || null,
          email: firebaseUser.email || profile?.email || null,
          avatar_uri: firebaseUser.photoURL || profile?.avatar_uri || null,
        });
      }

      // 2. Refresh profile details from backend in background
      userApi.getProfile()
        .then((res: any) => {
          if (isMounted && res) {
            setProfile({
              full_name: res.user?.full_name || res.user?.displayName || firebaseUser?.displayName || profile?.full_name || null,
              email: res.user?.email || firebaseUser?.email || profile?.email || null,
              try_on_count: typeof res.try_on_count === 'number' ? res.try_on_count : profile?.try_on_count ?? 0,
              saved_count: typeof res.saved_count === 'number' ? res.saved_count : profile?.saved_count ?? 0,
            });
          }
        })
        .catch((err) => {
          console.warn('[Profile] Background profile sync status:', err?.message || err);
        });

      return () => {
        isMounted = false;
      };
    }, [firebaseUser, setProfile])
  );

  const handleLogout = async () => {
    setLogoutOpen(false);
    clearProfile();
    try {
      await logout();
    } finally {
      router.replace('/login');
    }
  };

  /* Avatar ───────────────────────────────────────── */
  const handleTakePhoto = async () => {
    setEditOpen(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission Denied', 'Camera access is required.');
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!result.canceled && result.assets[0]?.uri) {
      setProfile({ avatar_uri: result.assets[0].uri });
    }
  };

  const handlePickPhoto = async () => {
    setEditOpen(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission Denied', 'Photo library access is required.');
    const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!result.canceled && result.assets[0]?.uri) {
      setProfile({ avatar_uri: result.assets[0].uri });
    }
  };

  const handleRemovePhoto = () => {
    setEditOpen(false);
    setProfile({ avatar_uri: null });
  };

  /* Contact Support ──────────────────────────────── */
  const handleSupport = async () => {
    // TODO: Read version and build from expo-constants in production
    const version = '1.0.4';
    const build   = '98';
    const os      = Platform.OS === 'ios' ? 'iOS' : 'Android';
    const sub     = isPremium ? 'Premium' : 'Free';
    // TODO: Replace with real user ID and email from auth session
    const userId  = 'USR-0000000';
    const email   = 'user@fitme.app';

    const body = [
      'Hi FitMe Support,',
      '',
      'I need help with:',
      '',
      '[Please describe your issue here]',
      '',
      '',
      '--------------------------',
      'Please do not edit below this line',
      '',
      `App Version:  ${version}`,
      `Build:        ${build}`,
      `Platform:     ${os}`,
      `User ID:      ${userId}`,
      `Account:      ${email}`,
      `Subscription: ${sub}`,
    ].join('\n');

    const url = `mailto:support@fitme.app?subject=${encodeURIComponent('FitMe Support Request')}&body=${encodeURIComponent(body)}`;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        // Fallback: device has no mail client configured
        router.push('/contact-support');
      }
    } catch {
      router.push('/contact-support');
    }
  };

  /* External links ───────────────────────────────── */
  const handlePrivacy = () => Linking.openURL('https://fitme.app/privacy');
  const handleTerms   = () => Linking.openURL('https://fitme.app/terms');

  /* Rate ─────────────────────────────────────────── */
  const handleRate = async () => {
    // TODO: Replace with real App Store / Play Store IDs before launch
    const storeUrl = Platform.OS === 'ios'
      ? 'https://apps.apple.com/app/id0000000000'
      : 'market://details?id=app.fitme.app';
    Linking.openURL(storeUrl).catch(() =>
      Alert.alert('Rate FitMe', 'Unable to open the app store. Please try again later.'),
    );
  };

  /* Delete Account ───────────────────────────────── */
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account, photos, saved try-ons, and subscription history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Are you absolutely sure?',
              'There is no way to recover your data after deletion.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete My Account',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await userApi.deleteAccount();
                      await deleteCurrentUserFromFirebase();
                      await logout();
                      Alert.alert('Account Deleted', 'Your account and personal data have been permanently deleted.', [

                        { text: 'OK', onPress: () => router.replace('/login') },
                      ]);
                    } catch (e: any) {
                      Alert.alert('Error', e?.message || 'Could not delete account. Please try again.');
                    }
                  },
                },
              ],
            ),
        },
      ],
    );
  };

  /* ─── Render ────────────────────────────────────── */

  const displayName =
    profile?.full_name ||
    firebaseUser?.displayName ||
    (profile?.email ? profile.email.split('@')[0] : firebaseUser?.email ? firebaseUser.email.split('@')[0] : 'FitMe User');

  const displayEmail = profile?.email || firebaseUser?.email || '';
  const initials = (displayName.trim().charAt(0) || 'U').toUpperCase();
  const avatarUri = profile?.avatar_uri || firebaseUser?.photoURL || null;
  const tryOnCount = profile?.try_on_count ?? 0;
  const savedCount = profile?.saved_count ?? 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Profile" showBell />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Identity card ─────────────────────────── */}
        <View style={styles.identityCard}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarInitial}>{initials}</Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.avatarEditBadge}
              onPress={() => setEditOpen(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="pencil" size={12} color={Colors.primaryForeground} />
            </TouchableOpacity>
          </View>

          <View style={styles.identityInfo}>
            <Text style={styles.displayName}>{displayName}</Text>
            <Text style={styles.displayEmail}>{displayEmail}</Text>

            {/* Plan badge */}
            {isPremium ? (
              <ProMemberBadge variant="standard" />
            ) : (
              <View style={styles.freeBadge}>
                <Text style={styles.freeBadgeText}>Free Plan</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Stats row ────────────────────────────── */}
        <View style={styles.statsRow}>
          {[
            { n: String(tryOnCount), l: 'Try-ons' },
            { n: String(savedCount), l: 'Saved' },
          ].map((s) => (
            <View key={s.l} style={styles.statCard}>
              <Text style={styles.statNum}>{s.n}</Text>
              <Text style={styles.statLabel}>{s.l}</Text>
            </View>
          ))}
        </View>

        {/* ── Account section ──────────────────────── */}
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.menuCard}>
          <MenuRow
            href="/my-photos"
            label="My Photos"
            icon="camera-outline"
          />
          <MenuRow
            href="/subscription"
            label="Subscription"
            icon="card-outline"
            sublabel={isPremium ? 'FitMe Pro' : 'Free'}
            hasBorder={false}
          />
        </View>

        {/* ── Support & Legal ──────────────────────── */}
        <Text style={styles.sectionTitle}>Support & Legal</Text>
        <View style={styles.menuCard}>
          <MenuRow
            onPress={handleSupport}
            label="Contact Support"
            icon="mail-outline"
          />
          <MenuRow
            onPress={handlePrivacy}
            label="Privacy Policy"
            icon="shield-checkmark-outline"
          />
          <MenuRow
            onPress={handleTerms}
            label="Terms of Service"
            icon="document-text-outline"
          />
          <MenuRow
            href="/about"
            label="About FitMe"
            icon="information-circle-outline"
          />
          <MenuRow
            onPress={handleRate}
            label="Rate FitMe"
            icon="star-outline"
            hasBorder={false}
          />
        </View>

        {/* ── Danger Zone ──────────────────────────── */}
        <Text style={styles.sectionTitle}>Danger Zone</Text>
        <View style={styles.dangerCard}>
          <TouchableOpacity
            style={styles.deleteRow}
            onPress={handleDeleteAccount}
            activeOpacity={0.7}
            accessibilityLabel="Delete Account"
            accessibilityRole="button"
          >
            <View style={styles.deleteIconWrap}>
              <Ionicons name="trash-outline" size={17} color={Colors.destructive} />
            </View>
            <Text style={styles.deleteLabel}>Delete Account</Text>
            <Ionicons name="chevron-forward" size={15} color={Colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* ── Log out ──────────────────────────────── */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => setLogoutOpen(true)}
          activeOpacity={0.7}
          accessibilityLabel="Log out"
          accessibilityRole="button"
        >
          <Ionicons name="log-out-outline" size={16} color={Colors.mutedForeground} />
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* ── Logout confirmation modal ─────────────── */}
      <Modal visible={logoutOpen} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconRing}>
              <Ionicons name="log-out-outline" size={26} color={Colors.mutedForeground} />
            </View>
            <Text style={styles.modalTitle}>Log out?</Text>
            <Text style={styles.modalBody}>
              You can always sign back in with your credentials.
            </Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.ghostBtn}
                onPress={() => setLogoutOpen(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.ghostBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.solidBtn}
                onPress={handleLogout}
                activeOpacity={0.8}
              >
                <Text style={styles.solidBtnText}>Log out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Avatar Edit Modal ─────────────────────── */}
      <Modal visible={editOpen} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.overlayBottom}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setEditOpen(false)} activeOpacity={1} />
          <View style={styles.actionSheet}>
            <Text style={styles.actionSheetTitle}>Profile Photo</Text>
            <TouchableOpacity style={styles.actionBtn} onPress={handleTakePhoto}>
              <Ionicons name="camera-outline" size={20} color={Colors.foreground} />
              <Text style={styles.actionBtnText}>Take Photo</Text>
            </TouchableOpacity>
            <View style={styles.actionDivider} />
            <TouchableOpacity style={styles.actionBtn} onPress={handlePickPhoto}>
              <Ionicons name="image-outline" size={20} color={Colors.foreground} />
              <Text style={styles.actionBtnText}>Choose from Gallery</Text>
            </TouchableOpacity>
            {avatarUri && (
              <>
                <View style={styles.actionDivider} />
                <TouchableOpacity style={styles.actionBtn} onPress={handleRemovePhoto}>
                  <Ionicons name="trash-outline" size={20} color={Colors.destructive} />
                  <Text style={[styles.actionBtnText, { color: Colors.destructive }]}>Remove Photo</Text>
                </TouchableOpacity>
              </>
            )}
            <View style={styles.actionDivider} />
            <TouchableOpacity style={styles.actionBtnCancel} onPress={() => setEditOpen(false)}>
              <Text style={styles.actionBtnCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ─── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll:    { paddingHorizontal: Spacing.xl, maxWidth: 640, width: '100%', alignSelf: 'center' },

  /* Identity card */
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: Colors.card,
    borderRadius: Radii.xxl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    marginTop: Spacing.xs,
  },
  avatarWrap: {},
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarImage: { width: '100%', height: '100%', borderRadius: 34 },
  avatarInitial: { fontFamily: 'serif', fontSize: 30, color: Colors.primaryForeground },
  avatarEditBadge: {
    position: 'absolute', right: -2, bottom: -2,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.foreground,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.card,
  },
  identityInfo: { flex: 1, gap: 2 },
  displayName:  { fontFamily: 'serif', fontSize: 22, color: Colors.foreground },
  displayEmail: { fontSize: 13, color: Colors.mutedForeground, marginBottom: 6 },

  freeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: Colors.muted,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.full,
  },
  freeBadgeText: { fontSize: 11, color: Colors.mutedForeground, fontWeight: '600' },

  /* Stats */
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: Spacing.xl },
  statCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statNum:   { fontFamily: 'serif', fontSize: 28, color: Colors.foreground, lineHeight: 32 },
  statLabel: { fontSize: 11, color: Colors.mutedForeground, marginTop: 2 },

  /* Section title */
  sectionTitle: {
    fontSize: 10,
    letterSpacing: 1.8,
    color: Colors.mutedForeground,
    textTransform: 'uppercase',
    marginBottom: Spacing.sm,
    paddingHorizontal: 2,
  },

  /* Menu card */
  menuCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: Spacing.xl,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: Spacing.xl,
    minHeight: 52,
  },
  menuRowBorder:  { borderBottomWidth: 1, borderBottomColor: Colors.border },
  menuIconWrap:   { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuLabelGroup: { flex: 1, gap: 1 },
  menuLabel:      { fontSize: 14, color: Colors.foreground, fontWeight: '500' },
  menuSublabel:   { fontSize: 11, color: Colors.mutedForeground },

  /* Danger zone */
  dangerCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: Spacing.xl,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: Spacing.xl,
    minHeight: 52,
  },
  deleteIconWrap: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: Colors.destructive + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  deleteLabel: { flex: 1, fontSize: 14, color: Colors.destructive, fontWeight: '500' },

  /* Log out */
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
  },
  logoutText: { fontSize: 14, color: Colors.mutedForeground },

  /* Logout modal */
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.card,
    borderRadius: Radii.xxl,
    padding: Spacing.xxl,
    alignItems: 'center',
  },
  modalIconRing: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: Colors.muted,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  modalTitle: { fontFamily: 'serif', fontSize: 22, color: Colors.foreground, marginBottom: 8 },
  modalBody:  {
    fontSize: 13, color: Colors.mutedForeground,
    textAlign: 'center', lineHeight: 20, marginBottom: Spacing.xl,
  },
  modalBtns: { flexDirection: 'row', gap: 10, width: '100%' },
  ghostBtn: {
    flex: 1, borderRadius: Radii.full,
    borderWidth: 1, borderColor: Colors.border,
    paddingVertical: 13, alignItems: 'center',
  },
  ghostBtnText: { fontSize: 14, color: Colors.foreground, fontWeight: '500' },
  solidBtn: {
    flex: 1, backgroundColor: Colors.primary,
    borderRadius: Radii.full, paddingVertical: 13, alignItems: 'center',
  },
  solidBtnText: { fontSize: 14, color: Colors.primaryForeground, fontWeight: '500' },

  /* Action Sheet */
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    paddingTop: Spacing.xl,
    paddingBottom: Platform.OS === 'ios' ? 40 : Spacing.xxl,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  actionSheetTitle: {
    fontSize: 13,
    color: Colors.mutedForeground,
    textAlign: 'center',
    marginBottom: Spacing.md,
    letterSpacing: 0.5,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: Spacing.xl,
    gap: 12,
  },
  actionBtnText: {
    fontSize: 15,
    color: Colors.foreground,
    fontWeight: '500',
  },
  actionDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },
  actionBtnCancel: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  actionBtnCancelText: {
    fontSize: 15,
    color: Colors.mutedForeground,
    fontWeight: '600',
  },
});
