import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '../constants/theme';

interface AppHeaderProps {
  title?: string;
  back?: boolean;
  onBack?: () => void;
  /** Custom right-side element. Pass null to render nothing. */
  right?: React.ReactNode | null;
  showBell?: boolean;
}

export function AppHeader({ title, back, onBack, right, showBell = true }: AppHeaderProps) {
  const router = useRouter();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const renderRight = () => {
    if (right !== undefined) return right; // caller controls it (including null = nothing)
    if (showBell && !back) {
      return (
        <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="notifications-outline" size={20} color={Colors.foreground} />
        </TouchableOpacity>
      );
    }
    return null;
  };

  return (
    <View style={styles.header}>
      <View style={styles.side}>
        {back && (
          <TouchableOpacity onPress={handleBack} style={styles.iconBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
          </TouchableOpacity>
        )}
      </View>

      {title ? (
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}

      <View style={styles.side}>
        {renderRight()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.background,
  },
  side: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '500',
    color: Colors.foreground,
    fontFamily: 'serif',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
