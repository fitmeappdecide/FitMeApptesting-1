import ExpoModulesCore
import Foundation

public class FitMeExtractionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FitMeExtraction")

    Events("extractionProgress")

    AsyncFunction("extractProduct") { (url: String, promise: Promise) in
      Task { @MainActor in
        do {
          // Call the existing iOS extractor
          let product = try await WebViewExtractor.shared.extract(from: url)

          // Debug logging for image URLs
          print("[FitMeExtraction] product payload: \(product)")
          print("[FitMeExtraction] imageURLs: \(product.imageURLs)")
          if let firstImage = product.imageURLs.first {
              print("[FitMeExtraction] firstImage: \(firstImage)")
              let isHTTP = firstImage.hasPrefix("http")
              let isFile = firstImage.hasPrefix("file://")
              print("[FitMeExtraction] isHTTP: \(isHTTP), isFile: \(isFile)")
              if isFile, let url = URL(string: firstImage) {
                  let path = url.path
                  let exists = FileManager.default.fileExists(atPath: path)
                  var sizeInfo = "0"
                  if exists, let attrs = try? FileManager.default.attributesOfItem(atPath: path),
                     let size = attrs[.size] as? NSNumber {
                      sizeInfo = size.stringValue
                  }
                  print("[FitMeExtraction] filePath=\(path) exists=\(exists) size=\(sizeInfo)")
              }
          }

          // Map ExtractedPayload to JS Product object (matching Android structure)
          // Map to the JS contract expected by the React Native side.
          // The native ExtractedPayload provides:
          //   title, brand, priceText, originalPriceText, discountPercent, sizes,
          //   description, imageURLs, nextDataJSON, jsonLDBlobs
          // The JS side expects fields: id, name, price, currency, imageUrl.
          // We derive them as follows (using only existing data):
          //   - id: use the product title as a placeholder identifier (or empty if missing).
          //   - name: use the product title.
          //   - price: use priceText (already formatted).
          //   - currency: not provided by ExtractedPayload → set to empty string.
          //   - imageUrl: first entry of imageURLs array.
          let result: [String: Any] = [
            // New fields expected by the JS side
            "title": product.title ?? "",
            "brand": product.brand ?? "",
            "price": product.priceText ?? "",
            "originalPrice": product.originalPriceText ?? "",
            "imageUrl": product.imageURLs.first ?? "",
            "imageUrls": product.imageURLs,
            // Legacy fields for backward compatibility
            "id": product.title ?? "",
            "name": product.title ?? "",
            "currency": ""
          ]
          
          promise.resolve(result)
        } catch {
          promise.reject("ERR_EXTRACTION_FAILED", error.localizedDescription)
        }
      }
    }
  }
}
