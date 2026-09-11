import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../src/components/AppHeader';
import { Colors, Spacing, Radii } from '../src/constants/theme';
import { useSession } from '../src/services/session';
import { productApi, ApiError } from '../src/services/api';
import { toExtractedProductInput } from '../src/services/extraction';

// This screen persists the on-device-extracted product to the backend
// (POST /api/v1/product/from-extension) so a product_id exists for the try-on step.
export default function Extraction() {
  const router = useRouter();
  const extractedProduct = useSession((s) => s.extractedProduct);
  const sourceUrl = useSession((s) => s.sourceUrl);
  const setProductId = useSession((s) => s.setProductId);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const steps = [
    { label: 'Reading URL' },
    { label: 'Extracting images' },
    { label: 'Saving product' },
    { label: 'Ready for try-on' },
  ];

  useEffect(() => {
    if (!extractedProduct || !sourceUrl) {
      setError('Missing extracted product — please go back and try again.');
      return;
    }
    setStep(1);
    const t1 = setTimeout(() => setStep(2), 400);

    productApi
      .fromExtraction(toExtractedProductInput(extractedProduct))
      .then((res) => {
        setProductId(res.product_id);
        setStep(3);
        setTimeout(() => router.replace('/processing'), 500);
      })
      .catch((e: ApiError) => {
        setError(e.message || 'Could not save this product. You can still continue offline.');
      });

    return () => clearTimeout(t1);
  }, [extractedProduct, sourceUrl]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader title="Extracting" back />
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.stepCount}>STEP 2 OF 4</Text>
          <Text style={styles.stepTitle}>{error ? 'Something went wrong' : 'Extracting images'}</Text>
          <View style={styles.steps}>
            {steps.map((s, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={[
                  styles.stepDot,
                  i < step && styles.stepDotDone,
                  i === step && styles.stepDotActive,
                ]}>
                  {i < step && <Ionicons name="checkmark" size={12} color={Colors.successForeground} />}
                  {i === step && <View style={styles.innerDot} />}
                </View>
                <Text style={[
                  styles.stepLabel,
                  i < step && styles.stepLabelDone,
                  i === step && styles.stepLabelActive,
                ]}>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl },
  card: {
    backgroundColor: Colors.card, borderRadius: Radii.xl,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.xl,
  },
  stepCount: { fontSize: 10, letterSpacing: 2, color: Colors.mutedForeground, textTransform: 'uppercase', marginBottom: 6 },
  stepTitle: { fontFamily: 'serif', fontSize: 22, color: Colors.foreground, marginBottom: Spacing.xl },
  steps: { gap: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.muted, alignItems: 'center', justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: Colors.success },
  stepDotActive: { backgroundColor: Colors.primary },
  innerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primaryForeground },
  stepLabel: { fontSize: 13, color: Colors.mutedForeground },
  stepLabelDone: { color: Colors.foreground },
  stepLabelActive: { color: Colors.foreground, fontWeight: '600' },
  errorText: { marginTop: Spacing.lg, fontSize: 13, color: Colors.mutedForeground },
});
