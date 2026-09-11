import Foundation
import SwiftUI

struct PlatformChip: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let color: String
}

struct Product: Identifiable {
    let id: String
    let title: String
    let brand: String
    let platform: String
    let price: String
    let originalPrice: String?
    let discountPercent: Int
    let images: [ProductImage]
    let sizes: [String]
    let garmentType: String
    let productURL: String
    let description: String?
    let fabricType: String?
    let dominantColors: [String]
    /// Real garment image fetched from the platform or uploaded by the user.
    /// Used as the input to the AI try-on pipeline.
    var garmentImageData: Data?
}

struct ProductImage: Identifiable {
    let id = UUID()
    let url: String
    let angle: String
}

struct PriceComparison: Identifiable {
    let id = UUID()
    let platform: String
    let platformColor: String
    let title: String
    let price: String
    let originalPrice: String?
    let discountPercent: Int
    let url: String
    let affiliateUrl: String
    let isBestPrice: Bool
    let isFastDelivery: Bool
    let isMostTrusted: Bool
    let isOriginal: Bool
}

struct SkinToneAnalysis {
    let undertone: String
    let skinToneCategory: String
    let garmentColorAnalysis: String
    let stylingAdvice: String
    let colorCompatibilityNote: String
}

struct RealismScore {
    let faceAccuracy: Double
    let garmentAccuracy: Double
    let fitConfidence: Double
}

struct BuyDecision {
    let shouldBuy: Bool
    let overallVerdict: String
    let fitAssessment: String
    let colorMatchAssessment: String
    let valueAssessment: String
    let alternativeNote: String?
}

struct ProductRecommendation: Identifiable {
    let id: String
    let title: String
    let brand: String
    let platform: String
    let platformColor: String
    let price: String
    let originalPrice: String?
    let imageURL: String
    let reason: RecommendationReason
    let productURL: String
    let affiliateUrl: String
}

enum RecommendationReason: String {
    case cheaper = "Cheaper alternative"
    case premium = "Premium option"
    case oversized = "Oversized fit"
    case differentColor = "Different color"
    case similarAesthetic = "Similar style"
}

struct FitAnalysis {
    let recommendedSize: String
    let confidence: Double
    let chestFit: String
    let shoulderFit: String
    let fitDescription: String
    let fitSummary: String
    let skinToneAnalysis: SkinToneAnalysis
}

struct TryOnResult: Identifiable {
    let id: String
    let originalImageURLs: [String]
    let resultImageURLs: [String]
    /// Raw bytes of the AI-generated try-on image (PNG/JPEG).
    let resultImageData: Data?
    /// Alias for resultImageData used by UI.
    var imageData: Data? { resultImageData }
    /// User's original selfie bytes, for the "show original" toggle.
    let originalSelfieData: Data?
    let priceComparisons: [PriceComparison]
    let realismScore: RealismScore
    let buyDecision: BuyDecision
    let recommendations: [ProductRecommendation]
    let processingTime: Double
    let garmentName: String
    let platform: String
}

struct ProcessingStep: Identifiable {
    let id = UUID()
    let number: Int
    let label: String
    let userFriendlyLabel: String
}

struct BodyScan {
    let id: String
    var frontPhoto: Data?
    var backPhoto: Data?
    var leftPhoto: Data?
    var rightPhoto: Data?
    var status: ScanStatus
    
    enum ScanStatus {
        case pending
        case processing
        case completed
        case failed
    }
}

struct SavedOutfit: Identifiable {
    let id: String
    let result: TryOnResult
    let savedAt: Date
    let thumbnailImageURL: String
    let garmentName: String
}

let allPlatforms: [PlatformChip] = [
    PlatformChip(name: "Myntra", color: "#FF3F6C"),
    PlatformChip(name: "Amazon", color: "#4A90D9"),
    PlatformChip(name: "Meesho", color: "#9B5DE5"),
    PlatformChip(name: "Flipkart", color: "#F7B731"),
    PlatformChip(name: "AJIO", color: "#E8532B"),
    PlatformChip(name: "Nykaa", color: "#FC2779"),
    PlatformChip(name: "TataCliq", color: "#6B48FF"),
    PlatformChip(name: "Zara", color: "#333333"),
    PlatformChip(name: "H&M", color: "#E50010"),
    PlatformChip(name: "ASOS", color: "#2D2D2D"),
    PlatformChip(name: "Bewakoof", color: "#FF6B35"),
    PlatformChip(name: "Snapdeal", color: "#E40046"),
    PlatformChip(name: "Nykaa Fashion", color: "#FC2779"),
    PlatformChip(name: "Limeroad", color: "#D4A017"),
    PlatformChip(name: "Koovs", color: "#1A1A1A"),
    PlatformChip(name: "Jabong", color: "#00A8E1"),
    PlatformChip(name: "Shoppers Stop", color: "#C41E3A"),
]

let processingSteps: [ProcessingStep] = [
    ProcessingStep(number: 1, label: "Analysing your fit", userFriendlyLabel: "Analysing your fit"),
    ProcessingStep(number: 2, label: "Matching outfit to your body", userFriendlyLabel: "Matching outfit to your body"),
    ProcessingStep(number: 3, label: "Creating your preview", userFriendlyLabel: "Creating your preview"),
    ProcessingStep(number: 4, label: "Preserving your look", userFriendlyLabel: "Preserving your look"),
    ProcessingStep(number: 5, label: "Enhancing details", userFriendlyLabel: "Enhancing details"),
    ProcessingStep(number: 6, label: "Finalising HD result", userFriendlyLabel: "Finalising HD result"),
]
