# Overall Architecture

## System Overview

The FitMe web‑extraction engine lives in the **iOS** part of the repository and is responsible for turning a product **URL** into a rich `ProductData` model that can be fed to the AI try‑on pipeline.

### High‑level Flow
1. **Input** – A product URL is received from the UI.
2. **ProductExtractor** – Orchestrates the extraction process.
3. **WebViewExtractor** – Loads the URL inside a `WKWebView`, injects JavaScript, and pulls JSON‑LD / `__NEXT_DATA__` / DOM information.
4. **Fallback** – If the WebView fails, a plain `URLSession` request fetches the raw HTML and runs a lightweight parser.
5. **FitMeAPI** – Sends the extracted data to the backend (e.g., for image‑based product extraction or try‑on job creation).
6. **Output** – A fully populated `ProductData` model is returned to the caller.

---

## Component Diagram (Mermaid)

```mermaid
flowchart TD
    UI[UI (product URL)] -->|calls| PE[ProductExtractor]
    PE --> WV[WebViewExtractor]
    WV -->|injects JS| WK[WKWebView]
    WK -->|returns data| PE
    PE -->|fallback| HTTP[URLSession HTML fetch]
    PE -->|sends to| API[FitMeAPI]
    API -->|POST /product/from-image| BE[Backend]
    BE -->|response| API
    API -->|returns| PE
    PE -->|produces| PD[ProductData]
    PD --> UI
```

## Plain‑text Diagram

```
[UI] --> ProductExtractor --> WebViewExtractor --> WKWebView (JS injection) -->
    success: returns product fields
    failure: fallback to URLSession HTML fetch
ProductExtractor --> FitMeAPI --> Backend (image extraction, try‑on) --> returns ProductData
```

---

## Documentation Structure
- `docs/Overall_Architecture.md` (this file) – global view.
- `docs/WebViewExtractor.md` – deep dive into the WebView based extraction.
- `docs/ProductExtractor.md` – orchestration logic and fallback strategy.
- `FitMe_Web_Extraction_Architecture.md` – master document that includes all sections for easy reference.

---

## Android Readiness Rating
| Area | Rating (0‑100) | Comments |
|------|----------------|----------|
| Extraction Logic | 85 | Core algorithm is platform‑agnostic; only WKWebView‑specific parts need re‑implementation using Android `WebView` and JavaScript bridges. |
| Networking & API | 95 | Uses `URLSession`; Android counterpart (`OkHttp`) is a straightforward swap. |
| Data Models | 100 | Pure Swift `Codable` structs → Kotlin data classes with minimal changes. |
| Keychain / Secure Storage | 70 | iOS `KeychainHelper` needs Android `EncryptedSharedPreferences` equivalent. |
| UI Integration | 80 | UI glue (e.g., SwiftUI / UIKit) must be re‑implemented in Android UI layer. |

---

*This file will be included in the master `FitMe_Web_Extraction_Architecture.md` document.*
