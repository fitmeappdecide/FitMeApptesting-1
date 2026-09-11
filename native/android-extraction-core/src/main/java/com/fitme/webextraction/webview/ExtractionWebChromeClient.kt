package com.fitme.webextraction.webview

import android.webkit.WebChromeClient
import android.webkit.WebView
import com.fitme.webextraction.errors.ExtractionError
import com.fitme.webextraction.utils.ExtractionLogger

/**
 * Minimal WebChromeClient used by the extraction engine.
 * It forwards progress updates to the [WebViewEventListener] and logs lifecycle events.
 */
class ExtractionWebChromeClient(private val listener: WebViewEventListener) : WebChromeClient() {

    override fun onProgressChanged(view: WebView?, newProgress: Int) {
        ExtractionLogger.d("WebView progress: $newProgress%")
        listener.onProgressChanged(newProgress)
        super.onProgressChanged(view, newProgress)
    }

    // Additional overrides (e.g., onConsoleMessage) can be added later if needed.
}
