import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Modal,
  Pressable,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { CachedImage } from '../src/components/CachedImage';
import { Colors, Spacing, Radii } from '../src/constants/theme';
import { useSavedPhotosStore } from '../src/services/savedPhotosStore';

const FREE_LIMIT    = 3;
const PREMIUM_LIMIT = 5;

const guideFullbody = require('../assets/images/fullphoto.png');
const guideCloseup  = require('../assets/images/half.png');

function formatPhotoAge(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${Math.max(1, diffMins)}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    const diffWeeks = Math.floor(diffDays / 7);
    return `${diffWeeks}w ago`;
  } catch {
    return 'Recently';
  }
}

export default function MyPhotos() {
  const router = useRouter();
  const { photos, fetchPhotos, deletePhoto, renamePhoto, loading } = useSavedPhotosStore();

  const isPremium      = false; // Default tier
  const maxPhotos      = isPremium ? PREMIUM_LIMIT : FREE_LIMIT;
  const atLimit        = photos.length >= maxPhotos;

  useFocusEffect(
    useCallback(() => {
      fetchPhotos();
    }, [fetchPhotos])
  );

  // Ellipsis menu state
  const [menuPhotoId, setMenuPhotoId] = useState<string | null>(null);

  // Rename dialog state
  const [renameVisible, setRenameVisible] = useState(false);
  const [renamingId, setRenamingId]       = useState<string | null>(null);
  const [newName, setNewName]             = useState('');

  /* ── Handlers ─────────────────────────────────────── */

  const handleAddPhoto = () => {
    if (atLimit) {
      if (isPremium) {
        Alert.alert(
          'Photo Limit Reached',
          `You have reached the maximum of ${PREMIUM_LIMIT} photos on your Pro plan.`,
          [{ text: 'OK' }],
        );
      } else {
        Alert.alert(
          'Upgrade to Store More Photos',
          `Free accounts can store up to ${FREE_LIMIT} photos. Upgrade to Pro to store up to ${PREMIUM_LIMIT}.`,
          [
            { text: 'Not Now', style: 'cancel' },
            { text: 'Upgrade to Pro', onPress: () => router.push('/subscription' as any) },
          ],
        );
      }
      return;
    }
    router.push('/upload-photo');
  };

  const openRenameDialog = (id: string) => {
    const photo = photos.find((p) => p.id === id);
    setMenuPhotoId(null);
    if (photo) {
      setRenamingId(id);
      setNewName(photo.display_name ?? 'Untitled');
      setRenameVisible(true);
    }
  };

  const handleRenameSave = async () => {
    if (renamingId && newName.trim()) {
      try {
        await renamePhoto(renamingId, newName.trim());
      } catch (err: any) {
        Alert.alert('Error', err?.message || 'Could not rename photo');
      }
    }
    setRenameVisible(false);
    setRenamingId(null);
  };

  const handleRenameCancel = () => {
    setRenameVisible(false);
    setRenamingId(null);
  };

  const handleDelete = (id: string) => {
    setMenuPhotoId(null);
    Alert.alert(
      'Delete Photo',
      'This photo will be permanently removed. Your existing try-on looks will be preserved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePhoto(id);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not delete photo');
            }
          },
        },
      ],
    );
  };

  /* ── UI ───────────────────────────────────────────── */

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="My Photos" back />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Privacy notice */}
        <View style={styles.notice}>
          <Ionicons name="lock-closed-outline" size={14} color={Colors.mutedForeground} />
          <Text style={styles.noticeText}>
            Your photos are private and only used for generating try-ons.
          </Text>
        </View>

        {/* Add photo button */}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push('/upload-photo')}
          activeOpacity={0.75}
          accessibilityLabel="Add a new photo"
          accessibilityRole="button"
        >
          <Ionicons
            name="add"
            size={20}
            color={Colors.primaryForeground}
          />
          <Text style={styles.addBtnText}>
            Add Photo ({photos.length})
          </Text>
        </TouchableOpacity>

        {/* Photos grid */}
        {photos.length > 0 ? (
          <View style={styles.grid}>
            {photos.map((photo) => {
              const uri = photo.signed_url || photo.storage_path;
              return (
                <View key={photo.id} style={styles.photoCard}>
                  <CachedImage uri={uri} style={styles.photoImg} />

                  {/* Ellipsis button */}
                  <TouchableOpacity
                    style={styles.moreBtn}
                    onPress={() => setMenuPhotoId(photo.id)}
                    activeOpacity={0.8}
                    accessibilityLabel="Photo options"
                    accessibilityRole="button"
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="ellipsis-vertical" size={16} color={Colors.foreground} />
                  </TouchableOpacity>

                  {/* Caption */}
                  <View style={styles.caption}>
                    <Text style={styles.photoName} numberOfLines={1}>
                      {photo.display_name || 'Untitled'}
                    </Text>
                    <Text style={styles.photoAge}>{formatPhotoAge(photo.created_at)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="camera-outline" size={48} color={Colors.mutedForeground} />
            <Text style={styles.emptyTitle}>No photos yet</Text>
            <Text style={styles.emptyBody}>
              Add your first full-body photo to start trying on clothes.
            </Text>
          </View>
        )}

        {/* Photo guidelines */}
        <Text style={styles.guideTitle}>PHOTO GUIDELINES</Text>
        <View style={styles.guideRow}>
          <View style={styles.guideItem}>
            <Image source={guideFullbody} style={styles.guideImg} />
            <View style={styles.badgeGood}>
              <Ionicons name="checkmark" size={9} color="#fff" />
              <Text style={styles.badgeText}>Full body</Text>
            </View>
          </View>
          <View style={styles.guideItem}>
            <Image source={guideCloseup} style={styles.guideImg} />
            <View style={styles.badgeBad}>
              <Ionicons name="close" size={9} color="#fff" />
              <Text style={styles.badgeText}>Close-up</Text>
            </View>
          </View>
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>

      {/* ── Ellipsis options sheet ───────────────────── */}
      <Modal
        visible={!!menuPhotoId}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuPhotoId(null)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setMenuPhotoId(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>

            <View style={styles.sheetHandle} />

            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => openRenameDialog(menuPhotoId!)}
              activeOpacity={0.7}
            >
              <View style={styles.sheetIconWrap}>
                <Ionicons name="pencil-outline" size={20} color={Colors.foreground} />
              </View>
              <Text style={styles.sheetItemText}>Rename</Text>
            </TouchableOpacity>

            <View style={styles.sheetDivider} />

            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => handleDelete(menuPhotoId!)}
              activeOpacity={0.7}
            >
              <View style={[styles.sheetIconWrap, { backgroundColor: Colors.destructive + '15' }]}>
                <Ionicons name="trash-outline" size={20} color={Colors.destructive} />
              </View>
              <Text style={[styles.sheetItemText, { color: Colors.destructive }]}>Delete</Text>
            </TouchableOpacity>

            <View style={styles.sheetDivider} />

            <TouchableOpacity
              style={styles.sheetCancel}
              onPress={() => setMenuPhotoId(null)}
              activeOpacity={0.7}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>

          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Rename dialog ────────────────────────────── */}
      <Modal
        visible={renameVisible}
        transparent
        animationType="fade"
        onRequestClose={handleRenameCancel}
      >
        <View style={styles.dialogOverlay}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Rename Photo</Text>

            <TextInput
              style={styles.dialogInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="Enter a name"
              placeholderTextColor={Colors.mutedForeground}
              autoFocus
              selectTextOnFocus
              maxLength={40}
              returnKeyType="done"
              onSubmitEditing={handleRenameSave}
            />

            <View style={styles.dialogBtns}>
              <TouchableOpacity style={styles.ghostBtn} onPress={handleRenameCancel} activeOpacity={0.7}>
                <Text style={styles.ghostBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.solidBtn} onPress={handleRenameSave} activeOpacity={0.8}>
                <Text style={styles.solidBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll:    { paddingHorizontal: Spacing.xl, maxWidth: 640, width: '100%', alignSelf: 'center' },

  // Privacy notice
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.muted, borderRadius: Radii.md,
    padding: Spacing.md, marginBottom: Spacing.lg,
  },
  noticeText: { fontSize: 12, color: Colors.mutedForeground, flex: 1, lineHeight: 18 },

  // Add button
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: Radii.full, paddingVertical: 14,
    marginBottom: Spacing.sm,
  },
  addBtnDisabled: { backgroundColor: Colors.muted },
  addBtnText:     { fontSize: 15, fontWeight: '500', color: Colors.primaryForeground },
  addBtnTextDisabled: { color: Colors.mutedForeground },

  // Upgrade nudge
  upgradeNudge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.accent + '12', borderRadius: Radii.full,
    paddingVertical: 10, paddingHorizontal: Spacing.lg, marginBottom: Spacing.lg,
    borderWidth: 1, borderColor: Colors.accent + '30',
  },
  upgradeNudgeText: { fontSize: 13, color: Colors.accent, fontWeight: '500', flex: 1, textAlign: 'center' },

  // Grid
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    marginTop: Spacing.lg, marginBottom: Spacing.xxl,
  },
  photoCard: {
    width: '48%', borderRadius: Radii.xl, overflow: 'hidden',
    backgroundColor: Colors.muted, position: 'relative',
    borderWidth: 1, borderColor: Colors.border,
  },
  photoImg: { width: '100%', aspectRatio: 3 / 4, resizeMode: 'cover' },
  moreBtn: {
    position: 'absolute', top: 8, right: 8,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 3, elevation: 2,
  },
  caption:   { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: Colors.card },
  photoName: { fontSize: 12, color: Colors.foreground, fontWeight: '500', marginBottom: 2 },
  photoAge:  { fontSize: 10, color: Colors.mutedForeground },

  // Empty state
  emptyState: {
    alignItems: 'center', paddingVertical: 48, gap: 12,
    marginBottom: Spacing.xxl,
  },
  emptyTitle: { fontFamily: 'serif', fontSize: 20, color: Colors.foreground },
  emptyBody:  { fontSize: 13, color: Colors.mutedForeground, textAlign: 'center', lineHeight: 20, paddingHorizontal: Spacing.xl },

  // Guidelines
  guideTitle: {
    fontSize: 10,
    letterSpacing: 2,
    color: Colors.mutedForeground,
    textTransform: 'uppercase',
    marginBottom: Spacing.md,
    marginTop: Spacing.xl,
    fontWeight: '600',
  },
  guideRow: { flexDirection: 'row', gap: 12, marginBottom: Spacing.xxl },
  guideItem: { flex: 1, borderRadius: 24, overflow: 'hidden', position: 'relative' },
  guideImg: { width: '100%', height: 220, resizeMode: 'cover' },
  badgeGood: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.success,
    borderRadius: 20,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeBad: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.destructive,
    borderRadius: 20,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 9, color: '#fff', fontWeight: '600' },

  // Options sheet (bottom sheet style)
  sheetOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radii.xxl, borderTopRightRadius: Radii.xxl,
    paddingHorizontal: Spacing.xl, paddingBottom: 40, paddingTop: Spacing.md,
    maxWidth: 480, width: '100%', alignSelf: 'center',
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg,
  },
  sheetItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, minHeight: 52,
  },
  sheetIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.muted, alignItems: 'center', justifyContent: 'center',
  },
  sheetItemText:   { fontSize: 16, color: Colors.foreground, fontWeight: '500' },
  sheetDivider:    { height: 1, backgroundColor: Colors.border },
  sheetCancel: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, minHeight: 52,
  },
  sheetCancelText: { fontSize: 16, color: Colors.mutedForeground, fontWeight: '500' },

  // Rename dialog
  dialogOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xxl,
  },
  dialog: {
    width: '100%', maxWidth: 420, backgroundColor: Colors.card,
    borderRadius: Radii.xxl, padding: Spacing.xxl, alignItems: 'center',
  },
  dialogTitle: { fontFamily: 'serif', fontSize: 20, color: Colors.foreground, marginBottom: Spacing.lg },
  dialogInput: {
    width: '100%', borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radii.lg, padding: 12, fontSize: 14, color: Colors.foreground,
    backgroundColor: Colors.muted, marginBottom: Spacing.xl,
  },
  dialogBtns: { flexDirection: 'row', gap: 10, width: '100%' },
  ghostBtn: {
    flex: 1, borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border,
    paddingVertical: 13, alignItems: 'center',
  },
  ghostBtnText: { fontSize: 14, color: Colors.foreground, fontWeight: '500' },
  solidBtn: {
    flex: 1, backgroundColor: Colors.primary, borderRadius: Radii.full,
    paddingVertical: 13, alignItems: 'center',
  },
  solidBtnText: { fontSize: 14, color: Colors.primaryForeground, fontWeight: '500' },
});
