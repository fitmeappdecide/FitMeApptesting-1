import Foundation
import UIKit

/// Deterministic product extraction. Never asks an LLM to "guess" fields.
///
/// Strategy:
/// 1. **WKWebView (primary)** — a real WebKit browser loads the URL on-device,
///    executes the page's JavaScript, and we read the fully-rendered DOM
///    plus embedded JSON (`__NEXT_DATA__`, JSON-LD). This is the on-device
///    equivalent of a Playwright backend and bypasses the bot-block
///    interstitials that Myntra / Flipkart / AJIO serve to raw HTTP clients.
/// 2. **Raw HTTP fallback** — if WebView load fails, try a mobile-UA
///    `URLSession` fetch and parse `__NEXT_DATA__` / JSON-LD / OpenGraph
///    from the raw HTML.
///
/// In both modes the data comes from the page's own structured JSON, not
/// from any LLM. Hallucinated titles/prices/images are impossible here.
final class ProductExtractor {
    static let shared = ProductExtractor()

    private let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 15
        cfg.timeoutIntervalForResource = 20
        cfg.httpAdditionalHeaders = [
            "Accept-Language": "en-IN,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
        ]
        return URLSession(configuration: cfg)
    }()

    private let mobileUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

    enum ExtractionError: LocalizedError {
        case fetchFailed(Int)
        case noStructuredData
        case blocked(String)
        var errorDescription: String? {
            switch self {
            case .fetchFailed(let c): "Could not load product page (\(c))."
            case .noStructuredData:   "No structured product data found on this page."
            case .blocked(let p):     "\(p) blocked the request or is under maintenance."
            }
        }
    }

    private static let blockSignals: [String] = [
        "site maintenance", "under maintenance", "access denied",
        "just a moment", "pardon our interruption", "are you a human",
        "robot or human", "verify you are a human", "checking your browser",
        "attention required", "cloudflare", "request blocked",
        "page not found", "403 forbidden", "too many requests"
    ]

    /// Primary entry point. Runs WebView extraction first, falls back to
    /// raw HTTP parsing only if the browser path fails outright.
    func extract(from urlString: String) async throws -> FitMeAPI.ProductData {
        var validURLString = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        if !validURLString.lowercased().hasPrefix("http://") && !validURLString.lowercased().hasPrefix("https://") {
            validURLString = "https://" + validURLString
        }
        let platform = detectPlatform(from: validURLString)
        print("[FitMe] platform=\(platform) path=WebView nextData=false jsonLD=false images=0 result=START error=")

        // --- Strategy 1: real WebKit browser on-device ---
        do {
            let payload = try await WebViewExtractor.shared.extract(from: validURLString)
            // Gather payload diagnostics
            let nextDataFound = payload.nextDataJSON != nil
            let jsonLDFound = !payload.jsonLDBlobs.isEmpty
            let imagesCount = payload.imageURLs.count
            let titleFound = !(payload.title?.isEmpty ?? true)
            let priceFound = !(payload.priceText?.isEmpty ?? true)
            let sizesFound = !payload.sizes.isEmpty
            let result = "SUCCESS"
            let errorMessage = ""
            print("[FitMe] platform=\(platform) path=WebView nextData=\(nextDataFound) jsonLD=\(jsonLDFound) images=\(imagesCount) result=\(result) error=\(errorMessage)")
            
            if let product = buildProduct(from: payload, urlString: validURLString, platform: platform) {
                return product
            }
            print("[FitMe] platform=\(platform) path=WebView buildProduct returned nil — falling through to raw HTTP")
            // WebView loaded but no structured data — fall through to raw HTTP.
        } catch let error {
            // FAILURE log for WebView path
            let result = "FAIL"
            let errorMessage = "\(error)"
            print("[FitMe] platform=\(platform) path=WebView nextData=false jsonLD=false images=0 result=\(result) error=\(errorMessage)")
            // WebView load failed (network, timeout, etc.) — fall through.
        }

        // --- Strategy 2: raw HTTP HTML parse ---
        do {
            let rawProduct = try await extractFromRawHTML(urlString: validURLString, platform: platform)
            // Diagnostics for RawHTML path
            let imagesCount = rawProduct.imageURLs.count
            let titleFound = !(rawProduct.title.isEmpty)
            let priceFound = !(rawProduct.price.isEmpty)
            let sizesFound = !rawProduct.sizes.isEmpty
            let result = "SUCCESS"
            let errorMessage = ""
            print("[FitMe] platform=\(platform) path=RawHTML nextData=false jsonLD=false images=\(imagesCount) result=\(result) error=\(errorMessage)")
            return rawProduct
        } catch {
            print("[FitMe] platform=\(platform) path=RawHTML nextData=false jsonLD=false images=0 result=FAIL error=\(error)")
            throw error
        }
    }

    // MARK: - Build from WebView payload

    private func buildProduct(from payload: WebViewExtractor.ExtractedPayload,
                              urlString: String,
                              platform: String) -> FitMeAPI.ProductData? {
        let nextDataFound = payload.nextDataJSON != nil
        let jsonLDFound = !payload.jsonLDBlobs.isEmpty
        let imagesCount = payload.imageURLs.count
        let titleFound = !(payload.title?.isEmpty ?? true)
        let priceFound = !(payload.priceText?.isEmpty ?? true)
        let sizesFound = !payload.sizes.isEmpty
        let result = "SUCCESS"
        let errorMessage = ""
        print("[FitMe] platform=\(platform) path=WebView nextData=\(nextDataFound) jsonLD=\(jsonLDFound) images=\(imagesCount) result=\(result) error=\(errorMessage)")

        // Block-page sanity check on the rendered title.
        // For AJIO, skip the title-based block check when we have valid
        // structured data (JSON-LD + images) — AJIO sometimes serves product
        // pages with generic titles that false-positive on block signals.
        let hasStructuredData = jsonLDFound && imagesCount > 0
        if let t = payload.title?.lowercased() {
            for sig in Self.blockSignals where t.contains(sig) {
                if (platform == "AJIO" || platform == "H&M") && hasStructuredData {
                    print("[FitMe] \(platform) block signal '\(sig)' in title but structured data found — continuing")
                } else {
                    print("[FitMe] buildProduct REJECTED: title contains block signal '\(sig)' (title=\(payload.title ?? ""))")
                    return nil
                }
            }
        }

        // Utility to patch missing data with DOM fallbacks
        func patchWithDOM(_ p: FitMeAPI.ProductData) -> FitMeAPI.ProductData {
            var newTitle = p.title
            var newGarmentType = p.garmentType
            var newPrice = p.price
            
            if (newTitle == "Product" || newTitle.isEmpty), let domTitle = payload.title, !domTitle.isEmpty {
                newTitle = domTitle
                newGarmentType = inferGarmentType(from: domTitle + " " + (p.description ?? ""))
            }
            
            // ALWAYS prefer the DOM-extracted price if available, because JSON-LD on 
            // multi-national sites like H&M often incorrectly outputs the base EUR/USD price (e.g. "28" instead of "2899").
            if let domPriceText = payload.priceText, !domPriceText.isEmpty {
                let cleanPriceStr = domPriceText.replacingOccurrences(of: "[^0-9.]", with: "", options: .regularExpression)
                if let val = Double(cleanPriceStr), let formatted = formatPrice(val, currency: "INR") {
                    newPrice = formatted
                } else {
                    newPrice = domPriceText
                }
            } else if newPrice == "—" || newPrice.isEmpty {
                newPrice = "—"
            }
            
            return FitMeAPI.ProductData(
                title: newTitle,
                brand: p.brand,
                platform: p.platform,
                price: newPrice,
                originalPrice: p.originalPrice,
                discountPercent: p.discountPercent,
                sizes: p.sizes,
                garmentType: newGarmentType,
                description: p.description,
                fabricType: p.fabricType,
                dominantColors: p.dominantColors,
                imageURL: p.imageURL,
                imageURLs: p.imageURLs
            )
        }

        // 1. JSON-LD Product schema — covers Amazon, Flipkart, Zara, H&M, Shopify, etc.
        for blob in payload.jsonLDBlobs {
            if let p = parseJSONLDBlob(blob, platform: platform,
                                       renderedImages: payload.imageURLs) {
                return patchWithDOM(p)
            }
        }

        // 2. __NEXT_DATA__ (Myntra) — most accurate.
        if platform == "Myntra", let nd = payload.nextDataJSON,
           let p = parseMyntraNextData(jsonString: nd, platform: platform,
                                        renderedImages: payload.imageURLs) {
            return patchWithDOM(p)
        }

        // 3. Generic __NEXT_DATA__ tree walk for non-Myntra Next.js sites.
        if let nd = payload.nextDataJSON,
           let p = parseGenericNextData(jsonString: nd, platform: platform,
                                        renderedImages: payload.imageURLs) {
            return patchWithDOM(p)
        }

        // 4. DOM + meta fallback (still deterministic, no LLM).
        guard let title = payload.title, !title.isEmpty else {
            print("[FitMe] buildProduct REJECTED: no title found")
            return nil
        }
        let images = filteredImages(payload.imageURLs, platform: platform)
        let cleanPriceStr = payload.priceText?.replacingOccurrences(of: "[^0-9.]", with: "", options: .regularExpression)
        let price = cleanPriceStr.flatMap { Double($0) }.flatMap { formatPrice($0, currency: "INR") } ?? "—"
        return FitMeAPI.ProductData(
            title: title,
            brand: payload.brand ?? platform,
            platform: platform,
            price: price,
            originalPrice: nil,
            discountPercent: 0,
            sizes: ["S", "M", "L", "XL", "XXL"],
            garmentType: inferGarmentType(from: title + " " + (payload.description ?? "")),
            description: payload.description,
            fabricType: nil,
            dominantColors: [],
            imageURL: images.first,
            imageURLs: Array(images.prefix(2))
        )
    }



    // MARK: - Myntra __NEXT_DATA__

    private func parseMyntraNextData(jsonString: String, platform: String,
                                     renderedImages: [String]) -> FitMeAPI.ProductData? {
        guard let data = jsonString.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        guard let blob = findProductBlob(in: root) else { return nil }

        let title = (blob["name"] as? String)
            ?? (blob["title"] as? String)
            ?? (blob["productName"] as? String)
            ?? "Product"
        let brand = (blob["brand"] as? String)
            ?? (blob["brandName"] as? String)
            ?? ((blob["brandInfo"] as? [String: Any])?["name"] as? String)
            ?? platform

        var imageURLs: [String] = []
        if let media = blob["media"] as? [String: Any], let albums = media["albums"] as? [[String: Any]] {
            for album in albums {
                if let images = album["images"] as? [[String: Any]] {
                    for img in images {
                        if let s = (img["src"] as? String) ?? (img["imageURL"] as? String) {
                            imageURLs.append(upscaleMyntraImage(s))
                        }
                    }
                }
            }
        }
        if imageURLs.isEmpty, let images = blob["images"] as? [[String: Any]] {
            for img in images {
                if let s = (img["src"] as? String) ?? (img["imageURL"] as? String) ?? (img["url"] as? String) {
                    imageURLs.append(upscaleMyntraImage(s))
                }
            }
        }
        // Merge in any rendered-DOM images only if we couldn't find any in __NEXT_DATA__.
        if imageURLs.isEmpty {
            for img in renderedImages where !imageURLs.contains(img) {
                imageURLs.append(img)
            }
        }
        imageURLs = filteredImages(imageURLs, platform: platform)

        var price = "—"
        var originalPrice: String?
        var discount = 0
        if let priceBlock = blob["price"] as? [String: Any] {
            if let discounted = priceBlock["discounted"] as? Double { price = formatRupees(discounted) }
            else if let p = priceBlock["price"] as? Double { price = formatRupees(p) }
            if let mrp = priceBlock["mrp"] as? Double { originalPrice = formatRupees(mrp) }
            if let d = priceBlock["discount"] as? [String: Any], let pct = d["discountPercent"] as? Double {
                discount = Int(pct)
            }
        } else if let mrp = blob["mrp"] as? Double {
            originalPrice = formatRupees(mrp)
            if let dp = blob["discountedPrice"] as? Double {
                price = formatRupees(dp)
                discount = mrp > 0 ? Int(((mrp - dp) / mrp) * 100) : 0
            }
        }

        var sizes: [String] = []
        if let sizesBlock = blob["sizes"] as? [[String: Any]] {
            sizes = sizesBlock.compactMap { ($0["label"] as? String) ?? ($0["sizeName"] as? String) }
        } else if let sku = blob["skus"] as? [[String: Any]] {
            sizes = sku.compactMap { $0["label"] as? String }
        }
        if sizes.isEmpty { sizes = ["S", "M", "L", "XL", "XXL"] }

        return FitMeAPI.ProductData(
            title: title, brand: brand, platform: platform, price: price,
            originalPrice: originalPrice, discountPercent: discount, sizes: sizes,
            garmentType: inferGarmentType(from: title),
            description: blob["description"] as? String,
            fabricType: nil, dominantColors: [],
            imageURL: imageURLs.first,
            imageURLs: Array(imageURLs.prefix(2))
        )
    }

    private func parseGenericNextData(jsonString: String, platform: String,
                                       renderedImages: [String]) -> FitMeAPI.ProductData? {
        guard let data = jsonString.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let blob = findProductBlob(in: root) else { return nil }
        let title = (blob["name"] as? String) ?? (blob["title"] as? String) ?? (blob["productName"] as? String) ?? "Product"
        let brand = (blob["brand"] as? String) ?? (blob["brandName"] as? String) ?? platform
        var images: [String] = []
        if let arr = blob["images"] as? [[String: Any]] {
            images = arr.compactMap { ($0["src"] as? String) ?? ($0["url"] as? String) }
        } else if let arr = blob["images"] as? [String] {
            images = arr
        }
        for img in renderedImages where !images.contains(img) { images.append(img) }
        images = filteredImages(images, platform: platform)
        return FitMeAPI.ProductData(
            title: title, brand: brand, platform: platform,
            price: (blob["price"] as? Double).flatMap { formatRupees($0) } ?? "—",
            originalPrice: nil, discountPercent: 0,
            sizes: ["S","M","L","XL","XXL"],
            garmentType: inferGarmentType(from: title),
            description: blob["description"] as? String,
            fabricType: nil, dominantColors: [],
            imageURL: images.first, imageURLs: Array(images.prefix(2))
        )
    }

    private func findProductBlob(in node: Any) -> [String: Any]? {
        if let dict = node as? [String: Any] {
            let hasName = dict["name"] != nil || dict["productName"] != nil || dict["title"] != nil
            let hasImages = dict["images"] is [Any] || dict["media"] is [String: Any]
            let hasPrice = dict["price"] != nil || dict["mrp"] != nil || dict["discountedPrice"] != nil
            if hasName && (hasImages || hasPrice) {
                return dict
            }
            for (_, v) in dict {
                if let found = findProductBlob(in: v) { return found }
            }
        } else if let arr = node as? [Any] {
            for item in arr {
                if let found = findProductBlob(in: item) { return found }
            }
        }
        return nil
    }

    private func upscaleMyntraImage(_ url: String) -> String {
        var out = url
        // Normalize any Myntra image to the high-res h_1440,w_1080 version.
        // This also strips f_webp/, fl_progressive/, etc. so identical images dedup correctly.
        if let range = out.range(of: "assets/images/") {
            let path = out[range.lowerBound...]
            return "https://assets.myntassets.com/h_1440,q_75,w_1080/\(path)"
        }
        return out
    }

    private func upscaleNykaaImage(_ url: String) -> String {
        var out = url
        
        // 1️⃣ Remove path-style transforms entirely (e.g., /tr:h-400,w-300,cm-pad_resize/)
        // This gives us the unpadded original high-res image
        if let regex = try? NSRegularExpression(pattern: "/tr:[^/]+/", options: .caseInsensitive) {
            let range = NSRange(out.startIndex..., in: out)
            out = regex.stringByReplacingMatches(in: out, range: range, withTemplate: "/")
        }
        
        // 2️⃣ Remove query-style transforms entirely using URLComponents
        if var components = URLComponents(string: out) {
            if let queryItems = components.queryItems {
                let filteredItems = queryItems.filter { $0.name.lowercased() != "tr" }
                components.queryItems = filteredItems.isEmpty ? nil : filteredItems
                if let safeURL = components.string {
                    out = safeURL
                }
            }
        }
        
        return out
    }


    private func upscaleLifestyleImage(_ url: String) -> String {
        var out = url
        // Replace small dimensions like h=150,w=150 or h=730,w=540 with w=1080 to fetch the highest quality version
        // This also normalizes the URL so duplicate images are caught
        // We also inject f=jpeg to force Cloudflare to return a JPEG instead of WEBP, which fixes rendering issues on iOS.
        if let regex = try? NSRegularExpression(pattern: "(h=\\d+,)?w=\\d+", options: .caseInsensitive) {
            let range = NSRange(out.startIndex..., in: out)
            out = regex.stringByReplacingMatches(in: out, range: range, withTemplate: "w=1080,f=jpeg")
        }
        return out
    }

    // MARK: - JSON-LD parsing

    private func parseJSONLDBlob(_ raw: String, platform: String,
                                  renderedImages: [String]) -> FitMeAPI.ProductData? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = trimmed.data(using: .utf8) else { return nil }
        let candidates: [Any] = (try? JSONSerialization.jsonObject(with: data, options: [.allowFragments])).map { obj in
            if let arr = obj as? [Any] { return arr }
            if let graph = (obj as? [String: Any])?["@graph"] as? [Any] { return graph }
            return [obj]
        } ?? []

        for candidate in candidates {
            guard let dict = candidate as? [String: Any] else { continue }
            let type = (dict["@type"] as? String) ?? ((dict["@type"] as? [String])?.first ?? "")
            guard type.lowercased().contains("product") else { continue }

            let title = (dict["name"] as? String) ?? "Product"
            let brandName: String
            if let brand = dict["brand"] as? [String: Any] {
                brandName = (brand["name"] as? String) ?? platform
            } else if let brand = dict["brand"] as? String {
                brandName = brand
            } else {
                brandName = platform
            }

            var images: [String] = []
            if let s = dict["image"] as? String { images = [s] }
            else if let arr = dict["image"] as? [String] { images = arr }
            else if let arr = dict["image"] as? [[String: Any]] {
                images = arr.compactMap { $0["url"] as? String }
            }
            for img in renderedImages where !images.contains(img) { images.append(img) }
            images = filteredImages(images, platform: platform)

            var price = "—"
            var originalPrice: String?
            var discount = 0
            if let offers = dict["offers"] as? [String: Any] {
                price = formatPrice(offers["price"]) ?? "—"
                if let highPrice = offers["highPrice"] { originalPrice = formatPrice(highPrice) }
                if let lowPrice = offers["lowPrice"] { price = formatPrice(lowPrice) ?? price }
            } else if let offersArr = dict["offers"] as? [[String: Any]], let first = offersArr.first {
                price = formatPrice(first["price"]) ?? "—"
            }
            if let op = originalPrice, let opVal = priceValue(op), let pVal = priceValue(price), opVal > pVal {
                discount = Int(((opVal - pVal) / opVal) * 100)
            }

            let sizes = extractSizes(from: dict) ?? ["S", "M", "L", "XL", "XXL"]
            let description = dict["description"] as? String
            return FitMeAPI.ProductData(
                title: title, brand: brandName, platform: platform, price: price,
                originalPrice: originalPrice, discountPercent: discount, sizes: sizes,
                garmentType: inferGarmentType(from: title + " " + (description ?? "")),
                description: description,
                fabricType: dict["material"] as? String, dominantColors: [],
                imageURL: images.first, imageURLs: Array(images.prefix(2))
            )
        }
        return nil
    }

    private func extractSizes(from dict: [String: Any]) -> [String]? {
        func dedup(_ sizes: [String]) -> [String] {
            var seen = Set<String>()
            return sizes.filter { seen.insert($0).inserted }
        }
        if let sizes = dict["size"] as? [String] { return dedup(sizes) }
        if let s = dict["size"] as? String { 
            return dedup(s.components(separatedBy: CharacterSet(charactersIn: ",;|")).map { $0.trimmingCharacters(in: .whitespaces) })
        }
        if let variants = dict["hasVariant"] as? [[String: Any]] {
            let s = variants.compactMap { $0["size"] as? String }
            if !s.isEmpty { return dedup(s) }
        }
        return nil
    }

    // MARK: - Image filtering

    /// Keeps only plausible product/model images. Drops sprites, icons,
    /// logos, and tiny thumbnails. Prefers larger images first.
    private func filteredImages(_ urls: [String], platform: String) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        var ajioFilenameToIndex: [String: Int] = [:]
        var ajioFilenameScores: [String: Int] = [:]
        var myntraDirectory: String? = nil
        var hmPathToIndex: [String: Int] = [:]
        var hmPathWidths: [String: Int] = [:]
        
        print("[FILTER] ── filteredImages called with \(urls.count) raw URLs ──")
        for (i, raw) in urls.enumerated() {
            print("[RAW IMAGE \(i)] \(raw)")
        }
        
        for raw in urls {
            // Step 1: Normalise the scheme.
            var normalized: String
            if raw.hasPrefix("//") {
                normalized = "https:" + raw
            } else if platform == "Myntra" && (raw.hasPrefix("fl_progressive/") || raw.hasPrefix("f_webp/")) {
                normalized = "https://assets.myntassets.com/" + raw
            } else {
                normalized = raw
            }
            
            // Upscaling before any guards
            if platform == "Nykaa" {
                normalized = upscaleNykaaImage(normalized)
            } else if platform == "Lifestyle" {
                normalized = upscaleLifestyleImage(normalized)
            }
            
            // AJIO specific handling
            var ajioID: String? = nil
            if platform == "AJIO" {
                // Replace existing dimensions
                if let regex = try? NSRegularExpression(pattern: #"-\d+Wx\d+H-"#, options: .caseInsensitive) {
                    let range = NSRange(normalized.startIndex..., in: normalized)
                    normalized = regex.stringByReplacingMatches(in: normalized, range: range, withTemplate: "-1117Wx1400H-")
                }
                
                // 2. Extract 24-character MongoDB ObjectID (using robust lookahead to support any separator: /, -, _)
                if let idRegex = try? NSRegularExpression(pattern: #"(?<=/)([a-fA-F0-9]{24})(?=[-_/])"#, options: .caseInsensitive),
                   let match = idRegex.firstMatch(in: normalized, range: NSRange(normalized.startIndex..., in: normalized)),
                   let r = Range(match.range(at: 1), in: normalized) {
                    let id = String(normalized[r])
                    ajioID = id
                    
                    // 3. Inject dimensions if missing (e.g. for metadata/og:images that have no dimensions)
                    if !normalized.contains("\(id)/-1117Wx1400H-") &&
                       !normalized.contains("\(id)-1117Wx1400H-") &&
                       !normalized.contains("\(id)_-1117Wx1400H-") {
                        normalized = normalized.replacingOccurrences(of: "\(id)/", with: "\(id)/-1117Wx1400H-")
                        normalized = normalized.replacingOccurrences(of: "\(id)-", with: "\(id)-1117Wx1400H-")
                        normalized = normalized.replacingOccurrences(of: "\(id)_", with: "\(id)_-1117Wx1400H-")
                    }
                }
            }

            if platform == "AJIO" {
                // Whitelist: AJIO product images always live under medias/sys_master.
                // CMS banners (/cms/), static assets (/static/), and promotional
                // images do NOT contain this path segment.
                guard normalized.lowercased().contains("medias/sys_master") else {
                    print("[REJECTED] \(raw)\n  Reason: ajio_not_product_media (missing medias/sys_master)")
                    continue
                }

                // --- Filename-based dedup ---
                // AJIO serves the same photo (e.g. MODEL.jpg) under multiple
                // MongoDB IDs at different resolutions (78px thumbnail vs 473px
                // main image). The -1117Wx1400H- dimension rewrite only works
                // properly when the source is already high-res. So we group by
                // the filename part (e.g. "701005612-white-MODEL.jpg"), and keep
                // only the URL whose ORIGINAL resolution was highest.
                // Different angles (MODEL2, MODEL3, etc.) have different filenames
                // so they survive as separate, distinct images.
                let originalWidth: Int
                if let dimRegex = try? NSRegularExpression(pattern: #"-(\d+)Wx\d+H-"#),
                   let dimMatch = dimRegex.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)),
                   let wRange = Range(dimMatch.range(at: 1), in: raw),
                   let w = Int(raw[wRange]) {
                    originalWidth = w
                } else {
                    originalWidth = 100  // og:image or no dimension → low priority
                }

                // Extract the filename after the last "/" and strip the dimension prefix
                let lastComponent = String(normalized.split(separator: "/").last ?? "")
                var baseFilename = lastComponent
                if let stripRegex = try? NSRegularExpression(pattern: #"^-\d+Wx\d+H-"#) {
                    let range = NSRange(baseFilename.startIndex..., in: baseFilename)
                    baseFilename = stripRegex.stringByReplacingMatches(in: baseFilename, range: range, withTemplate: "")
                }

                if let existingIdx = ajioFilenameToIndex[baseFilename] {
                    let existingScore = ajioFilenameScores[baseFilename] ?? 0
                    if originalWidth > existingScore {
                        // This source is higher quality — replace the blurry thumbnail
                        let oldURL = out[existingIdx]
                        out[existingIdx] = normalized
                        seen.remove(oldURL)
                        seen.insert(normalized)
                        ajioFilenameScores[baseFilename] = originalWidth
                        print("[AJIO DEDUP] Upgraded \(baseFilename): \(originalWidth)px > \(existingScore)px")
                    } else {
                        print("[AJIO DEDUP] Dropped lower-quality duplicate \(baseFilename): \(originalWidth)px <= \(existingScore)px")
                    }
                    continue  // either way, don't add a second entry
                }
                ajioFilenameToIndex[baseFilename] = out.count
                ajioFilenameScores[baseFilename] = originalWidth
            }

            // Duplicate guard
            guard !seen.contains(normalized) else {
                print("[REJECTED] \(raw)\n  Reason: duplicate_guard")
                continue
            }

            let lower = normalized.lowercased()

            // Scheme guard – after normalisation every valid URL must start with http(s).
            guard lower.hasPrefix("http://") || lower.hasPrefix("https://") else {
                print("[REJECTED] \(raw)\n  Reason: scheme_guard (no http/https prefix, normalized=\(normalized))")
                continue
            }

            // pdp_loader guard
            if lower.contains("pdp_loader") {
                print("[REJECTED] \(raw)\n  Reason: pdp_loader_guard")
                continue
            }

            // checkout/assets guard
            if lower.contains("checkout/assets") {
                print("[REJECTED] \(raw)\n  Reason: checkout_assets_guard")
                continue
            }

            // Small-dimension guard — applies only to Myntra where w_1080 indicates high-res product images.
            if platform == "Myntra" {
                let smallWidths = [",w_50,", ",w_100,", ",w_150,", ",w_200,",
                                   ",w_250,", ",w_300,", ",w_400,", ",w_500,",
                                   "/w_50/", "/w_100/", "/w_150/", "/w_200/",
                                   "/w_250/", "/w_300/", "/w_400/", "/w_500/"]
                if let hit = smallWidths.first(where: { lower.contains($0) }) {
                    print("[REJECTED] \(raw)\n  Reason: small_dimension_guard (matched: \"\(hit)\")")
                    continue
                }
            }

            // Bad keyword guard
            let bad = [
                "logo", "icon", "sprite", "favicon", "placeholder",
                "/banner", "_banner", "tax-banner", "tax_banner", "promo-banner",
                "promo_banner", "discount-banner", "discount_banner", "info-banner",
                "info_banner", "header-banner", "header_banner", "home-banner",
                "home_banner", "main-banner", "main_banner", "hero-banner",
                "hero_banner", "/header", "social", "share", "rating", "star",
                "loading", "spinner", "blank", "size-chart", "sizechart",
                "size_chart", "size-guide", "sizeguide", "size_guide", "tax",
                "free-delivery", "free_delivery", "easy-return", "easy-returns",
                "easy_return", "easy_returns", "authentic-badge", "trust-badge",
                "/cms/", "/static/img", "dealrefresh", "sticky", "amazonstores",
                "download", "promo", "offer", "coupon", "flat-off", "app-install",
                "install-app", "nykaa-app", "nfea", "cod-banner", "cashback"
            ]
            if let hit = bad.first(where: { lower.contains($0) }) {
                print("[REJECTED] \(raw)\n  Reason: bad_keyword_guard (matched: \"\(hit)\")")
                continue
            }

            // Nykaa: reject images-static.nykaa.com/uploads/ — these are site-wide
            // marketing/promo banners, NOT product images
            if platform == "Nykaa" && lower.contains("images-static.nykaa.com/uploads/") {
                print("[REJECTED] \(raw)\n  Reason: nykaa_promo_banner_guard")
                continue
            }

            // Compute final URL (including upscale if needed) before duplicate check
            let finalURL: String
            if platform == "Nykaa" {
                finalURL = upscaleNykaaImage(normalized)
            } else if platform == "Lifestyle" {
                finalURL = upscaleLifestyleImage(normalized)
            } else if platform == "Myntra" {
                finalURL = upscaleMyntraImage(normalized)
            } else {
                finalURL = normalized
            }
            
            // Myntra strict directory guard: ensure all accepted images belong to the same product directory
            if platform == "Myntra" {
                if let range = finalURL.range(of: "assets/images/") {
                    let pathAfter = finalURL[range.upperBound...]
                    if let lastSlash = pathAfter.lastIndex(of: "/") {
                        let directory = String(pathAfter[..<lastSlash])
                        
                        if myntraDirectory == nil {
                            myntraDirectory = directory
                        } else if myntraDirectory != directory {
                            print("[REJECTED] \(raw)\n  Reason: myntra_directory_mismatch (\(directory) != \(myntraDirectory!))")
                            continue
                        }
                    }
                }
            }
            
            // H&M dedup: same image is served at multiple ?imwidth= values.
            // Normalise by stripping that param and keep only the highest-res copy.
            if platform == "H&M", lower.contains("image.hm.com") {
                // Extract the path component (before any '?')
                let pathKey = finalURL.components(separatedBy: "?").first ?? finalURL
                // Parse current imwidth
                let curWidth: Int
                if let wRange = finalURL.range(of: "imwidth="),
                   let val = Int(finalURL[wRange.upperBound...].prefix(while: { $0.isNumber })) {
                    curWidth = val
                } else {
                    curWidth = 0
                }
                if let existingIdx = hmPathToIndex[pathKey] {
                    let existingWidth = hmPathWidths[pathKey] ?? 0
                    if curWidth > existingWidth {
                        // Higher res — replace the existing entry
                        let oldURL = out[existingIdx]
                        out[existingIdx] = finalURL
                        seen.remove(oldURL)
                        seen.insert(finalURL)
                        hmPathWidths[pathKey] = curWidth
                        print("[HM DEDUP] Upgraded \(pathKey): \(curWidth)px > \(existingWidth)px")
                    } else {
                        print("[HM DEDUP] Dropped lower-res duplicate \(pathKey): \(curWidth)px <= \(existingWidth)px")
                    }
                    continue
                }
                hmPathToIndex[pathKey] = out.count
                hmPathWidths[pathKey] = curWidth
            }

            // Duplicate guard – use finalURL for uniqueness
            guard !seen.contains(finalURL) else {
                print("[REJECTED] \(raw)\n  Reason: duplicate_guard")
                continue
            }
            // Add to output
            seen.insert(finalURL)
            out.append(finalURL)
            print("[ACCEPTED] \(raw)")
            // End of loop iteration

        }

        print("[FILTER] Input count: \(urls.count)  Accepted count: \(out.count)")
        return out
    }



    // MARK: - Raw HTTP fallback

    private func extractFromRawHTML(urlString: String, platform: String) async throws -> FitMeAPI.ProductData {
        guard let url = URL(string: urlString) else { throw ExtractionError.fetchFailed(0) }
        var req = URLRequest(url: url)
        req.setValue(mobileUA, forHTTPHeaderField: "User-Agent")
        req.setValue("en-IN,en;q=0.9", forHTTPHeaderField: "Accept-Language")
        req.setValue("\"iOS\"", forHTTPHeaderField: "sec-ch-ua-platform")
        req.setValue("?1", forHTTPHeaderField: "sec-ch-ua-mobile")

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw ExtractionError.fetchFailed(0) }
        guard (200..<400).contains(http.statusCode) else { throw ExtractionError.fetchFailed(http.statusCode) }
        guard let html = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
            throw ExtractionError.noStructuredData
        }

        // Block-page check – skip for H&M and Meesho (rely on other extraction methods)
        if platform != "H&M" && platform != "Meesho" {
            let lowerTitle = (firstCapture(html: html, pattern: #"<title[^>]*>([^<]+)</title>"#) ?? "").lowercased()
            for sig in Self.blockSignals where lowerTitle.contains(sig) {
                print("[FitMe] RawHTML BLOCKED: title contains '\(sig)' (title=\(lowerTitle))")
                throw ExtractionError.blocked(platform)
            }
        }
        if html.count < 8000 && platform != "H&M" && platform != "Meesho" {
            let body = html.lowercased()
            for sig in Self.blockSignals where body.contains(sig) {
                print("[FitMe] RawHTML BLOCKED: body (\(html.count) chars) contains '\(sig)'")
                throw ExtractionError.blocked(platform)
            }
        }

        // Extract all Myntra image URLs embedded anywhere in the raw HTML
        // (inside JSON strings, srcset attributes, img tags, etc.)
        // These are passed as renderedImages so parseMyntraNextData can merge them
        // with any images found in __NEXT_DATA__, giving us the full set.
        var scrapedImages: [String] = []
        if platform == "Myntra" {
            let imgPattern = #"https://assets\.myntassets\.com/[^"'\s\\)>]+"#
            if let regex = try? NSRegularExpression(pattern: imgPattern) {
                let nsHtml = html as NSString
                let fullRange = NSRange(html.startIndex..., in: html)
                let matches = regex.matches(in: html, range: fullRange)
                for m in matches {
                    var rawURL = nsHtml.substring(with: m.range)
                    // Strip trailing punctuation that regex may have captured
                    while let last = rawURL.last, ".,;\"'\\)]>".contains(last) {
                        rawURL = String(rawURL.dropLast())
                    }
                    if !scrapedImages.contains(rawURL) {
                        scrapedImages.append(rawURL)
                    }
                }
            }
            print("[FitMe] RawHTML scraped \(scrapedImages.count) myntassets URLs from page body")
        }

        // __NEXT_DATA__ extraction from raw HTML.
        if platform == "Myntra",
           let range = html.range(of: #"<script id="__NEXT_DATA__"[^>]*>"#, options: .regularExpression),
           let end = html.range(of: "</script>", range: range.upperBound..<html.endIndex) {
            let jsonString = String(html[range.upperBound..<end.lowerBound])
            if let p = parseMyntraNextData(jsonString: jsonString, platform: platform, renderedImages: scrapedImages) {
                return p
            }
        }

        // JSON-LD scripts in raw HTML.
        let scripts = extractScripts(matching: #"<script[^>]+type=["']application/ld\+json["'][^>]*>"#, html: html)
        for raw in scripts {
            if let p = parseJSONLDBlob(raw, platform: platform, renderedImages: scrapedImages) {
                return p
            }
        }

        // OpenGraph last-resort.
        if let title = metaContent(html: html, property: "og:title") ?? titleTag(html: html), !title.isEmpty {
            let lower = title.lowercased()
            for sig in Self.blockSignals where lower.contains(sig) { throw ExtractionError.blocked(platform) }
            let imageURL = metaContent(html: html, property: "og:image") ?? metaContent(html: html, name: "twitter:image")
            let description = metaContent(html: html, property: "og:description") ?? metaContent(html: html, name: "description")
            let brand = metaContent(html: html, property: "product:brand") ?? metaContent(html: html, property: "og:site_name") ?? platform
            let images = imageURL.map { [$0] } ?? []
            return FitMeAPI.ProductData(
                title: title, brand: brand, platform: platform, price: "—",
                originalPrice: nil, discountPercent: 0,
                sizes: ["S","M","L","XL","XXL"],
                garmentType: inferGarmentType(from: title + " " + (description ?? "")),
                description: description, fabricType: nil, dominantColors: [],
                imageURL: images.first, imageURLs: Array(images.prefix(2))
            )
        }
        throw ExtractionError.noStructuredData
    }

    // MARK: - Helpers

    private func extractScripts(matching pattern: String, html: String) -> [String] {
        var results: [String] = []
        var searchRange = html.startIndex..<html.endIndex
        while let openRange = html.range(of: pattern, options: .regularExpression, range: searchRange),
              let closeRange = html.range(of: "</script>", range: openRange.upperBound..<html.endIndex) {
            results.append(String(html[openRange.upperBound..<closeRange.lowerBound]))
            searchRange = closeRange.upperBound..<html.endIndex
        }
        return results
    }

    private func metaContent(html: String, property: String) -> String? {
        let pattern = #"<meta[^>]+property=["']\#(property)["'][^>]*content=["']([^"']+)["']"#
        if let value = firstCapture(html: html, pattern: pattern) { return value }
        let alt = #"<meta[^>]+content=["']([^"']+)["'][^>]*property=["']\#(property)["']"#
        return firstCapture(html: html, pattern: alt)
    }

    private func metaContent(html: String, name: String) -> String? {
        let pattern = #"<meta[^>]+name=["']\#(name)["'][^>]*content=["']([^"']+)["']"#
        if let value = firstCapture(html: html, pattern: pattern) { return value }
        let alt = #"<meta[^>]+content=["']([^"']+)["'][^>]*name=["']\#(name)["']"#
        return firstCapture(html: html, pattern: alt)
    }

    private func titleTag(html: String) -> String? {
        firstCapture(html: html, pattern: #"<title[^>]*>([^<]+)</title>"#)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func firstCapture(html: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) else {
            return nil
        }
        let range = NSRange(html.startIndex..., in: html)
        guard let match = regex.firstMatch(in: html, range: range), match.numberOfRanges >= 2,
              let r = Range(match.range(at: 1), in: html) else { return nil }
        return decodeHTMLEntities(String(html[r]))
    }

    private func decodeHTMLEntities(_ s: String) -> String {
        var out = s
        let map: [(String, String)] = [
            ("&amp;", "&"), ("&quot;", "\""), ("&#39;", "'"), ("&apos;", "'"),
            ("&lt;", "<"), ("&gt;", ">"), ("&nbsp;", " "), ("&#8377;", "₹"),
            ("&rsquo;", "’"), ("&lsquo;", "‘"), ("&ndash;", "–"), ("&mdash;", "—")
        ]
        for (k, v) in map { out = out.replacingOccurrences(of: k, with: v) }
        return out
    }

    private func formatPrice(_ raw: Any?, currency: String? = nil) -> String? {
        guard let raw else { return nil }
        let value: Double?
        if let d = raw as? Double { value = d }
        else if let i = raw as? Int { value = Double(i) }
        else if let s = raw as? String { value = Double(s.replacingOccurrences(of: ",", with: "")) }
        else { value = nil }
        guard let v = value else { return nil }
        return formatPrice(v, currency: currency)
    }

    private func formatPrice(_ value: Double, currency: String?) -> String? {
        let symbol: String = {
            switch (currency ?? "INR").uppercased() {
            case "INR": return "₹"
            case "USD": return "$"
            case "EUR": return "€"
            case "GBP": return "£"
            default: return "₹"
            }
        }()
        let intVal = Int(value.rounded())
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = ","
        let s = formatter.string(from: NSNumber(value: intVal)) ?? "\(intVal)"
        return "\(symbol)\(s)"
    }

    private func formatRupees(_ v: Double) -> String {
        formatPrice(v, currency: "INR") ?? "₹\(Int(v))"
    }

    private func priceValue(_ s: String) -> Double? {
        let cleaned = s.filter { "0123456789.".contains($0) }
        return Double(cleaned)
    }

    private func inferGarmentType(from text: String) -> String {
        let l = text.lowercased()
        let map: [(String, String)] = [
            ("t-shirt", "tshirt"), ("tshirt", "tshirt"), ("tee", "tshirt"),
            ("shirt", "shirt"), ("kurta", "kurta"), ("kurti", "kurta"),
            ("saree", "saree"), ("sari", "saree"),
            ("lehenga", "lehenga"), ("gown", "dress"), ("dress", "dress"),
            ("jeans", "jeans"), ("trouser", "pants"), ("pants", "pants"),
            ("chinos", "pants"), ("shorts", "shorts"),
            ("hoodie", "hoodie"), ("sweatshirt", "hoodie"),
            ("jacket", "jacket"), ("blazer", "jacket"),
            ("skirt", "skirt"), ("top", "top"), ("blouse", "top")
        ]
        for (k, v) in map { if l.contains(k) { return v } }
        return "garment"
    }
    private func detectPlatform(from url: String) -> String {
        let l = url.lowercased()
        if l.contains("myntra") { return "Myntra" }
        if l.contains("amazon") { return "Amazon" }
        if l.contains("flipkart") { return "Flipkart" }
        if l.contains("ajio") { return "AJIO" }
        if l.contains("meesho") { return "Meesho" }
        if l.contains("zara") { return "Zara" }
        if l.contains("hm.com") || l.contains("h&m") { return "H&M" }
        if l.contains("nykaa") { return "Nykaa" }
        if l.contains("tatacliq") { return "TataCliq" }
        if l.contains("bewakoof") { return "Bewakoof" }
        if l.contains("snapdeal") { return "Snapdeal" }
        if l.contains("asos") { return "ASOS" }
        if l.contains("lifestylestores") || l.contains("landmarkshops") { return "Lifestyle" }
        return "Online Store"
    }
}
