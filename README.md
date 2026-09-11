# FitMe — integrated architecture

This repo integrates three previously-separate pieces into one working system:

1. **`fitme-ui/`** — the Expo/React Native app (iOS + Android). This is the one app users install.
2. **`native/`** *(new)* — the single source of truth for the native product-extraction engine,
   shared between `fitme-ui` and the standalone validation app.
3. **`fit me backend/fashion/backend/`** — the FastAPI backend (auth, product persistence, body
   scan, try-on generation).
4. **`fit me backend/fitme-webextraction/`** — the original standalone iOS/Android extraction
   app. Kept as a reference/validation harness, now pointed at the same shared `native/` code
   instead of its own copy.

Everything else under `fit me backend/fashion/` (scraper-service, chrome-extension, brand-dashboard,
shopify-app, consumer-web, another mobile-app, runpod-worker) was **not** touched — it's out of
scope for "get the RN app + extraction + backend running."

## What changed, and why

### 1. Native extraction engine — de-duplicated (`native/`)

Previously `WebViewExtractor.swift` (iOS) and `ExtractionFacade.kt`/`WebExtractionEngine.kt`
(Android) only existed inside the standalone `fitme-webextraction` app, and `fitme-ui`'s
`modules/fitme-extraction` bridge referenced classes that didn't exist anywhere it could see them
— it would not have compiled.

- **`native/android-extraction-core/`** is now a real Gradle library module (`com.fitme.webextraction`)
  containing the full engine (moved, not copied, from `fitme-webextraction/android` + `app`).
  Both `fitme-webextraction/app` and `fitme-ui/android`'s `modules/fitme-extraction` include it via
  `settings.gradle(.kts)` (`include(":extraction-core")` + a relative `projectDir`), so there is
  exactly one copy of the Kotlin source on disk.
- **`native/ios-extraction-core/WebViewExtractor.swift`** is the one real file. Both consumers
  reference it via a **symlink** (`fitme-webextraction/ios/FitMe/Services/WebViewExtractor.swift`
  and `fitme-ui/modules/fitme-extraction/ios/Core/WebViewExtractor.swift`) rather than a copy.
  This works cleanly because both Xcode projects compile whatever file is physically present at
  that path (the standalone app via Xcode 16's filesystem-synchronized groups, the RN app via
  CocoaPods' `source_files` glob) — no `.pbxproj` surgery required.
- Along the way, `ExtractionFacade.kt` had ~450 lines of dead/duplicate pipeline code with unresolved
  imports (it would not have compiled) — trimmed to the actually-used thin wrapper. `MainActivity.kt`
  had a few pre-existing bugs (a duplicate `ExtractedProduct` type shadowing the real one, a missing
  `detectPlatform` function, missing imports) — fixed so the standalone app builds again.

**If you run `npx expo prebuild --clean`** in `fitme-ui`, it will regenerate `android/settings.gradle`
and wipe the `:extraction-core` include — you'll need to re-add the block at the top of that file
(marked with a comment), or move it into an Expo config plugin.

### 2. RN app wired to the real backend (`fitme-ui/src/services/`)

- **`src/services/extraction.ts`** — calls the native module (`extractProduct(url)`) directly.
  This is on-device, no network call.
- **`src/services/api.ts`** — rewritten to match the *real* FastAPI routes (previously it called
  invented endpoints like `/tryon/extract` that don't exist). Handles auth (register/login/refresh,
  tokens in `expo-secure-store`), `POST /product/from-extension` (persists what the native module
  extracted), `POST /scan/upload` (body photo), `POST /tryon/start` + polling, and profile.
- **`src/services/session.ts`** — a small in-memory (zustand) store carrying the extracted product /
  ids through the `home → import → extraction → upload-photo → processing → result` wizard, instead
  of serializing large objects through router params.
- Screens wired to real logic instead of mocks: `index.tsx` (auto-login), `home.tsx`, `import.tsx`
  (real extraction), `extraction.tsx` (persists to backend), `upload-photo.tsx` (real camera/gallery
  picker + upload), `processing.tsx` (real try-on start + poll), `result.tsx` (real result image),
  `login.tsx`/`signup.tsx` (real auth).
- New dependencies added to `package.json`: `expo-secure-store`, `expo-image-picker`, `zustand`.

### 3. Backend — untouched code, added local-dev plumbing

The FastAPI backend's code was already reasonably complete; I didn't need to change it, only add
`fit me backend/fashion/backend/docker-compose.dev.yml` (Postgres + Redis for local dev) and a
`.env` with localhost defaults.

## Running it

### Backend
```bash
cd "fit me backend/fashion/backend"
docker compose -f docker-compose.dev.yml up -d      # postgres + redis
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```
Auth, product persistence, and body-scan upload work with just this. **Try-on image generation**
additionally needs either a RunPod GPU endpoint (`RUNPOD_API_KEY`/`RUNPOD_ENDPOINT_ID` in `.env`)
or real local model weights (`GPU_MODE=local`) — neither is included in this repo, so `/tryon/start`
will accept the request but generation will fail until you provide one.

### RN app (fitme-ui)
```bash
cd fitme-ui
npm install
cp .env.example .env   # if not present, create one with:
# EXPO_PUBLIC_API_URL=http://localhost:8000        (iOS simulator)
# EXPO_PUBLIC_API_URL=http://10.0.2.2:8000          (Android emulator)
npx expo prebuild       # only if ios/android need regenerating; re-add the
                         # :extraction-core block to android/settings.gradle if so
```
**iOS:** `cd ios && pod install && cd ..`, then open `fitme-ui.xcworkspace` in Xcode and run on a
simulator/device (native extraction requires a real build — it will not work in plain Expo Go).
**Android:** open `fitme-ui/android` in Android Studio and run, or `npx expo run:android`.

### Standalone reference app (fitme-webextraction)
Open `fit me backend/fitme-webextraction/ios/FitMe.xcodeproj` in Xcode, or
`fit me backend/fitme-webextraction/android` in Android Studio — both now build against the shared
`native/` engine.

## Known gaps / next steps
- Google/Apple/Phone sign-in buttons on the login screen are UI-only placeholders (need OAuth
  provider setup + native SDKs — out of scope here).
- Try-on generation needs RunPod or local GPU model weights, which weren't in the zip.
- `/product/from-extension`'s size list isn't populated by the native extractor yet (`sizes` is
  sent as an empty array) — the field exists on both ends, just needs the extractor to fill it in.
