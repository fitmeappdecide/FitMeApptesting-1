import React from 'react';
import { View, Text, Image, StyleSheet, ViewStyle, ImageStyle, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { normalizeRetailer } from '../constants/retailers';
import { Colors } from '../constants/theme';

export type RetailerLogoSize = 'xs' | 'sm' | 'md' | 'lg' | number;

export interface RetailerLogoProps {
  retailer?: string | null;
  size?: RetailerLogoSize;
  showName?: boolean;
  style?: ViewStyle;
  imageStyle?: ImageStyle;
  textStyle?: TextStyle;
}

const SIZE_MAP: Record<string, number> = {
  xs: 18,
  sm: 24,
  md: 28,
  lg: 36,
};

export function RetailerLogo({
  retailer,
  size = 'sm',
  showName = false,
  style,
  imageStyle,
  textStyle,
}: RetailerLogoProps) {
  const pixelSize = typeof size === 'number' ? size : SIZE_MAP[size] || 24;
  const def = normalizeRetailer(retailer);

  const renderIcon = () => {
    if (def.logoAsset) {
      return (
        <Image
          source={def.logoAsset}
          style={[
            styles.image,
            { width: pixelSize, height: pixelSize, borderRadius: Math.round(pixelSize * 0.25) },
            imageStyle,
          ]}
          resizeMode="contain"
        />
      );
    }

    // Unrecognized or missing platform: return null (NO icon)
    return null;
  };

  if (!def.logoAsset && !showName) {
    return null;
  }

  if (showName) {
    return (
      <View style={[styles.inlineRow, style]}>
        {renderIcon()}
        <Text style={[styles.nameText, textStyle]} numberOfLines={1}>
          {def.name}
        </Text>
      </View>
    );
  }

  return <View style={style}>{renderIcon()}</View>;
}

const styles = StyleSheet.create({
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  image: {
    backgroundColor: 'transparent',
  },
  fallbackContainer: {
    backgroundColor: Colors.muted,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.foreground,
  },
});
