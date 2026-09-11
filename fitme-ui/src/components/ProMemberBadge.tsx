import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/* ─── Design tokens ──────────────────────────────────────── */

const COPPER  = '#C97B56';
const BORDER  = '#E8CDBE';
const BG      = '#FFF7F3';

/* ─── Types ──────────────────────────────────────────────── */

export type ProMemberBadgeVariant = 'compact' | 'standard';

interface ProMemberBadgeProps {
  variant?: ProMemberBadgeVariant;
}

/* ─── Component ──────────────────────────────────────────── */

export function ProMemberBadge({ variant = 'compact' }: ProMemberBadgeProps) {
  const isCompact = variant === 'compact';

  return (
    <View style={[styles.badge, isCompact ? styles.badgeCompact : styles.badgeStandard]}>
      <Text style={[styles.label, isCompact ? styles.labelCompact : styles.labelStandard]}>
        Pro Member
      </Text>
    </View>
  );
}

/* ─── Styles ──────────────────────────────────────────────── */

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  /* Compact — Home screen header */
  badgeCompact: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    height: 24,
  },
  /* Standard — Profile screen identity card */
  badgeStandard: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    height: 28,
  },

  label: {
    color: COPPER,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  labelCompact: {
    fontSize: 11,
  },
  labelStandard: {
    fontSize: 13,
  },
});
