import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Image, Alert, Animated } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
          {/* Curved glass top reflection sheen */}
          <View style={styles.cameraGlassSheen} pointerEvents="none" />
          <View style={styles.cameraInnerCircle}>
            <Ionicons name="camera-outline" size={26} color="#FFFFFF" />
          </View>
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

function CustomTabBar({ state, navigation }: any) {
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
    <View style={[styles.barWrapper, { bottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 14) }]}>
      <View style={styles.bar}>
        {/* Soft upper glass specular highlight reflection */}
        <View style={styles.glassSheen} pointerEvents="none" />

        {/* Animated Active Tab Glass Capsule */}
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
        >
          {/* Inner specular gloss highlight */}
          <View style={styles.activeCapsuleSheen} />
        </Animated.View>

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

          // Render central raised camera button between Looks (idx 1) and Ava (idx 2)
          if (idx === 1) {
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
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'box-none',
    zIndex: 100,
  },
  bar: {
    position: 'relative',
    flexDirection: 'row',
    // Translucent Liquid Glass Background
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255, 255, 255, 0.72)' : 'rgba(255, 255, 255, 0.88)',
    borderRadius: 36,
    paddingVertical: 6,
    paddingHorizontal: 6,
    width: '90%',
    maxWidth: 440,
    justifyContent: 'space-around',
    alignItems: 'center',
    // Multi-stage Refined Specular Border
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.75)',
    borderTopColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomColor: 'rgba(255, 255, 255, 0.40)',
    // Subtle Deep Floating Shadow
    shadowColor: '#1A1410',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 10,
    overflow: 'visible',
  },
  // Top glass refraction highlight
  glassSheen: {
    position: 'absolute',
    top: 2,
    left: 16,
    right: 16,
    height: 22,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.38)',
  },
  // Animated Active Tab Glass Capsule
  activeCapsule: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    borderRadius: 24,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255, 255, 255, 0.82)' : 'rgba(255, 255, 255, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.90)',
    borderTopColor: '#FFFFFF',
    shadowColor: '#C97352',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 6,
    elevation: 3,
    overflow: 'hidden',
  },
  activeCapsuleSheen: {
    position: 'absolute',
    top: 1,
    left: 4,
    right: 4,
    height: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
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
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255, 255, 255, 0.82)' : 'rgba(255, 255, 255, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    borderTopColor: 'rgba(255, 255, 255, 0.98)',
    borderBottomColor: 'rgba(255, 255, 255, 0.45)',
    shadowColor: '#1A1410',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 8,
    overflow: 'hidden',
  },
  cameraGlassSheen: {
    position: 'absolute',
    top: 2,
    left: 8,
    right: 8,
    height: 20,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.40)',
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
