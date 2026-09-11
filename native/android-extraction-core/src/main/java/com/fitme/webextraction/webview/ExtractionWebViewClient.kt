package com.fitme.webextraction.webview

import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Handler
import android.os.Looper
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.fitme.webextraction.errors.ExtractionError
import com.fitme.webextraction.utils.ExtractionLogger
import com.fitme.webextraction.config.ExtractionConstants

/**
 * Dedicated WebViewClient for the extraction engine.
 * It reports lifecycle events to the supplied listener and converts
 * platform‑specific failures into the unified ExtractionError hierarchy.
 */
class ExtractionWebViewClient(
    private val listener: WebViewEventListener,
    private val mainHandler: Handler = Handler(Looper.getMainLooper())
) : WebViewClient() {

    private var redirectCount = 0

    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val url = request?.url?.toString() ?: return false

        // Prevent ERR_UNKNOWN_URL_SCHEME crashes when sites try to open their native Android apps.
        if (url.startsWith("intent://")) {
            try {
                val intent = android.content.Intent.parseUri(url, android.content.Intent.URI_INTENT_SCHEME)
                val fallbackUrl = intent.getStringExtra("browser_fallback_url")
                if (fallbackUrl != null) {
                    view?.loadUrl(fallbackUrl)
                    return true
                }
            } catch (e: Exception) {
                ExtractionLogger.e("Failed to parse intent URI: ${e.message}")
            }
            return true // Intercept to prevent error page
        }

        // Block any other non-HTTP/HTTPS schemes (e.g. flipkart://, myntra://)
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            ExtractionLogger.d("Blocked unsupported scheme: $url")
            return true
        }

        // Track standard HTTP/HTTPS redirects
        if (view?.url != url) {
            redirectCount++
            ExtractionLogger.d("Redirect to $url (count=$redirectCount)")
            if (redirectCount > ExtractionConstants.MAX_REDIRECTS) {
                listener.onError(ExtractionError.NetworkFailure())
                return true // stop further loading
            }
            listener.onRedirect(url)
        }
        return false // let WebView handle it
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        // Double check for intent:// in onPageStarted because server-side 302 redirects 
        // to intent:// sometimes bypass shouldOverrideUrlLoading on older Android versions.
        if (url != null && url.startsWith("intent://")) {
            view?.stopLoading()
            try {
                val intent = android.content.Intent.parseUri(url, android.content.Intent.URI_INTENT_SCHEME)
                val fallbackUrl = intent.getStringExtra("browser_fallback_url")
                if (fallbackUrl != null) {
                    view?.loadUrl(fallbackUrl)
                    return
                }
            } catch (e: Exception) {
                ExtractionLogger.e("Failed to parse intent URI in onPageStarted: ${e.message}")
            }
            return
        }

        // Reset redirect counter for a fresh navigation and notify listener.
        resetRedirects()
        ExtractionLogger.d("Page started: $url")
        listener.onPageStarted(url ?: "")
    }

    // No request interception – let the WebView handle all resources.
    override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): android.webkit.WebResourceResponse? {
        return null
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        ExtractionLogger.d("Page finished: $url")
        listener.onPageFinished(url ?: "")
    }

    override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
        // Proceed on SSL errors for sub-resources (tracking/ad scripts with mixed content).
        // This matches iOS WKWebView which does not block on sub-resource SSL issues.
        // For production apps a stricter policy should be applied; for extraction purposes
        // we need the page to load fully.
        ExtractionLogger.d("[WebViewClient] SSL error (proceeding): ${error?.toString()}")
        handler?.proceed()
    }

    override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
    ) {
        val isMainFrame = request?.isForMainFrame == true
        val errorCode = error?.errorCode ?: return

        // Fatal error codes that indicate the main page itself cannot load.
        // All other codes (e.g. -6 file-not-found for sub-resources, -1 for
        // blocked trackers) are normal on modern e-commerce sites and must
        // be ignored — AJIO, Flipkart, and Myntra all trigger sub-resource
        // errors from blocked ad/tracking scripts while the product page
        // loads successfully.
        val fatalCodes = setOf(
            android.webkit.WebViewClient.ERROR_HOST_LOOKUP,       // -2  DNS failure
            android.webkit.WebViewClient.ERROR_CONNECT,           // -6  connection refused
            android.webkit.WebViewClient.ERROR_TIMEOUT,           // -8  timeout
            android.webkit.WebViewClient.ERROR_FAILED_SSL_HANDSHAKE, // -11
            android.webkit.WebViewClient.ERROR_REDIRECT_LOOP,     // -9
            android.webkit.WebViewClient.ERROR_UNSUPPORTED_SCHEME // -10 intent:// or flipkart://
        )

        if (isMainFrame && errorCode in fatalCodes) {
            ExtractionLogger.e("[WebViewClient] FATAL main-frame error: code=$errorCode url=${request?.url}")
            listener.onError(ExtractionError.NetworkFailure())
        } else {
            // Sub-resource failure or non-fatal main-frame error — log only, do not abort.
            ExtractionLogger.d("[WebViewClient] Sub-resource/non-fatal error ignored: code=$errorCode isMainFrame=$isMainFrame url=${request?.url}")
        }
    }

    // Helper to reset redirect counter when a new load begins.
    fun resetRedirects() {
        redirectCount = 0
    }
}

/**
 * Minimal listener interface used by the manager to react to WebView events.
 */
interface WebViewEventListener {
    fun onPageStarted(url: String)
    fun onPageFinished(url: String)
    fun onRedirect(newUrl: String)
    fun onError(error: ExtractionError)
    fun onProgressChanged(progress: Int)
}
