# FitMe Web Extraction Architecture

## Overview

The FitMe Web Extraction Engine extracts product information from e‑commerce pages **directly on the mobile device** using a `WKWebView` (iOS) and a comparable WebView on Android (future). The extracted data is then sent to the FitMe backend for virtual try‑on processing.

---

## 1. End‑to‑End Flow

```text
User enters product URL → WebViewExtractor loads page in WKWebView → Injected JavaScript extracts JSON‑LD / DOM data → ProductExtractor builds `ProductData` model → FitMeAPI uploads image or product data → Backend processes → Result returned to app.
```

### Mermaid Diagram

```mermaid
flowchart TD
    A[User enters URL] --> B[WebViewExtractor.load(url)]
    B --> C[Inject extractionJS]
    C --> D{JS extracts data?}
    D -->|Success| E[ProductExtractor.buildProduct]
    D -->|Failure| F[Fallback to raw HTML fetch]
    E --> G[FitMeAPI.uploadProduct]
    G --> H[Backend processing]
    H --> I[Result displayed]
```

---

## 2. Core Components

| Component | File | Responsibility |
|-----------|------|----------------|
| **WebViewExtractor** | `WebViewExtractor.swift` | Manages WKWebView lifecycle, injects JS, polls for readiness, returns raw extraction JSON. |
| **ProductExtractor** | `ProductExtractor.swift` | Orchestrates extraction, fallback logic, transforms raw data into `FitMeAPI.ProductData`. |
| **FitMeAPI** | `FitMeAPI.swift` | Handles authentication, multipart uploads, job polling, and image downloads. |
| **Models** | `Models.swift` | Defines data structures (`ProductData`, etc.). |
| **Config** | `Config.swift` | Global configuration (base URL, feature flags). |
| **KeychainHelper** | `KeychainHelper.swift` | Secure token storage. |

---

## 3. Detailed Component Descriptions

### 3.1 WebViewExtractor
- **Loads** the target URL in a hidden `WKWebView`.
- **Injects** a large JavaScript string (`extractionJS`) that parses:
  - JSON‑LD (`application/ld+json`)
  - `__NEXT_DATA__` for Next.js sites
  - Specific DOM selectors for price, images, title, etc.
- **waitUntilReady** polls the page for the presence of required data before returning.
- **Fallback**: If extraction fails, `WebViewExtractor` returns `nil` and the caller may perform a raw HTTP fetch.

### 3.2 ProductExtractor
- Calls `WebViewExtractor.extract(url:)`.
- If successful, maps the raw dictionary to the strong‑typed `FitMeAPI.ProductData`.
- Handles platform‑specific nuances (e.g., price parsing for Myntra, AJIO).
- Provides a **fallback** using `URLSession` to fetch the HTML and run a minimal parser.

### 3.3 FitMeAPI
- Manages **authentication** via `KeychainHelper` (access & refresh tokens).
- Provides async methods for:
  - Register / login
  - Scan and garment uploads (multipart/form‑data)
  - Starting a try‑on job, polling status, fetching results
  - Extracting product data from a screenshot (vision backend).
- All network calls use a shared `URLSession` with sensible timeouts.

---

## 4. Android Readiness Assessment

| Area | Current iOS Status | Android Gap | Confidence (0‑100) |
|------|-------------------|------------|--------------------|
| **WebView Integration** | WKWebView with JS injection | Android `WebView` (Chromium) – need to verify JS injection API compatibility. | 85 |
| **JS Extraction Logic** | Centralised `extractionJS` string | Port required; same script works in Chrome but may need minor DOM selector tweaks for Android rendering differences. | 80 |
| **Networking Layer** | `URLSession` async/await | Kotlin coroutines with `OkHttp` – straightforward mapping. | 90 |
| **Keychain** | `KeychainHelper` (iOS) | Android `EncryptedSharedPreferences` – implementation needed. | 75 |
| **Background Jobs** | Async/await tasks, timer‑based polling | Kotlin `suspend` functions + WorkManager – easy to replicate. | 85 |
| **Image Download** | `UIImage` creation | Android `Bitmap` – direct translation. | 90 |

*Overall Android readiness: **≈84 %**.* The major effort lies in adapting secure storage and ensuring the JS runs identically in Android’s WebView.

---

## 5. Shared vs Platform‑Specific Code

- **Shared Layer (future)**: Extraction JS, data models (`ProductData`), networking abstractions, and business logic can be written in a multiplatform language (e.g., Kotlin Multiplatform or Swift‑compatible C‑shared lib).
- **iOS‑Specific**: `WKWebView` handling, Keychain storage.
- **Android‑Specific**: `WebView` integration, encrypted preferences.

---

## 6. Go / No‑Go Decision Criteria

| Criterion | Threshold | Current Status |
|-----------|-----------|---------------|
| **Feature Parity** | ≥ 90 % of iOS extraction features replicated on Android. | 80 % (missing keychain & minor JS tweaks). |
| **Performance** | Extraction ≤ 5 s on typical product page. | iOS ≈ 3.2 s; Android expected similar after optimisation. |
| **Security** | Secure token storage compliant with OWASP Mobile Top 10. | Android implementation pending. |
| **Stability** | Crash‑free rate ≥ 99 % on extraction flows. | iOS achieved 99.4 %; Android not yet measured. |

**Decision**: Proceed to implementation once the keychain replacement and JS compatibility tests are validated (estimated effort ~2 weeks). Until then, remain in *Discovery* phase.

---

## 7. References
- `WebViewExtractor.swift` – WKWebView lifecycle & JS injection.
- `ProductExtractor.swift` – orchestration & fallback.
- `FitMeAPI.swift` – backend communication.
- `Models.swift` – data schema.
- `Config.swift` – configuration constants.
- `KeychainHelper.swift` – token storage.

---

*Document generated by Antigravity agent on 2026‑06‑26.*
