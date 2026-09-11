# FITME — PRE-DEPLOYMENT RELEASE BLOCKERS
**Status:** ❌ SUBMISSION BLOCKED  
**Target Stores:** Apple App Store (iOS) & Google Play Store (Android)  
**Inspection Date:** September 12, 2026  

This document contains **ONLY** P0 (guaranteed store rejection), P1 (high probability rejection / critical security risk), and submission-critical P2 blockers discovered during the 0–100% pre-deployment release audit.

---

## TABLE OF BLOCKERS

| ID | Priority | Platform | Issue Title | Store Policy / Guideline |
| :--- | :--- | :--- | :--- | :--- |
| **BLK-01** | **P0** | iOS & Android | Mock In-App Purchases / No StoreKit or Play Billing | Apple 3.1.1 & 2.1; Google Play Payments Policy |
| **BLK-02** | **P0** | iOS | Missing "Sign in with Apple" & Placeholder Auth Alert | Apple Guideline 4.8 & 2.1 |
| **BLK-03** | **P0** | iOS & Android | Dead / Unhosted Privacy Policy & Terms URLs | Apple Guideline 5.1.1; Google Play User Data |
| **BLK-04** | **P0** | iOS & Android | Default Loopback IP / Missing Production Backend URL | Apple Guideline 2.1 (App Completeness & Crashes) |
| **BLK-05** | **P0** | Android | Release Build Signed with Debug Keystore | Google Play Console Signing Requirements |
| **BLK-06** | **P0** | iOS & Android | Insecure Cleartext Traffic & ATS Global Bypass | Apple ATS Policy; Google Play Network Security |
| **BLK-07** | **P0** | iOS & Android | Orphaned Onboarding Flow / Forced Direct Tab Navigation | Apple Guideline 2.1 (App Completeness) |
| **BLK-08** | **P1** | Android | Deprecated Broad External Storage Permissions | Google Play Photo Picker & Storage Policy |
| **BLK-09** | **P1** | iOS | Missing App Store Export Compliance Declaration | App Store Connect Export Compliance |
| **BLK-10** | **P1** | iOS & Android | Unused PII (Phone Number) Collected on Signup | Apple Guideline 5.1.1; Google Play Data Safety |
| **BLK-11** | **P1** | iOS & Android | Dead "Forgot Password?" Link on Login Screen | Apple Guideline 2.1 (App Completeness) |
| **BLK-12** | **P2** | iOS & Android | Store Rating Fallback Points to Dummy App IDs | Apple Guideline 2.1 & UX Standards |

---

## P0 BLOCKERS (GUARANTEED STORE REJECTION)

### BLK-01: Mock In-App Purchases / Missing StoreKit & Google Play Billing
* **Platforms Affected:** iOS & Android
* **Store Policy Violated:**
  * **Apple App Store:** Guideline 3.1.1 (Business - Payments - In-App Purchase) & Guideline 2.1 (App Completeness)
  * **Google Play Store:** Payments Policy (Google Play's Billing System) & Policy on Incomplete/Broken Apps
* **Exact Location:** `fitme-ui/app/subscription.tsx` (Lines 58–68, 83–91)
  ```typescript
  // Line 58
  const handleUpgrade = () => {
    Alert.alert('Upgrade to Pro', 'This will open the native purchase flow.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mock Purchase ✓', onPress: () => setPremium(true) },
    ]);
  };
  // Line 83
  const handleRestore = () => {
    Alert.alert('Restore Purchases', 'Checking for previous purchases…\n\n(RevenueCat integration pending)');
  };
  ```
* **Impact Description:**
  The app allows users to unlock digital features (Pro subscription, unlimited try-ons) without processing any real payment transaction. Tapping "Mock Purchase ✓" sets `isPremium = true` locally in client state. Tapping "Restore Purchases" displays an explicit alert declaring RevenueCat integration is pending. Apple App Reviewers will test this button during review, see the mock alert, and immediately issue a Guideline 3.1.1 and 2.1 rejection.
* **Remediation Plan:**
  1. Install RevenueCat: `npx expo install react-native-purchases`.
  2. Configure iOS App Store Connect In-App Purchases (Monthly & Annual Auto-Renewable Subscriptions) and Google Play Console Subscriptions.
  3. Initialize Purchases SDK in `_layout.tsx` with platform-specific API keys.
  4. Replace `handleUpgrade()` in `subscription.tsx` with `await Purchases.purchasePackage(selectedPackage)`.
  5. Replace `handleRestore()` with `await Purchases.restorePurchases()`.
  6. Eliminate all references to `"Mock Purchase"` and `"pending"` text strings.

---

### BLK-02: Missing "Sign in with Apple" & Broken Auth Placeholders
* **Platforms Affected:** iOS
* **Store Policy Violated:**
  * **Apple App Store:** Guideline 4.8 (Sign in with Apple) & Guideline 2.1 (App Completeness)
* **Exact Location:** `fitme-ui/app/login.tsx` (Lines 187–198)
  ```typescript
  // Line 187
  <TouchableOpacity style={styles.socialBtn} onPress={() => Alert.alert('Coming soon', 'Sign in with Apple requires capability setup — see README for adding it.')} activeOpacity={0.7}>
    <View style={styles.socialIconWrap}>
      <Ionicons name="logo-apple" size={17} color={Colors.foreground} />
    </View>
    <Text style={styles.socialBtnText}>Continue with Apple</Text>
  </TouchableOpacity>
  // Line 193
  <TouchableOpacity style={styles.socialBtn} onPress={() => Alert.alert('Coming soon', 'Phone sign-in is not wired up yet.')} activeOpacity={0.7}>
    <Text style={styles.socialBtnText}>Continue with Phone</Text>
  </TouchableOpacity>
  ```
* **Impact Description:**
  Under Apple Guideline 4.8, any app that offers third-party social login (such as Google Sign-In) **must** offer Sign in with Apple as an equivalent choice. Currently, FitMe offers Google Sign-In, but tapping "Continue with Apple" opens a placeholder alert instructing the user to read the README.
* **Remediation Plan:**
  1. Add the Apple Sign-in capability in Xcode (`Signing & Capabilities` -> `+ Capability` -> `Sign in with Apple`).
  2. Install `expo-apple-authentication`.
  3. Wire `appleAuth.performRequest()` to exchange the Apple identity token with the backend/Firebase.
  4. If Phone sign-in is not implemented, remove the "Continue with Phone" button completely rather than displaying a "Coming soon" alert dialog.

---

### BLK-03: Dead / Unhosted Privacy Policy & Terms URLs
* **Platforms Affected:** iOS & Android
* **Store Policy Violated:**
  * **Apple App Store:** Guideline 5.1.1 (Data Collection and Storage - Privacy Policy)
  * **Google Play Store:** User Data Policy (Privacy Policy Requirement)
* **Exact Location:** `fitme-ui/app/(tabs)/profile.tsx` (Lines 168–169)
  ```typescript
  const handlePrivacy = () => Linking.openURL('https://fitme.app/privacy');
  const handleTerms   = () => Linking.openURL('https://fitme.app/terms');
  ```
* **Impact Description:**
  `https://fitme.app` is currently an unhosted domain returning HTTP 403 / NXDOMAIN. Apple and Google automated review bots verify that the privacy policy URL is reachable and returns HTTP 200 prior to manual review. If the URL is broken, submission is automatically rejected or blocked from release.
* **Remediation Plan:**
  1. Host the Privacy Policy and Terms of Service documents on a live HTTPS web server or public Notion/GitHub Pages site (e.g., `https://legal.fitme.app/privacy` or equivalent).
  2. Update lines 168–169 in `profile.tsx` with the live HTTPS URLs.
  3. Enter the exact same live URL in the App Store Connect and Google Play Console privacy policy fields.

---

### BLK-04: Default Loopback IP / Missing Production Backend URL
* **Platforms Affected:** iOS & Android
* **Store Policy Violated:**
  * **Apple App Store:** Guideline 2.1 (App Completeness / Crashes)
  * **Google Play Store:** Quality & Functional Requirements
* **Exact Location:** `fitme-ui/src/services/api.ts` (Lines 21–37)
  ```typescript
  const envUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  function resolveBaseUrl(): string {
    if (envUrl) { ... }
    // Fallback defaults
    return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
  }
  ```
* **Impact Description:**
  There is no production `.env` file included in the client bundle. In production release builds, `process.env.EXPO_PUBLIC_API_URL` evaluates to `undefined`, falling back to `127.0.0.1:8000` on iOS and `10.0.2.2:8000` on Android. When Apple or Google reviewers open the app on physical devices, every network request fails with connection errors.
* **Remediation Plan:**
  1. Deploy the FastAPI backend to a production cloud server with a verified SSL certificate (e.g., `https://api.fitme.app`).
  2. Create `fitme-ui/.env.production` containing:
     ```bash
     EXPO_PUBLIC_API_URL=https://api.fitme.app
     ```
  3. Ensure release build scripts bundle this environment variable.

---

### BLK-05: Release Build Signed with Debug Keystore
* **Platforms Affected:** Android (Google Play Store)
* **Store Policy Violated:**
  * **Google Play Store:** Play Console Release Signing Policy
* **Exact Location:** `fitme-ui/android/app/build.gradle` (Lines 137–140)
  ```groovy
  buildTypes {
      release {
          // Caution! In production, you need to generate your own keystore file.
          signingConfig signingConfigs.debug
          shrinkResources false
          minifyEnabled false
      }
  }
  ```
* **Impact Description:**
  The release build type explicitly points to `signingConfigs.debug`. Google Play Console strictly refuses to ingest any AAB or APK signed with the default `androiddebugkey`.
* **Remediation Plan:**
  1. Generate a production upload keystore using `keytool`:
     ```bash
     keytool -genkey -v -keystore fitme-release.keystore -alias fitme-key -keyalg RSA -keysize 2048 -validity 10000
     ```
  2. Store the keystore securely and configure release signing credentials in `android/gradle.properties` or CI/CD environment variables.
  3. Update `buildTypes.release.signingConfig` to reference `signingConfigs.release`.

---

### BLK-06: Insecure Cleartext Traffic & ATS Global Bypass
* **Platforms Affected:** iOS & Android
* **Store Policy Violated:**
  * **Apple App Store:** App Transport Security (ATS) Policy
  * **Google Play Store:** Target API 28+ Network Security Policy
* **Exact Location:**
  * Android: `fitme-ui/android/app/src/main/AndroidManifest.xml` (Line 14)
    ```xml
    android:usesCleartextTraffic="true"
    ```
  * iOS: `fitme-ui/ios/FitMe/Info.plist` (Lines 41–46)
    ```xml
    <key>NSAppTransportSecurity</key>
    <dict>
      <key>NSAllowsArbitraryLoads</key>
      <true/>
      <key>NSAllowsLocalNetworking</key>
      <true/>
    </dict>
    ```
* **Impact Description:**
  Global `NSAllowsArbitraryLoads = true` on iOS triggers automatic flags during App Store Review, requiring explicit technical justification. Android `usesCleartextTraffic="true"` exposes mobile traffic to man-in-the-middle attacks and violates Google Play security recommendations.
* **Remediation Plan:**
  1. In `AndroidManifest.xml`, change `android:usesCleartextTraffic="true"` to `false`.
  2. In `Info.plist`, remove global `NSAllowsArbitraryLoads = true`. If required for the webview shopping browser, use `<key>NSAllowsArbitraryLoadsInWebContent</key><true/>`.

---

### BLK-07: Orphaned Onboarding Flow / Forced Direct Home Navigation
* **Platforms Affected:** iOS & Android
* **Store Policy Violated:**
  * **Apple App Store:** Guideline 2.1 (App Completeness & User Experience)
* **Exact Location:** `fitme-ui/app/index.tsx` (Lines 26–28)
  ```typescript
  const timer = setTimeout(async () => {
    router.replace('/(tabs)/home');
  }, 500);
  ```
* **Impact Description:**
  The splash screen runs a 500ms timer and unconditionally routes to `/(tabs)/home`. The onboarding flow in `app/onboarding.tsx` is completely bypassed and cannot be reached by a user downloading the app for the first time.
* **Remediation Plan:**
  1. In `index.tsx`, read stored auth tokens and an `hasCompletedOnboarding` flag from `AsyncStorage` / `SecureStore`.
  2. If the user is launching for the first time, navigate to `/onboarding`.
  3. If authenticated, route to `/(tabs)/home`.
  4. If unauthenticated but onboarding completed, route to `/login`.

---

## P1 BLOCKERS (HIGH RISK OF REJECTION / CRITICAL DEFECTS)

### BLK-08: Deprecated Broad External Storage Permissions on Android
* **Platforms Affected:** Android
* **Store Policy Violated:** Google Play Photo and Video Permissions Policy (Targeting Android 14 / API 34)
* **Exact Location:** `fitme-ui/android/app/src/main/AndroidManifest.xml` (Lines 4, 6)
  ```xml
  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>
  <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"/>
  ```
* **Impact Description:**
  Google Play mandates that apps targeting Android 13+ (API 33+) that only require user-selected photos must not request `READ_EXTERNAL_STORAGE` or `WRITE_EXTERNAL_STORAGE`. Declaring these permissions requires filling out a high-scrutiny permission declaration form in Play Console and will result in rejection if the core function is not a file manager.
* **Remediation Plan:**
  1. Remove `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` from `AndroidManifest.xml`.
  2. If direct permission is needed on Android 13+, specify `<uses-permission android:name="android.permission.READ_MEDIA_IMAGES"/>`.

---

### BLK-09: Missing App Store Export Compliance Declaration
* **Platforms Affected:** iOS
* **Store Policy Violated:** App Store Connect Export Compliance Documentation
* **Exact Location:** `fitme-ui/ios/FitMe/Info.plist`
* **Impact Description:**
  Without `ITSAppUsesNonExemptEncryption`, every build uploaded to App Store Connect gets stuck in a "Missing Compliance" state requiring manual web intervention before it can be distributed to TestFlight or App Store Review.
* **Remediation Plan:**
  Add the following key to `fitme-ui/ios/FitMe/Info.plist`:
  ```xml
  <key>ITSAppUsesNonExemptEncryption</key>
  <false/>
  ```

---

### BLK-10: Unused PII (Phone Number) Collected on Signup
* **Platforms Affected:** iOS & Android
* **Store Policy Violated:** Apple Guideline 5.1.1 (Data Minimization) & Google Play Data Safety Declaration
* **Exact Location:** `fitme-ui/app/signup.tsx` (Lines 15, 33–34)
  ```typescript
  // Line 15
  { label: 'PHONE', key: 'phone', placeholder: '+91 98765 43210', type: 'phone-pad' },
  // Line 33
  // Note: the backend's /auth/register only accepts email, password, full_name —
  // phone isn't part of the current schema, so it's collected here but not sent yet.
  ```
* **Impact Description:**
  Collecting personal phone numbers in the UI without transmitting, storing, or securing them violates data minimization principles and creates an immediate mismatch with App Store Privacy Nutrition Labels and Google Play Data Safety forms.
* **Remediation Plan:**
  Remove the phone input field from `fields` in `signup.tsx` until backend schema and privacy disclosures are updated to support it.

---

### BLK-11: Dead "Forgot Password?" Link on Login Screen
* **Platforms Affected:** iOS & Android
* **Store Policy Violated:** Apple Guideline 2.1 (App Completeness)
* **Exact Location:** `fitme-ui/app/login.tsx` (Lines 162–166)
  ```typescript
  <TouchableOpacity style={styles.forgotBtn}>
    <Text style={styles.forgotText}>Forgot password?</Text>
  </TouchableOpacity>
  ```
* **Impact Description:**
  The "Forgot password?" button has no `onPress` prop. Tapping it produces no response, which App Reviewers routinely flag as a broken interactive element under Guideline 2.1.
* **Remediation Plan:**
  1. Add a password reset modal or integrate Firebase Auth's `sendPasswordResetEmail(email)`.
  2. If not ready for initial release, open an alert prompting the user to contact support or navigate to a reset password screen.

---

## SUBMISSION-CRITICAL P2 BLOCKERS

### BLK-12: Store Rating Fallback Points to Dummy IDs
* **Platforms Affected:** iOS & Android
* **Store Policy Violated:** Apple Guideline 2.1 & General App Store Quality Guidelines
* **Exact Location:** `fitme-ui/app/(tabs)/profile.tsx` (Lines 174–176)
  ```typescript
  const storeUrl = Platform.OS === 'ios'
    ? 'https://apps.apple.com/app/id0000000000'
    : 'market://details?id=app.fitme.app';
  ```
* **Impact Description:**
  Tapping "Rate FitMe" attempts to open `id0000000000` on iOS (which fails with an invalid store item error) and `app.fitme.app` on Android (which fails because the real package is `com.fitme.app`).
* **Remediation Plan:**
  1. In `profile.tsx`, use `StoreReview.requestReview()` from `expo-store-review` for in-app ratings.
  2. Replace dummy URLs with valid store application IDs prior to public release.

---

## CONCLUSION & IMMEDIATE ACTION REQUIRED

FitMe **cannot be submitted** to either the Apple App Store or the Google Play Store today. Submitting in its current state will guarantee immediate rejection.

**Required Action Sequence:**
1. Resolve all **7 P0 Blockers** (BLK-01 through BLK-07).
2. Resolve **P1 Blockers** (BLK-08 through BLK-11).
3. Create a clean git release commit and tag (`v1.0.0`).
4. Generate signed release builds with proper production credentials.
