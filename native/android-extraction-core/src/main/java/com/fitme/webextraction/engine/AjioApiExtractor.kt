package com.fitme.webextraction.engine

import com.fitme.webextraction.utils.ExtractionLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Dedicated HTTP-based extractor for AJIO product pages.
 *
 * WHY HTTP INSTEAD OF WEBVIEW:
 * AJIO's WAF (Akamai Bot Manager) blocks Android WebView requests regardless of User-Agent,
 * because WebView exposes fingerprints (JS APIs, missing browser APIs, timing patterns) that
 * bot detectors identify. A plain HttpURLConnection doesn't have these fingerprints.
 *
 * APPROACH:
 * 1. Try AJIO's internal product API: https://www.ajio.com/api/p/{productCode}
 * 2. Fall back to fetching the HTML page and parsing JSON-LD from it
 * 3. Both use a realistic desktop Chrome User-Agent + proper Accept headers
 */
object AjioApiExtractor {

    private const val TAG = "AjioApiExtractor"

    // Desktop Chrome UA — standard HTTP client, not a WebView
    private const val CHROME_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

    // AJIO's internal product API endpoint pattern
    // Example URL: https://www.ajio.com/s/fnf-men-casual-shirts/FNFMS24SH0085-WHITE
    // Product code is the last path segment: FNFMS24SH0085-WHITE
    private const val AJIO_API_BASE = "https://www.ajio.com/api/p/"

    data class AjioProduct(
        val title: String,
        val brand: String,
        val price: String,
        val originalPrice: String?,
        val imageUrl: String?,
        val imageUrls: List<String>
    )

    /**
     * Main entry point. Tries:
     * 1. AJIO product API (fast, structured JSON)
     * 2. HTML page fetch + JSON-LD parse (fallback)
     *
     * Returns null if all methods fail (caller should fall back to WebView).
     */
    suspend fun extract(productUrl: String): AjioProduct? = withContext(Dispatchers.IO) {
        ExtractionLogger.d("[$TAG] Starting HTTP extraction for $productUrl")

        // Step 1: Try internal API
        val productCode = extractProductCode(productUrl)
        ExtractionLogger.d("[$TAG] Product code: $productCode")

        if (productCode != null) {
            val apiResult = tryAjioApi(productCode)
            if (apiResult != null) {
                ExtractionLogger.d("[$TAG] API extraction succeeded: ${apiResult.title}")
                return@withContext apiResult
            }
        }

        // Step 2: Fetch raw HTML and parse JSON-LD
        ExtractionLogger.d("[$TAG] API failed, trying HTML fetch...")
        val htmlResult = tryHtmlFetch(productUrl)
        if (htmlResult != null) {
            ExtractionLogger.d("[$TAG] HTML extraction succeeded: ${htmlResult.title}")
            return@withContext htmlResult
        }

        ExtractionLogger.w("[$TAG] All HTTP methods failed for $productUrl")
        null
    }

    /**
     * Extract product code from AJIO URLs.
     * Formats seen:
     *   https://www.ajio.com/s/some-name/PRODUCTCODE
     *   https://trends.ajio.com/s/some-name/PRODUCTCODE
     *   https://www.ajio.com/some-name/p/PRODUCTCODE
     */
    private fun extractProductCode(url: String): String? {
        return try {
            // Pattern: last path segment that looks like an AJIO product code
            // AJIO codes are alphanumeric with hyphens, often like: FNFMS24SH0085-WHITE or 469696402_white
            val path = URL(url).path
            val segments = path.split("/").filter { it.isNotBlank() }
            // Take last segment — product codes are always last
            val last = segments.lastOrNull() ?: return null
            // Basic sanity: at least 5 chars, no spaces
            if (last.length >= 5 && !last.contains(' ')) last else null
        } catch (e: Exception) {
            ExtractionLogger.w("[$TAG] Failed to extract product code from $url: ${e.message}")
            null
        }
    }

    /**
     * Try AJIO's internal product API.
     * Endpoint: https://www.ajio.com/api/p/{productCode}
     * Returns structured JSON with product details.
     */
    private fun tryAjioApi(productCode: String): AjioProduct? {
        val apiUrl = "$AJIO_API_BASE$productCode"
        ExtractionLogger.d("[$TAG] Trying API: $apiUrl")
        return try {
            val json = httpGet(apiUrl, acceptJson = true) ?: return null
            ExtractionLogger.d("[$TAG] API response length: ${json.length}")
            parseAjioApiJson(json)
        } catch (e: Exception) {
            ExtractionLogger.w("[$TAG] API call failed: ${e.message}")
            null
        }
    }

    /**
     * Parse the JSON response from AJIO's product API.
     * The API returns a flat product object.
     */
    private fun parseAjioApiJson(jsonStr: String): AjioProduct? {
        return try {
            val json = JSONObject(jsonStr)

            // The API response may be nested under "baseOptions", "potentialPromotions", etc.
            val title = json.optString("name").nullIfBlank()
                ?: json.optJSONObject("baseProduct")?.optString("name").nullIfBlank()
                ?: return null  // If no name, this isn't a valid product response

            val brand = json.optString("brand").nullIfBlank()
                ?: json.optJSONObject("brandData")?.optString("brandName").nullIfBlank()
                ?: "AJIO"

            val price = json.optJSONObject("price")?.optString("formattedValue").nullIfBlank()
                ?: json.optString("price").nullIfBlank()
                ?: "—"

            val originalPrice = json.optJSONObject("wasPrice")?.optString("formattedValue").nullIfBlank()

            val images = mutableListOf<String>()
            val galleryImgs = json.optJSONArray("images")
            if (galleryImgs != null) {
                for (i in 0 until galleryImgs.length()) {
                    val img = galleryImgs.optJSONObject(i)
                    val imgUrl = img?.optString("url").nullIfBlank() ?: continue
                    // Make absolute URL
                    val absUrl = if (imgUrl.startsWith("http")) imgUrl else "https://assets.ajio.com$imgUrl"
                    if (images.indexOf(absUrl) == -1) images.add(absUrl)
                }
            }

            // Also try imageList
            val imageList = json.optJSONArray("imageList")
            if (imageList != null) {
                for (i in 0 until imageList.length()) {
                    val imgUrl = imageList.optString(i).nullIfBlank() ?: continue
                    val absUrl = if (imgUrl.startsWith("http")) imgUrl else "https://assets.ajio.com$imgUrl"
                    if (images.indexOf(absUrl) == -1) images.add(absUrl)
                }
            }

            ExtractionLogger.d("[$TAG] API parsed: title=$title brand=$brand price=$price images=${images.size}")
            AjioProduct(title, brand, price, originalPrice, images.firstOrNull(), images.take(6))
        } catch (e: Exception) {
            ExtractionLogger.w("[$TAG] API JSON parse failed: ${e.message}")
            null
        }
    }

    /**
     * Fetch raw HTML from AJIO page and extract JSON-LD structured data.
     * This bypasses the WAF because HttpURLConnection doesn't carry WebView fingerprints.
     */
    private fun tryHtmlFetch(url: String): AjioProduct? {
        ExtractionLogger.d("[$TAG] Fetching HTML from $url")
        return try {
            val html = httpGet(url, acceptJson = false) ?: return null
            ExtractionLogger.d("[$TAG] HTML length: ${html.length}")

            // Check for access denied in HTML
            val lowerHtml = html.lowercase()
            if (lowerHtml.contains("<title>access denied</title>") ||
                lowerHtml.contains("request rejected") ||
                (lowerHtml.contains("access denied") && html.length < 5000)) {
                ExtractionLogger.w("[$TAG] HTML fetch returned Access Denied page")
                return null
            }

            parseHtmlJsonLD(html)
        } catch (e: Exception) {
            ExtractionLogger.w("[$TAG] HTML fetch failed: ${e.message}")
            null
        }
    }

    /**
     * Extract JSON-LD product data from raw HTML.
     * Looks for <script type="application/ld+json"> tags and finds Product objects.
     */
    private fun parseHtmlJsonLD(html: String): AjioProduct? {
        // Extract all JSON-LD script blocks
        val jsonLDBlocks = mutableListOf<String>()
        val regex = Regex("""<script[^>]+type=["']application/ld\+json["'][^>]*>(.*?)</script>""",
            setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE))
        regex.findAll(html).forEach { match ->
            jsonLDBlocks.add(match.groupValues[1].trim())
        }

        ExtractionLogger.d("[$TAG] Found ${jsonLDBlocks.size} JSON-LD blocks in HTML")

        for (block in jsonLDBlocks) {
            val product = tryParseJsonLDProduct(block) ?: continue
            return product
        }

        // Also try to find og: meta tags as fallback
        return parseOgMeta(html)
    }

    private fun tryParseJsonLDProduct(jsonStr: String): AjioProduct? {
        return try {
            val trimmed = jsonStr.trim()
            val candidates: List<JSONObject> = when {
                trimmed.startsWith("[") -> {
                    val arr = JSONArray(trimmed)
                    (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
                }
                else -> {
                    val obj = JSONObject(trimmed)
                    val graph = obj.optJSONArray("@graph")
                    if (graph != null) {
                        (0 until graph.length()).mapNotNull { graph.optJSONObject(it) }
                    } else listOf(obj)
                }
            }

            for (candidate in candidates) {
                val typeRaw = candidate.opt("@type") ?: continue
                val type = when (typeRaw) {
                    is String -> typeRaw
                    is JSONArray -> (0 until typeRaw.length()).joinToString(",") { typeRaw.optString(it) }
                    else -> ""
                }
                if (!type.lowercase().contains("product")) continue

                val title = candidate.optString("name").nullIfBlank() ?: continue
                val brand = when (val b = candidate.opt("brand")) {
                    is JSONObject -> b.optString("name").nullIfBlank() ?: "AJIO"
                    is String -> b.nullIfBlank() ?: "AJIO"
                    else -> "AJIO"
                }

                // Price from offers
                val offers = candidate.opt("offers")
                val priceStr = when (offers) {
                    is JSONObject -> offers.optString("price").nullIfBlank()
                        ?: offers.optString("lowPrice").nullIfBlank()
                    is JSONArray -> (0 until offers.length()).firstNotNullOfOrNull {
                        offers.optJSONObject(it)?.optString("price").nullIfBlank()
                    }
                    else -> null
                }
                val price = if (priceStr != null) "₹$priceStr" else "—"

                // Images
                val images = mutableListOf<String>()
                when (val imgRaw = candidate.opt("image")) {
                    is String -> if (imgRaw.startsWith("http")) images.add(imgRaw)
                    is JSONArray -> {
                        for (i in 0 until imgRaw.length()) {
                            val u = imgRaw.optString(i).nullIfBlank() ?: continue
                            if (u.startsWith("http")) images.add(u)
                        }
                    }
                    is JSONObject -> imgRaw.optString("url").nullIfBlank()?.let {
                        if (it.startsWith("http")) images.add(it)
                    }
                }

                // hasVariant images
                val variants = candidate.optJSONArray("hasVariant")
                if (variants != null) {
                    for (i in 0 until variants.length()) {
                        val v = variants.optJSONObject(i) ?: continue
                        when (val vi = v.opt("image")) {
                            is String -> if (vi.startsWith("http") && images.indexOf(vi) == -1) images.add(vi)
                            is JSONArray -> {
                                for (j in 0 until vi.length()) {
                                    val u = vi.optString(j).nullIfBlank() ?: continue
                                    if (u.startsWith("http") && images.indexOf(u) == -1) images.add(u)
                                }
                            }
                        }
                    }
                }

                // Upscale AJIO CDN images
                val upscaled = images.map { u ->
                    if (u.contains("assets.ajio.com") || u.contains("assets-jiocdn.ajio.com")) {
                        u.replace(Regex("-\\d+Wx\\d+H-", RegexOption.IGNORE_CASE), "-1117Wx1400H-")
                    } else u
                }.distinctBy { it }.take(6)

                ExtractionLogger.d("[$TAG] JSON-LD parsed: title=$title brand=$brand price=$price images=${upscaled.size}")
                return AjioProduct(title, brand, price, null, upscaled.firstOrNull(), upscaled)
            }
            null
        } catch (e: Exception) {
            ExtractionLogger.w("[$TAG] JSON-LD parse error: ${e.message}")
            null
        }
    }

    /**
     * Minimal fallback: read og:title, og:image, product:price:amount from meta tags.
     */
    private fun parseOgMeta(html: String): AjioProduct? {
        val title = metaContent(html, "og:title") ?: metaContent(html, "title") ?: return null
        if (title.lowercase().contains("access denied") || title.lowercase().contains("ajio.com | ")) return null
        val image = metaContent(html, "og:image")
        val price = metaContent(html, "product:price:amount")?.let { "₹$it" } ?: "—"
        val brand = metaContent(html, "product:brand") ?: "AJIO"
        val images = if (image != null) listOf(image) else emptyList()
        ExtractionLogger.d("[$TAG] OG meta parsed: title=$title")
        return AjioProduct(title.trim(), brand, price, null, image, images)
    }

    private fun metaContent(html: String, property: String): String? {
        val patterns = listOf(
            Regex("""<meta[^>]+property=["']${Regex.escape(property)}["'][^>]+content=["']([^"']+)["']""", RegexOption.IGNORE_CASE),
            Regex("""<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${Regex.escape(property)}["']""", RegexOption.IGNORE_CASE),
            Regex("""<meta[^>]+name=["']${Regex.escape(property)}["'][^>]+content=["']([^"']+)["']""", RegexOption.IGNORE_CASE)
        )
        for (pattern in patterns) {
            val match = pattern.find(html) ?: continue
            val value = match.groupValues[1].trim()
            if (value.isNotBlank()) return value
        }
        return null
    }

    /**
     * Perform an HTTP GET request using HttpURLConnection.
     * Returns the response body as a String, or null on error.
     */
    private fun httpGet(urlStr: String, acceptJson: Boolean): String? {
        var connection: HttpURLConnection? = null
        return try {
            val url = URL(urlStr)
            connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.setRequestProperty("User-Agent", CHROME_UA)
            connection.setRequestProperty("Accept-Language", "en-IN,en;q=0.9")
            connection.setRequestProperty("Accept-Encoding", "gzip, deflate, br")
            connection.setRequestProperty("Cache-Control", "no-cache")
            connection.setRequestProperty("Upgrade-Insecure-Requests", "1")
            connection.setRequestProperty("Sec-Fetch-Dest", "document")
            connection.setRequestProperty("Sec-Fetch-Mode", "navigate")
            connection.setRequestProperty("Sec-Fetch-Site", "none")
            if (acceptJson) {
                connection.setRequestProperty("Accept", "application/json, text/plain, */*")
            } else {
                connection.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            }
            connection.instanceFollowRedirects = true

            val responseCode = connection.responseCode
            ExtractionLogger.d("[$TAG] HTTP GET $urlStr -> $responseCode")

            if (responseCode !in 200..299) {
                ExtractionLogger.w("[$TAG] HTTP error: $responseCode for $urlStr")
                return null
            }

            // Handle gzip encoding
            val encoding = connection.contentEncoding
            val inputStream = if (encoding?.equals("gzip", ignoreCase = true) == true) {
                java.util.zip.GZIPInputStream(connection.inputStream)
            } else {
                connection.inputStream
            }

            inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } catch (e: Exception) {
            ExtractionLogger.w("[$TAG] HTTP request failed for $urlStr: ${e.message}")
            null
        } finally {
            connection?.disconnect()
        }
    }

    private fun String?.nullIfBlank(): String? =
        if (this.isNullOrBlank() || this == "null") null else this
}
