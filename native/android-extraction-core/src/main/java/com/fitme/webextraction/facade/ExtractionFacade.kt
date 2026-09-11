// ExtractionFacade.kt - Thin wrapper delegating to WebExtractionEngine
package com.fitme.webextraction.facade

import android.content.Context
import android.webkit.WebView
import com.fitme.webextraction.errors.ExtractionError
import com.fitme.webextraction.engine.AjioApiExtractor
import com.fitme.webextraction.engine.WebExtractionEngine
import com.fitme.webextraction.webview.WebViewConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch


/**
 * Thin façade that delegates the full extraction pipeline to the shared {@link WebExtractionEngine} singleton.
 * It maintains the original public API used by the UI and future React Native bridge.
 */
object ExtractionFacade {
    /** Data class mirroring the engine's result for compatibility with existing callers. */
    data class ExtractedProduct(
        val title: String,
        val brand: String,
        val price: String,
        val originalPrice: String?,
        val imageUrl: String?,
        val imageUrls: List<String>
    )

    /** Listener used by callers (e.g., MainActivity or future React Native bridge) */
    interface ExtractionListener {
        fun onProgress(progress: Int) // currently unused; placeholder for future extensions
        fun onSuccess(product: ExtractedProduct)
        fun onError(error: ExtractionError)
    }

    /** Starts extraction for the given URL. Returns the coroutine Job so the caller can cancel if needed. */
    fun extract(context: Context, url: String, listener: ExtractionListener): Job {
        return CoroutineScope(Dispatchers.Main).launch {
            try {
                val platform = detectPlatform(url)

                // ── AJIO: use HTTP extractor first (bypasses WebView WAF blocking) ──────────
                // AJIO's WAF (Akamai Bot Manager) blocks Android WebView regardless of UA.
                // HttpURLConnection does NOT carry WebView fingerprints, so it often gets through.
                // Only if HTTP extraction fails do we fall back to WebView.
                if (platform == "AJIO") {
                    android.util.Log.d("FitMe", "[Facade] AJIO: attempting HTTP extraction (no WebView)")
                    val httpResult = AjioApiExtractor.extract(url)
                    if (httpResult != null && httpResult.title.isNotBlank() &&
                        !httpResult.title.lowercase().contains("access denied")) {
                        android.util.Log.d("FitMe", "[Facade] AJIO HTTP extraction succeeded: ${httpResult.title}")
                        listener.onSuccess(ExtractedProduct(
                            title = httpResult.title,
                            brand = httpResult.brand,
                            price = httpResult.price,
                            originalPrice = httpResult.originalPrice,
                            imageUrl = httpResult.imageUrl,
                            imageUrls = httpResult.imageUrls
                        ))
                        return@launch
                    }
                    android.util.Log.w("FitMe", "[Facade] AJIO HTTP extraction failed — falling back to WebView")
                }

                // ── All other platforms: standard WebView extraction ───────────────────────
                val webView = WebView(context)
                configureWebView(webView, url)

                // AJIO (fallback) gets extra browser-like headers; others load normally
                if (platform == "AJIO") {
                    val extraHeaders = mapOf(
                        "Accept" to "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                        "Accept-Language" to "en-IN,en;q=0.9",
                        "Upgrade-Insecure-Requests" to "1",
                        "Cache-Control" to "max-age=0"
                    )
                    webView.loadUrl(url, extraHeaders)
                } else {
                    webView.loadUrl(url)
                }

                val engineResult = WebExtractionEngine.runExtractionPipeline(webView, url)

                val result = ExtractedProduct(
                    title = engineResult.title,
                    brand = engineResult.brand,
                    price = engineResult.price,
                    originalPrice = engineResult.originalPrice,
                    imageUrl = engineResult.imageUrl,
                    imageUrls = engineResult.imageUrls
                )
                listener.onSuccess(result)
                webView.destroy()
            } catch (e: Exception) {
                listener.onError(ExtractionError.RenderingError(e.message ?: "Unknown error"))
            }
        }
    }

    // Desktop Chrome UA — passes AJIO's WAF (iPhone/Android WebView UAs are blocked)
    private val CHROME_DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    // Chrome Android UA — second option for AJIO retry
    private val CHROME_ANDROID_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36"

    /** Configures the WebView with required settings and platform-specific user-agent. */
    fun configureWebView(webView: WebView, currentUrl: String, uaOverride: String? = null) {
        val settings = webView.settings
        settings.javaScriptEnabled = WebViewConfig.ENABLE_JAVASCRIPT
        settings.domStorageEnabled = WebViewConfig.ENABLE_DOM_STORAGE
        settings.cacheMode = WebViewConfig.CACHE_MODE
        settings.mixedContentMode = WebViewConfig.MIXED_CONTENT_MODE
        settings.safeBrowsingEnabled = WebViewConfig.SAFE_BROWSING_ENABLED
        settings.loadsImagesAutomatically = true
        settings.databaseEnabled = true
        val platform = detectPlatform(currentUrl)
        // AJIO (Akamai Bot Manager) uses JS and TLS fingerprinting.
        // Spoofing iPhone Safari or Desktop Chrome causes a mismatch with the Android WebView fingerprint, resulting in an instant block.
        // Instead, we use the device's real native Chrome UA, but strip the "; wv" and "Version/4.0" tokens so it looks like the standalone Chrome app.
        settings.userAgentString = uaOverride ?: when (platform) {
            "AJIO" -> android.webkit.WebSettings.getDefaultUserAgent(webView.context)
                          .replace("; wv", "")
                          .replace("Version/4.0 ", "")
            "H&M", "Meesho" -> CHROME_DESKTOP_UA
            else -> WebViewConfig.USER_AGENT  // iPhone Safari — works for Myntra, Amazon, Flipkart, Nykaa
        }
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
    }

    /** Simple platform detection used for user‑agent configuration. */
    private fun detectPlatform(url: String): String {
        val l = url.lowercase()
        return when {
            l.contains("ajio") -> "AJIO"
            l.contains("h&m") || l.contains("hm.com") -> "H&M"
            l.contains("meesho") -> "Meesho"
            l.contains("amazon") -> "Amazon"
            l.contains("flipkart") -> "Flipkart"
            l.contains("myntra") -> "Myntra"
            else -> "Online Store"
        }
    }
}
