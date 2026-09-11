package com.fitme.app

import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.fitme.webextraction.errors.ExtractionError
import com.fitme.webextraction.utils.ExtractionLogger
import com.fitme.webextraction.webview.ExtractionWebChromeClient
import com.fitme.webextraction.webview.ExtractionWebViewClient
import com.fitme.webextraction.webview.WebViewEventListener
import com.fitme.webextraction.webview.WebViewConfig
import com.fitme.webextraction.facade.ExtractionFacade
import com.fitme.webextraction.facade.ExtractionFacade.ExtractedProduct
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.URL

class MainActivity : AppCompatActivity(), WebViewEventListener {
    private lateinit var webView: WebView

    // UI Elements
    private lateinit var inputLayout: View
    private lateinit var resultLayout: View
    private lateinit var textStatus: TextView
    private lateinit var productImage: ImageView
    private lateinit var textPlatform: TextView
    private lateinit var textBrand: TextView
    private lateinit var textProduct: TextView
    private lateinit var textPrice: TextView

    // Track the current URL for platform detection
    private var currentUrl: String = ""

    // Track the active extraction pipeline job to cancel it if a page reloads
    private var extractionJob: kotlinx.coroutines.Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        inputLayout = findViewById(R.id.inputLayout)
        resultLayout = findViewById(R.id.resultLayout)
        textStatus = findViewById(R.id.textStatus)
        productImage = findViewById(R.id.productImage)
        textPlatform = findViewById(R.id.textPlatform)
        textBrand = findViewById(R.id.textBrand)
        textProduct = findViewById(R.id.textProduct)
        textPrice = findViewById(R.id.textPrice)

        val editTextUrl = findViewById<EditText>(R.id.editTextUrl)
        val buttonLoad = findViewById<Button>(R.id.buttonLoad)
        val buttonContinue = findViewById<Button>(R.id.buttonContinue)

        configureWebView()

        buttonLoad.setOnClickListener {
            var url = editTextUrl.text.toString().trim()

            // Auto-extract the actual HTTP(S) link if the user pasted raw 'Share' text
            val urlRegex = Regex("(https?://[^\\s]+)")
            val match = urlRegex.find(url)
            if (match != null) {
                url = match.value
            }

            if (url.isEmpty()) {
                android.widget.Toast.makeText(this, "Please enter a valid product URL", android.widget.Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            currentUrl = url

            // Set Platform name from URL
            val platform = detectPlatform(currentUrl)
            textPlatform.text = platform

            textStatus.text = "Loading..."

            if (platform == "AJIO") {
                webView.settings.userAgentString = android.webkit.WebSettings.getDefaultUserAgent(this)
            } else if (platform == "H&M" || platform == "Meesho") {
                // H&M and Meesho block mobile headless WebViews. Spoof Desktop Chrome.
                webView.settings.userAgentString = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            } else {
                webView.settings.userAgentString = WebViewConfig.USER_AGENT
            }

            webView.webViewClient = ExtractionWebViewClient(this)
            webView.webChromeClient = ExtractionWebChromeClient(this)
            webView.loadUrl(url)
        }

        buttonContinue.setOnClickListener {
            resultLayout.visibility = View.GONE
            inputLayout.visibility = View.VISIBLE
            textStatus.text = ""
        }
    }

    private fun configureWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = WebViewConfig.ENABLE_JAVASCRIPT
        settings.domStorageEnabled = WebViewConfig.ENABLE_DOM_STORAGE
        settings.cacheMode = WebViewConfig.CACHE_MODE
        settings.mixedContentMode = WebViewConfig.MIXED_CONTENT_MODE
        settings.safeBrowsingEnabled = WebViewConfig.SAFE_BROWSING_ENABLED
        val platform = detectPlatform(currentUrl)
        if (platform == "AJIO") {
            settings.userAgentString = android.webkit.WebSettings.getDefaultUserAgent(this)
        } else if (platform == "H&M" || platform == "Meesho") {
            settings.userAgentString = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        } else {
            settings.userAgentString = WebViewConfig.USER_AGENT
        }

        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
        webView.webChromeClient = ExtractionWebChromeClient(this)
        webView.webViewClient = ExtractionWebViewClient(this)
    }

    override fun onPageStarted(url: String) {
        ExtractionLogger.d("Page started: $url")
        extractionJob?.cancel()
    }

    override fun onPageFinished(url: String) {
        ExtractionLogger.d("Page finished: $url")
        extractionJob?.cancel()
                    extractionJob = ExtractionFacade.extract(this, currentUrl, object : ExtractionFacade.ExtractionListener {
                override fun onProgress(progress: Int) {
                    // optional: update UI progress bar if needed
                }

                override fun onSuccess(product: ExtractedProduct) {
                    bindUI(product)
                }

                override fun onError(error: ExtractionError) {
                    ExtractionLogger.e("Extraction error via facade: ${error.javaClass.simpleName}")
                }
            })
    }

    private fun bindUI(product: ExtractedProduct) {
        ExtractionLogger.d("bindUI: title=${product.title} brand=${product.brand} price=${product.price} images=${product.imageUrls.size}")

        runOnUiThread {
            textProduct.text = product.title
            textBrand.text = product.brand
            textPrice.text = product.price
            inputLayout.visibility = View.GONE
            resultLayout.visibility = View.VISIBLE
        }

        product.imageUrl?.let { urlString ->
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val finalUrl = if (urlString.startsWith("//")) "https:$urlString" else urlString
                    ExtractionLogger.d("Loading image: $finalUrl")
                    val connection = URL(finalUrl).openConnection()
                    connection.setRequestProperty("User-Agent", WebViewConfig.USER_AGENT)
                    connection.setRequestProperty("Referer", currentUrl)
                    val bitmap = BitmapFactory.decodeStream(connection.getInputStream())
                    withContext(Dispatchers.Main) {
                        productImage.setImageBitmap(bitmap)
                    }
                } catch (e: Exception) {
                    ExtractionLogger.e("Image load failed: ${e.message}")
                }
            }
        }
    }

    // WebView event callbacks
    override fun onRedirect(newUrl: String) {
        ExtractionLogger.d("Redirected to: $newUrl")
    }

    override fun onError(error: ExtractionError) {
        ExtractionLogger.e("WebView error: $error")
    }

    override fun onProgressChanged(progress: Int) {
        ExtractionLogger.d("Loading progress: $progress%")
        runOnUiThread {
            textStatus.text = "Loading: $progress%"
        }
    }

    /** Simple platform detection used for user-agent / UI labeling. Mirrors ExtractionFacade's. */
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
