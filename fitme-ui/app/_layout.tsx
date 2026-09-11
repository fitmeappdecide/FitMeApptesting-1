import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Colors } from '../src/constants/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" backgroundColor={Colors.background} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="import" />
        <Stack.Screen name="extraction" />
        <Stack.Screen name="processing" />
        <Stack.Screen name="result" />
        <Stack.Screen name="my-photos" />
        <Stack.Screen name="upload-photo" />
        <Stack.Screen name="measurements" />
        <Stack.Screen name="style-dna" />
        <Stack.Screen name="saved" />
        <Stack.Screen name="history" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="privacy-security" />
        <Stack.Screen name="contact-support" />
        <Stack.Screen name="open-source-licenses" />
        <Stack.Screen name="about" />
        <Stack.Screen name="subscription" />
        <Stack.Screen name="find-product/index" />
        <Stack.Screen name="find-product/searching" />
        <Stack.Screen name="find-product/results" />
      </Stack>
    </SafeAreaProvider>
  );
}
