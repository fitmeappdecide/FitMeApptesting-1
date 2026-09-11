import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Image, Alert } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Radii, Spacing } from '../../src/constants/theme';
import { useSession } from '../../src/services/session';
import { useSavedPhotosStore } from '../../src/services/savedPhotosStore';

// Brand icon — matches the new logo
function AvaIcon({ color }: { color: string }) {
  return (
    <Image 
      source={require('../../assets/eva.png')}
      style={{ width: 24, height: 24, tintColor: color }}
      resizeMode="contain"
    />
  );
}

type TabName = 'home' | 'looks' | 'ava' | 'profile';

type TabConfig = {
  name: TabName;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'] | null;
  iconActive: React.ComponentProps<typeof Ionicons>['name'] | null;
};

const tabs: TabConfig[] = [
  { name: 'home',    label: 'Home',    icon: 'home-outline',       iconActive: 'home-outline' },
  { name: 'looks',   label: 'Looks',   icon: 'heart-outline',      iconActive: 'heart-outline' },
  { name: 'ava',     label: 'Ava',     icon: 'chevron-up-outline', iconActive: 'chevron-up-outline' },
  { name: 'profile', label: 'Profile', icon: 'person-outline',     iconActive: 'person-outline' },
];

function CustomTabBar({ state, navigation }: any) {
  const router = useRouter();

  const handleCameraPress = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permission Required',
          'Camera access is required to take a photo. Please enable camera access in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }
      // Open phone camera directly with quality: 0.8 compression (reduces 3-12MB down to ~300KB-800KB without quality loss)
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;
        useSession.getState().setLocalPhotoUri(uri);

        // Auto-save photo to user's saved photo store
        useSavedPhotosStore.getState().uploadPhoto(uri).then((saved) => {
          if (saved) {
            useSession.getState().setSavedPhotoId(saved.id);
            useSession.getState().setSavedPhotoName(saved.display_name);
          }
        }).catch((err) => console.warn('Auto-save error:', err));

        // Redirect to Upload Your Photo page AFTER photo is clicked/taken
        router.push('/upload-photo' as any);
      }
      // If user cancels camera capture, stay on current screen
    } catch (err: any) {
      console.warn('Camera launcher error (e.g. simulator):', err);
      // Fallback for Simulator where physical camera hardware is unavailable
      Alert.alert(
        'Camera Unavailable',
        'Camera is not available on simulator or device. Please select a photo from your photo library.',
        [
          {
            text: 'Open Gallery',
            onPress: async () => {
              try {
                const libRes = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  quality: 0.8,
                  allowsEditing: false,
                });
                if (!libRes.canceled && libRes.assets[0]) {
                  const uri = libRes.assets[0].uri;
                  useSession.getState().setLocalPhotoUri(uri);
                  useSavedPhotosStore.getState().uploadPhoto(uri).then((saved) => {
                    if (saved) {
                      useSession.getState().setSavedPhotoId(saved.id);
                      useSession.getState().setSavedPhotoName(saved.display_name);
                    }
                  }).catch((e) => console.warn('Auto-save error:', e));

                  // Redirect to Upload Your Photo page after photo selection
                  router.push('/upload-photo' as any);
                }
              } catch (libErr) {
                console.warn('Gallery fallback error:', libErr);
              }
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    }
  };

  return (
    <View style={styles.barWrapper}>
      <View style={styles.bar}>
        {tabs.map((tab, idx) => {
          const currentRouteName = state.routes[state.index].name;
          const active = currentRouteName === tab.name;
          const color  = active ? '#C97352' : '#7A6E67';

          const tabItemNode = (
            <TouchableOpacity
              key={tab.name}
              style={styles.tabItem}
              onPress={() => navigation.navigate(tab.name)}
              activeOpacity={0.7}
            >
              {tab.name === 'ava' ? (
                <AvaIcon color={color} />
              ) : (
                <Ionicons
                  name={(active ? tab.iconActive : tab.icon) as React.ComponentProps<typeof Ionicons>['name']}
                  size={26}
                  color={color}
                />
              )}
              <Text style={[styles.tabLabel, { color }]}>{tab.label}</Text>
            </TouchableOpacity>
          );

          // Render central raised camera button between Looks (idx 1) and Ava (idx 2)
          if (idx === 1) {
            return (
              <React.Fragment key={tab.name}>
                {tabItemNode}
                <View style={styles.cameraContainer}>
                  {/* Floating Circular Camera Button Protruding Outside Top Edge */}
                  <TouchableOpacity
                    style={styles.cameraButtonTouchable}
                    onPress={handleCameraPress}
                    activeOpacity={0.85}
                  >
                    <View style={styles.cameraOuterCircle}>
                      <View style={styles.cameraInnerCircle}>
                        <Ionicons name="camera-outline" size={26} color="#FFFFFF" />
                      </View>
                    </View>
                  </TouchableOpacity>
                </View>
              </React.Fragment>
            );
          }

          return tabItemNode;
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    />
  );
}

const styles = StyleSheet.create({
  barWrapper: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 24 : 16,
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderRadius: Radii.full,
    paddingVertical: 10,
    paddingHorizontal: Spacing.sm,
    width: '90%',
    justifyContent: 'space-around',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#EFE8E1',
    overflow: 'visible',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    gap: 3,
  },
  tabLabel: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  cameraContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    height: 44,
    zIndex: 10,
  },
  cameraButtonTouchable: {
    position: 'absolute',
    top: -22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraOuterCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 6,
  },
  cameraInnerCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#C97352',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
