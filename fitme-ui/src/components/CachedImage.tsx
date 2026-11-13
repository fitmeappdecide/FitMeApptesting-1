import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ImageProps, StyleProp } from 'react-native';
import { Image as ExpoImage, ImageProps as ExpoImageProps, ImageContentFit } from 'expo-image';
import * as FileSystem from 'expo-file-system';
import { getLocalPermanentPath, saveToPermanentStorage } from '../services/imageStorage';

export interface CachedImageProps extends Omit<ImageProps, 'source'> {
  uri?: string | null;
  source?: any;
  placeholderColor?: string;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
  contentFit?: ImageContentFit;
  transition?: number;
}

/** Pre-downloads an image into disk cache in the background */
export async function prefetchCachedImage(uri: string): Promise<string | null> {
  if (!uri || uri.startsWith('file://') || uri.startsWith('data:')) return uri || null;

  try {
    // 1. Try native expo-image disk prefetch
    await ExpoImage.prefetch(uri, 'disk');
  } catch (_) {}

  // 2. Also save to permanent documentDirectory for guaranteed lifetime offline access
  try {
    const permanentPath = await saveToPermanentStorage(uri);
    return permanentPath;
  } catch (_) {}

  return uri;
}

export function CachedImage({
  uri,
  source,
  style,
  placeholderColor = '#F2EBE5',
  resizeMode,
  contentFit,
  transition = 150,
  ...props
}: CachedImageProps) {
  const isDirectLocal = uri && (
    uri.startsWith('file://') ||
    uri.startsWith('ph://') ||
    uri.startsWith('content://') ||
    uri.startsWith('data:')
  );

  const [resolvedUri, setResolvedUri] = useState<string | null>(() => {
    if (source) return null;
    if (!uri) return null;
    if (isDirectLocal) return uri;
    return uri;
  });

  useEffect(() => {
    let isMounted = true;

    if (!uri || source) {
      if (isMounted) setResolvedUri(null);
      return;
    }

    if (isDirectLocal) {
      if (isMounted) setResolvedUri(uri);
      return;
    }

    // Check if permanent offline file exists on disk
    getLocalPermanentPath(uri).then((permPath) => {
      if (isMounted && permPath) {
        setResolvedUri(permPath);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [uri, source, isDirectLocal]);

  // Map legacy React Native resizeMode to expo-image contentFit
  let mappedFit: ImageContentFit = contentFit || 'cover';
  if (resizeMode) {
    if (resizeMode === 'contain') mappedFit = 'contain';
    else if (resizeMode === 'cover') mappedFit = 'cover';
    else if (resizeMode === 'stretch') mappedFit = 'fill';
    else if (resizeMode === 'center') mappedFit = 'none';
  }

  // Render bundled asset source directly
  if (source) {
    return (
      <ExpoImage
        source={source}
        style={style as any}
        contentFit={mappedFit}
        transition={transition}
        {...(props as any)}
      />
    );
  }

  if (!resolvedUri) {
    return <View style={[{ backgroundColor: placeholderColor }, style]} />;
  }

  return (
    <ExpoImage
      source={{ uri: resolvedUri }}
      style={style as any}
      contentFit={mappedFit}
      cachePolicy="disk"
      transition={transition}
      placeholder={{ backgroundColor: placeholderColor }}
      {...(props as any)}
    />
  );
}
