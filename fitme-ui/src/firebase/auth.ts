// src/firebase/auth.ts

import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { auth } from './index'; // needed for logout
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi, clearAuth } from '../services/api';

// Configure Google Sign-In (client ID from GoogleService-Info.plist)
// In a real app you might pull this from native config; hard‑coded here for simplicity.
GoogleSignin.configure({
  scopes: ['profile', 'email'],
  webClientId: '691300275712-n5ime2qjjkmadd7el2vurjct4uoe8156.apps.googleusercontent.com',
  offlineAccess: false
});

/** Register with email/password via backend (already implemented in authApi). */
export const registerWithEmail = async (email: string, password: string, fullName?: string) => {
  const res = await authApi.register(email, password, fullName);
  // Tokens are persisted inside authApi.register.
  return res;
};

/** Login with email/password via backend. */
export const loginWithEmail = async (email: string, password: string) => {
  const res = await authApi.login(email, password);
  // Tokens are persisted inside authApi.login.
  return res;
};

/** Exchange a Firebase ID token for backend JWTs. */
export const exchangeIdToken = async (firebaseIdToken: string) => {
  const res = await authApi.loginWithFirebase(firebaseIdToken);
  return res;
};

// Instrumented loginWithGoogle with detailed logging and error handling
export const loginWithGoogle = async () => {
  console.log("===== Starting Google Sign-In =====");
  try {
    // Ensure Google Play Services are available (Android only)
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    console.log("✓ Google Play Services available");

    // Initiate native Google sign‑in
    console.log("Calling GoogleSignin.signIn()");
    const result = await GoogleSignin.signIn();
    console.log("Google Sign-In Result type:", (result as any)?.type);

    // @react-native-google-signin/google-signin v13+ wraps in { type, data }
    const signInData = (result as any)?.data ?? result;
    const idToken: string | null = signInData?.idToken ?? (result as any)?.idToken ?? null;
    console.log("ID Token:", idToken ? "Present" : "Missing");

    if (!idToken) {
      throw new Error("Google Sign-In did not return an idToken");
    }

    // ---- Skip signInWithCredential (Firebase JS SDK network call) ----
    // On Android the JS SDK's signInWithCredential makes a REST call to
    // googleapis.com which often fails with "Network request failed" in RN.
    // Instead, send the Google idToken directly to our backend which
    // validates Firebase-compatible Google tokens server-side.
    console.log("Calling backend /api/v1/auth/firebase with Google idToken");
    let response;
    try {
      response = await exchangeIdToken(idToken);
    } catch (error: any) {
      console.error("Backend token exchange failed:", error?.message);
      throw error;
    }
    console.log("Backend login successful");

    // Build a minimal user-like object for callers that expect it
    const user = {
      uid: signInData?.user?.id ?? signInData?.user?.email ?? "google-user",
      email: signInData?.user?.email ?? null,
      displayName: signInData?.user?.name ?? null,
      photoURL: signInData?.user?.photo ?? null,
    };

    console.log("Navigating to Home");
    return user;
  } catch (error: any) {
    console.error("Google Sign-In FAILED");
    console.error(error?.code);
    console.error(error?.message);
    throw error;
  }
};


/** Logout from Firebase, Google Sign-In, backend tokens, and clear local caches. */
export const logout = async () => {
  try { await GoogleSignin.signOut(); } catch (_) {}
  try { await auth.signOut(); } catch (_) {}
  try { await authApi.logout(); } catch (_) {}
  await clearAuth();
  try {
    await AsyncStorage.multiRemove([
      'fitme_home_recent_comparisons',
      'fitme_home_recent_tryons',
      'fitme_looks_phone_cache_v3',
      'fitme_saved_photos_cache_v2',
    ]);
  } catch (_) {}
};
