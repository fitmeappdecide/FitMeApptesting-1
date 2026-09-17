# FITME — ENVIRONMENT SEPARATION & ARCHITECTURE AUDIT

> **Document Type:** Senior Full-Stack & Mobile Architecture Audit Report  
> **Status:** AUDIT COMPLETE — ZERO CODE MODIFICATIONS PERFORMED  
> **Target Repository:** `fitmeappdecide/FitMeApptesting-1` (Branch: `main`)  
> **Date:** September 2026  

---

## Executive Summary

This audit evaluates the environment routing, deployment pipelines, secrets hygiene, and database/storage isolation across **Local Development**, **GitHub**, **Railway Production**, and the **Existing Android Release APK**.

### Critical Audit Verdicts

| Dimension | Current State | Target Requirement | Status / Severity |
| :--- | :--- | :--- | :--- |
| **Existing Android APK** | Points directly to Railway Production (`https://fitmeapptesting-1-production.up.railway.app`) | Point to Railway Production; remain unchanged | **PASS** |
| **Xcode / iOS Simulator Run** | Points to **Railway Production** | Point to Local Backend (`http://127.0.0.1:8000`) | **FAIL** (Routes to Prod) |
| **Android Emulator Run** | Points to **Railway Production** | Point to Local Backend (`http://10.0.2.2:8000`) | **FAIL** (Routes to Prod) |
| **Local Backend Database** | Points directly to **Production Supabase DB** | Isolated local or staging database | **P0 ENVIRONMENT ISOLATION RISK** |
| **Local Backend Storage** | Uploads directly to **Production Supabase Storage** (`scans` bucket) | Isolated local or staging storage | **P0 ENVIRONMENT ISOLATION RISK** |
| **Git Safety (Local Edits)** | Editing files stays 100% local; no auto-commits or auto-pushes | Local edits must never push to GitHub | **PASS** |
| **Railway Deployment** | Automatic deployment triggered on Git push to `main` | Push to GitHub -> Railway Auto-Deploy | **PASS (Documented)** |
| **Keystore Binary** | `fitme-release.keystore` is properly gitignored | Keystore binary not committed | **PASS** |
| **Signing Passwords** | Plaintext release keystore passwords in `android/gradle.properties` (tracked in Git) | Passwords must never be tracked in Git | **P1 SECURITY RISK** |

---

## Architecture Diagram

```
                              FITME SYSTEM
                                   │
          ┌────────────────────────┴────────────────────────┐
          │                                                 │
     DEVELOPMENT                                        PRODUCTION
          │                                                 │
 ┌────────┴────────┐                               ┌────────┴────────┐
 │  iOS Simulator  │                               │  Existing APK   │
 │   (Xcode Run)   │                               │ (On real phone) │
 ├─────────────────┤                               ├─────────────────┤
 │Android Emulator │                               │ Production iOS  │
 │(Android Studio) │                               │ Release Builds  │
 └────────┬────────┘                               └────────┬────────┘
          │                                                 │
          ▼                                                 ▼
    LOCAL BACKEND                                    RAILWAY BACKEND
 (FastAPI on Mac host)                      (fitmeapptesting-1-production)
  http://127.0.0.1:8000                    https://fitmeapptesting-1-production
   (or 10.0.2.2:8000)                                .up.railway.app
          │                                                 │
          ▼                                                 ▼
    LOCAL SERVICES                                 PRODUCTION SERVICES
 ┌─────────────────┐                               ┌─────────────────┐
 │ Local DB/Docker │                               │ Supabase Cloud  │
 │ (Isolated Data) │                               │ PostgreSQL (DB) │
 ├─────────────────┤                               ├─────────────────┤
 │ Local / Mock    │                               │ Supabase Bucket │
 │ Storage Engine  │                               │ `scans` (Cloud) │
 └─────────────────┘                               ├─────────────────┤
          │                                        │ Google Vertex & │
          X (HARD STOP)                            │ Firebase Cloud  │
    No auto-commits                                └─────────────────┘
    No auto-pushes                                          ▲
    No auto-deploy                                          │
          │                                                 │
          │ (Explicit User Approval ONLY)                   │
          ▼                                                 │
     GITHUB REPO ───────────────────────────────────────────┘
 (`fitmeappdecide/FitMeApptesting-1`)  Railway auto-deploy on push to main
```

---

## Detailed Audit Findings by Task

### Task 1: Frontend API URL Configuration

#### 1. Configuration Files Inspected
- `fitme-ui/.env`: Contains `EXPO_PUBLIC_API_URL=https://fitmeapptesting-1-production.up.railway.app`
- `fitme-ui/.env.example`: Contains `EXPO_PUBLIC_API_URL=https://your-backend.up.railway.app`
- `fitme-ui/app.json`: Static Expo configuration (`slug: "fitme"`, `package: "com.fitme.app"`). No dynamic API URL overrides.
- `fitme-ui/src/services/api.ts` (Lines 21–39):
  ```typescript
  const envUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  function resolveBaseUrl(): string {
    if (envUrl) {
      // If it's already a real LAN/WAN IP (not loopback), use it directly on all platforms
      if (!envUrl.includes('127.0.0.1') && !envUrl.includes('localhost')) {
        return envUrl;
      }
      // On Android, rewrite loopback to emulator host alias
      if (Platform.OS === 'android') {
        return envUrl.replace('127.0.0.1', '10.0.2.2').replace('localhost', '10.0.2.2');
      }
      return envUrl.replace('localhost', '127.0.0.1');
    }
    // Fallback defaults
    return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
  }

  export const BASE_URL = resolveBaseUrl();
  ```

#### 2. Exact Behavior Across 8 Build / Runtime Scenarios

| Scenario | Target Platform / Execution | Value of `envUrl` | Resolved `BASE_URL` | Destination Server |
| :--- | :--- | :--- | :--- | :--- |
| **1. Expo Dev Mode** | `npx expo start` | `https://fitmeapptesting-1-production.up.railway.app` | `https://fitmeapptesting-1-production.up.railway.app` | **Railway Production** |
| **2. iOS Simulator** | Xcode Run (Debug) / `npx expo run:ios` | `https://fitmeapptesting-1-production.up.railway.app` | `https://fitmeapptesting-1-production.up.railway.app` | **Railway Production** |
| **3. iOS Dev Build** | Custom Dev Client IPA | `https://fitmeapptesting-1-production.up.railway.app` | `https://fitmeapptesting-1-production.up.railway.app` | **Railway Production** |
| **4. Android Emulator**| Android Studio Run / `npx expo run:android` | `https://fitmeapptesting-1-production.up.railway.app` | `https://fitmeapptesting-1-production.up.railway.app` | **Railway Production** |
| **5. Android Dev APK** | Local `./gradlew assembleDebug` | `https://fitmeapptesting-1-production.up.railway.app` | `https://fitmeapptesting-1-production.up.railway.app` | **Railway Production** |
| **6. Existing APK** | `FitMe-release.apk` (on real device) | *Pre-bundled in Hermes bytecode* | `https://fitmeapptesting-1-production.up.railway.app` | **Railway Production** |
| **7. iOS Release Build**| Xcode Archive (Release) with current `.env` | `https://fitmeapptesting-1-production.up.railway.app` | `https://fitmeapptesting-1-production.up.railway.app` | **Railway Production** |
| **8. Android Release Build**| Local `./gradlew assembleRelease` with current `.env` | `https://fitmeapptesting-1-production.up.railway.app` | `https://fitmeapptesting-1-production.up.railway.app` | **Railway Production** |

*Root Cause:* Because `fitme-ui/.env` contains the live Railway URL, `envUrl.includes('localhost')` evaluates to `false`. Every single local development run immediately binds to Railway production rather than the local machine backend.

---

### Task 2: Local Backend Configuration & Execution

#### 1. Backend Specifications
- **Codebase Location:** `fit me backend/fashion/backend`
- **Application Entry Point:** `app.main:app`
- **Python Environment:** Virtual environment present at `fit me backend/fashion/backend/.venv` (Python 3.11.15, Uvicorn 0.34.0, FastAPI 0.115.x).
- **Execution Test:** Verified by importing `app.main:app` via `.venv/bin/python` — initialized cleanly without missing module errors.

#### 2. Local Startup Command
To run the local backend on the developer's Mac:
```bash
cd "fit me backend/fashion/backend"
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
- **Host:** `0.0.0.0` (binds to all interfaces so macOS, iOS Simulator via `localhost`, and Android Emulator via `10.0.2.2` can connect).
- **Port:** `8000`

#### 3. Current Backend Services Configuration (`app/core/config.py` & `.env`)
- **CORS:** Configured in `app/main.py` lines 27–33: `allow_origins=["*"]`, `allow_credentials=False`, `allow_methods=["*"]`, `allow_headers=["*"]`.
- **Authentication:** Dual provider support:
  - Local JWT Auth (`/api/v1/auth/register`, `/api/v1/auth/login`) using `JWT_SECRET_KEY=dev-only-secret-change-me`.
  - Firebase Auth token exchange (`/api/v1/auth/firebase`) validating against Google Firebase Admin SDK.
- **AI Providers:** Google Vertex AI (`fitme-3ac94`, `us-central1`), SearchAPI / SerpAPI for live shopping and visual search.
- **Environment Switch:** `ENVIRONMENT=development` in `.env`. Property `settings.is_production` evaluates whether `ENVIRONMENT.lower() == "production"`.

---

### Task 3: Database & Storage Separation

> **P0 ENVIRONMENT ISOLATION RISK: LOCAL BACKEND CONNECTS DIRECTLY TO PRODUCTION SUPABASE**  
> The local backend `.env` file (`fit me backend/fashion/backend/.env`) and default fallbacks in `app/core/config.py` point directly to the **LIVE PRODUCTION SUPABASE INSTANCE**:
> - **Database URL:** `postgresql+asyncpg://postgres.smzhdmutffzapshfajyj:[REDACTED_PASSWORD]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`
> - **Supabase Project URL:** `https://smzhdmutffzapshfajyj.supabase.co`
> - **Supabase Storage Bucket:** `scans` (Private bucket)
> - **Firebase / GCP Project:** `fitme-3ac94`
>
> **Implication:** If a developer starts the local FastAPI backend on their Mac today and exercises authentication, user creation, body scan uploads, or try-on jobs, **THEY ARE DIRECTLY MUTATING PRODUCTION DATA IN SUPABASE**. There is currently zero separation at the local backend level.

#### Storage Architecture Verification
- **Storage Bucket Name:** Exactly one private bucket exists: `scans`.
- **Path Prefixes inside `scans`:**
  - `scans/` (Raw user body scan photos)
  - `user_photos/` (Uploaded reference photos)
  - `tryon_results/` (Generated try-on imagery)
  - `pi_scans/` (Product intelligence screenshots)
- **Signed URL Access:** Managed via `app/services/storage_service.py` using `create_signed_photo_url()`.
- **Verdict:** No duplicate or rogue buckets were found. The single private bucket model is strictly adhered to in code, but local development lacks an isolated sandbox bucket or database.

---

### Task 4: Existing Android APK Audit

#### 1. Binary Analysis of `FitMe-release.apk`
- **Location:** Workspace root (`FitMe-release.apk`, 94.2 MB)
- **Compiled JavaScript Bundle:** `assets/index.android.bundle` (Hermes Bytecode)
- **Extracted String Inspection:**
  Direct byte extraction of strings in the Hermes bundle identified:
  ```
  https://fitmeapptesting-1-production.up.railway.app
  ```
- **Local IP / Loopback Inspection:**
  Byte-level check for `127.0.0.1`, `localhost:8000`, and `10.0.2.2:8000` returned **zero instances** in the production bundle.

#### 2. Verdict: PASS
The existing Android APK installed on test phones is **100% connected to Railway Production**.  
It does **NOT** point to localhost, and it will **NOT** be broken or altered by any proposed changes.

---

### Task 5: Xcode / iOS Local Development Audit

#### 1. Trace: Pressing "Run" in Xcode
When the developer opens `fitme-ui/ios/FitMe.xcworkspace` in Xcode, selects an iOS Simulator, and clicks **Run**:
1. **Compilation:** Xcode builds the native Objective-C/Swift binary and links CocoaPods.
2. **Metro Packaging:** In `Debug` mode, the app starts/connects to Metro bundler on port 8081.
3. **Environment Injection:** Metro bundles `fitme-ui/src/services/api.ts` using variables from `fitme-ui/.env`.
4. **Endpoint Resolution:** `envUrl` receives `https://fitmeapptesting-1-production.up.railway.app`. `resolveBaseUrl()` does not see `localhost` or `127.0.0.1`, so it returns the Railway URL.
5. **Network Traffic:** All network calls from the simulator go over HTTPS to Railway.

#### 2. Direct Question Answer
> **"If I open FitMe in Xcode and press Run, does the app use the local Mac backend or Railway?"**  
> **Answer: It uses Railway Production.**

This directly violates the desired architecture where Xcode local runs must hit the Mac's local backend.

---

### Task 6: Android Local Development Audit

#### 1. Android Emulator (`npx expo run:android` or Android Studio Debug)
- **Current Behavior:** Uses `https://fitmeapptesting-1-production.up.railway.app` (Railway Production).
- **Target Routing Requirement:** Android Emulator runs inside an isolated virtual network where `127.0.0.1` refers to the Android device itself. Connecting to the Mac host requires `10.0.2.2:<port>`.
- **Existing Support in Code:** `api.ts` already has a replacement rule:
  ```typescript
  if (Platform.OS === 'android') {
    return envUrl.replace('127.0.0.1', '10.0.2.2').replace('localhost', '10.0.2.2');
  }
  ```
  However, this rule is inactive because `envUrl` is currently set to the Railway URL.

#### 2. Physical Android Development Device
- **Current Behavior:** Uses Railway Production.
- **Local Dev Constraint:** A physical Android phone connected via USB or Wi-Fi cannot access `localhost` or `10.0.2.2` on the Mac.
- **Required Local Dev Configuration:**
  - Option A: Mac's local LAN IP (e.g. `http://192.168.1.50:8000`), with the backend listening on `0.0.0.0`.
  - Option B: USB ADB reverse port forwarding (`adb reverse tcp:8000 tcp:8000`), which allows `http://localhost:8000` to resolve from the phone to the Mac.

#### 3. Release APK Generated Locally (`./gradlew assembleRelease`)
- **Current Behavior:** Reads `fitme-ui/.env` and bakes `https://fitmeapptesting-1-production.up.railway.app` into the Hermes bytecode.
- **Verdict:** Consistent with production requirements.

---

### Task 7: Environment Model Audit

#### 1. Evaluation of Current Separation
The project currently **LACKS** a reliable automated distinction between `DEVELOPMENT` and `PRODUCTION`.

- **Mobile App (`fitme-ui`):** Relies solely on whatever string is in `fitme-ui/.env`. There are no `.env.development` or `.env.production` files, nor is there runtime switching based on React Native's global `__DEV__` flag.
- **Backend (`fit me backend`):** Has an `ENVIRONMENT=development` flag in `.env`, but both development and production point to the exact same production database and cloud storage bucket.

#### 2. Desired Separation Model
```
┌─────────────────────────┬────────────────────────────────────────────────────────┐
│ Environment             │ Target Endpoint                                        │
├─────────────────────────┼────────────────────────────────────────────────────────┤
│ DEVELOPMENT             │ Local Mac Backend                                      │
│ - iOS Simulator         │ http://localhost:8000 (or http://127.0.0.1:8000)       │
│ - Android Emulator      │ http://10.0.2.2:8000                                   │
│ - Physical Dev Device   │ http://<mac-lan-ip>:8000 or adb reverse               │
├─────────────────────────┼────────────────────────────────────────────────────────┤
│ PRODUCTION              │ Railway Production Backend                             │
│ - Existing Android APK  │ https://fitmeapptesting-1-production.up.railway.app    │
│ - New Release Builds    │ https://fitmeapptesting-1-production.up.railway.app    │
└─────────────────────────┴────────────────────────────────────────────────────────┘
```

---

### Task 8: Git Safety Audit

#### 1. Repository Status
- **Remote Origin:** `https://github.com/fitmeappdecide/FitMeApptesting-1.git`
- **Current Branch:** `main`
- **Working Tree:** Clean (only `FitMe-release.apk` is untracked in root).
- **Git Hooks:** All hook templates in `.git/hooks/` are inactive `.sample` files. No automated pre-commit or pre-push scripts exist.
- **GitHub Actions:** No `.github/` folder exists in the repository. There are zero automated CI/CD workflows triggered on push.

#### 2. Automated Script Audit
Inspected `fitme-ui/package.json`, Gradle build files, and shell scripts. None of the commands (`start`, `ios`, `android`, `assembleRelease`) trigger git operations.

#### 3. Verdict: PASS
**Editing local code remains 100% local.** No local build or edit action will automatically commit or push to GitHub.

---

### Task 9: Railway Deployment Path Audit

#### 1. Deployment Path Traced
```
Local Git Commit (Local Mac)
       │
       ▼ (Explicit User Command: git push origin main)
GitHub Repository: fitmeappdecide/FitMeApptesting-1 (Branch: main)
       │
       ▼ (GitHub Webhook to Railway)
Railway Service: fitmeapptesting-1-production
       │
       ▼ (Railway Builder executes Dockerfile)
Production Deployment on https://fitmeapptesting-1-production.up.railway.app
```

#### 2. Key Findings
- **Trigger Type:** Automatic deployment on every `git push` to `main`.
- **Root Directory:** Railway builds the backend container using `fit me backend/fashion/backend/Dockerfile`.
- **CLI Connection:** The `railway` CLI is not installed on the local Mac; local development has no direct connection to Railway APIs.
- **Verdict:** Documented. Railway will only deploy when the user explicitly pushes to GitHub `main`.

---

### Task 10: Local Changes Isolation Audit

#### 1. Disk Level
- Editing `fitme-ui/src/...`, `app/...`, or `fit me backend/...` changes only local working tree files on disk.
- It does **NOT** affect GitHub, Railway, or remote repositories.

#### 2. Runtime Level (The Hidden Coupling)
- While file changes remain local, **running** the mobile app or local backend currently leaks into production:
  - Running `expo start` communicates with the **production Railway API**.
  - Running `uvicorn` communicates with the **production Supabase database and storage**.

---

### Task 11: Secrets & Credentials Audit

#### 1. `.gitignore` Coverage
- Root `.gitignore`: Ignores `.venv/`, `node_modules/`, `*vertex-key*.json`, `*adminsdk*.json`.
- `fitme-ui/.gitignore`: Ignores `*.env`, `*.env.local`, `*.keystore`, `*.jks`.
- `fit me backend/fashion/.gitignore`: Ignores `.env`.
- `fitme-ui/.env` and `fit me backend/fashion/backend/.env` are **NOT** tracked in Git. (PASS)

#### 2. Release Keystore Binary
- `fitme-ui/android/app/fitme-release.keystore` is ignored by `*.keystore` and is **NOT** committed to Git. (PASS)

#### 3. Keystore Passwords Tracked in Git
- In `fitme-ui/android/gradle.properties` (lines 69–70), `FITME_RELEASE_STORE_PASSWORD` and `FITME_RELEASE_KEY_PASSWORD` are committed in plaintext and tracked in Git (committed in commit `9b478bc`).
- **Severity:** **P1 SECURITY RISK**. When architectural changes are implemented, these signing credentials should be extracted into local untracked environment properties or local gradle overrides. *(Actual password values have been redacted from this audit report).*

#### 4. Cloud Credentials & Service Keys
- `gcp-vertex-key.json` in backend is gitignored and untracked. (PASS)
- `fit me backend/fashion/backend/app/core/config.py` has the production `supabase_service_key` written as a default fallback value in code. This key gives full admin access to Supabase Storage and database bypass. (Documented for cleanup).

---

## Action Plan (For Future Execution)

*Note: In accordance with audit instructions, NO code or architectural changes have been applied during this audit phase.*

When authorized to proceed with implementation, the recommended execution steps are:

### Phase 1: Frontend Environment Separation
1. Update `fitme-ui/src/services/api.ts` to implement automatic environment resolution:
   - When running in development (`__DEV__ === true`):
     - Android: Route to `http://10.0.2.2:8000`
     - iOS Simulator / Web: Route to `http://127.0.0.1:8000`
     - Physical device override via environment variable if needed.
   - When running in release/production (`__DEV__ === false`):
     - Route to `https://fitmeapptesting-1-production.up.railway.app`.
2. Keep `fitme-ui/.env` configured cleanly without forcing the production URL onto development builds.
3. Verify that the existing `FitMe-release.apk` remains completely untouched.

### Phase 2: Local Backend Sandbox & Isolation
1. Provide a local PostgreSQL configuration or dev schema switch so local FastAPI execution does not mutate production Supabase data.
2. Provide a local/mock storage option for body scans and try-on uploads during local testing, preserving the private `scans` bucket for production.

### Phase 3: Secrets Hardening
1. Remove plaintext keystore passwords from `fitme-ui/android/gradle.properties` and untrack/ignore or load via unversioned local environment variables.
2. Remove hardcoded production service keys from fallback defaults in `config.py`.
