import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/theme';

interface LogoProps {
  size?: number;
}

export function Logo({ size = 28 }: LogoProps) {
  return (
    <Text style={[styles.logo, { fontSize: size }]}>
      <Text style={styles.fitPart}>Fit</Text>
      <Text style={styles.mePart}>Me</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  logo: {
    fontFamily: 'serif',
    letterSpacing: -0.5,
  },
  fitPart: {
    color: Colors.foreground,
  },
  mePart: {
    color: Colors.accent,
  },
});
