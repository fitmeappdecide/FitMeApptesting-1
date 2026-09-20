import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AppHeader } from '../src/components/AppHeader';
import { CachedImage } from '../src/components/CachedImage';
import { Colors, Spacing, Radii } from '../src/constants/theme';
import { useSession } from '../src/services/session';
import { useSavedPhotosStore } from '../src/services/savedPhotosStore';
import { productApi } from '../src/services/api';

const guideFullbody = require('../assets/images/fullphoto.png');
const guideCloseup  = require('../assets/images/half.png');

export default function UploadPhoto() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const productImageUri = useSession((s) => s.productImageUri);
  const setProductImageUri = useSession((s) => s.setProductImageUri);
  const productId = useSession((s) => s.productId);
  const setProductId = useSession((s) => s.setProductId);
  const sessionLocalPhotoUri = useSession((s) => s.localPhotoUri);
  const setLocalPhotoUri = useSession((s) => s.setLocalPhotoUri);
  const savedPhotoId = useSession((s) => s.savedPhotoId);
  const setSavedPhotoId = useSession((s) => s.setSavedPhotoId);
  const setSavedPhotoName = useSession((s) => s.setSavedPhotoName);

  const { photos: savedPhotos, fetchPhotos, uploadPhoto } = useSavedPhotosStore();

  const [photoUri, setPhotoUri] = useState<string | null>(sessionLocalPhotoUri);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(savedPhotoId);
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchPhotos();
    }, [fetchPhotos])
  );

  useEffect(() => {
    if (sessionLocalPhotoUri && !photoUri) {
      setPhotoUri(sessionLocalPhotoUri);
    }
  }, [sessionLocalPhotoUri]);

  // If user has saved model photos and no model photo is selected yet, auto-select the first saved photo
  useEffect(() => {
    if (savedPhotos.length > 0 && !selectedSavedId && !photoUri) {
      const defaultPhoto = savedPhotos[0];
      const uri = defaultPhoto.signed_url || defaultPhoto.storage_path;
      selectSavedPhoto(defaultPhoto.id, uri, defaultPhoto.display_name);
    }
  }, [savedPhotos]);

  useEffect(() => {
    if (savedPhotos.length > 0 && selectedSavedId) {
      const exists = savedPhotos.some((p) => p.id === selectedSavedId);
      if (!exists) {
        setSelectedSavedId(null);
        setSavedPhotoId(null);
        setSavedPhotoName(null);
        setPhotoUri(null);
        setLocalPhotoUri(null);
      }
    }
  }, [savedPhotos, selectedSavedId, setSavedPhotoId, setSavedPhotoName, setLocalPhotoUri]);

  const selectSavedPhoto = (id: string, uri: string, name: string) => {
    setLocalPhotoUri(null);
    setSelectedSavedId(id);
    setPhotoUri(uri);
    setSavedPhotoId(id);
    setSavedPhotoName(name);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Enable camera access in Settings to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      // Synchronously clear old saved photo state so a previous photo ID never overrides a new capture
      setSelectedSavedId(null);
      setSavedPhotoId(null);
      setSavedPhotoName(null);
      setPhotoUri(uri);
      setLocalPhotoUri(uri);
      uploadPhoto(uri).then((saved) => {
        if (saved && useSession.getState().localPhotoUri === uri) {
          setSelectedSavedId(saved.id);
          setSavedPhotoId(saved.id);
          setSavedPhotoName(saved.display_name);
        }
      }).catch((err) => {
        console.warn('Auto-save error:', err);
      });
    }
  };

  const pickFromGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo library access needed', 'Enable photo access in Settings to choose a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      // Synchronously clear old saved photo state so a previous photo ID never overrides a new selection
      setSelectedSavedId(null);
      setSavedPhotoId(null);
      setSavedPhotoName(null);
      setPhotoUri(uri);
      setLocalPhotoUri(uri);
      uploadPhoto(uri).then((saved) => {
        if (saved && useSession.getState().localPhotoUri === uri) {
          setSelectedSavedId(saved.id);
          setSavedPhotoId(saved.id);
          setSavedPhotoName(saved.display_name);
        }
      }).catch((err) => {
        console.warn('Auto-save error:', err);
      });
    }
  };

  const handleRetakeOutfitReference = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera access needed', 'Enable camera access in Settings to capture an outfit image.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;
        setProductId('');
        setProductImageUri(uri);
      }
    } catch (err) {
      console.warn('Retake camera error:', err);
    }
  };

  const handleContinue = async () => {
    if (!photoUri) return;

    setSubmitting(true);
    try {
      // Synchronously lock the exact currently selected model photo into session state
      if (selectedSavedId) {
        setSavedPhotoId(selectedSavedId);
        setLocalPhotoUri(null);
      } else {
        setSavedPhotoId(null);
        setSavedPhotoName(null);
        setLocalPhotoUri(photoUri);
      }

      // 1. If background garment registration promise is pending from import.tsx, await it first
      const pendingPromise = useSession.getState().garmentRegistrationPromise;
      if (pendingPromise && !productId) {
        console.log('[TRY-ON] Awaiting pending background garment registration promise...');
        const res = await pendingPromise;
        setProductId(res.product_id);
      }

      // 2. If we have an un-registered outfit reference image (from bottom camera), register it as garment first
      if (productImageUri && !productId && !pendingPromise) {
        console.log('[QUICK TRY-ON] Registering camera outfit reference image as garment...');
        const res = await productApi.uploadGarment(productImageUri, { title: 'Quick Reference Outfit' });
        setProductId(res.product_id);
      }

      if (!productImageUri && !productId && !useSession.getState().productId) {
        Alert.alert('Outfit Reference Required', 'Please select or capture an outfit to try on.');
        return;
      }

      router.push('/processing');
    } catch (err: any) {
      console.error('[TRY-ON] Error preparing garment reference:', err);
      Alert.alert('Upload Error', err?.message || 'Unable to prepare outfit reference for try-on. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const hasOutfitReference = Boolean(productImageUri || productId);
  const isContinueDisabled = submitting || !photoUri || !hasOutfitReference;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Upload your photo" back />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.privacyNote}>
          <Ionicons name="lock-closed-outline" size={13} color={Colors.mutedForeground} />
          <Text style={styles.privacyText}>Your photos are private and never shared.</Text>
        </View>

        {/* User Model Photo Section */}
        <View style={styles.sectionHeaderWrap}>
          <Text style={styles.sectionHeading}>Add your photo</Text>
          <Text style={styles.sectionSubheading}>
            Select your model photo below to try on the outfit.
          </Text>
        </View>

        {/* User Model Photo Upload / Preview Area */}
        <View style={styles.uploadArea}>
          {photoUri ? (
            <CachedImage uri={photoUri} style={styles.previewImg} />
          ) : (
            <View style={styles.cameraCircle}>
              <Ionicons name="person-outline" size={32} color={Colors.mutedForeground} />
            </View>
          )}
          {!photoUri && (
            <>
              <Text style={styles.uploadTitle}>Select model photo</Text>
              <Text style={styles.uploadSub}>Stand straight · plain background · full body</Text>
            </>
          )}
        </View>

        {/* User Model Photo Camera & Gallery Action Buttons */}
        <View style={styles.btnsRow}>
          <TouchableOpacity style={styles.outlineBtn} onPress={takePhoto}>
            <Ionicons name="camera-outline" size={16} color={Colors.foreground} />
            <Text style={styles.outlineBtnText}>Take photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.outlineBtn} onPress={pickFromGallery}>
            <Ionicons name="image-outline" size={16} color={Colors.foreground} />
            <Text style={styles.outlineBtnText}>Gallery</Text>
          </TouchableOpacity>
        </View>

        {/* Saved Photos Strip */}
        {savedPhotos.length > 0 && (
          <View style={styles.savedSection}>
            <View style={styles.savedHeaderRow}>
              <Text style={styles.savedSectionTitle}>Your saved photos</Text>
              <TouchableOpacity onPress={() => router.push('/my-photos' as any)}>
                <Text style={styles.manageLink}>Manage</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.savedScroll}
            >
              {savedPhotos.map((photo) => {
                const isSelected = selectedSavedId === photo.id;
                const uri = photo.signed_url || photo.storage_path;
                return (
                  <TouchableOpacity
                    key={photo.id}
                    style={[styles.savedCard, isSelected && styles.savedCardSelected]}
                    onPress={() => selectSavedPhoto(photo.id, uri, photo.display_name)}
                    activeOpacity={0.8}
                  >
                    <CachedImage uri={uri} style={styles.savedImg} />
                    {isSelected && (
                      <View style={styles.selectedBadge}>
                        <Ionicons name="checkmark" size={12} color="#fff" />
                      </View>
                    )}
                    <View style={styles.savedCardInfo}>
                      <Text style={styles.savedName} numberOfLines={1}>
                        {photo.display_name}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Visual Guidelines (Only shown for first-time users with no saved photos) */}
        {savedPhotos.length === 0 && (
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
        )}

      </ScrollView>
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          style={[styles.continueBtn, isContinueDisabled && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={isContinueDisabled}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.primaryForeground} />
          ) : (
            <Text style={styles.continueBtnText}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.lg },
  privacyNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.md, marginTop: Spacing.xs },
  privacyText: { fontSize: 12, color: Colors.mutedForeground },

  /* Outfit Reference Card */
  outfitRefCard: {
    backgroundColor: '#FAF3EC',
    borderRadius: Radii.xxl,
    borderWidth: 1,
    borderColor: '#E8DED2',
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  outfitRefHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  outfitTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#A86248',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.full,
  },
  outfitTagText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  retakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  retakeBtnText: {
    fontSize: 12,
    color: Colors.accent,
    fontWeight: '500',
  },
  outfitImgWrap: {
    width: '100%',
    height: 180,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    backgroundColor: Colors.muted,
  },
  outfitImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },

  sectionHeaderWrap: {
    marginBottom: 10,
  },
  sectionHeading: {
    fontFamily: 'serif',
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
  },
  sectionSubheading: {
    fontSize: 12,
    color: Colors.mutedForeground,
    marginTop: 2,
  },

  uploadArea: {
    width: '100%', height: 320, backgroundColor: Colors.muted, borderRadius: Radii.xxl,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md, gap: 8, overflow: 'hidden',
  },
  previewImg: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  cameraCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  uploadTitle: { fontFamily: 'serif', fontSize: 18, color: Colors.foreground },
  uploadSub: { fontSize: 12, color: Colors.mutedForeground },
  errorText: { fontSize: 12, color: Colors.destructive, marginBottom: Spacing.md, textAlign: 'center' },
  btnsRow: { flexDirection: 'row', gap: 12, marginBottom: Spacing.md },
  outlineBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.card, paddingVertical: 12,
  },
  outlineBtnText: { fontSize: 13, color: Colors.foreground, fontWeight: '500' },

  // Saved photos strip
  savedSection: { marginBottom: Spacing.md },
  savedHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  savedSectionTitle: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  manageLink: { fontSize: 12, color: Colors.accent, fontWeight: '500' },
  savedScroll: { gap: 10 },
  savedCard: {
    width: 104, height: 140, borderRadius: Radii.xl, overflow: 'hidden',
    backgroundColor: Colors.muted, position: 'relative',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  savedCardSelected: { borderColor: Colors.primary, borderWidth: 2.5 },
  savedImg: { width: '100%', height: 106, resizeMode: 'cover' },
  selectedBadge: {
    position: 'absolute', top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  savedCardInfo: {
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: Colors.card, height: 34, justifyContent: 'center',
  },
  savedName: { fontSize: 12, color: Colors.foreground, fontWeight: '500', textAlign: 'center' },

  guideRow: { flexDirection: 'row', gap: 12, marginBottom: Spacing.xxl },
  guideItem: { flex: 1, borderRadius: 24, overflow: 'hidden', position: 'relative' },
  guideImg: { width: '100%', height: 220, resizeMode: 'cover' },
  badgeGood: {
    position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.success, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 3,
  },
  badgeBad: {
    position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.destructive, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 3,
  },
  badgeText: { fontSize: 9, color: '#fff', fontWeight: '600' },
  bottomBar: {
    paddingHorizontal: Spacing.xl,
    paddingTop: 12,
    backgroundColor: Colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  continueBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radii.full,
    paddingVertical: 16,
    alignItems: 'center',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  continueBtnDisabled: {
    backgroundColor: Colors.muted,
    shadowOpacity: 0,
    elevation: 0,
  },
  continueBtnText: {
    color: Colors.primaryForeground,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});


