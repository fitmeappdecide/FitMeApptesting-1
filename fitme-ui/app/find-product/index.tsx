import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Alert, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AppHeader } from '../../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../../src/constants/theme';
import { useSession } from '../../src/services/session';

export default function FindProductUpload() {
  const router = useRouter();
  const setProductImageUri = useSession((s) => s.setProductImageUri);
  const setProductImageBase64 = useSession((s) => s.setProductImageBase64);
  
  const [garmentImage, setGarmentImage] = useState<string | null>(null);
  const [userBrand, setUserBrand] = useState<string>('');
  const [userTitle, setUserTitle] = useState<string>('');

  const navigateToSearching = (imgUri: string) => {
    router.push({
      pathname: '/find-product/searching',
      params: {
        garmentUri: imgUri,
        userBrand: userBrand.trim(),
        userTitle: userTitle.trim(),
      },
    } as any);
  };

  const pickGarmentPhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Enable photo access to choose a garment image.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsEditing: false,
        base64: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setGarmentImage(asset.uri);
        setProductImageUri(asset.uri);
        setProductImageBase64(asset.base64 || null);
        navigateToSearching(asset.uri);
      }
    } catch (err: any) {
      console.warn('Image picker error:', err);
      Alert.alert('Error', 'Could not open photo library.');
    }
  };

  const takeGarmentPhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Enable camera access to take a garment photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsEditing: false,
        base64: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setGarmentImage(asset.uri);
        setProductImageUri(asset.uri);
        setProductImageBase64(asset.base64 || null);
        navigateToSearching(asset.uri);
      }
    } catch (cameraErr: any) {
      console.warn('Camera not available (e.g. simulator):', cameraErr);
      Alert.alert(
        'Camera Unavailable',
        'Camera is not available on simulator or device. Please select a photo from your gallery.',
        [{ text: 'Open Gallery', onPress: pickGarmentPhoto }, { text: 'Cancel', style: 'cancel' }]
      );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Find this product" back />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* Main Dashed Upload Card (Matching Image 2) */}
        <TouchableOpacity
          style={styles.uploadArea}
          onPress={pickGarmentPhoto}
          activeOpacity={0.88}
        >
          {garmentImage ? (
            <Image source={{ uri: garmentImage }} style={styles.previewImg} />
          ) : (
            <>
              {/* Glowing Circular Hanger & T-shirt Illustration Composition */}
              <View style={styles.spotlightContainer}>
                <View style={styles.spotlightCircle} />
                <Image
                  source={require('../../assets/images/garment_upload_illustration.png')}
                  style={styles.garmentIllustration}
                  resizeMode="contain"
                />
                <Text style={[styles.sparkleText, { top: 12, left: 14 }]}>✦</Text>
                <Text style={[styles.sparkleText, { top: 22, right: 18 }]}>✨</Text>
              </View>


              <Text style={styles.uploadTitle}>Upload a garment photo</Text>
              <Text style={styles.uploadSub}>Tap to upload or drag & drop</Text>
            </>
          )}
        </TouchableOpacity>

        {/* OR Divider Badge */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <View style={styles.orBadge}>
            <Text style={styles.orText}>OR</Text>
          </View>
          <View style={styles.dividerLine} />
        </View>

        {/* Take a Photo Card Button (Image 2) */}
        <TouchableOpacity
          style={styles.takePhotoCard}
          onPress={takeGarmentPhoto}
          activeOpacity={0.88}
        >
          <View style={styles.cameraIconBadge}>
            <Ionicons name="camera" size={22} color="#C86D51" />
          </View>
          <View style={styles.takePhotoTextGroup}>
            <Text style={styles.takePhotoTitle}>Take a photo</Text>
            <Text style={styles.takePhotoSub}>Use your camera to capture instantly</Text>
          </View>
          <View style={styles.arrowCircle}>
            <Ionicons name="arrow-forward" size={18} color="#1C1C1E" />
          </View>
        </TouchableOpacity>

        {/* Privacy Note */}
        <Text style={styles.privacyFooter}>We'll never share your photos.</Text>


      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xxxl,
  },

  /* Main Upload Card */
  uploadArea: {
    backgroundColor: '#FFFDFB',
    borderWidth: 1.5,
    borderColor: '#F0DDD0',
    borderStyle: 'dashed',
    borderRadius: 24,
    paddingVertical: 24,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    shadowColor: '#A86248',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  spotlightContainer: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 8,
  },
  spotlightCircle: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: '#FAF0E6',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  garmentIllustration: {
    width: 165,
    height: 165,
    borderRadius: 82.5,
  },

  sparkleText: {

    position: 'absolute',
    fontSize: 14,
    color: '#D89E82',
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 4,
    textAlign: 'center',
  },
  uploadSub: {
    fontSize: 13,
    color: Colors.mutedForeground,
    textAlign: 'center',
  },
  previewImg: {
    width: '100%',
    height: 220,
    borderRadius: Radii.xl,
    resizeMode: 'cover',
  },

  /* OR Divider Badge */
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    paddingHorizontal: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#F0E5D8',
  },
  orBadge: {
    width: 34,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFFDFB',
    borderWidth: 1,
    borderColor: '#F0E5D8',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  orText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9E8E7F',
  },

  /* Take Photo Card Button */
  takePhotoCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E5D8',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cameraIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FAF0E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  takePhotoTextGroup: {
    flex: 1,
    marginLeft: 12,
  },
  takePhotoTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  takePhotoSub: {
    fontSize: 12,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
  arrowCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FAF0E8',
    alignItems: 'center',
    justifyContent: 'center',
  },

  privacyFooter: {
    fontSize: 12,
    color: Colors.mutedForeground,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});

