# FitMe — React Native (Expo) App

AI Virtual Try-On app for iOS and Android.

---

## Prerequisites

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 18+ | https://nodejs.org |
| Watchman | latest | `brew install watchman` (Mac) |
| Expo CLI | latest | `npm install -g expo-cli` |
| Xcode | 15+ | Mac App Store (iOS only) |
| Android Studio | latest | https://developer.android.com/studio |
| CocoaPods | latest | `sudo gem install cocoapods` (iOS only) |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start development server (Expo Go — no Xcode/Android Studio needed)
npm start
# Then scan QR with Expo Go app on your phone
```

---

## Run on Xcode (iOS Simulator or Device)

```bash
# Step 1: Generate native iOS project
npx expo prebuild --platform ios

# Step 2: Install CocoaPods
cd ios && pod install && cd ..

# Step 3: Run on simulator
npm run ios
# OR open in Xcode manually:
open ios/FitMe.xcworkspace
# Then press ▶ in Xcode
```

**For a real iOS device:**
1. Open `ios/FitMe.xcworkspace` in Xcode
2. Select your device in the top bar
3. Go to Signing & Capabilities → set your Apple Developer Team
4. Press ▶

---

## Run on Android Studio (Emulator or Device)

```bash
# Step 1: Generate native Android project
npx expo prebuild --platform android

# Step 2: Open in Android Studio
open android/
# OR: File → Open → select the android/ folder

# Step 3: Run (after emulator is running)
npm run android
# OR press ▶ in Android Studio
```

**For a real Android device:**
1. Enable Developer Options on your device (tap Build Number 7 times)
2. Enable USB Debugging
3. Connect via USB
4. Run `npm run android`

---

## Connect Your Backend

All mock data is in `src/data/mockData.ts`. Replace it with real API calls.

### 1. Create API service layer

Create `src/services/api.ts`:

```typescript
const BASE_URL = 'https://your-api.com/v1'; // ← your backend URL

// Auth token storage (use expo-secure-store in production)
let authToken: string | null = null;

export function setAuthToken(token: string) {
  authToken = token;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

// ─── AUTH ────────────────────────────────────────────────
export const auth = {
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  signup: (name: string, email: string, phone: string, password: string) =>
    request<{ token: string; user: User }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, phone, password }),
    }),

  logout: () => request('/auth/logout', { method: 'POST' }),
};

// ─── TRY-ON ──────────────────────────────────────────────
export const tryOn = {
  extractProduct: (url: string) =>
    request<Product>('/tryon/extract', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  generate: (productId: string, photoId: string) =>
    request<TryOnResult>('/tryon/generate', {
      method: 'POST',
      body: JSON.stringify({ productId, photoId }),
    }),

  getHistory: () => request<TryOnResult[]>('/tryon/history'),
  getSaved:   () => request<TryOnResult[]>('/tryon/saved'),

  save:   (tryOnId: string) => request(`/tryon/${tryOnId}/save`, { method: 'POST' }),
  unsave: (tryOnId: string) => request(`/tryon/${tryOnId}/save`, { method: 'DELETE' }),
};

// ─── PHOTOS ──────────────────────────────────────────────
export const photos = {
  list: () => request<Photo[]>('/photos'),

  upload: async (uri: string): Promise<Photo> => {
    const formData = new FormData();
    formData.append('photo', {
      uri,
      type: 'image/jpeg',
      name: 'photo.jpg',
    } as any);

    const response = await fetch(`${BASE_URL}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: formData,
    });
    return response.json();
  },

  delete: (photoId: string) => request(`/photos/${photoId}`, { method: 'DELETE' }),
};

// ─── PROFILE ─────────────────────────────────────────────
export const profile = {
  get:          () => request<User>('/profile'),
  updateMeasurements: (data: Measurements) =>
    request('/profile/measurements', { method: 'PUT', body: JSON.stringify(data) }),
  updateStyleDna: (data: StyleDna) =>
    request('/profile/style-dna', { method: 'PUT', body: JSON.stringify(data) }),
};

// ─── AVA AI ──────────────────────────────────────────────
export const ava = {
  chat: (message: string, context: { productId?: string }) =>
    request<{ reply: string }>('/ava/chat', {
      method: 'POST',
      body: JSON.stringify({ message, context }),
    }),
};

// ─── TYPES ───────────────────────────────────────────────
export type User = {
  id: string;
  name: string;
  email: string;
  avatar?: string;
};

export type Product = {
  id: string;
  title: string;
  brand: string;
  price: string;
  image: string;
  platform: string;
};

export type TryOnResult = {
  id: string;
  product: Product;
  resultImage: string;
  createdAt: string;
  saved: boolean;
};

export type Photo = {
  id: string;
  uri: string;
  createdAt: string;
};

export type Measurements = {
  height: string;
  weight: string;
  bodyShape: string;
  bust: string;
  waist: string;
  hips: string;
};

export type StyleDna = {
  colors: string[];
  fits: string[];
  brands: string[];
};
```

### 2. Wire up Login screen

Replace mock navigation in `app/login.tsx`:

```typescript
import { auth, setAuthToken } from '../src/services/api';

const handleLogin = async () => {
  try {
    const { token } = await auth.login(email, password);
    setAuthToken(token);
    router.replace('/(tabs)/home');
  } catch (e) {
    Alert.alert('Login failed', 'Check your email and password.');
  }
};
```

### 3. Wire up Try-On flow

In `app/import.tsx`, call `tryOn.extractProduct(url)`.
In `app/processing.tsx`, call `tryOn.generate(productId, photoId)`.
In `app/result.tsx`, call `tryOn.save(tryOnId)`.

### 4. Secure token storage (production)

```bash
npx expo install expo-secure-store
```

```typescript
import * as SecureStore from 'expo-secure-store';

export async function saveToken(token: string) {
  await SecureStore.setItemAsync('auth_token', token);
}
export async function loadToken(): Promise<string | null> {
  return SecureStore.getItemAsync('auth_token');
}
```

---

## Project Structure

```
FitMeApp/
├── app/                    # All screens (expo-router file-based routing)
│   ├── (tabs)/             # Bottom tab screens
│   │   ├── _layout.tsx     # Tab bar configuration
│   │   ├── home.tsx        # Home tab
│   │   ├── looks.tsx       # Looks tab
│   │   ├── ava.tsx         # Ava AI stylist tab
│   │   └── profile.tsx     # Profile tab
│   ├── _layout.tsx         # Root layout (navigation stack)
│   ├── index.tsx           # Splash screen
│   ├── onboarding.tsx
│   ├── login.tsx
│   ├── signup.tsx
│   ├── import.tsx          # Step 1: paste product URL
│   ├── extraction.tsx      # Step 2: extract product info
│   ├── processing.tsx      # Step 3: generate try-on
│   ├── result.tsx          # Step 4: view result
│   ├── my-photos.tsx
│   ├── upload-photo.tsx
│   ├── measurements.tsx
│   ├── style-dna.tsx
│   ├── saved.tsx
│   ├── history.tsx
│   ├── notifications.tsx
│   ├── settings.tsx
│   ├── privacy-security.tsx
│   └── contact-support.tsx
├── src/
│   ├── components/         # Shared components
│   │   ├── AppHeader.tsx
│   │   └── Logo.tsx
│   ├── constants/
│   │   └── theme.ts        # Colors, spacing, radii
│   ├── data/
│   │   └── mockData.ts     # ← Replace with API calls
│   └── services/
│       └── api.ts          # ← Create this (see above)
├── assets/                 # Icons, splash, fonts
├── app.json                # Expo config
├── babel.config.js
├── metro.config.js
├── tsconfig.json
└── package.json
```

---

## Build for Production

```bash
# Install EAS CLI
npm install -g eas-cli
eas login

# Configure builds
eas build:configure

# Build iOS (.ipa for TestFlight / App Store)
eas build --platform ios

# Build Android (.aab for Play Store)
eas build --platform android

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

---

## Environment Variables

Create `.env` in the project root:

```
EXPO_PUBLIC_API_URL=https://your-api.com/v1
EXPO_PUBLIC_UNSPLASH_KEY=your_key
```

Use in code:
```typescript
const API_URL = process.env.EXPO_PUBLIC_API_URL;
```

Add `.env` to `.gitignore`. Never commit secrets.

---

## Common Issues

| Issue | Fix |
|-------|-----|
| `Unable to resolve module` | Run `npm install` again |
| iOS build fails | Run `cd ios && pod install` |
| Metro bundler cache | Run `npx expo start --clear` |
| Android emulator not found | Open Android Studio → AVD Manager → create emulator |
| `reanimated` crash | Ensure `react-native-reanimated/plugin` is last in babel.config.js |
