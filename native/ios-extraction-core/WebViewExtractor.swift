import Foundation
import WebKit
import UIKit

/// Headless WKWebView-based product extractor. This is the on-device
/// equivalent of running Playwright on a server: a real WebKit browser
/// loads the page, executes JavaScript, and we read the fully-rendered
/// DOM / embedded JSON.
///
/// This is the primary extraction path for Myntra, Flipkart, AJIO, Meesho —
/// platforms that block raw HTTP fetches but serve normally to a real
/// mobile browser. No LLM is involved; all data comes from the page's
/// own structured JSON (`__NEXT_DATA__`, JSON-LD `Product`) or DOM.
@MainActor
final class WebViewExtractor: NSObject {
    static let shared = WebViewExtractor()

    private var webView: WKWebView?
    private var continuation: CheckedContinuation<ExtractedPayload, Error>?
    private var loadTimeoutTask: Task<Void, Never>?
    private var hasResumed = false
    private var isExtracting = false
    private var pendingJSRequest: PendingJSRequest?
    // Store the URL being processed for logging
    private var currentURLString: String?
    // Track extraction attempt (1-3)
    private var currentAttempt: Int = 1

    // ─── Serial extraction queue ──────────────────────────────────────────────
    // When resolveLiveExactPrices() fires two concurrent extractProductFromUrl()
    // calls (e.g. Nykaa + thehouseofrare), both eventually reach
    // WebViewExtractor.shared.extract(). Without serialisation the second call
    // overwrites self.continuation / self.webView / self.hasResumed, so Nykaa's
    // HTTP-403 failure can resume thehouseofrare's continuation with an error.
    //
    // The fix: acquireQueue() makes the second caller suspend until the first
    // has called releaseQueue() inside its defer block — meaning ALL self.*
    // state has been cleaned up by finish(). The two extractions therefore run
    // one after the other with no shared mutable state in flight simultaneously.
    private var operationQueue: [CheckedContinuation<Void, Never>] = []
    private var isRunningOperation = false

    /// Suspend until it is this caller's turn to use the extractor.
    private func acquireQueue() async {
        if !isRunningOperation {
            isRunningOperation = true
            return
        }
        await withCheckedContinuation { (waiter: CheckedContinuation<Void, Never>) in
            operationQueue.append(waiter)
        }
    }

    /// Hand ownership to the next queued caller, or mark the extractor idle.
    private func releaseQueue() {
        if let next = operationQueue.first {
            operationQueue.removeFirst()
            next.resume()         // wake the next waiting extract() call
        } else {
            isRunningOperation = false
        }
    }

    // Simple platform detection mirroring ProductExtractor.detectPlatform
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
        return "Online Store"
    }

    struct ExtractedPayload: Sendable {
        let title: String?
        let brand: String?
        let priceText: String?
        let originalPriceText: String?
        let discountPercent: Int
        let sizes: [String]
        let description: String?
        let imageURLs: [String]
        let nextDataJSON: String?
        let jsonLDBlobs: [String]
    }

    enum WebError: LocalizedError {
        case timeout
        case noData
        case loadFailed(String)
        var errorDescription: String? {
            switch self {
            case .timeout: "Page took too long to load."
            case .noData: "No product data found on the page."
            case .loadFailed(let m): "Page load failed: \(m)"
            }
        }
    }

    func extract(from urlString: String, timeoutSeconds: Double = 15) async throws -> ExtractedPayload {
        guard URL(string: urlString) != nil else { throw WebError.loadFailed("Invalid URL") }

        // ── Serial gate: one extraction at a time ────────────────────────────
        // This is the core of the concurrency fix.  The second concurrent caller
        // suspends here until finish() → releaseQueue() fires for the first one.
        // At that point ALL self.* state has been cleaned up and zeroed, so the
        // second caller starts with a completely blank slate.
        await acquireQueue()
        defer { releaseQueue() }

        // ── Reset all shared state for this operation ────────────────────────
        // Belt-and-suspenders: even though releaseQueue() is only called after
        // finish() which already nils continuation and webView, we zero every
        // field here so the state is unambiguously clean.
        self.currentURLString = urlString
        self.currentAttempt = 1
        self.hasResumed = false
        self.isExtracting = false
        self.pendingJSRequest = nil
        self.webView = nil
        self.loadTimeoutTask = nil

        print("[FitMe] platform=\(detectPlatform(from: urlString)) path=WebView attempt=\(self.currentAttempt) nextData=false jsonLD=false images=0 result=START error=")

        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<ExtractedPayload, Error>) in
            self.continuation = cont
            self.hasResumed = false
            self.isExtracting = false

            let cfg = WKWebViewConfiguration()
            if #available(iOS 14.0, *) {
                cfg.defaultWebpagePreferences.allowsContentJavaScript = true
            } else {
                cfg.preferences.javaScriptEnabled = true
            }
            cfg.websiteDataStore = .nonPersistent()
            // Mobile Safari rendering — matches what Myntra serves to phones.
            let prefs = WKWebpagePreferences()
            prefs.preferredContentMode = .mobile
            cfg.defaultWebpagePreferences = prefs

            let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: 414, height: 896), configuration: cfg)
            wv.navigationDelegate = self
            self.webView = wv

            // H&M and Meesho block headless WebViews — spoof a real desktop Safari UA to bypass the "Access Denied" gate.
            let platform = self.detectPlatform(from: urlString)
            if platform == "H&M" || platform == "Meesho" {
                wv.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15"
                // Switch to desktop rendering to match the spoofed UA
                let desktopPrefs = WKWebpagePreferences()
                desktopPrefs.preferredContentMode = .desktop
                if #available(iOS 14.0, *) {
                    desktopPrefs.allowsContentJavaScript = true
                }
                cfg.defaultWebpagePreferences = desktopPrefs
            }

            guard let url = URL(string: urlString) else {
                cont.resume(throwing: WebError.loadFailed("Invalid URL"))
                return
            }
            let req = URLRequest(url: url)
            wv.load(req)

            // Hard timeout — never hang the caller.
            self.loadTimeoutTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 25_000_000_000)
                self?.finish(with: .failure(WebError.timeout))
            }
        }
    }

    private func finish(with result: Result<ExtractedPayload, Error>) {
        // Diagnostic prints
        print("[FitMe] finish called")
        print("[FitMe] hasResumed=\(hasResumed)")
        print("[FitMe] pendingJSRequest exists=\(pendingJSRequest != nil)")

        // Guard against double resume
        guard !hasResumed else { return }
        hasResumed = true

        // Cancel the hard timeout task
        loadTimeoutTask?.cancel()
        loadTimeoutTask = nil

        // Resolve any pending JS request
        let request = pendingJSRequest
        pendingJSRequest = nil
        print("[FitMe] before request.resume")
        request?.resume(throwing: WebError.timeout)
        print("[FitMe] after request.resume")

        // Resolve the continuation passed to extract(...)
        let cont = continuation
        continuation = nil

        // Tear down the web view on the next run loop
        let wv = webView
        webView = nil
        DispatchQueue.main.async {
            wv?.stopLoading()
            wv?.navigationDelegate = nil
        }

        // Log failures with attempt information
        if case .failure(let err) = result, let urlStr = self.currentURLString {
            let platform = detectPlatform(from: urlStr)
            print("[FitMe] platform=\(platform) path=WebView attempt=\(self.currentAttempt) result=FAIL error=\(err)")
        }

        // Resume the awaiting continuation with the final result
        switch result {
        case .success(let v):
            cont?.resume(returning: v)
        case .failure(let e):
            cont?.resume(throwing: e)
        }
    }

    // Helper to evaluate JavaScript and return result
    private func evaluateJS(_ script: String) async throws -> Any? {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Any?, Error>) in
            guard let webView = self.webView else {
                cont.resume(throwing: WebError.noData)
                return
            }
            
            let request = PendingJSRequest(continuation: cont)
            self.pendingJSRequest = request
            
            webView.evaluateJavaScript(script) { [weak self] result, error in
                guard let self = self else {
                    request.resume(throwing: WebError.noData)
                    return
                }
                
                if self.pendingJSRequest === request {
                    self.pendingJSRequest = nil
                }
                
                if let error = error {
                    request.resume(throwing: error)
                } else {
                    request.resume(returning: result)
                }
            }
        }
    }

    // Poll the page until product data is ready (platform‑specific)
    private func waitUntilReady(pollInterval: TimeInterval = 0.3, timeout: TimeInterval = 25) async throws -> Bool {
        guard let urlStr = currentURLString else { return false }
        let platform = detectPlatform(from: urlStr)
        let condition: String
        switch platform {
        case "Myntra":
            condition = "!!document.getElementById('__NEXT_DATA__') || !!document.querySelector('h1')"
        case "Amazon":
            condition = "!!document.querySelector('#productTitle') || !!document.querySelector('#title') || !!document.querySelector('.a-price') || !!document.querySelector('#twisterContainer')"
        case "AJIO":
            condition = "!!document.querySelector('#productDetailSection') || !!document.querySelector('.prod-name') || !!document.querySelector('h1') || !!document.querySelector('script[type=\"application/ld+json\"]')"
        case "Flipkart":
            condition = "!!document.querySelector('script[type=\"application/ld+json\"]') || !!document.querySelector('span.B_NuCI') || !!document.querySelector('div._13oc-S')"
        case "H&M":
            // Desktop H&M: wait for product JSON-LD, product name heading, or fallback h1.
            // Also returns true on access-denied so we can detect it quickly instead of timing out.
            condition = "!!document.querySelector('script[type=\"application/ld+json\"]') || !!document.querySelector('[class*=\"product-name\"]') || !!document.querySelector('[class*=\"ProductName\"]') || !!document.querySelector('h1') || document.title.toLowerCase().includes('access denied')"
        default:
            condition = "!!document.querySelector('meta[property=\"og:title\"]') || !!document.querySelector('script[type=\"application/ld+json\"]') || !!document.querySelector('h1')"
        }
        let script = "(function(){ return \(condition); })();"
        let deadline = Date().addingTimeInterval(timeout)
        var lastDiagLog = Date.distantPast
        while Date() < deadline {
            if platform == "Myntra", Date().timeIntervalSince(lastDiagLog) >= 2.0 {
                lastDiagLog = Date()
                let diagScript = """
                (function() {
                  return JSON.stringify({
                    readyState: document.readyState,
                    nextData: !!document.getElementById('__NEXT_DATA__'),
                    h1: !!document.querySelector('h1'),
                    pdp: !!document.querySelector('[class*="pdp"]')
                  });
                })()
                """
                if let diagResultStr = try? await evaluateJS(diagScript) as? String,
                   let data = diagResultStr.data(using: .utf8),
                   let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    let readyState = dict["readyState"] as? String ?? "unknown"
                    let nextData = dict["nextData"] as? Bool ?? false
                    let h1 = dict["h1"] as? Bool ?? false
                    let pdp = dict["pdp"] as? Bool ?? false
                    print("[FitMe] readyState=\(readyState) nextData=\(nextData) h1=\(h1) pdp=\(pdp)")
                }
            }
                        print("[FitMe] before evaluateJS")
                let readyAny = try await evaluateJS(script)
                print("[FitMe] after evaluateJS")
            print("[FitMe] readyValue=\(String(describing: readyAny)) type=\(type(of: readyAny))")
            if let ready = readyAny as? Bool, ready {
                print("[FitMe] waitUntilReady returning TRUE")
                return true
            }
            try? await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
        }
        print("[FitMe] waitUntilReady timed out")
        return false
    }
        // MARK: - JSON‑LD Price Helper
        private func extractPriceAndOriginal(from jsonLDBlobs: [String]) -> (price: String?, originalPrice: String?) {
            // Helper to pull a price string from a single offers dict.
            // H&M uses AggregateOffer with lowPrice (=sale) and highPrice (=MRP).
            func priceFrom(_ offers: [String: Any]) -> (price: String?, originalPrice: String?) {
                // Prefer lowPrice (sale price) over plain price
                let low  = offers["lowPrice"]  as? String ?? (offers["lowPrice"]  as? NSNumber)?.stringValue
                let plain = offers["price"]    as? String ?? (offers["price"]    as? NSNumber)?.stringValue
                let high  = offers["highPrice"] as? String ?? (offers["highPrice"] as? NSNumber)?.stringValue
                let salePrice = low ?? plain
                let originalPrice = high ?? (low != nil ? plain : nil)
                return (salePrice, originalPrice)
            }

            func extractFrom(_ jsonObj: [String: Any]) -> (price: String?, originalPrice: String?)? {
                if let offers = jsonObj["offers"] as? [String: Any] {
                    return priceFrom(offers)
                } else if let offersArray = jsonObj["offers"] as? [[String: Any]], let first = offersArray.first {
                    return priceFrom(first)
                }
                return nil
            }

            for blob in jsonLDBlobs {
                guard let data = blob.data(using: .utf8) else { continue }
                // Handle top-level dict
                if let jsonObj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    // @graph array wrapper
                    if let graph = jsonObj["@graph"] as? [[String: Any]] {
                        for node in graph {
                            if let result = extractFrom(node), result.price != nil { return result }
                        }
                    } else if let result = extractFrom(jsonObj), result.price != nil {
                        return result
                    }
                }
                // Handle top-level array (some sites emit [{...}])
                else if let jsonArr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                    for jsonObj in jsonArr {
                        if let result = extractFrom(jsonObj), result.price != nil { return result }
                    }
                }
            }
            return (nil, nil)
        }


    private func scrollPage() async {
        // Full scroll sequence to trigger lazy loads
        _ = try? await evaluateJS("window.scrollTo(0, document.body.scrollHeight / 2);")
        try? await Task.sleep(nanoseconds: 800_000_000)
        _ = try? await evaluateJS("window.scrollTo(0, document.body.scrollHeight);")
        try? await Task.sleep(nanoseconds: 800_000_000)
        _ = try? await evaluateJS("window.scrollTo(0, 0);")
        try? await Task.sleep(nanoseconds: 500_000_000)
    }

    // Retry handling – attempts 1‑3
    private func handleRetryIfNeeded() async {
        guard !hasResumed else { return }
        // If already succeeded we won't be here.
        if self.currentAttempt == 1 {
            // First failure – try scrolling then retry
            self.currentAttempt = 2
            await self.scrollPage()
            self.isExtracting = false
            await self.runExtractionAndFinish()
        } else if self.currentAttempt == 2 {
            // Second failure – reload page and retry
            self.currentAttempt = 3
            self.isExtracting = false
            self.webView?.reload()
            // The navigation delegate will call runExtractionAndFinish again for attempt 3.
        } else {
            // All attempts exhausted – report failure
            self.finish(with: .failure(WebError.timeout))
        }
    }

    /// JavaScript that walks the rendered DOM and returns a JSON payload.
    /// Runs after `didFinish` so the page has executed its own scripts.
    private static let extractionJS: String = """
    (function() {
      function text(sel) {
        const el = document.querySelector(sel);
        return el ? (el.textContent || '').trim() : null;
      }
      function attr(sel, a) {
        const el = document.querySelector(sel);
        return el ? el.getAttribute(a) : null;
      }
      function metaProp(p) {
        const el = document.querySelector('meta[property="' + p + '"]') ||
                   document.querySelector('meta[name="' + p + '"]');
        return el ? el.getAttribute('content') : null;
      }
      // 1. __NEXT_DATA__ blob (Myntra and many Next.js sites)
      var nextData = null;
      var nd = document.getElementById('__NEXT_DATA__');
      if (nd) { nextData = nd.textContent; }

      // 2. All JSON-LD scripts
      var jsonLD = [];
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        jsonLD.push(scripts[i].textContent);
      }

      // 3. OpenGraph + meta fallbacks with deep brand inspection
       var title = text('#title') || text('#productTitle') || metaProp('og:title') || metaProp('twitter:title') || (document.title || '').trim() || null;
       if (title) {
           title = title.replace(/^Buy\\s+/i, '');
           title = title.split(' - ')[0];
           title = title.split('|')[0];
           title = title.trim();
       }
       var description = metaProp('og:description') || metaProp('description');
       var ogImage = metaProp('og:image') || metaProp('twitter:image');
       
       // ----- DEBUG: brand & structured data inspection -----
       var brandKeys = ['brand','brandname','manufacturer','sellerbrand','productbrand','brand_info','styledata','pdpdata','productdetails'];
       function logFound(path, key, value, parent) {
           console.log('[FitMe DEBUG] FOUND:', path);
           console.log('Key:', key);
           console.log('Value:', value);
           console.log('Parent object:', JSON.stringify(parent, null, 2));
       }
       function inspect(obj, currentPath) {
           if (!obj || typeof obj !== 'object') return;
           for (var k in obj) {
               if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
               var v = obj[k];
               var newPath = currentPath ? currentPath + '.' + k : k;
               // Property name match
               if (brandKeys.includes(k.toLowerCase())) {
                   logFound(newPath, k, v, obj);
               }
               // String value match (common brand strings)
               if (typeof v === 'string') {
                   var low = v.toLowerCase();
                   if (low.includes('mufti') || low.includes('myntra') || low.includes('brand') || low.includes('og:site_name') || low.includes('product:brand')) {
                       console.log('[FitMe DEBUG] FOUND STRING:', newPath);
                       console.log('Value:', v);
                       console.log('Parent object:', JSON.stringify(obj, null, 2));
                   }
               }
               // Recurse into nested objects/arrays
               if (typeof v === 'object') {
                   inspect(v, newPath);
               }
           }
       }
       // Parse __NEXT_DATA__ and inspect
       var parsedNextData = {};
       try { parsedNextData = JSON.parse(nextData); } catch(e) {}
       if (nextData) { inspect(parsedNextData, '__NEXT_DATA__'); }
       // Inspect each JSON‑LD blob
       jsonLD.forEach(function(blob, idx) {
           try { var parsed = JSON.parse(blob); inspect(parsed, 'jsonLD[' + idx + ']'); } catch(e) {}
       });


           // --- Brand: prefer JSON-LD brand.name, then meta tags ---
       var brand = null;
       // 1. Try every JSON-LD blob for a brand.name field
       for (var bi = 0; bi < jsonLD.length; bi++) {
           try {
               var ldObj = JSON.parse(jsonLD[bi]);
               var objs = Array.isArray(ldObj) ? ldObj : (ldObj['@graph'] ? ldObj['@graph'] : [ldObj]);
               for (var oi = 0; oi < objs.length; oi++) {
                   var b = objs[oi].brand;
                   if (b) {
                       var bname = typeof b === 'string' ? b : (b.name || null);
                       if (bname) { brand = bname; break; }
                   }
               }
               if (brand) break;
           } catch(e) {}
       }
       // 2. Fallback to meta tags
        if (!brand) brand = metaProp('product:brand') || metaProp('og:site_name');
        console.log('FINAL BRAND =', brand);
        var priceAmount = 
            text('._30jeq3') || text('.Nx9bqj') || text('._16Jk6d') || text('div.Nx9bqj') || text('div._30jeq3') ||
            text('.pdp-price') || text('.pdp-discounted-price') ||
            text('.prod-sp') || text('.prod-cp') || text('.prod-dis-val') ||
            text('.a-price .a-offscreen') || text('.a-price-whole') || text('.priceToPay') ||
            text('.price-item--sale') || text('.price-item--regular') || text('.price-item') ||
            text('[data-product-price]') || text('.product-price') || text('.current-price') ||
            metaProp('product:price:amount') || metaProp('og:price:amount');

      function isNoise(el) {
        while (el && el !== document.body) {
          const cl = (el.className || '').toString().toLowerCase();
          const id = (el.id || '').toString().toLowerCase();
          if (cl.includes('similar') || id.includes('similar') ||
              cl.includes('recommend') || id.includes('recommend') ||
              cl.includes('related') || id.includes('related') ||
              cl.includes('swatch') || id.includes('swatch') ||
              cl.includes('color') || id.includes('color') ||
              cl.includes('variant') || id.includes('variant') ||
              cl.includes('widget') || id.includes('widget') ||
              cl.includes('footer') || id.includes('footer') ||
              cl.includes('header') || id.includes('header') ||
              cl.includes('nav') || id.includes('nav') ||
              cl.includes('menu') || id.includes('menu') ||
              cl.includes('feedback') || id.includes('feedback') ||
              cl.includes('payment') || id.includes('payment') ||
              cl.includes('delivery') || id.includes('delivery') ||
              cl.includes('tax') || id.includes('tax')) {
            return true;
          }
          el = el.parentElement;
        }
        return false;
      }

      // 4. Collect every plausible product image from the rendered DOM.
      var imgs = [];
      var seen = {};
      function pushImg(src) {
        if (!src) return;
        if (src.indexOf('data:') === 0) return;
        if (seen[src]) return;
        seen[src] = 1;
        imgs.push(src);
      }
      if (ogImage) pushImg(ogImage);
      // Prefer <img> tags inside known product gallery containers first.
      var galleryRoots = document.querySelectorAll(
          '#main-image-container img, #imgTagWrapperId img, img#landingImage, img[data-a-dynamic-image], .image-grid-image, .image-grid-imageContainer, [class*="ImageGallery"], [class*="image-gallery"], [class*="product-image"], [class*="ProductImage"], picture img, [data-testid*="image"] img, img[src*="assets.ajio.com"], img[data-src*="assets.ajio.com"], img[data-src*="hm.com"], img[src*="hm.com"], .product-hero img, .product-image img');

      for (var g = 0; g < galleryRoots.length; g++) {
        var el = galleryRoots[g];
        var isAmazonImg = (el.hasAttribute && el.hasAttribute('data-a-dynamic-image')) || el.id === 'landingImage' || (el.closest && el.closest('#main-image-container, #imgTagWrapperId'));
        if (!isAmazonImg && isNoise(el)) continue;
        
        var src = '';
        var attrs = ['src', 'data-src', 'data-original', 'data-lazy', 'data-srcset', 'srcset'];
        
        if (el.tagName === 'IMG') {
          var dynamicStr = el.getAttribute('data-a-dynamic-image');
          if (dynamicStr) {
            try {
              var keys = Object.keys(JSON.parse(dynamicStr));
              if (keys.length > 0) src = keys[0];
            } catch(e){}
          }
          if (!src) {
            for (var a = 0; a < attrs.length; a++) {
              var val = el.getAttribute(attrs[a]);
              if (val && val.indexOf('data:') !== 0 && !val.includes('placeholder')) {
                src = val;
                break;
              }
            }
          }
        } else {
          var sub = el.querySelector('img');
          if (sub) {
            var dynamicStr = sub.getAttribute('data-a-dynamic-image');
            if (dynamicStr) {
              try {
                var keys = Object.keys(JSON.parse(dynamicStr));
                if (keys.length > 0) src = keys[0];
              } catch(e){}
            }
            if (!src) {
              for (var a = 0; a < attrs.length; a++) {
                var val = sub.getAttribute(attrs[a]);
                if (val && val.indexOf('data:') !== 0 && !val.includes('placeholder')) {
                  src = val;
                  break;
                }
              }
            }
          } else {
            // Background image?
            var bg = el.style && el.style.backgroundImage;
            if (bg && bg.indexOf('url(') === 0) {
              src = bg.replace(/^url\\(['"]?/, '').replace(/['"]?\\)$/, '');
            }
          }
        }
        
        if (src && src.indexOf(',') !== -1 && src.indexOf('http') === 0) {
          // srcset — pick last (highest res) entry
          var parts = src.split(',');
          src = parts[parts.length - 1].trim().split(' ')[0];
        }
        pushImg(src);
      }
      
      // Fall back to every <img> on the page if gallery selectors found too few images.
      if (imgs.length < 3) {
        var allImgs = document.querySelectorAll('img');
        for (var j = 0; j < allImgs.length; j++) {
          var imgEl = allImgs[j];
          var isAmazonImg = (imgEl.hasAttribute && imgEl.hasAttribute('data-a-dynamic-image')) || imgEl.id === 'landingImage' || (imgEl.closest && imgEl.closest('#main-image-container, #imgTagWrapperId'));
          if (!isAmazonImg && isNoise(imgEl)) continue;
          
          var s = '';
          var dynamicStr = imgEl.getAttribute ? imgEl.getAttribute('data-a-dynamic-image') : null;
          if (dynamicStr) {
            try {
              var keys = Object.keys(JSON.parse(dynamicStr));
              if (keys.length > 0) s = keys[0];
            } catch(e){}
          }
          if (!s) {
            var attrs = ['src', 'data-src', 'data-original', 'data-lazy', 'currentSrc'];
            for (var a = 0; a < attrs.length; a++) {
              var val = imgEl.getAttribute ? imgEl.getAttribute(attrs[a]) : imgEl[attrs[a]];
              if (val && val.indexOf('data:') !== 0 && !val.includes('placeholder')) {
                s = val;
                break;
              }
            }
          }
          if (!s) s = imgEl.currentSrc || imgEl.src;
          if (s && s.indexOf('data:') !== 0 && /\\.(jpg|jpeg|png|webp)/i.test(s)) {
            pushImg(s);
          }
        }
      }


      // --- Fix relative Myntra image URLs ---
      // Myntra CDN paths often arrive without the host (e.g. "fl_progressive/...").
      // Prepend the CDN base so every URL is absolute before returning.
      var MYNTRA_CDN = 'https://assets.myntassets.com/';
      if (window.location.host.includes('myntra')) {
          var t1 = text('h1.pdp-title') || '';
          var t2 = text('h1.pdp-name') || '';
          if (t1 || t2) {
              title = (t1 + ' ' + t2).trim();
          }
          try {
              if (nextData) {
                  var nd = JSON.parse(nextData);
                  var pData = nd.props.pageProps.initialState.pdpData;
                  if (pData && pData.name) {
                      title = (pData.brand && pData.brand.name ? pData.brand.name + ' ' : '') + pData.name;
                  }
                  if (pData && pData.media && pData.media.albums && pData.media.albums.length > 0) {
                      var albumImgs = pData.media.albums[0].images;
                      if (albumImgs && albumImgs.length > 0) {
                          var newImgs = [];
                          for (var idx = 0; idx < albumImgs.length; idx++) {
                              if (albumImgs[idx].imageURL) newImgs.push(albumImgs[idx].imageURL);
                          }
                          if (newImgs.length > 0) {
                              imgs = newImgs.concat(imgs);
                          }
                      }
                  }
              }
          } catch(e) {}
          imgs = imgs.map(function(u) {
              if (u && !u.startsWith('http') && !u.startsWith('data:') && !u.startsWith('//')) {
                  return MYNTRA_CDN + u;
              }
              return u;
          });
      }

      // 5. Platform-specific hardcoded overrides to guarantee exact extraction
      if (window.location.host.includes('amazon')) {
        var p = text('.priceToPay .a-price-whole') || text('#corePrice_feature_div .a-price-whole') || text('#corePriceDisplay_desktop_feature_div .a-price-whole') || text('.a-price .a-offscreen');
        if (p) priceAmount = p;
        
        var amzImg = document.querySelector('#landingImage') || document.querySelector('#imgBlkFront') || document.querySelector('#main-image') || document.querySelector('#imgTagWrapperId img') || document.querySelector('img[data-a-dynamic-image]');
        if (amzImg) {
          var dyn = amzImg.getAttribute('data-a-dynamic-image');
          if (dyn) {
            try {
              var keys = Object.keys(JSON.parse(dyn));
              if (keys.length > 0 && !imgs.includes(keys[0])) { imgs.unshift(keys[0]); }
            } catch(e){}
          } else if (amzImg.src && !amzImg.src.startsWith('data:') && !imgs.includes(amzImg.src)) {
            imgs.unshift(amzImg.src);
          }
        }
        
        var t = text('#title') || text('#productTitle');
        if (t) title = t;
        
        var d = text('#productDescription') || text('#feature-bullets');
        if (d) description = d;
      } else if (window.location.host.includes('flipkart')) {
        // Flipkart: extract high-res (1500x1500) images from JSON-LD which uses rukmini1.flixcart.com
        try {
            var fkScripts = document.querySelectorAll('script[type="application/ld+json"]');
            var fkImages = [];
            for (var si = 0; si < fkScripts.length; si++) {
                try {
                    var ld = JSON.parse(fkScripts[si].textContent);
                    var arr = Array.isArray(ld) ? ld : [ld];
                    for (var li = 0; li < arr.length; li++) {
                        var item = arr[li];
                        if (item && item.image) {
                            var imgArr = Array.isArray(item.image) ? item.image : [item.image];
                            for (var ii = 0; ii < imgArr.length; ii++) {
                                var imgUrl = imgArr[ii];
                                if (imgUrl && typeof imgUrl === 'string' && imgUrl.includes('flixcart.com')) {
                                    fkImages.push(imgUrl);
                                }
                            }
                        }
                    }
                } catch(e) {}
            }
            if (fkImages.length > 0) {
                // JSON-LD images are 1500x1500 — prepend them so they are selected first
                imgs = fkImages.concat(imgs.filter(function(u) { return !fkImages.includes(u); }));
            }
        } catch(e) {}
        var p = text('._30jeq3') || text('._16Jk6d') || text('[class*="finalPrice"]') || text('[class*="price"]');
        if (p) priceAmount = p;
      } else if (window.location.host.includes('ajio.com')) {
        var t = text('.prod-name') || text('h1') || text('[class*="prod-name"]');
        if (t) {
            title = t;
        }
        var b = text('.brand-name') || text('[class*="brand-name"]') || text('[class*="brandName"]') || text('.brand');
        if (b) brand = b;

        if (title) {
           title = title.replace(/\\s+Online$/i, '');
           if (brand) {
               var byBrandRegex = new RegExp('\\\\s+by\\\\s+' + brand, 'i');
               title = title.replace(byBrandRegex, '');
           }
           title = title.trim();
        }

        imgs = imgs.filter(function(u) {
            if (!u) return false;
            // AJIO & Shein India: Filter out swatches, logos, banners, and micro-thumbnails (Width < 200)
            if (u.includes('SWATCH') || u.includes('brand-logo') || u.includes('banner') || u.includes('sticky') || u.includes('icon')) {
                return false;
            }
            if (u.includes('ajio') || u.includes('shein') || u.includes('jiocdn')) {
                var m = u.match(/-([0-9]+)Wx[0-9]+H-/i);
                if (m && parseInt(m[1]) < 200) {
                    return false;
                }
            }
            return true;
        });

        var p = text('.prod-cp') || text('[class*="prod-cp"]') || text('[class*="price"]');
        if (p) priceAmount = p;
      } else if (window.location.host.includes('hm.com')) {
        // ── Step 1: explicit data attributes ──
        var p = text('[data-testid="product-price-value"]')
             || text('[data-testid="product-price"]')
             || text('[class*="product-detail-main-price-value"]')
             || text('#product-price')
             || text('hm-product-price');

        // ── Step 2: scan JSON-LD script tags directly in JS ──
        if (!p) {
            var scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (var si = 0; si < scripts.length; si++) {
                try {
                    var ld = JSON.parse(scripts[si].textContent);
                    var objs = Array.isArray(ld) ? ld : (ld['@graph'] ? ld['@graph'] : [ld]);
                    for (var oi = 0; oi < objs.length; oi++) {
                        var obj = objs[oi];
                        var offers = obj.offers;
                        if (!offers) continue;
                        if (Array.isArray(offers)) offers = offers[0];
                        var low  = offers.lowPrice  !== undefined ? String(offers.lowPrice)  : null;
                        var prc  = offers.price      !== undefined ? String(offers.price)      : null;
                        var found = low || prc;
                        if (found) {
                            var fval = parseFloat(String(found).replace(/,/g,''));
                            if (!isNaN(fval) && fval >= 1 && fval <= 200000) {
                                p = String(fval);
                                console.log('[FitMe DEBUG] HM JSON-LD price found: ' + p + ' (low=' + low + ' price=' + prc + ')');
                                break;
                            }
                        }
                    }
                    if (p) break;
                } catch(e) {}
            }
        }

        // ── Step 3: DOM scan – look for any numeric leaf element ──
        if (!p) {
            var els = document.querySelectorAll('span, p, div, strong, em');
            var priceClassPrice = null;
            var priceClassValue = Infinity;
            var anyPrice = null;
            var anyValue = Infinity;
            var promoRegex = /free|shipping|over|above|member|earn|loyalty|total|subtotal|delivery|voucher/i;
            var priceClassRegex = /price/i;
            for (var i = 0; i < els.length; i++) {
                var el = els[i];
                var style = window.getComputedStyle(el);
                if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) continue;
                if (el.children.length > 2) continue;
                var txt = (el.textContent || '').trim();
                if (!txt || txt.length > 25) continue;
                // Extract a number from the text (with or without currency symbol)
                var numMatch = txt.replace(/[\\u00A0\\u202F]/g, ' ').match(/([0-9][0-9,]*(\\.[0-9]*)?)/);  
                if (!numMatch) continue;
                var numStr = numMatch[1].replace(/,/g, '');
                var val = parseFloat(numStr);
                if (isNaN(val) || val < 50 || val > 200000) continue;
                var ancestor = el.parentElement;
                var ancestorText = '';
                var depth = 0;
                while (ancestor && depth < 4) {
                    ancestorText += ' ' + (ancestor.textContent || '').toLowerCase();
                    ancestor = ancestor.parentElement;
                    depth++;
                }
                var combined = (txt + ' ' + ancestorText);
                if (promoRegex.test(combined)) continue;
                var cls = (el.className || '').toString().toLowerCase();
                var id  = (el.id || '').toString().toLowerCase();
                var hasPriceClass = priceClassRegex.test(cls) || priceClassRegex.test(id);
                if (hasPriceClass && val < priceClassValue) { priceClassValue = val; priceClassPrice = String(val); }
                if (val < anyValue) { anyValue = val; anyPrice = String(val); }
            }
            p = priceClassPrice || anyPrice;
            if (p) console.log('[FitMe DEBUG] HM DOM scan price: ' + p);
        }

        if (p) { priceAmount = p; }
        else { console.log('[FitMe DEBUG] HM: no price found from any source'); }
        var t = text('h1') || text('.product-item-headline');
        if (t) title = t;
      }

      // ── Global CDN image cleanup (runs for ALL platforms) ─────────────────
      // Strip CDN resize transforms from URL paths/query params to get original
      // high-resolution images for AJIO, Nykaa, Myntra, etc.
      imgs = imgs.map(function(u) {
          if (!u) return u;
          // AJIO & Shein India: Upgrade low-res/thumbnail path dimensions (-78Wx98H-, -473Wx593H-, -286Wx362H-, -111Wx142H-) to full HD 1000Wx1500H
          if (u.includes('ajio') || u.includes('shein') || u.includes('jiocdn')) {
              u = u.replace(/-[0-9]+Wx[0-9]+H-/gi, '-1000Wx1500H-');
              u = u.replace(/-[0-9]+Wx[0-9]+H(?=\\.)/gi, '-1000Wx1500H');
          }
          // Nykaa / Nykaa Fashion / ImageKit: remove path-embedded transform like /tr:h-400,w-300,cm-pad_resize/
          if (u.includes('nykaa') || u.includes('hsapps.com') || u.includes('imagekit')) {
              u = u.replace(/[/]tr:[^/]+[/]/g, '/');
              // Upgrade small ?tr=w-NNN or &tr=w-NNN query param to w-1000
              u = u.replace(/([?&]tr=(?:[^&]*,)?w-)([0-9]+)/g, function(match, prefix, w) {
                  return parseInt(w) < 1000 ? prefix + '1000' : match;
              });
          }
          return u;
      });

      if (!priceAmount) {
        // Priority 1: Check elements with price class or id or testid
        var priceCandidates = document.querySelectorAll('[class*="price"], [class*="Price"], [id*="price"], [data-testid*="price"], .prod-sp, .prod-cp, .pdp-price, .product-price, .selling-price');
        for (var pi = 0; pi < priceCandidates.length; pi++) {
          var elP = priceCandidates[pi];
          if (isNoise(elP)) continue;
          var tP = (elP.textContent || '').trim();
          var mP = tP.match(/(?:₹|rs\\.?|inr|\\$)\\s*([\\d,]+(?:\\.\\d+)?)/i);
          if (mP && mP[1]) {
            priceAmount = mP[0];
            break;
          }
        }
      }
      if (!priceAmount) {
        // Priority 2: Check headings and bold elements for standalone currency text
        var headings = document.querySelectorAll('h1, h2, h3, h4, h5, strong, b, span, p');
        for (var hj = 0; hj < headings.length; hj++) {
          var elH = headings[hj];
          if (isNoise(elH)) continue;
          var tH = (elH.textContent || '').trim();
          if (/^(?:₹|rs\\.?)\\s*[\\d,]+(?:\\.\\d+)?$/i.test(tH)) {
            priceAmount = tH;
            break;
          }
        }
      }

      console.log('[FitMe DEBUG] Final payload being returned');
      

      return JSON.stringify({
        title: title,
        brand: brand,
        description: description,
        priceText: priceAmount,
        nextData: nextData,
        jsonLD: jsonLD,
        images: imgs.slice(0, 12)
      });
    })();
    """

    // MARK: - Dynamic Readiness Check for Fast Extraction
    private func isProductDataComplete() async -> Bool {
        guard let urlStr = currentURLString else { return false }
        let platform = detectPlatform(from: urlStr)
        
        let checkScript: String
        switch platform {
        case "Myntra":
            checkScript = """
            (function() {
                try {
                    var nd = document.getElementById('__NEXT_DATA__');
                    if (nd && nd.textContent) {
                        var parsed = JSON.parse(nd.textContent);
                        var pData = parsed.props.pageProps.initialState.pdpData;
                        if (pData && pData.name && pData.media && pData.media.albums && pData.media.albums.length > 0) {
                            return true;
                        }
                    }
                } catch(e) {}
                return (!!document.querySelector('h1.pdp-title') || !!document.querySelector('h1.pdp-name')) && !!document.querySelector('.pdp-price');
            })()
            """
        case "Flipkart":
            checkScript = """
            (function() {
                try {
                    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
                    for (var i = 0; i < scripts.length; i++) {
                        var ld = JSON.parse(scripts[i].textContent);
                        var arr = Array.isArray(ld) ? ld : [ld];
                        for (var j = 0; j < arr.length; j++) {
                            if (arr[j].name && (arr[j].offers || arr[j].image)) return true;
                        }
                    }
                } catch(e) {}
                return (!!document.querySelector('span.B_NuCI') || !!document.querySelector('h1')) && (!!document.querySelector('._30jeq3') || !!document.querySelector('.Nx9bqj') || !!document.querySelector('._16Jk6d') || !!document.querySelector('[class*="price"]'));
            })()
            """
        case "Amazon":
            checkScript = """
            (function() {
                var title = !!document.querySelector('#productTitle') || !!document.querySelector('#title');
                var price = !!document.querySelector('.a-price') || !!document.querySelector('.priceToPay') || !!document.querySelector('#corePriceDisplay_desktop_feature_div');
                var img = !!document.querySelector('#landingImage') || !!document.querySelector('img[data-a-dynamic-image]') || !!document.querySelector('#imgTagWrapperId img');
                return title && price && img;
            })()
            """
        case "AJIO":
            checkScript = """
            (function() {
                var title = !!document.querySelector('.prod-name') || !!document.querySelector('h1') || !!document.querySelector('meta[property="og:title"]');
                var price = !!document.querySelector('.prod-sp') || !!document.querySelector('.prod-cp') || !!document.querySelector('[class*="prod-sp"]') || !!document.querySelector('[class*="prod-cp"]') || !!document.querySelector('[class*="price"]') || !!document.querySelector('script[type="application/ld+json"]');
                return title || price;
            })()
            """
        default:
            checkScript = """
            (function() {
                var title = !!document.querySelector('h1') || !!document.querySelector('meta[property="og:title"]');
                var img = !!document.querySelector('meta[property="og:image"]') || !!document.querySelector('img');
                return title && img;
            })()
            """
        }
        
        if let res = try? await evaluateJS(checkScript) as? Bool {
            return res
        }
        return false
    }

    private func triggerAjioGalleryScroll() async {
        // Trigger viewport IntersectionObserver for the image gallery
        _ = try? await evaluateJS("window.scrollTo(0, document.body.scrollHeight / 3);")
        
        // Wait until gallery images are populated (up to 1.2s bounded max)
        let deadline = Date().addingTimeInterval(1.2)
        while Date() < deadline {
            let imgCountScript = "(function(){ return document.querySelectorAll('img[src*=\"assets.ajio.com\"], img[data-src*=\"assets.ajio.com\"]').length >= 3; })();"
            if let ready = try? await evaluateJS(imgCountScript) as? Bool, ready {
                break
            }
            try? await Task.sleep(nanoseconds: 100_000_000) // 100ms poll
        }
        // Return to top smoothly
        _ = try? await evaluateJS("window.scrollTo(0, 0);")
    }

    fileprivate func runExtractionAndFinish() {
        guard let wv = webView else { return }
        guard !isExtracting else { return }
        isExtracting = true
        
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            // Wait for product data to become available
            let ready = try? await self.waitUntilReady()
            guard !self.hasResumed else { return }
            if ready != true {
                // Ready check failed – engage retry logic
                await self.handleRetryIfNeeded()
                return
            }
            
            // Pre-scroll for platforms that lazy-load gallery images (e.g. AJIO).
            if let urlStr = self.currentURLString {
                let platform = self.detectPlatform(from: urlStr)
                if platform == "AJIO" {
                    await self.triggerAjioGalleryScroll()
                }
            }

            // Adaptive readiness wait: poll every 100ms for verified completeness up to 2.5s maximum fallback
            let adaptiveDeadline = Date().addingTimeInterval(2.5)
            while Date() < adaptiveDeadline {
                if await self.isProductDataComplete() {
                    break
                }
                try? await Task.sleep(nanoseconds: 100_000_000)
            }

            wv.evaluateJavaScript(Self.extractionJS) { [weak self] value, error in
                guard let self = self else { return }
                if let error {
                    self.finish(with: .failure(WebError.loadFailed(error.localizedDescription)))
                    return
                }
                guard let jsonStr = value as? String,
                      let data = jsonStr.data(using: .utf8),
                      let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    self.finish(with: .failure(WebError.noData))
                    return
                }
                
                let isHM = self.currentURLString?.contains("hm.com") == true
                if isHM {
                    print("======== H&M DIAGNOSTICS ========")
                    print("metaPrice: \(String(describing: dict["priceText"]))")
                    print("jsonLD RAW: \(String(describing: dict["jsonLD"]))")
                    let testExtract = self.extractPriceAndOriginal(from: (dict["jsonLD"] as? [String]) ?? [])
                    print("extractPriceAndOriginal result: price=\(String(describing: testExtract.price)), originalPrice=\(String(describing: testExtract.originalPrice))")
                    if let nd = dict["nextData"] as? String {
                        print("nextData length: \(nd.count) characters")
                        print("nextData snippet: \(String(nd.prefix(500)))")
                    } else {
                        print("nextData: nil")
                    }
                    print("=================================")
                }
                
                // Extract price from meta tags and fallback to JSON‑LD
                let metaPrice = dict["priceText"] as? String
                let jsonLDPriceInfo = extractPriceAndOriginal(from: (dict["jsonLD"] as? [String]) ?? [])
                func extractDouble(from str: String?) -> Double? {
                    guard let s = str else { return nil }
                    let cleaned = s.replacingOccurrences(of: "[^0-9.,]", with: "", options: .regularExpression).replacingOccurrences(of: ",", with: "")
                    return Double(cleaned)
                }

                // Step 3 — Fix the priority logic
                // Change the priority so JSON-LD price wins when present, and the meta tag is only used as a last-resort fallback
                let finalPrice = jsonLDPriceInfo.price ?? metaPrice
                
                print("[FitMe] metaPrice=\(metaPrice ?? "nil") jsonLDPrice=\(jsonLDPriceInfo.price ?? "nil") finalPrice=\(finalPrice ?? "nil")")
                let finalOriginal = jsonLDPriceInfo.originalPrice
                let payload = ExtractedPayload(
                    title: dict["title"] as? String,
                    brand: dict["brand"] as? String,
                    priceText: finalPrice,
                    originalPriceText: finalOriginal,
                    discountPercent: 0,
                    sizes: [],
                    description: dict["description"] as? String,
                    imageURLs: (dict["images"] as? [String]) ?? [],
                    nextDataJSON: dict["nextData"] as? String,
                    jsonLDBlobs: (dict["jsonLD"] as? [String]) ?? []
                )
                // Anti-bot block validation (e.g., Cloudflare, Akamai "Access Denied")
                let rawTitleLower = payload.title?.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let blockedKeywords = ["access denied", "just a moment", "attention required", "cloudflare", "403 forbidden", "robot or human", "security check", "pardon our interruption", "blocked"]
                let isAntiBotBlock = blockedKeywords.contains { rawTitleLower.contains($0) }

                if isAntiBotBlock || (payload.title?.isEmpty ?? true) || payload.imageURLs.isEmpty {
                    if let urlStr = self.currentURLString {
                        let platform = self.detectPlatform(from: urlStr)
                        print("[FitMe] platform=\(platform) path=WebView attempt=\(self.currentAttempt) title=\"\(payload.title ?? "")\" result=BLOCKED_ANTI_BOT")
                    }
                    self.finish(with: .failure(WebError.loadFailed("Retailer anti-bot page detected")))
                    return
                }

                // Diagnostic logging – include attempt number
                if let urlStr = self.currentURLString {
                    let platform = self.detectPlatform(from: urlStr)
                    let nextDataFound = payload.nextDataJSON != nil
                    let jsonLDFound = !payload.jsonLDBlobs.isEmpty
                    let imagesCount = payload.imageURLs.count
                    let titleFound = !(payload.title?.isEmpty ?? true)
                    let priceFound = !(payload.priceText?.isEmpty ?? true)
                    let sizesFound = !payload.sizes.isEmpty

                    let ndStr = nextDataFound ? "YES" : "NO"
                    let ldStr = jsonLDFound ? "YES" : "NO"
                    let titleStr = titleFound ? "YES" : "NO"
                    let priceStr = priceFound ? "YES" : "NO"
                    let sizesStr = sizesFound ? "YES" : "NO"

                    print("[FitMe] platform=\(platform) path=WebView attempt=\(self.currentAttempt) nextData=\(ndStr) jsonLD=\(ldStr) images=\(imagesCount) title=\(titleStr) price=\(priceStr) sizes=\(sizesStr) result=SUCCESS")
                }
                self.finish(with: .success(payload))
            }
        }
    }
}

extension WebViewExtractor: WKNavigationDelegate {
    nonisolated func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        Task { @MainActor in
            self.runExtractionAndFinish()
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            self.runExtractionAndFinish()
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in
            self.finish(with: .failure(WebError.loadFailed(error.localizedDescription)))
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in
            self.finish(with: .failure(WebError.loadFailed(error.localizedDescription)))
        }
    }
}

@MainActor
private final class PendingJSRequest {
    private var continuation: CheckedContinuation<Any?, Error>?
    private var hasResumed = false

    init(continuation: CheckedContinuation<Any?, Error>) {
        self.continuation = continuation
    }

    func resume(returning value: Any?) {
        guard !hasResumed else { return }
        hasResumed = true
        let cont = continuation
        continuation = nil
        cont?.resume(returning: value)
    }

    func resume(throwing error: Error) {
        guard !hasResumed else { return }
        hasResumed = true
        let cont = continuation
        continuation = nil
        cont?.resume(throwing: error)
    }
}

