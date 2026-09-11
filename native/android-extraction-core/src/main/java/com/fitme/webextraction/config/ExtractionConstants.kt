package com.fitme.webextraction.config

/**
 * Miscellaneous constants that are used across the extraction foundation.
 * Keeping them in a dedicated object makes it easy to tune values without
 * touching the core logic.
 */
object ExtractionConstants {
    // Rendering timeout – matches iOS overall timeout (≈10 seconds).
    const val RENDER_TIMEOUT_MS = 10_000L

    // Maximum number of redirects that we will follow before aborting.
    const val MAX_REDIRECTS = 5

    // Minimum progress change to emit a log entry (percentage).
    const val PROGRESS_LOG_THRESHOLD = 5

    // Default User‑Agent string – mirrors iOS WKWebView default.
    const val DEFAULT_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1"
}
