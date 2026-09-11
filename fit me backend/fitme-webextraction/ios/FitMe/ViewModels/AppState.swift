import SwiftUI
import PhotosUI

@Observable
@MainActor
final class AppState {
    var navigationPath = NavigationPath()
    
    var productURL: String = ""
    var currentProduct: Product?
    var isLoadingProduct: Bool = false
    var productError: String?
    
    var uploadedProductImage: UIImage?
    var userSelfieImage: UIImage?

    /// True when URL extraction was blocked by the source platform.
    /// The UI uses this to surface a premium screenshot-fallback card
    /// so the try-on flow can continue without scraping.
    var showScreenshotFallback: Bool = false
    var blockedPlatformName: String?
    
    var bodyScan = BodyScan(id: UUID().uuidString, status: .pending)
    var currentTryOnResult: TryOnResult?
    var isProcessing: Bool = false
    var processingProgress: Double = 0
    var currentProcessingStep: Int = 0
    var estimatedWaitSeconds: Int = 20
    var processingError: String?
    
    var savedOutfits: [SavedOutfit] = []
    var tryOnHistory: [TryOnResult] = []
    
    var showPhotoSourceSheet = false
    var photoSourceCallback: ((UIImage?) -> Void)?
    var pendingPhotoSlot: BodyScanPhotoSlot?
    
    var showShareSheet = false
    var shareImage: UIImage?
    
    enum BodyScanPhotoSlot: String, CaseIterable {
        case front = "Front"
        case back = "Back"
        case left = "Left Side"
        case right = "Right Side"
        
        var icon: String {
            switch self {
            case .front: return "person.fill"
            case .back: return "person.fill.turn.down"
            case .left: return "arrow.left.circle.fill"
            case .right: return "arrow.right.circle.fill"
            }
        }
    }
    
    func detectPlatform(from url: String) -> PlatformChip? {
        let lowercased = url.lowercased()
        for platform in allPlatforms {
            if lowercased.contains(platform.name.lowercased()) {
                return platform
            }
        }
        return nil
    }
    
    /// Fetches real product data deterministically by parsing the page's
    /// embedded JSON (`__NEXT_DATA__`, JSON-LD, OpenGraph). Falls back to
    /// the AI extraction path only if structured parsing fails.
    func loadProductFromURL() async {
        guard !productURL.isEmpty else { return }
        isLoadingProduct = true
        productError = nil
        uploadedProductImage = nil
        defer { isLoadingProduct = false }

        showScreenshotFallback = false
        blockedPlatformName = nil

        let extracted: FitMeAPI.ProductData
        do {
            extracted = try await ProductExtractor.shared.extract(from: productURL)
        } catch ProductExtractor.ExtractionError.blocked(let platform) {
            // Bot-block / interstitial. Surface the screenshot fallback card
            // so the user can continue the try-on flow without scraping.
            productError = "\(platform) blocked automated extraction. Upload a screenshot of the product page to continue."
            blockedPlatformName = platform
            showScreenshotFallback = true
            currentProduct = nil
            return
        } catch {
            // No structured product data found. We deliberately avoid AI
            // "guessing" of titles/prices/images — hallucinated metadata
            // would mislead the user. Offer the screenshot fallback instead.
            productError = "We couldn't fetch this product automatically. Upload a screenshot of the product page to continue."
            blockedPlatformName = detectPlatform(from: productURL)?.name
            showScreenshotFallback = true
            currentProduct = nil
            return
        }

        var garmentData: Data?
        if let imgURL = extracted.imageURL,
           let image = try? await FitMeAPI.shared.downloadImage(from: imgURL) {
            garmentData = image.jpegData(compressionQuality: 0.9)
        }

        // Build the gallery from every model image the extractor found.
        let angles = ["front", "back", "left", "right", "detail", "detail", "detail", "detail"]
        let images: [ProductImage] = extracted.imageURLs.enumerated().map { idx, url in
            ProductImage(url: url, angle: idx < angles.count ? angles[idx] : "detail")
        }

        currentProduct = Product(
            id: UUID().uuidString,
            title: extracted.title,
            brand: extracted.brand,
            platform: extracted.platform,
            price: extracted.price,
            originalPrice: extracted.originalPrice,
            discountPercent: extracted.discountPercent,
            images: images,
            sizes: extracted.sizes,
            garmentType: extracted.garmentType,
            productURL: productURL,
            description: extracted.description,
            fabricType: extracted.fabricType,
            dominantColors: extracted.dominantColors,
            garmentImageData: garmentData
        )
    }
    
    /// Uses Gemini vision to extract product info from a screenshot. The
    /// uploaded image itself becomes the garment image for AI try-on.
    func loadProductFromImage(_ image: UIImage) {
        uploadedProductImage = image
        productError = nil
        showScreenshotFallback = false
        blockedPlatformName = nil
        let garmentData = image.jpegData(compressionQuality: 0.9)
        
        // Optimistic placeholder so the UI navigates immediately.
        currentProduct = Product(
            id: UUID().uuidString,
            title: "Analysing product…",
            brand: "—",
            platform: "Uploaded",
            price: "—",
            originalPrice: nil,
            discountPercent: 0,
            images: [],
            sizes: ["S", "M", "L", "XL"],
            garmentType: "garment",
            productURL: "",
            description: nil,
            fabricType: nil,
            dominantColors: [],
            garmentImageData: garmentData
        )
        
        Task { [weak self] in
            guard let self else { return }
            do {
                let data = try await FitMeAPI.shared.extractProduct(fromImage: image)
                self.currentProduct = Product(
                    id: self.currentProduct?.id ?? UUID().uuidString,
                    title: data.title,
                    brand: data.brand,
                    platform: data.platform,
                    price: data.price,
                    originalPrice: data.originalPrice,
                    discountPercent: data.discountPercent,
                    images: [],
                    sizes: data.sizes,
                    garmentType: data.garmentType,
                    productURL: "",
                    description: data.description,
                    fabricType: data.fabricType,
                    dominantColors: data.dominantColors,
                    garmentImageData: garmentData
                )
            } catch {
                // Leave the placeholder — try-on can still proceed with the image.
            }
        }
    }
    
    /// Runs the real AI pipeline. UI step progression animates concurrently
    /// with the actual network calls so the processing screen feels live.
    func startTryOn() async {
    isProcessing = true
    processingProgress = 0
    currentProcessingStep = 0
    estimatedWaitSeconds = 22
    processingError = nil

    // DEV_BYPASS_AUTH: authentication guard disabled for development testing
    // guard KeychainHelper.shared.get("fitme_access_token") != nil else {
    //     processingError = "User not authenticated."
    //     isProcessing = false
    //     return
    // }

    guard let selfieImage = userSelfieImage,
          let product = currentProduct,
          let garmentData = product.garmentImageData,
          let garmentImage = UIImage(data: garmentData) else {
        processingError = "Missing selfie or product image."
        isProcessing = false
        return
    }

    // Progress animator – same visual behaviour as before
    let progressTask = Task { [weak self] in
        guard let self else { return }
        let totalSteps = processingSteps.count
        for i in 0..<totalSteps {
            if Task.isCancelled { return }
            self.currentProcessingStep = i
            let stepDuration: Double = i == totalSteps - 1 ? 6.0 : 3.5
            let chunks = 20
            let startP = Double(i) / Double(totalSteps)
            let endP = Double(i + 1) / Double(totalSteps)
            for c in 0..<chunks {
                if Task.isCancelled { return }
                let t = Double(c) / Double(chunks)
                let raw = startP + (endP - startP) * t
                self.processingProgress = min(raw, 0.95)
                try? await Task.sleep(for: .seconds(stepDuration / Double(chunks)))
            }
        }
        while !Task.isCancelled {
            self.processingProgress = 0.95
            try? await Task.sleep(for: .seconds(0.5))
        }
    }

    do {
        // 1. Upload scan (selfie image)
        let scanResp = try await FitMeAPI.shared.uploadScan(imageData: selfieImage.jpegData(compressionQuality: 0.9) ?? Data())
        // 2. Upload garment image
        let garmentResp = try await FitMeAPI.shared.uploadGarment(imageData: garmentData)
        // 3. Start try‑on job
        let startResp = try await FitMeAPI.shared.startTryOn(scanId: scanResp.scan_id, garmentId: garmentResp.garment_id)

        // 4. Poll job status until completed or failed
        var jobStatus: JobStatusResponse
        var attempts = 0
        repeat {
            try await Task.sleep(for: .seconds(2))
            jobStatus = try await FitMeAPI.shared.pollJobStatus(jobId: startResp.job_id)
            attempts += 1
        } while jobStatus.status != "completed" && jobStatus.status != "failed" && attempts < 30

        guard jobStatus.status == "completed" else {
            throw APIError.httpError(status: 500)
        }

        // 5. Fetch final result
        let resultResp = try await FitMeAPI.shared.fetchResult(jobId: startResp.job_id)

        // 6. Download first result image (if any)
        var resultImageData: Data? = nil
        if let firstURL = resultResp.result_image_urls.first {
            resultImageData = try await FitMeAPI.shared.downloadImageData(from: firstURL)
        }

        // Assemble TryOnResult – placeholders used for analysis fields
        let placeholderRealism = RealismScore(faceAccuracy: 0, garmentAccuracy: 0, fitConfidence: 0)
        let placeholderBuy = BuyDecision(shouldBuy: false, overallVerdict: "", fitAssessment: "", colorMatchAssessment: "", valueAssessment: "", alternativeNote: nil)

        print("========== BEFORE ASSIGNMENT ==========")
        print("resultResp =", resultResp)
        print("result_image_urls =", resultResp.result_image_urls)
        print("result_image_urls count =", resultResp.result_image_urls.count)
        print("resultImageData nil =", resultImageData == nil)
        print("resultImageData bytes =", resultImageData?.count ?? 0)
        print("======================================")

        currentTryOnResult = TryOnResult(
            id: UUID().uuidString,
            originalImageURLs: [],
            resultImageURLs: resultResp.result_image_urls,
            resultImageData: resultImageData,
            originalSelfieData: selfieImage.jpegData(compressionQuality: 0.85),

            priceComparisons: makePriceComparisons(for: product),
            realismScore: placeholderRealism,
            buyDecision: placeholderBuy,
            recommendations: makeRecommendations(for: product),
            processingTime: 0,
            garmentName: product.title,
            platform: product.platform
        )

        print("========== AFTER ASSIGNMENT ==========")
        print("currentTryOnResult nil =", currentTryOnResult == nil)
        print("=====================================")

        if let result = currentTryOnResult, resultImageData != nil {
            tryOnHistory.append(result)
        }
    } catch {
        print("========== CATCH BLOCK ==========")
        print("Error:", error)
        print("Localized Description:", error.localizedDescription)
        print("=================================")
        processingError = "Try‑on failed: \(error.localizedDescription)"
    }
    progressTask.cancel()
    processingProgress = 1.0
    currentProcessingStep = processingSteps.count - 1
    isProcessing = false
    // Debug logs
    print("TryOn completed")
    print("currentTryOnResult exists:", currentTryOnResult != nil)
    print("isProcessing:", isProcessing)
    // Navigate to result screen when done
    if let _ = currentTryOnResult, !isProcessing {
        navigationPath.append(NavigationDestination.tryOnResult)
    }
}
    
    private func makePriceComparisons(for product: Product) -> [PriceComparison] {
        // Build a same-brand comparison from the product itself. Without a
        // production scraping backend we can't query other platforms safely,
        // so we surface only the verified source listing as the primary row.
        let primary = PriceComparison(
            platform: product.platform,
            platformColor: allPlatforms.first(where: { $0.name == product.platform })?.color ?? "#C9974A",
            title: product.title,
            price: product.price,
            originalPrice: product.originalPrice,
            discountPercent: product.discountPercent,
            url: product.productURL,
            affiliateUrl: affiliateURL(for: product.productURL, platform: product.platform),
            isBestPrice: true,
            isFastDelivery: true,
            isMostTrusted: true,
            isOriginal: true
        )
        return [primary]
    }
    
    private func makeRecommendations(for product: Product) -> [ProductRecommendation] {
        []
    }
    
    private func affiliateURL(for url: String, platform: String) -> String {
        guard !url.isEmpty else { return "" }
        let separator = url.contains("?") ? "&" : "?"
        switch platform.lowercased() {
        case "myntra":
            return "\(url)\(separator)utm_source=fitme&utm_medium=app&utm_campaign=tryon"
        case "amazon":
            return "\(url)\(separator)tag=fitme-21"
        case "flipkart":
            return "\(url)\(separator)affid=fitme&utm_source=fitme"
        case "ajio":
            return "\(url)\(separator)utm_source=fitme"
        default:
            return "\(url)\(separator)utm_source=fitme"
        }
    }
    
    func resetScan() {
        bodyScan = BodyScan(id: UUID().uuidString, status: .pending)
        userSelfieImage = nil
        currentTryOnResult = nil
        processingProgress = 0
        currentProcessingStep = 0
    }
    
    func saveCurrentOutfit() {
        guard let result = currentTryOnResult else { return }
        guard !savedOutfits.contains(where: { $0.id == result.id }) else { return }
        let outfit = SavedOutfit(
            id: result.id,
            result: result,
            savedAt: Date(),
            thumbnailImageURL: result.resultImageURLs.first ?? "",
            garmentName: result.garmentName
        )
        savedOutfits.append(outfit)
    }
    
    func deleteOutfit(at offsets: IndexSet) {
        savedOutfits.remove(atOffsets: offsets)
    }
    
    func prepareShareImage() -> UIImage? {
        if let data = currentTryOnResult?.resultImageData, let image = UIImage(data: data) {
            return image
        }
        return userSelfieImage
    }
    
    func openAffiliateLink(_ urlString: String) {
        guard !urlString.isEmpty, let url = URL(string: urlString) else { return }
        UIApplication.shared.open(url)
    }
}
