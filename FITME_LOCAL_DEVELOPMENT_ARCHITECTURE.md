# FITME — LOCAL DEVELOPMENT ARCHITECTURE (BACKEND-ONLY SEPARATION)

> **Document Version:** 1.0.0  
> **Status:** IMPLEMENTED & LOCALLY VERIFIED (PENDING OWNER APPROVAL)  
> **Current Local Branch:** `fitme-local-development`  
> **Repository:** `fitmeappdecide/FitMeApptesting-1`  
> **Infrastructure Model:** One Shared FitMe Cloud Infrastructure, Two Backend Execution Environments  

---

## 1. Architectural Philosophy & Guiding Principles

The core architectural rule for FitMe's local development environment is:

> **"ONE FITME INFRASTRUCTURE, TWO BACKEND LOCATIONS, ZERO AUTOMATIC PRODUCTION CHANGES."**

1. **Zero Duplicate Cloud Infrastructure:**
   There is **NO** duplicate "Dev Supabase", "Dev Firebase", or secondary storage buckets. Both Local and Production FastAPI instances share the exact same battle-tested cloud resources:
   - Supabase Project (`smzhdmutffzapshfajyj`)
   - Supabase PostgreSQL Database
   - Single Private Supabase Storage Bucket: `scans` (prefixes: `scans/`, `user_photos/`, `tryon_results/`, `pi_scans/`)
   - Firebase Authentication & Google Sign-In (`fitme-3ac94`)
   - Vertex AI, Try-On providers, and Product Intelligence search APIs
2. **Backend Isolation Only:**
   Only the **FastAPI backend host location** differs:
   - **Local Development:** Runs on the developer's Mac host (`http://127.0.0.1:8000` / `http://10.0.2.2:8000`).
   - **Production:** Runs in Railway cloud containers (`https://fitmeapptesting-1-production.up.railway.app`).
3. **Frozen Reference APK Protection:**
   The existing `FitMe-release.apk` installed on physical test devices remains **100% frozen** and permanently bound to Railway.
4. **Frozen Extraction Engine & Android Parity Lock:**
   The iOS WebView extraction engine (`native/ios-extraction-core`, `fitme-ui/modules/fitme-extraction`, `fitme-ui/src/services/extraction.ts`) and Android extraction parity implementation (`native/android-extraction-core`) are **STRICTLY FROZEN**. They must **NOT** be modified under any circumstances unless explicitly authorized by the owner.
5. **Git & Railway Safety:**
   Local editing, building, and running never automatically commit, push, or trigger Railway deployments.

---

## 2. System Architecture Diagram

```
                                      FITME ARCHITECTURE
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      │                                               │
             LOCAL DEVELOPMENT                                    PRODUCTION
                      │                                               │
             ┌────────┴────────┐                             ┌────────┴────────┐
             │  iOS Simulator  │                             │  Existing APK   │
             │   (Xcode Run)   │                             │(On test phones) │
             ├─────────────────┤                             ├─────────────────┤
             │Android Emulator │                             │ Production iOS  │
             │(Android Studio) │                             │ & Android Builds│
             └────────┬────────┘                             └────────┬────────┘
                      │                                               │
                      ▼                                               ▼
                LOCAL BACKEND                                  RAILWAY BACKEND
             (FastAPI on Mac)                             (Container on Railway)
          http://127.0.0.1:8000 (iOS)                  https://fitmeapptesting-1-
          http://10.0.2.2:8000 (Android)                 production.up.railway.app
                      │                                               │
                      └───────────────────────┬───────────────────────┘
                                              │
                                              ▼
                                 SHARED FITME CLOUD RESOURCES
                      ┌───────────────────────────────────────────────┐
                      │  • Supabase Database (PostgreSQL Cloud)       │
                      │  • Supabase Storage (Private `scans` Bucket)  │
                      │  • Firebase Authentication (GCP `fitme-3ac94`) │
                      │  • Google Vertex AI & Try-On Synthesis Engine │
                      │  • SearchAPI / SerpAPI Product Intelligence   │
                      └───────────────────────────────────────────────┘
```

---

## 3. Deterministic API Endpoint Selection

Environment routing is managed in [`fitme-ui/src/services/api.ts`](file:///Users/selvi.none/Desktop/fitme-claudeintegration/fitmefinal_git/fitme-ui/src/services/api.ts) using React Native's global `__DEV__` flag:

```typescript
// Determine API base URL, strictly separating DEVELOPMENT (local backend) from PRODUCTION (Railway)
import { Platform } from 'react-native';

const PRODUCTION_API_URL = 'https://fitmeapptesting-1-production.up.railway.app';
const LOCAL_IOS_URL = 'http://127.0.0.1:8000';
const LOCAL_ANDROID_URL = 'http://10.0.2.2:8000';

function resolveBaseUrl(): string {
  // 1. PRODUCTION DETERMINISTIC ROUTING (__DEV__ === false)
  // In release builds, always route directly to Railway production.
  // Stale local .env or EXPO_PUBLIC_API_URL cannot redirect production builds to localhost.
  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
  if (!isDev) {
    return PRODUCTION_API_URL;
  }

  // 2. DEVELOPMENT ROUTING (__DEV__ === true)
  // Check if developer explicitly configured a physical device LAN override
  const devOverride = process.env.EXPO_PUBLIC_DEV_API_URL?.trim();
  if (devOverride) {
    if (Platform.OS === 'android') {
      return devOverride.replace('127.0.0.1', '10.0.2.2').replace('localhost', '10.0.2.2');
    }
    return devOverride;
  }

  // Default development endpoints
  const devUrl = Platform.OS === 'android' ? LOCAL_ANDROID_URL : LOCAL_IOS_URL;
  if (__DEV__) {
    console.log(`[FitMe Local Dev] API Endpoint: ${devUrl} (${Platform.OS})`);
  }
  return devUrl;
}

export const BASE_URL = resolveBaseUrl();
```

### Determinism Rules
1. **Production Builds (`__DEV__ === false`):**
   - Automatically routes to `https://fitmeapptesting-1-production.up.railway.app`.
   - **Protection:** A developer's local `.env` file containing `localhost` or accidental variables **CANNOT** compromise production release builds.
2. **Development Builds (`__DEV__ === true`):**
   - **iOS Simulator:** Automatically routes to `http://127.0.0.1:8000`.
   - **Android Emulator:** Automatically routes to `http://10.0.2.2:8000` (translating host networking).
   - **Diagnostic Logging:** Logs `[FitMe Local Dev] API Endpoint: <url> (<platform>)` on app boot in development mode.
3. **Physical Android Device in Development:**
   - Supports optional `EXPO_PUBLIC_DEV_API_URL=http://<mac-lan-ip>:8000` in `.env` or USB tethering with `adb reverse tcp:8000 tcp:8000`.

---

## 4. Platform Runtime Behavior

| Client Target | Build Mode | Resolved Endpoint | Target Backend |
| :--- | :--- | :--- | :--- |
| **Xcode Run (iOS Simulator)** | Debug (`__DEV__ = true`) | `http://127.0.0.1:8000` | **Local Mac FastAPI** |
| **Android Studio Run (Emulator)** | Debug (`__DEV__ = true`) | `http://10.0.2.2:8000` | **Local Mac FastAPI** |
| **Physical Dev Device (Wi-Fi)** | Debug (`__DEV__ = true`) | `EXPO_PUBLIC_DEV_API_URL` | **Local Mac FastAPI** |
| **Existing Android APK** | Release (`__DEV__ = false`) | `https://fitmeapptesting-1-production.up.railway.app` | **Railway Production** |
| **Future Production Releases** | Release (`__DEV__ = false`) | `https://fitmeapptesting-1-production.up.railway.app` | **Railway Production** |

---

## 5. Cloud Infrastructure Relationships

### Supabase Relationship
- Both Local and Railway backends connect directly to the existing Supabase instance:
  - Database: `aws-1-ap-south-1.pooler.supabase.com:5432/postgres`
  - Storage Bucket: `scans` (Single private bucket)
  - Signed URLs: Created and resolved through `app/services/storage_service.py`
- Zero new buckets or schema tables were created.

### Firebase Relationship
- Both backends authenticate against the existing Google Firebase project (`fitme-3ac94`).
- Google Sign-In OAuth credentials and JWT verification remain uniform across environments.

### Try-On & AI Provider Relationship
- Local Try-On executions invoke the production-tested providers (Vertex AI, FASHN, rembg segmentation).
- This ensures local performance tuning and response-time optimizations reflect real-world pipeline timing.

---

## 6. Shared Data Warning & Operational Protocols

> [!WARNING]
> ### SHARED DATA NOTICE
> Because Local Development and Railway Production intentionally share the same cloud PostgreSQL database and Supabase Storage bucket:
> - **Test Accounts:** Developers MUST create and use dedicated test accounts (e.g. `dev_test_*@example.com`) during local testing.
> - **Destructive Actions:** DO NOT run bulk database wipes, table drops, or bucket purges during local development.
> - **Cascade Deletions:** Use account deletion features only on test users created specifically during local testing sessions.

---

## 7. Frozen WebView Extraction Engine & Android Extraction Parity Lock

> [!IMPORTANT]
> ### STRICT EXTRACTION ENGINE FREEZE
> The **iOS WebView extraction engine** and **Android extraction parity implementation** are strictly frozen:
> - `native/ios-extraction-core/`
> - `native/android-extraction-core/`
> - `fitme-ui/modules/fitme-extraction/`
> - `fitme-ui/src/services/extraction.ts`
>
> **Mandatory Rule:** Neither the iOS extraction core, the Android extraction parity logic, nor the WebView JavaScript injection scripts may be modified, refactored, or altered under any circumstances unless the owner explicitly issues an instruction authorizing an extraction change.
>
> Product extraction executes entirely on-device natively in the mobile app. The environment separation implemented here affects only backend network API routing (`fitme-ui/src/services/api.ts`) and does NOT alter native product extraction behavior.

---

## 8. Git & Railway Safety Architecture

1. **Git Isolation:**
   - Active branch: `fitme-local-development`.
   - Local commits remain unpushed until explicit owner sign-off.
   - Remote branches (`origin/main`) are untouched.
2. **Railway Isolation:**
   - Railway auto-deploys ONLY when changes are pushed to `origin/main`.
   - Because no Git push operations occur, **Railway is never triggered by local development**.

---

## 9. Secrets & Android Signing Hygiene

1. **Keystore Binary:**
   - `fitme-ui/android/app/fitme-release.keystore` is ignored by `.gitignore` (`*.keystore`). The existing keystore was not modified or regenerated.
2. **Gradle Signing Passwords:**
   - Passwords moved to untracked user configuration: `~/.gradle/gradle.properties` (secured with `chmod 600`).
   - Cleaned `fitme-ui/android/gradle.properties` by removing plaintext password strings.
   - **Historical Footnote:** Plaintext passwords were committed historically in commit `9b478bc` on `main`. In accordance with instructions, Git history was not rewritten; credential rotation should be scheduled before public app store launch.

---

## 10. Verification & Test Results

### 1. Existing APK Binary Integrity
- **Artifact:** `FitMe-release.apk` (94,233,981 bytes)
- **SHA-256 Hash Before:** `2f716f771236ee53f64ed41f7a85cd7fd662615584b8e82c79df42b78ebc4aa5`
- **SHA-256 Hash After:**  `2f716f771236ee53f64ed41f7a85cd7fd662615584b8e82c79df42b78ebc4aa5`
- **Integrity Status:** **PASSED (Byte-identical, 0 bytes modified)**
- **Embedded URL in Bytecode:** `https://fitmeapptesting-1-production.up.railway.app` (Verified)

### 2. Deterministic Endpoint Resolution Tests
- Unit evaluation of `resolveBaseUrl()` logic across runtime environments:
  - iOS Simulator (`__DEV__=true`): `http://127.0.0.1:8000` (**PASS**)
  - Android Emulator (`__DEV__=true`): `http://10.0.2.2:8000` (**PASS**)
  - Physical Device Override (`__DEV__=true`): `http://192.168.1.88:8000` (**PASS**)
  - Production iOS Release (`__DEV__=false`): `https://fitmeapptesting-1-production.up.railway.app` (**PASS**)
  - Production Android Release (`__DEV__=false`): `https://fitmeapptesting-1-production.up.railway.app` (**PASS**)

### 3. Local FastAPI Network Connectivity Test
- Real HTTP GET request sent to `http://127.0.0.1:8000/health`:
  ```json
  {
    "status": "ok",
    "models_loaded": {
      "body_pose": true,
      "body_mesh": true,
      "garment_segmentation": true,
      "tryon_synthesis": false,
      "face_identity": true
    },
    "gpu_available": false,
    "queue_depth": 0,
    "db_connected": true,
    "redis_connected": true,
    "scraper_connected": true
  }
  ```
- **HTTP Status Code:** `200 OK`
- **Database Connection:** Confirmed connected (`db_connected: true`) to Supabase.
