import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Image, Alert, Animated } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Radii, Spacing } from '../../src/constants/theme';
import { useSession } from '../../src/services/session';
import { useSavedPhotosStore } from '../../src/services/savedPhotosStore';
import { productApi } from '../../src/services/api';

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

// Set to true to re-enable the center elevated floating camera button
const SHOW_CENTER_CAMERA_BUTTON = false;

interface TabLayoutInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

function TabButton({
  tab,
  active,
  onPress,
  onLayout,
}: {
  tab: TabConfig;
  active: boolean;
  onPress: () => void;
  onLayout: (e: any) => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const color = active ? '#C97352' : '#7A6E67';

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.94,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 4,
    }).start();
  };

  return (
    <TouchableOpacity
      style={styles.tabItem}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onLayout={onLayout}
      activeOpacity={0.8}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={tab.label}
    >
      <Animated.View style={[styles.tabContent, { transform: [{ scale: scaleAnim }] }]}>
        {tab.name === 'ava' ? (
          <AvaIcon color={color} />
        ) : (
          <Ionicons
            name={(active ? tab.iconActive : tab.icon) as React.ComponentProps<typeof Ionicons>['name']}
            size={24}
            color={color}
          />
        )}
        <Text style={[styles.tabLabel, { color, fontWeight: active ? '600' : '500' }]}>
          {tab.label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

function CameraButton({ onPress }: { onPress: () => void }) {
  const pressAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(pressAnim, {
      toValue: 0.94,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(pressAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 4,
    }).start();
  };

  return (
    <View style={styles.cameraContainer}>
      <TouchableOpacity
        style={styles.cameraButtonTouchable}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel="Take or upload photo"
      >
        <Animated.View style={[styles.cameraOuterCircle, { transform: [{ scale: pressAnim }] }]}>
          <View style={styles.cameraInnerCircle}>
            <Ionicons name="camera-outline" size={26} color="#FFFFFF" />
          </View>
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

function CustomTabBar({ state, navigation, descriptors }: any) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const tabLayouts = useRef<{ [key: string]: TabLayoutInfo }>({});
  const [capsuleWidth, setCapsuleWidth] = useState<number>(64);
  const capsuleX = useRef(new Animated.Value(0)).current;
  const capsuleOpacity = useRef(new Animated.Value(0)).current;
  const isReady = useRef(false);

  const currentRouteName = state.routes[state.index]?.name;

  const updateCapsulePosition = (tabName: string, immediate = false) => {
    const layout = tabLayouts.current[tabName];
    if (!layout) return;

    const targetInset = 4;
    const targetX = layout.x + targetInset;
    const targetW = Math.max(layout.width - targetInset * 2, 48);

    setCapsuleWidth(targetW);

    if (immediate || !isReady.current) {
      capsuleX.setValue(targetX);
      capsuleOpacity.setValue(1);
      isReady.current = true;
    } else {
      Animated.parallel([
        Animated.spring(capsuleX, {
          toValue: targetX,
          tension: 78,
          friction: 11,
          useNativeDriver: true,
        }),
        Animated.timing(capsuleOpacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  useEffect(() => {
    updateCapsulePosition(currentRouteName);
  }, [currentRouteName]);

  const handleTabLayout = (tabName: string, event: any) => {
    const layout = event.nativeEvent.layout;
    tabLayouts.current[tabName] = layout;
    if (tabName === currentRouteName) {
      updateCapsulePosition(tabName, !isReady.current);
    }
  };

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
      // Open phone camera directly with quality: 0.5 compression (reduces 3-12MB down to ~300KB-800KB without quality loss)
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.5,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;
        useSession.getState().setSourceUrl(null);
        useSession.getState().setExtractedProduct(null);
        useSession.getState().setProductId('');
        useSession.getState().setScanId(null);
        useSession.getState().setTryOnJobId(null);
        useSession.getState().setResultImageUrls([]);
        useSession.getState().setLocalPhotoUri(null);
        useSession.getState().setSavedPhotoId(null);
        useSession.getState().setSavedPhotoName(null);

        // Store captured bottom camera image strictly as the outfit reference image (Quick Try-On)
        useSession.getState().setProductImageUri(uri);

        // Start background registration immediately so by the time user picks their photo it's already done!
        const promise = productApi.uploadGarment(uri, { title: 'Quick Reference Outfit' });
        useSession.getState().setGarmentRegistrationPromise(promise);

        // Redirect to Product Preview page AFTER photo is clicked/taken
        router.push('/import' as any);
      }
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
                  quality: 0.5,
                  allowsEditing: false,
                });
                if (!libRes.canceled && libRes.assets[0]) {
                  const uri = libRes.assets[0].uri;
                  useSession.getState().setSourceUrl(null);
                  useSession.getState().setExtractedProduct(null);
                  useSession.getState().setProductId('');
                  useSession.getState().setScanId(null);
                  useSession.getState().setTryOnJobId(null);
                  useSession.getState().setResultImageUrls([]);
                  useSession.getState().setLocalPhotoUri(null);
                  useSession.getState().setSavedPhotoId(null);
                  useSession.getState().setSavedPhotoName(null);

                  useSession.getState().setProductImageUri(uri);

                  // Start background registration immediately
                  const promise = productApi.uploadGarment(uri, { title: 'Quick Reference Outfit' });
                  useSession.getState().setGarmentRegistrationPromise(promise);

                  // Redirect to Product Preview page after photo selection
                  router.push('/import' as any);
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

  const bottomOffset = Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 14);

  const currentRoute = state.routes[state.index];
  const descriptor = descriptors ? descriptors[currentRoute.key] : null;
  const tabBarStyle = descriptor?.options?.tabBarStyle;
  if (tabBarStyle && tabBarStyle.display === 'none') {
    return null;
  }

  return (
    <>
      {/* Soft background fade so scrolling content smoothly fades behind the floating bar */}
      <View
        pointerEvents="none"
        style={[styles.bottomFadeMask, { height: bottomOffset + 70 }]}
      >
        <View style={[styles.fadeSlice, { backgroundColor: 'rgba(247, 239, 231, 0.0)' }]} />
        <View style={[styles.fadeSlice, { backgroundColor: 'rgba(247, 239, 231, 0.25)' }]} />
        <View style={[styles.fadeSlice, { backgroundColor: 'rgba(247, 239, 231, 0.55)' }]} />
        <View style={[styles.fadeSlice, { backgroundColor: 'rgba(247, 239, 231, 0.82)' }]} />
        <View style={[styles.fadeSlice, { backgroundColor: 'rgba(247, 239, 231, 0.98)', flex: 2 }]} />
      </View>

      <View style={[styles.barWrapper, { bottom: bottomOffset }]}>
        <View style={styles.bar}>
          {/* Animated Active Tab Solid Capsule */}
          <Animated.View
            style={[
              styles.activeCapsule,
              {
                width: capsuleWidth,
                opacity: capsuleOpacity,
                transform: [{ translateX: capsuleX }],
              },
            ]}
            pointerEvents="none"
          />

          {tabs.map((tab, idx) => {
            const active = currentRouteName === tab.name;

            const tabItemNode = (
              <TabButton
                key={tab.name}
                tab={tab}
                active={active}
                onPress={() => navigation.navigate(tab.name)}
                onLayout={(e) => handleTabLayout(tab.name, e)}
              />
            );

            // Optionally render central raised camera button between Looks (idx 1) and Ava (idx 2)
            if (SHOW_CENTER_CAMERA_BUTTON && idx === 1) {
              return (
                <React.Fragment key={tab.name}>
                  {tabItemNode}
                  <CameraButton onPress={handleCameraPress} />
                </React.Fragment>
              );
            }

            return tabItemNode;
          })}
        </View>
      </View>
    </>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      detachInactiveScreens={false}
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        unmountOnBlur: false,
        freezeOnBlur: false,
      }}
    />
  );
}

const styles = StyleSheet.create({
  bottomFadeMask: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 90,
  },
  fadeSlice: {
    flex: 1,
    width: '100%',
  },
  barWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'box-none',
    zIndex: 100,
  },
  bar: {
    position: 'relative',
    flexDirection: 'row',
    // Fully solid white background - 100% opaque, no bleed-through
    backgroundColor: '#FFFFFF',
    borderRadius: 36,
    paddingVertical: 6,
    paddingHorizontal: 6,
    width: '82%',
    maxWidth: 350,
    justifyContent: 'space-around',
    alignItems: 'center',
    // Clean subtle warm border
    borderWidth: 1,
    borderColor: '#E8E1D9',
    // Soft floating shadow
    shadowColor: '#1A1410',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 18,
    elevation: 8,
    overflow: 'visible',
  },
  // Animated Active Tab Capsule
  activeCapsule: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    borderRadius: 24,
    backgroundColor: '#F5ECE3',
    borderWidth: 1,
    borderColor: '#EADFD4',
    shadowColor: '#C97352',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    minHeight: 48,
    zIndex: 2,
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabLabel: {
    fontSize: 11.5,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  cameraContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    height: 48,
    zIndex: 10,
  },
  cameraButtonTouchable: {
    position: 'absolute',
    top: -20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraOuterCircle: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#E8E1D9',
    shadowColor: '#1A1410',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 8,
    overflow: 'hidden',
  },
  cameraInnerCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#C97352',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
