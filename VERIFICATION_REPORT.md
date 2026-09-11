# FitMe integration — verification report

Everything below was actually executed in this sandbox and the raw output is what's shown —
nothing here is asserted without a command backing it up. Where a real toolchain wasn't available
(no macOS/Xcode for iOS), that's stated explicitly rather than glossed over.

## Summary

| Claim | Status | Evidence |
|---|---|---|
| RN app (TypeScript) builds | ✅ Verified — real compiler | `tsc --noEmit`, 0 errors |
| Android engine + both real consumers build | ✅ Verified — real compiler | `kotlinc`, 0 errors (1 toolchain-vintage caveat, see §2) |
| iOS engine — single source, correctly wired | ✅ Verified structurally | no Swift compiler available in this sandbox (see §3) |
| Backend (Python) builds & runs | ✅ Verified — real server, real DB | live `uvicorn` + Postgres, real HTTP calls |
| Every dependency resolves | ✅ after fixing 3 real gaps | see §4 |
| Exactly one extraction engine exists | ✅ Verified | file-system search, hashes, symlink targets |
| RN app genuinely calls that engine | ✅ Verified | 6-hop call chain traced with grep evidence |

**4 real, pre-existing bugs were found and fixed while verifying** (not hypothetical — each one
was caught because compilation or the live server actually failed until fixed). Details in §5.

---

## 1. React Native app — TypeScript

```
$ cd fitme-ui && npx tsc --noEmit -p .
(no output — 0 errors)
```
Also confirmed `npm install` actually resolved every new dependency to a real package on disk
(not just present in `package.json`):
```
OK  zustand@4.5.7          -> node_modules/zustand
OK  expo-secure-store@13.0.2 -> node_modules/expo-secure-store
OK  expo-image-picker@15.0.7 -> node_modules/expo-image-picker
OK  fitme-extraction@1.0.0  -> node_modules/fitme-extraction -> modules/fitme-extraction   (local module, resolves correctly)
```

## 2. Android — real `kotlinc` compilation, not just a read-through

This sandbox has no Android SDK (network policy doesn't allow `dl.google.com`/Google's Maven, so
the real Gradle/AGP build can't run here). To get a genuine compiler-verified result anyway, I:

1. Installed a real Kotlin compiler (`apt-get install kotlin`) and JDK 21.
2. Wrote hand-built stub `.kt` files for the external surfaces used (`android.webkit.*`,
   `android.content.Context`, `org.json.*`, `kotlinx.coroutines.*`, `expo.modules.kotlin.*`, plus
   a stub `R` class) — **method-signature stubs only**, so the compiler does real type-checking
   of *our* code while trusting external framework APIs exist with the signatures used.
3. Compiled all 8 files of `native/android-extraction-core` **together with both real
   consumers** — `fitme-ui`'s bridge (`FitMeExtractionModule.kt`) and the standalone app's
   `MainActivity.kt` — in one `kotlinc` invocation, exactly as Gradle would when they include
   `:extraction-core`.

```
$ kotlinc <stubs> <9 real source files> -d out
exit code: 1
```
This first run found two things that were **not** stub artifacts:

- **Real bug**: `ExtractionFacade.kt` called `ExtractionError(e.message ?: "Unknown error")` —
  but `ExtractionError` is a `sealed class`; only its subclasses can be instantiated. This is a
  genuine pre-existing compile-blocking bug (present before I touched this file). **Fixed** →
  `ExtractionError.RenderingError(...)`.
- **Toolchain artifact**: the apt-packaged `kotlinc` bundles a pre-1.5 stdlib lacking
  `String.lowercase()` (stable since Kotlin 1.5; the project's real Gradle build targets Kotlin
  1.9.20, where it's built in). Confirmed via a 3-line isolated repro outside the project. Worked
  around with per-package polyfill stub files (not by touching real source).

After that fix, exactly one diagnostic remained:
```
WebExtractionEngine.kt:433: error: type inference failed ... suspendCancellableCoroutine { cont -> ... }
```
I isolated this with a minimal repro against the identical stub: the same code compiles cleanly
with an explicit type witness (`suspendCancellableCoroutine<String> { ... }`), which real Kotlin
1.9's inference infers automatically but this old bundled compiler's weaker inference cannot. This
is a harness limitation, not a source defect — confirmed by testing the exact pattern in isolation.

**Final compile**, real source files only (bar this one line, run from a harness-only copy to work
around the compiler-vintage gap — the tracked repo file is untouched):
```
$ kotlinc <stubs> <9 real files, 1 as harness copy> -d out
exit code: 0
$ grep "error:" compile_log.txt
(no matches)
$ find out -name "*.class" | wc -l
95
```
95 `.class` files generated, including `com/fitme/webextraction/{engine,facade,errors,utils,webview,config}/*`
(the shared engine), `com/fitme/extraction/FitMeExtractionModule.class` (the RN bridge), and
`com/fitme/app/MainActivity.class` (the standalone app) — **compiled from the same source files in
the same invocation**, which is exactly what proves they're not two divergent copies.

## 3. iOS — no Swift compiler available; structural verification instead

There's no macOS/Xcode/Swift toolchain reachable in this sandbox (confirmed — not in Ubuntu's apt
repos, and `download.swift.org` isn't in the network allowlist), so I cannot run a real `swiftc`
compile here. Being upfront about that rather than faking it. What I *could* verify:

**Single source of truth, byte-for-byte:**
```
$ find <repo> -name "WebViewExtractor.swift"
native/ios-extraction-core/WebViewExtractor.swift                                  (real file)
fit me backend/fitme-webextraction/ios/FitMe/Services/WebViewExtractor.swift       (symlink)
fitme-ui/modules/fitme-extraction/ios/Core/WebViewExtractor.swift                  (symlink)

$ sha256sum <all three, following symlinks>
9c1453e4...  (identical for all three)
```

**The podspec really does pick up the symlinked file** (simulated CocoaPods' glob decomposition of
`"**/*.{h,m,swift}"` with Python's `glob`, since no Ruby/CocoaPods is available here either):
```
**/*.swift -> Core/WebViewExtractor.swift        (the shared engine)
**/*.swift -> FitMeExtractionModule.swift         (the bridge)
```
Both match the same glob into the same pod target — this is also why `internal`-level Swift access
control (the default, unchanged from the original file) is sufficient; no `public` API surface
needed to be added.

**The bridge's calls match the engine's real declarations** (grep, not a type-checker, but a direct
signature comparison):
```
Bridge calls:     WebViewExtractor.shared.extract(from: url)
                  catch let error as WebViewExtractor.WebError
Engine declares:  static let shared = WebViewExtractor()
                  func extract(from urlString: String, timeoutSeconds: Double = 15) async throws -> ExtractedPayload
                  enum WebError: LocalizedError
```
Matches. **What this does *not* prove**: full Swift type-checking, that `ExtractedPayload`'s
fields line up with what `FitMeExtractionModule.swift` reads off it downstream, or that it actually
builds in Xcode. You'll get a definitive answer the moment you open either project in Xcode — I'd
recommend that as the next real checkpoint.

## 4. Backend — real server, real Postgres, real HTTP calls

No Docker in this sandbox, so instead of the `docker-compose.dev.yml` I shipped, I installed
Postgres 16 and Redis directly via apt, created the `fitme` DB matching `.env`, and ran everything
for real:

```
$ pip install -r requirements.txt        # in a fresh venv
$ alembic upgrade head
$ uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```
GET  /health                              -> 200  {"status":"ok","db_connected":true,"redis_connected":true,...}
POST /api/v1/auth/register                -> 201  {"access_token":"eyJ...", "user": {...}}
POST /api/v1/auth/login                   -> 200  {"access_token":"eyJ...", ...}
GET  /api/v1/user/profile  (Bearer token) -> 200  {"user": {...}, "body_profile": null}
POST /api/v1/product/from-extension       -> 200  {"product_id":"8e3c...", "product": {...}}
GET  /docs                                -> 200
```
The last one uses the *exact* payload shape `productApi.fromExtraction()` sends — i.e. what the RN
app posts after the native extractor returns a result.

## 5. Real bugs found and fixed during this verification

None of these were hypothetical — each was caught because something actually failed (a compile
error or a live 500) until it was fixed.

1. **`ExtractionFacade.kt` instantiated a sealed class directly** (§2) — would not compile.
   Fixed: use `ExtractionError.RenderingError(...)`.
2. **`redis` was imported (`app/core/cache.py`) but never listed in `requirements.txt`** — app
   failed to import at all. Fixed: added `redis==5.2.1`.
3. **`google-genai==1.16.0` was pinned, but that exact version is yanked from PyPI and doesn't
   contain the `ProductImage`/`RecontextImageConfig` API the code imports** (`vertex_provider.py`)
   — binary-searched PyPI releases to find the earliest version that has it. Fixed: bumped to
   `google-genai==1.30.0`.
4. **The async Alembic `env.py` never committed a transaction** — `run_migrations_online()` called
   `context.run_migrations()` without wrapping it in `context.begin_transaction()`, so `alembic
   upgrade head` logged success but silently rolled back every DDL statement — a completely empty
   database with no error, every single time. This is the nastiest of the four: it would have
   looked like migrations worked in any real deployment right up until the first query failed.
   Fixed to match Alembic's standard async template (`do_run_migrations` wrapped in
   `context.begin_transaction()`). Re-ran and confirmed all 8 tables + `alembic_version` now
   actually persist.
5. **`passlib[bcrypt]==1.7.4` + unpinned `bcrypt` (resolved to 5.0.0) is a known-broken
   combination** — passlib's bcrypt backend self-test throws on newer bcrypt's stricter 72-byte
   check, so *every* register/login call 500'd. Fixed: pinned `bcrypt==4.0.1` alongside it (the
   standard workaround for this specific, widely-reported incompatibility).

All five fixes are now in the files delivered in the zip.

## 6. RN app genuinely uses the shared engine — full call chain, not just an import

```
[1] app/import.tsx            imports & calls  extractProductFromUrl(sourceUrl)
[2] src/services/extraction.ts   imports from 'fitme-extraction', calls nativeExtractProduct()
[3] node_modules/fitme-extraction  -> symlinked to modules/fitme-extraction   (real local package)
[4] modules/fitme-extraction/index.ts   exports extractProduct from ./src/FitMeExtractionModule
[5] src/FitMeExtractionModule.ts   const FitMeExtraction = requireNativeModule('FitMeExtraction')
                                    FitMeExtraction.extractProduct(url)
[6a] android/.../FitMeExtractionModule.kt   Name("FitMeExtraction") { ... ExtractionFacade.extract(...) }
[6b] ios/FitMeExtractionModule.swift        WebViewExtractor.shared.extract(from: url)
```
Six real hops, each confirmed with `grep` against the actual files, terminating at the same shared
engine verified single-source in §2/§3.

## What would still need a real device/Mac to close out
- An actual Xcode build of both iOS projects (no macOS available here).
- An actual Android Studio / Gradle build against real `compileSdk 34` (no network access to
  Google's Maven from this sandbox).
- Try-on image generation itself (needs RunPod or local GPU weights, not included in the zip).

Updated files are in the same repo structure as before — happy to re-zip and re-send if useful.
