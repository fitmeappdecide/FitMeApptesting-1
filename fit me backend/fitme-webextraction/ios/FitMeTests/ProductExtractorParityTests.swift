// ProductExtractorParityTests.swift
// Auto-generated parity test comparing Android and iOS extraction JSON outputs.
import XCTest

class ProductExtractorParityTests: XCTestCase {
    func testParityForSampleURL() throws {
        // Sample Myntra product URL
        let url = "https://www.myntra.com/shirts/allen+solly/allen-solly-men-slim-fit-striped-casual-shirt/38562204/buy"
        // Execute iOS extractor (assumed to be available via ProductExtractor)
        let iosResult = try ProductExtractor.extract(from: url)
        // Execute Android extractor via JavaScript bridge (placeholder implementation)
        let androidResult = try AndroidExtractor.extract(from: url)
        // Convert results to comparable dictionaries
        let iosDict = try JSONSerialization.jsonObject(with: iosResult.data, options: []) as? [String: Any]
        let androidDict = try JSONSerialization.jsonObject(with: androidResult.data, options: []) as? [String: Any]
        // Assert equality for key fields
        XCTAssertEqual(iosDict?['title'] as? String, androidDict?['title'] as? String)
        XCTAssertEqual(iosDict?['brand'] as? String, androidDict?['brand'] as? String)
        XCTAssertEqual(iosDict?['currentPrice'] as? String, androidDict?['currentPrice'] as? String)
        XCTAssertEqual(iosDict?['originalPrice'] as? String, androidDict?['originalPrice'] as? String)
        XCTAssertEqual(iosDict?['discount'] as? String, androidDict?['discount'] as? String)
        XCTAssertEqual(iosDict?['imageUrls'] as? [String], androidDict?['imageUrls'] as? [String])
        XCTAssertEqual(iosDict?['sizes'] as? [String], androidDict?['sizes'] as? [String])
    }
}
