import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../src/constants/theme';

// Brand icon — matches the new logo
function AvaIcon({ color = Colors.accent }: { color?: string }) {
  return (
    <Image 
      source={require('../assets/eva.png')}
      style={{ width: 18, height: 18, tintColor: color }}
      resizeMode="contain"
    />
  );
}

type NotifType = 'check' | 'spinner' | 'heart';

const notifications: { icon: NotifType; title: string; body: string; time: string }[] = [
  { icon: 'check',   title: 'Try-on ready',  body: 'Your silk slip dress look is ready to view.', time: '2m' },
  { icon: 'spinner', title: 'New from Ava',   body: 'Three outfit ideas for your Lisbon trip.',    time: '1h' },
  { icon: 'heart',   title: 'Trending now',   body: 'Linen tailoring is moving fast — see picks.', time: '5h' },
];

function NotifIcon({ type }: { type: NotifType }) {
  if (type === 'spinner') return <AvaIcon />;
  if (type === 'check')   return <Ionicons name="checkmark-circle-outline" size={18} color={Colors.accent} />;
  return <Ionicons name="heart-outline" size={18} color={Colors.accent} />;
}

export default function Notifications() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Notifications" back right={<View style={{ width: 36 }} />} />
      <ScrollView showsVerticalScrollIndicator={false}>
        {notifications.map((n, i) => (
          <View key={i} style={[styles.row, i < notifications.length - 1 && styles.rowBorder]}>
            <View style={styles.iconWrap}>
              <NotifIcon type={n.icon} />
            </View>
            <View style={styles.content}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{n.title}</Text>
                <Text style={styles.time}>{n.time}</Text>
              </View>
              <Text style={styles.body}>{n.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  row:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: Spacing.xl },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  iconWrap:  { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.accent + '15', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  content:   { flex: 1 },
  titleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  title:     { fontSize: 14, fontWeight: '500', color: Colors.foreground },
  time:      { fontSize: 11, color: Colors.mutedForeground },
  body:      { fontSize: 13, color: Colors.mutedForeground, lineHeight: 19 },
});
