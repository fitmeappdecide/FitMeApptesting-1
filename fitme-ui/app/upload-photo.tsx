import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Alert, ScrollView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AppHeader } from '../src/components/AppHeader';
import { CachedImage } from '../src/components/CachedImage';
import { Colors, Spacing, Radii } from '../src/constants/theme';
import { useSession } from '../src/services/session';
import { useSavedPhotosStore } from '../src/services/savedPhotosStore';

const guideFullbody = require('../assets/images/fullphoto.png');
const guideCloseup  = require('../assets/images/half.png');

export default function UploadPhoto() {
  const router = useRouter();
  const sessionLocalPhotoUri = useSession((s) => s.localPhotoUri);
  const setLocalPhotoUri = useSession((s) => s.setLocalPhotoUri);
  const savedPhotoId = useSession((s) => s.savedPhotoId);
  const setSavedPhotoId = useSession((s) => s.setSavedPhotoId);
  const setSavedPhotoName = useSession((s) => s.setSavedPhotoName);

  const { photos: savedPhotos, fetchPhotos, uploadPhoto } = useSavedPhotosStore();

  const [photoUri, setPhotoUri] = useState<string | null>(sessionLocalPhotoUri);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(savedPhotoId);

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
    setSelectedSavedId(id);
    setPhotoUri(uri);
    setLocalPhotoUri(uri);
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
      setPhotoUri(uri);
      setLocalPhotoUri(uri);
      uploadPhoto(uri).then((saved) => {
        if (saved) {
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
      setPhotoUri(uri);
      setLocalPhotoUri(uri);
      uploadPhoto(uri).then((saved) => {
        if (saved) {
          setSelectedSavedId(saved.id);
          setSavedPhotoId(saved.id);
          setSavedPhotoName(saved.display_name);
        }
      }).catch((err) => {
        console.warn('Auto-save error:', err);
      });
    }
  };

  const handleContinue = () => {
    if (!photoUri) return;
    setLocalPhotoUri(photoUri);
    router.push('/processing');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Upload your photo" back />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.privacyNote}>
          <Ionicons name="lock-closed-outline" size={13} color={Colors.mutedForeground} />
          <Text style={styles.privacyText}>Your photos are private and never shared.</Text>
        </View>

        {/* Upload area */}
        <View style={styles.uploadArea}>
          {photoUri ? (
            <CachedImage uri={photoUri} style={styles.previewImg} />
          ) : (
            <View style={styles.cameraCircle}>
              <Ionicons name="camera-outline" size={32} color={Colors.mutedForeground} />
            </View>
          )}
          {!photoUri && (
            <>
              <Text style={styles.uploadTitle}>Add your photo</Text>
              <Text style={styles.uploadSub}>Stand straight · plain background · full body</Text>
            </>
          )}
        </View>

        {/* Buttons */}
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

        {/* Continue Button */}
        <TouchableOpacity
          style={[styles.continueBtn, !photoUri && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={!photoUri}
        >
          <Text style={styles.continueBtnText}>Continue</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl },
  privacyNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.xl, marginTop: Spacing.xs },
  privacyText: { fontSize: 12, color: Colors.mutedForeground },
  uploadArea: {
    width: '100%', aspectRatio: 3 / 4, backgroundColor: Colors.muted, borderRadius: Radii.xxl,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xl, gap: 8, overflow: 'hidden',
  },
  previewImg: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  cameraCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  uploadTitle: { fontFamily: 'serif', fontSize: 20, color: Colors.foreground },
  uploadSub: { fontSize: 12, color: Colors.mutedForeground },
  errorText: { fontSize: 12, color: Colors.destructive, marginBottom: Spacing.md, textAlign: 'center' },
  btnsRow: { flexDirection: 'row', gap: 12, marginBottom: Spacing.xl },
  outlineBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.card, paddingVertical: 13,
  },
  outlineBtnText: { fontSize: 13, color: Colors.foreground },

  // Saved photos strip
  savedSection: { marginBottom: Spacing.xl },
  savedHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  savedSectionTitle: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  manageLink: { fontSize: 12, color: Colors.accent, fontWeight: '500' },
  savedScroll: { gap: 12 },
  savedCard: {
    width: 116, height: 156, borderRadius: Radii.xl, overflow: 'hidden',
    backgroundColor: Colors.muted, position: 'relative',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  savedCardSelected: { borderColor: Colors.primary, borderWidth: 2.5 },
  savedImg: { width: '100%', height: 120, resizeMode: 'cover' },
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
  continueBtn: {
    backgroundColor: Colors.primary, borderRadius: Radii.full, paddingVertical: 16, alignItems: 'center', width: '100%'
  },
  continueBtnDisabled: {
    backgroundColor: Colors.muted,
  },
  continueBtnText: {
    color: Colors.primaryForeground, fontSize: 15, fontWeight: '500'
  },
});

