import ExpoModulesCore
import Foundation

public class FitMeExtractionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FitMeExtraction")

    Function("extractProduct") { (url: String, resolve: @escaping PromiseResolveBlock, reject: @escaping PromiseRejectBlock) in
      Task {
        do {
          // Call the existing iOS extractor
          let product = try await WebViewExtractor.shared.extract(url: url)
          let result: [String: Any] = [
            "title": product.title,
            "price": product.price,
            "imageUrl": product.imageUrl,
            "attributes": product.attributes
          ]
          resolve(result)
        } catch {
          reject("EXTRACTION_ERROR", "Extraction failed", error)
        }
      }
    }

    Events("extractionProgress")
  }
}
