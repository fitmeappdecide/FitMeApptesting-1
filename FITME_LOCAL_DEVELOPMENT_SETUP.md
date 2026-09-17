# FITME — LOCAL DEVELOPMENT SETUP & RUNBOOK

> **Document Version:** 1.0.0  
> **Status:** ACTIVE RUNBOOK  
> **Repository:** `fitmeappdecide/FitMeApptesting-1`  
> **Active Branch:** `fitme-local-development`  

This runbook provides the exact commands and workflow to run the FitMe FastAPI backend locally on your Mac and connect local development clients (iOS Simulator, Android Emulator, and physical development phones).

---

## 1. Prerequisites Check

Before starting, verify you have the local Python virtual environment ready:
```bash
# Verify Python 3.11 environment in backend directory
"fit me backend/fashion/backend/.venv/bin/python" --version
```

Verify that you are on the local development branch:
```bash
git branch --show-current
# Should output: fitme-local-development
```

---

## 2. Start the Local FastAPI Backend

From the repository root, start the local backend using Uvicorn:

```bash
cd "fit me backend/fashion/backend"
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

* **Host `0.0.0.0`:** Binds to all network interfaces so iOS Simulator (`localhost`), Android Emulator (`10.0.2.2`), and physical devices over Wi-Fi can reach it.
* **Port `8000`:** Standard FitMe backend port.
* **`--reload`:** Automatically reloads the server when you edit Python files.

---

## 3. Verify Local Backend Health

In a new terminal window, confirm that the local FastAPI server is running and connected to Supabase:

```bash
curl -i http://127.0.0.1:8000/health
```

**Expected Response (HTTP 200 OK):**
```json
HTTP/1.1 200 OK
content-type: application/json

{"status":"ok","models_loaded":{"body_pose":true,"body_mesh":true,"garment_segmentation":true,"tryon_synthesis":false,"face_identity":true},"gpu_available":false,"queue_depth":0,"db_connected":true,"redis_connected":true,"scraper_connected":true}
```
*Note: `db_connected: true` confirms the local backend has established its live async connection to Supabase.*

---

## 4. Run iOS Simulator Locally

### Option A: Using Xcode (Recommended)
1. Open the iOS project in Xcode:
   ```bash
   open fitme-ui/ios/FitMe.xcworkspace
   ```
2. Select an iOS Simulator (e.g. **iPhone 15 Pro**) in the scheme bar.
3. Press **⌘ + R** (or click the **Play / Run** button).
4. Xcode will launch Metro automatically and install the app on the simulator.
5. In development mode (`__DEV__ === true`), the app automatically routes all network requests to:
   $$\text{http://127.0.0.1:8000}$$

### Option B: Using Expo CLI
From the `fitme-ui` directory:
```bash
cd fitme-ui
npx expo run:ios
```

---

## 5. Run Android Emulator Locally

1. Start your Android Emulator via Android Studio (Device Manager) or terminal:
   ```bash
   emulator -avd Pixel_7_API_34 &
   ```
2. Run the development build:
   ```bash
   cd fitme-ui
   npx expo run:android
   ```
3. The Android Emulator will boot the app.
4. In development mode (`__DEV__ === true`), the app automatically translates host networking and routes all API requests to:
   $$\text{http://10.0.2.2:8000}$$

---

## 6. Run on a Physical Android Phone (Development Only)

*Note: The frozen production `FitMe-release.apk` remains untouched on Railway. If you build a development build for your real phone:*

### Method A: USB Tethering via ADB Reverse (Fastest & Most Reliable)
1. Connect phone via USB with USB Debugging enabled.
2. Forward port 8000:
   ```bash
   adb reverse tcp:8000 tcp:8000
   ```
3. Run the development app. It can now access the Mac backend seamlessly via `http://localhost:8000`.

### Method B: Wi-Fi LAN IP Override
1. Find your Mac's Wi-Fi IP address:
   ```bash
   ipconfig getifaddr en0
   # Example output: 192.168.1.50
   ```
2. Add your LAN IP to `fitme-ui/.env`:
   ```bash
   echo "EXPO_PUBLIC_DEV_API_URL=http://192.168.1.50:8000" >> fitme-ui/.env
   ```
3. Start the app: `npx expo start`. The app will now communicate directly over Wi-Fi with your Mac's FastAPI server.

---

## 7. How to Verify the Active API Endpoint at Runtime

When the mobile app starts in development mode (`__DEV__ === true`), it logs its resolved API endpoint to the Metro terminal console:

```
[FitMe Local Dev] API Endpoint: http://127.0.0.1:8000 (ios)
```
or:
```
[FitMe Local Dev] API Endpoint: http://10.0.2.2:8000 (android)
```

Look for this log in your Metro bundler terminal output to confirm that local routing is active.

---

## 8. Stop the Local Backend

When you are finished with your local development session:
- Press **CTRL + C** in the terminal running Uvicorn.
- Or find and terminate the process by port:
  ```bash
  lsof -ti :8000 | xargs kill -9
  ```

---

## 9. Important Developer Reminders

1. **Frozen WebView Extraction Engine:** The iOS WebView extraction engine (`native/ios-extraction-core`, `fitme-ui/modules/fitme-extraction`, `fitme-ui/src/services/extraction.ts`) and Android extraction parity implementation (`native/android-extraction-core`) are **strictly frozen**. They must **NOT** be modified, refactored, or altered unless the owner explicitly issues an instruction authorizing an extraction change.
2. **Shared Supabase Data:** Local development connects to the shared Supabase project. Always create and use test accounts (`dev_test_*@example.com`). Avoid dropping tables or deleting production user scans.
3. **Git & Railway Safety:**
   - Always remain on `fitme-local-development`.
   - Never run `git push origin main` or `railway deploy` during local feature iteration.
   - Railway will ONLY deploy when changes are explicitly merged and pushed to `main`.
