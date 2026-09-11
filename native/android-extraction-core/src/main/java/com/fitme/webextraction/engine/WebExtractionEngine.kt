package com.fitme.webextraction.engine

import android.content.Context
import android.webkit.WebView
import com.fitme.webextraction.errors.ExtractionError
import com.fitme.webextraction.utils.ExtractionLogger
import com.fitme.webextraction.webview.WebViewConfig
import kotlinx.coroutines.*
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Singleton extraction engine containing the core extraction pipeline and all helper methods.
 * Mirrors the original Android extraction logic from MainActivity and ExtractionFacade.
 * This object is the single source of truth for extraction; all callers (facades, UI) should delegate here.
 */
object WebExtractionEngine {
    /** Data class representing the extracted product */
    data class ExtractedProduct(
        val title: String,
        val brand: String,
        val price: String,
        val originalPrice: String?,
        val imageUrl: String?,
        val imageUrls: List<String>
    )

    /** Runs the full extraction pipeline on the provided WebView and URL. */
    suspend fun runExtractionPipeline(webView: WebView, url: String): ExtractedProduct {
        ExtractionLogger.d("[Engine] Starting extraction pipeline for $url")
        val platform = detectPlatform(url)
        val ready = waitUntilReady(webView, platform)
        ExtractionLogger.d("[Engine] waitUntilReady=$ready platform=$platform")

        // Always check for Access Denied / bot challenge pages.
        // For AJIO we check even when ready=true because AJIO's WAF serves a challenge page
        // that has readyState='complete' immediately. Without this check we'd run the
        // extraction script on a blocked page and get empty results silently.
        val challengeCheckNeeded = !ready || platform == "AJIO"
        if (challengeCheckNeeded) {
            val pageTitle = suspendEvaluateJs(webView, "document.title")
            ExtractionLogger.d("[Engine] Page title for challenge check: $pageTitle")
            val isChallenge = suspendEvaluateJs(webView,
                "var t = document.title.toLowerCase();" +
                "var h = document.querySelector('h1');" +
                "var hText = h ? h.innerText.toLowerCase() : '';" +
                "String(t.includes('access denied') || t.includes('access_denied') || " +
                "t.includes('blocked') || t.includes('bot check') || t.includes('verify you are human') || " +
                "t.includes('just a moment') || t.includes('challenge') || " +
                "hText.includes('access denied') || hText.includes('blocked'))"
            )
            if (isChallenge == "true" || isChallenge == "\"true\"") {
                ExtractionLogger.w("[Engine] $platform bot challenge page detected (title=$pageTitle). Throwing exception.")
                throw Exception("Bot challenge detected (WAF Blocked)")
            }
            if (!ready) {
                ExtractionLogger.w("[Engine] DOM never became ready – proceeding anyway")
            }
        }
        // Give AJIO a longer render time — its React app needs more time to hydrate
        val renderDelay = if (platform == "AJIO") 4500L else 2500L
        delay(renderDelay)
        if (platform == "AJIO") {
            ExtractionLogger.d("[Engine] AJIO pre‑extraction scroll")
            scrollPage(webView)
            delay(500)
        }
        val js = webView.context.assets.open("extraction.js").bufferedReader().use { it.readText() }
        ExtractionLogger.d("[Engine] Injecting extraction.js (${js.length} chars)")
        val result = suspendEvaluateJs(webView, js)
        val jsonString = unwrapJsResult(result)
        return parseExtractionResult(jsonString, platform)
    }

    private suspend fun waitUntilReady(webView: WebView, platform: String, pollMs: Long = 300, timeoutMs: Long = 25_000): Boolean {
        val condition = when (platform) {
            "Myntra" -> "!!document.getElementById('__NEXT_DATA__') || !!document.querySelector('h1')"
            "Amazon" -> "!!document.querySelector('#productTitle') || !!document.querySelector('#title') || !!document.querySelector('.a-price')"
            // AJIO: Wait strictly for product DOM elements or JSON-LD.
            // We omit `h1` because Cloudflare's WAF "Access Denied" page contains an h1.
            // Waiting forces the WebView to allow Cloudflare's JS challenge time to automatically redirect to the real product page.
            "AJIO" -> "!!document.querySelector('#productDetailSection') || !!document.querySelector('.prod-name') || !!document.querySelector('script[type=\\\"application/ld+json\\\"]')"
            "Flipkart" -> "!!document.querySelector('script[type=\\\"application/ld+json\\\"]') || !!document.querySelector('.B_NuCI') || !!document.querySelector('span.B_NuCI')"
            "H& M" -> "!!document.querySelector('script[type=\\\"application/ld+json\\\"]') || !!document.querySelector('h1')"
            else -> "!!document.querySelector('script[type=\\\"application/ld+json\\\"]') || !!document.querySelector('h1')"
        }
        val script = "(function(){ return $condition; })();"
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val ready = suspendEvaluateJs(webView, script)
            ExtractionLogger.d("[Engine] waitUntilReady poll: $ready")
            if (ready == "true") return true
            delay(pollMs)
        }
        return false
    }

    private suspend fun scrollPage(webView: WebView) = withContext(Dispatchers.Main) {
        webView.scrollBy(0, 2500)
        delay(800)
        webView.scrollBy(0, 3500)
        delay(800)
        webView.scrollTo(0, 0)
        delay(500)
    }

    private fun unwrapJsResult(rawResult: String?): String {
        if (rawResult == null) return ""
        return if (rawResult.startsWith("\"") && rawResult.endsWith("\"") && rawResult.length > 1) {
            rawResult.substring(1, rawResult.length - 1)
                .replace("\\\"", "\"")
                .replace("\\\\", "\\")
                .replace("\\n", "\n")
                .replace("\\r", "")
                .replace("\\t", "\t")
        } else {
            rawResult
        }
    }

    private fun parseExtractionResult(jsonString: String, platform: String): ExtractedProduct {
        // Guard: if the JS returned nothing (script error, timeout, empty page) return a safe empty product
        if (jsonString.isBlank()) {
            ExtractionLogger.w("[Engine] parseExtractionResult: empty JSON string from JS for platform=$platform")
            throw Exception("Empty extraction result")
        }
        val raw = try {
            JSONObject(jsonString)
        } catch (e: Exception) {
            ExtractionLogger.w("[Engine] parseExtractionResult: JSONObject parse failed for platform=$platform err=${e.message}")
            throw Exception("JSON parse failed: ${e.message}")
        }
        val domTitle = raw.optString("title").nullIfBlank()
        val domBrand = raw.optString("brand").nullIfBlank()
        val domPrice = raw.optString("priceText").nullIfBlank()
        val domImages = raw.optJSONArray("images")?.toStringList() ?: emptyList()
        val nextDataStr = raw.optString("nextData").nullIfBlank()
        val jsonLDArr = raw.optJSONArray("jsonLD")
        ExtractionLogger.d("[Engine] domTitle=$domTitle domBrand=$domBrand domPrice=$domPrice domImages=${domImages.size}")
        ExtractionLogger.d("[Engine] nextData present=${nextDataStr != null} jsonLD blobs=${jsonLDArr?.length() ?: 0}")
        // Tier 1: JSON‑LD
        if (jsonLDArr != null) {
            for (i in 0 until jsonLDArr.length()) {
                val blob = jsonLDArr.optString(i)
                if (blob.isNullOrBlank()) continue
                val product = parseJsonLDBlob(blob, platform, domImages)
                if (product != null) return patchWithDom(product, domTitle, domPrice, platform)
            }
        }
        // Tier 2: Myntra __NEXT_DATA__
        if (platform == "Myntra" && nextDataStr != null) {
            val myntra = parseMyntraNextData(nextDataStr, domImages)
            if (myntra != null) return patchWithDom(myntra, domTitle, domPrice, platform)
        }
        // Tier 3: Generic __NEXT_DATA__
        if (nextDataStr != null) {
            val generic = parseGenericNextData(nextDataStr, platform, domImages)
            if (generic != null) return patchWithDom(generic, domTitle, domPrice, platform)
        }
        // Tier 4: DOM fallback
        val title = domTitle ?: "Unknown Product"
        val brand = when {
            !domBrand.isNullOrBlank() && domBrand != "null" && domBrand != "Unknown" -> domBrand
            else -> platform
        }
        val price = domPrice?.let { formatPriceString(it) } ?: "—"
        val images = filteredImages(domImages, platform)
        return ExtractedProduct(title, brand, price, null, images.firstOrNull(), images.take(6))
    }


    private fun patchWithDom(product: ExtractedProduct, domTitle: String?, domPrice: String?, platform: String): ExtractedProduct {
        var title = product.title
        var price = product.price
        if ((title == "Product" || title.isBlank()) && !domTitle.isNullOrBlank()) {
            title = domTitle
        }
        if (!domPrice.isNullOrBlank()) {
            val cleaned = domPrice.replace(Regex("[^0-9.]"), "")
            val value = cleaned.toDoubleOrNull()
            if (value != null && value > 0) price = formatRupees(value) else price = domPrice
        }
        return product.copy(title = title, price = price)
    }

    private fun parseJsonLDBlob(raw: String, platform: String, renderedImages: List<String>): ExtractedProduct? {
        return try {
            val trimmed = raw.trim()
            val candidates: List<JSONObject> = when {
                trimmed.startsWith("[") -> {
                    val arr = JSONArray(trimmed)
                    (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
                }
                else -> {
                    val obj = JSONObject(trimmed)
                    val graph = obj.optJSONArray("@graph")
                    if (graph != null) (0 until graph.length()).mapNotNull { graph.optJSONObject(it) } else listOf(obj)
                }
            }
            for (dict in candidates) {
                val typeRaw = dict.opt("@type")
                val type = when (typeRaw) {
                    is String -> typeRaw
                    is JSONArray -> (0 until typeRaw.length()).mapNotNull { typeRaw.optString(it) }.joinToString(",")
                    else -> ""
                }
                if (!type.lowercase().contains("product")) continue
                val title = dict.optString("name").nullIfBlank() ?: "Product"
                val brand = when (val b = dict.opt("brand")) {
                    is JSONObject -> b.optString("name").nullIfBlank() ?: platform
                    is String -> b.nullIfBlank() ?: platform
                    else -> platform
                }
                val images = mutableListOf<String>()
                when (val img = dict.opt("image")) {
                    is String -> images.add(img)
                    is JSONArray -> for (i in 0 until img.length()) {
                        when (val item = img.opt(i)) {
                            is String -> item.nullIfBlank()?.let { images.add(it) }
                            is JSONObject -> item.optString("url").nullIfBlank()?.let { images.add(it) }
                        }
                    }
                    is JSONObject -> img.optString("url").nullIfBlank()?.let { images.add(it) }
                }
                for (ri in renderedImages) if (!images.contains(ri)) images.add(ri)
                val filteredImgs = filteredImages(images, platform)
                var price = "—"
                var originalPrice: String? = null
                val offersObj = dict.optJSONObject("offers")
                val offersArr = dict.optJSONArray("offers")
                val offers = offersObj ?: offersArr?.optJSONObject(0)
                if (offers != null) {
                    val rawPrice = offers.opt("price")
                    price = formatPriceAny(rawPrice) ?: "—"
                    val lowPrice = offers.opt("lowPrice")
                    val highPrice = offers.opt("highPrice")
                    if (lowPrice != null) price = formatPriceAny(lowPrice) ?: price
                    if (highPrice != null) originalPrice = formatPriceAny(highPrice)
                }
                return ExtractedProduct(title, brand, price, originalPrice, filteredImgs.firstOrNull(), filteredImgs.take(6))
            }
            null
        } catch (e: Exception) {
            ExtractionLogger.e("[Engine] parseJsonLDBlob exception: ${e.message}")
            null
        }
    }

    private fun parseMyntraNextData(jsonString: String, renderedImages: List<String>): ExtractedProduct? {
        return try {
            val root = JSONObject(jsonString)
            val blob = findProductBlob(root) ?: return null
            val title = blob.optString("name").nullIfBlank()
                ?: blob.optString("title").nullIfBlank()
                ?: blob.optString("productName").nullIfBlank()
                ?: "Product"
            val brand = blob.optString("brand").nullIfBlank()
                ?: blob.optString("brandName").nullIfBlank()
                ?: blob.optJSONObject("brandInfo")?.optString("name").nullIfBlank()
                ?: "Unknown"
            val imageUrls = mutableListOf<String>()
            val media = blob.optJSONObject("media")
            val albums = media?.optJSONArray("albums")
            if (albums != null) {
                for (i in 0 until albums.length()) {
                    val album = albums.optJSONObject(i) ?: continue
                    val images = album.optJSONArray("images") ?: continue
                    for (j in 0 until images.length()) {
                        val img = images.optJSONObject(j) ?: continue
                        val src = img.optString("src").nullIfBlank() ?: img.optString("imageURL").nullIfBlank()
                        if (src != null) imageUrls.add(upscaleMyntraImage(src))
                    }
                }
            }
            if (imageUrls.isEmpty()) {
                val images = blob.optJSONArray("images")
                if (images != null) {
                    for (i in 0 until images.length()) {
                        val img = images.optJSONObject(i) ?: continue
                        val src = img.optString("src").nullIfBlank()
                            ?: img.optString("imageURL").nullIfBlank()
                            ?: img.optString("url").nullIfBlank()
                        if (src != null) imageUrls.add(upscaleMyntraImage(src))
                    }
                }
            }
            if (imageUrls.isEmpty()) {
                for (img in renderedImages) if (!imageUrls.contains(img)) imageUrls.add(img)
            }
            val filteredImgs = filteredImages(imageUrls, "Myntra")
            var price = "—"
            var originalPrice: String? = null
            val priceBlock = blob.optJSONObject("price")
            if (priceBlock != null) {
                val discounted = priceBlock.optDouble("discounted", Double.NaN)
                val plain = priceBlock.optDouble("price", Double.NaN)
                val mrp = priceBlock.optDouble("mrp", Double.NaN)
                if (!discounted.isNaN()) price = formatRupees(discounted)
                else if (!plain.isNaN()) price = formatRupees(plain)
                if (!mrp.isNaN()) originalPrice = formatRupees(mrp)
            } else {
                val mrp = blob.optDouble("mrp", Double.NaN)
                val dp = blob.optDouble("discountedPrice", Double.NaN)
                if (!mrp.isNaN()) originalPrice = formatRupees(mrp)
                if (!dp.isNaN()) price = formatRupees(dp)
            }
            ExtractedProduct(title, brand, price, originalPrice, filteredImgs.firstOrNull(), filteredImgs.take(6))
        } catch (e: Exception) {
            ExtractionLogger.e("[Engine] parseMyntraNextData exception: ${e.message}")
            null
        }
    }

    private fun parseGenericNextData(jsonString: String, platform: String, renderedImages: List<String>): ExtractedProduct? {
        return try {
            val root = JSONObject(jsonString)
            val blob = findProductBlob(root) ?: return null
            val title = blob.optString("name").nullIfBlank()
                ?: blob.optString("title").nullIfBlank()
                ?: blob.optString("productName").nullIfBlank()
                ?: "Product"
            val brand = blob.optString("brand").nullIfBlank()
                ?: blob.optString("brandName").nullIfBlank()
                ?: platform
            val images = mutableListOf<String>()
            val imagesArr = blob.optJSONArray("images")
            if (imagesArr != null) {
                for (i in 0 until imagesArr.length()) {
                    when (val item = imagesArr.opt(i)) {
                        is JSONObject -> item.optString("src").nullIfBlank()?.let { images.add(it) }
                            ?: item.optString("url").nullIfBlank()?.let { images.add(it) }
                        is String -> item.nullIfBlank()?.let { images.add(it) }
                    }
                }
            } else {
                blob.optString("image").nullIfBlank()?.let { images.add(it) }
            }
            for (img in renderedImages) if (!images.contains(img)) images.add(img)
            val filteredImgs = filteredImages(images, platform)
            val price = blob.optDouble("price", Double.NaN).takeUnless { it.isNaN() }?.let { formatRupees(it) } ?: "—"
            ExtractedProduct(title, brand, price, null, filteredImgs.firstOrNull(), filteredImgs.take(6))
        } catch (e: Exception) {
            ExtractionLogger.e("[Engine] parseGenericNextData exception: ${e.message}")
            null
        }
    }

    private fun findProductBlob(node: JSONObject): JSONObject? {
        val hasName = node.has("name") || node.has("productName") || node.has("title")
        val hasImages = node.has("images") || node.has("media")
        val hasPrice = node.has("price") || node.has("mrp") || node.has("discountedPrice")
        if (hasName && (hasImages || hasPrice)) return node
        val keys = node.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val child = node.opt(key) ?: continue
            val found = when (child) {
                is JSONObject -> findProductBlob(child)
                is JSONArray -> findProductBlobInArray(child)
                else -> null
            }
            if (found != null) return found
        }
        return null
    }

    private fun findProductBlobInArray(arr: JSONArray): JSONObject? {
        for (i in 0 until arr.length()) {
            val item = arr.opt(i) ?: continue
            val found = when (item) {
                is JSONObject -> findProductBlob(item)
                is JSONArray -> findProductBlobInArray(item)
                else -> null
            }
            if (found != null) return found
        }
        return null
    }

    // ---- Image handling ----
    private fun filteredImages(urls: List<String>, platform: String): List<String> {
        val seen = linkedSetOf<String>()
        for (raw in urls) {
            if (raw.isBlank() || raw == "null") continue
            var normalized = when {
                raw.startsWith("//") -> "https:$raw"
                platform == "Myntra" && (raw.startsWith("fl_progressive/") || raw.startsWith("f_webp/")) -> "https://assets.myntassets.com/$raw"
                else -> raw
            }
            if (platform == "Nykaa") normalized = upscaleNykaaImage(normalized)
            if (platform == "AJIO") normalized = normalized.replace(Regex("-\\d+Wx\\d+H-"), "-1117Wx1400H-")
            if (platform == "Myntra") normalized = upscaleMyntraImage(normalized)
            if (normalized.isNotBlank() && !seen.contains(normalized)) seen.add(normalized)
        }
        return seen.toList()
    }

    private fun upscaleMyntraImage(url: String): String {
        val marker = "assets/images/"
        val idx = url.indexOf(marker)
        return if (idx >= 0) {
            val path = url.substring(idx)
            "https://assets.myntassets.com/h_1440,q_75,w_1080/$path"
        } else url
    }

    private fun upscaleNykaaImage(url: String): String {
        var out = url
        out = out.replace(Regex("/tr:[^/]+/", RegexOption.IGNORE_CASE), "/")
        return try {
            val uri = android.net.Uri.parse(out)
            val builder = uri.buildUpon()
            val params = uri.queryParameterNames.filter { it.lowercase() != "tr" }
            builder.clearQuery()
            for (p in params) builder.appendQueryParameter(p, uri.getQueryParameter(p))
            builder.build().toString()
        } catch (e: Exception) {
            out
        }
    }

    private fun formatRupees(value: Double): String {
        val intVal = value.toInt()
        val formatter = java.text.NumberFormat.getNumberInstance(Locale("en", "IN"))
        return "₹${formatter.format(intVal)}"
    }

    private fun formatPriceString(raw: String): String {
        val cleaned = raw.replace(Regex("[^0-9.]"), "")
        val value = cleaned.toDoubleOrNull() ?: return raw
        return formatRupees(value)
    }

    private fun formatPriceAny(raw: Any?): String? {
        val value = when (raw) {
            is Double -> raw
            is Int -> raw.toDouble()
            is Long -> raw.toDouble()
            is String -> raw.replace(",", "").toDoubleOrNull() ?: return null
            else -> return null
        }
        if (value <= 0) return null
        return formatRupees(value)
    }

    private fun detectPlatform(url: String): String {
        val l = url.lowercase()
        return when {
            l.contains("myntra") -> "Myntra"
            l.contains("amazon") -> "Amazon"
            l.contains("flipkart") -> "Flipkart"
            l.contains("ajio") -> "AJIO"
            l.contains("meesho") -> "Meesho"
            l.contains("zara") -> "Zara"
            l.contains("hm.com") || l.contains("h&m") -> "H& M"
            l.contains("nykaa") -> "Nykaa"
            l.contains("tatacliq") -> "TataCliq"
            else -> "Online Store"
        }
    }

    // Utility extensions
    private fun String?.nullIfBlank(): String? = if (this.isNullOrBlank() || this == "null") null else this
    private fun JSONArray.toStringList(): List<String> = (0 until length()).mapNotNull { optString(it).nullIfBlank() }

    private suspend fun suspendEvaluateJs(webView: WebView, script: String): String =
        withContext(Dispatchers.Main) {
            suspendCancellableCoroutine { cont ->
                webView.evaluateJavascript(script) { result ->
                    cont.resumeWith(Result.success(result ?: "null"))
                }
            }
        }
}
