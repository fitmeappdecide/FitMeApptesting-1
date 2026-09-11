package com.fitme.webextraction.webview

import com.fitme.webextraction.config.ExtractionConstants

/**
 * Central configuration for the Android WebView used in the extraction engine.
 * All values are deliberately centralized to avoid magic numbers spread across the codebase.
 */
object WebViewConfig {
    // Enable JavaScript – required for the shared extraction JavaScript.
    const val ENABLE_JAVASCRIPT = true

    // Enable DOM storage (localStorage, sessionStorage) – many e‑commerce sites rely on it.
    const val ENABLE_DOM_STORAGE = true

    // Cache mode – we want a fresh load for each extraction to avoid stale data.
    const val CACHE_MODE = android.webkit.WebSettings.LOAD_DEFAULT

    // Mixed content mode – allow https pages to load http sub‑resources when needed.
    const val MIXED_CONTENT_MODE = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

    // Enable safe browsing – provides protection against known malicious content.
    const val SAFE_BROWSING_ENABLED = true

    // User‑Agent – mirror the iOS WKWebView mobile Safari UA.
    // Myntra and other e-commerce sites serve a different (often less-structured) DOM
    // to Android Chrome. Using the same iPhone UA as iOS ensures we receive the same
    // page layout and the same __NEXT_DATA__ blob that the iOS extractor relies on.
    val USER_AGENT: String = ExtractionConstants.DEFAULT_USER_AGENT

    // Rendering timeout in milliseconds – used by the lifecycle manager.
    const val RENDER_TIMEOUT_MS = 10_000L // 10 seconds, matches iOS overall timeout.

    // Progress reporting interval – how often we emit progress updates (ms).
    const val PROGRESS_UPDATE_INTERVAL_MS = 100L
}
