import React, { useState, useEffect } from 'react';
import { Image, ImageProps, View, StyleSheet } from 'react-native';
import * as FileSystem from 'expo-file-system';

const CACHE_FOLDER = `${FileSystem.cacheDirectory}fitme_img_cache/`;

// Ensure local cache directory exists
let dirChecked = false;
async function ensureDirExists() {
  if (dirChecked) return;
  try {
    const dirInfo = await FileSystem.getInfoAsync(CACHE_FOLDER);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(CACHE_FOLDER, { intermediates: true });
    }
    dirChecked = true;
  } catch {
    // ignore
  }
}

function getCacheFilename(uri: string): string {
  // Strip query parameters to create a stable hash for the cache key
  const cleanUrl = uri.split('?')[0];
  let hash = 0;
  for (let i = 0; i < cleanUrl.length; i++) {
    const char = cleanUrl.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const ext = cleanUrl.split('.').pop() || 'jpg';
  return `cached_${Math.abs(hash)}.${ext}`;
}

const memoryCache = new Map<string, string>();
const MAX_MEMORY_CACHE = 200;

function setMemoryCache(key: string, path: string) {
  if (memoryCache.size >= MAX_MEMORY_CACHE) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, path);
}

export interface CachedImageProps extends Omit<ImageProps, 'source'> {
  uri?: string | null;
  source?: any;
  placeholderColor?: string;
}

export function CachedImage({
  uri,
  source,
  style,
  placeholderColor = '#F2EBE5',
  ...props
}: CachedImageProps) {
  const isLocal = uri && (
    uri.startsWith('file://') ||
    uri.startsWith('ph://') ||
    uri.startsWith('content://') ||
    uri.startsWith('data:')
  );

  const [localUri, setLocalUri] = useState<string | null>(() => {
    if (!uri) return null;
    if (isLocal) return uri;
    return memoryCache.get(uri) || uri;
  });

  useEffect(() => {
    let isMounted = true;

    if (!uri) {
      setLocalUri(null);
      return;
    }

    // Direct local URIs (bundled assets, local camera captures, file://, data:)
    if (isLocal) {
      setLocalUri(uri);
      return;
    }

    if (memoryCache.has(uri)) {
      setLocalUri(memoryCache.get(uri)!);
      return;
    }

    // Immediately display network URI without blocking on disk download
    setLocalUri(uri);

    async function loadCachedImage() {
      try {
        await ensureDirExists();
        const filename = getCacheFilename(uri!);
        const localPath = `${CACHE_FOLDER}${filename}`;
        const fileInfo = await FileSystem.getInfoAsync(localPath);

        if (fileInfo.exists) {
          setMemoryCache(uri!, localPath);
          if (isMounted) setLocalUri(localPath);
          return;
        }

        // Fast download to local phone disk cache in background
        const downloadRes = await FileSystem.downloadAsync(uri!, localPath);
        if (isMounted && downloadRes?.uri) {
          setMemoryCache(uri!, downloadRes.uri);
          if (isMounted) setLocalUri(downloadRes.uri);
        }
      } catch (err) {
        // Direct network URI is already displayed, ignore background cache failure
      }
    }

    loadCachedImage();

    return () => {
      isMounted = false;
    };
  }, [uri]);

  const [hasError, setHasError] = useState(false);

  if (source) {
    return <Image source={source} style={style} {...props} />;
  }

  if (!localUri || hasError) {
    return <View style={[{ backgroundColor: placeholderColor }, style]} />;
  }

  return (
    <Image
      source={{ uri: localUri }}
      style={style}
      onError={() => {
        setHasError(true);
      }}
      {...props}
    />
  );
}
