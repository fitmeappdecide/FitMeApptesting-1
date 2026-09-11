import Foundation
import UIKit

// MARK: - API Models
// These structs mirror the FastAPI backend schemas (audited).
// Adjust fields as backend schema evolves.

struct RegisterRequest: Codable {
    let email: String
    let password: String
    let name: String?
}

struct RegisterResponse: Codable {
    let access_token: String
    let refresh_token: String
    let user_id: String?
}

struct LoginRequest: Codable {
    let email: String
    let password: String
}

struct LoginResponse: Codable {
    let access_token: String
    let refresh_token: String
    let user_id: String?
}

struct ScanUploadResponse: Codable {
    let scan_id: String
}

struct GarmentUploadResponse: Codable {
    let id: String
    var garment_id: String { id }
}

struct TryOnStartResponse: Codable {
    let job_id: String
}

struct JobStatusResponse: Codable {
    let status: String // e.g., "pending", "processing", "completed", "failed"
    let progress: Double?
}

struct TryOnResultResponse: Codable {
    let result_image_urls: [String]
    // Additional fields can be added as needed.
}

// MARK: - FitMeAPI

final class FitMeAPI {
    struct ProductData: Codable {
        let title: String
        let brand: String
        let platform: String
        let price: String
        let originalPrice: String?
        let discountPercent: Int
        let sizes: [String]
        let garmentType: String
        let description: String?
        let fabricType: String?
        let dominantColors: [String]
        let imageURL: String?
        let imageURLs: [String]
    }

    static let shared = FitMeAPI()
    private init() {}

    private let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 120
        cfg.timeoutIntervalForResource = 180
        return URLSession(configuration: cfg)
    }()

    // MARK: - Token handling (Keychain)
    private var accessToken: String? {
        get { KeychainHelper.shared.get("fitme_access_token") }
        set { if let value = newValue { KeychainHelper.shared.set(value, for: "fitme_access_token") } else { KeychainHelper.shared.delete("fitme_access_token") } }
    }
    private var refreshToken: String? {
        get { KeychainHelper.shared.get("fitme_refresh_token") }
        set { if let value = newValue { KeychainHelper.shared.set(value, for: "fitme_refresh_token") } else { KeychainHelper.shared.delete("fitme_refresh_token") } }
    }

    // MARK: - Helper
    private var authHeader: [String: String] {
        if let token = accessToken { 
            print("Auth Token found: \(token.prefix(5))...")
            return ["Authorization": "Bearer \(token)"] 
        }
        print("No auth token available")
        return [:]
    }

    private func makeURL(path: String) -> URL? {
        guard !Config.baseURL.isEmpty else { return nil }
        return URL(string: Config.baseURL + path)
    }

    // MARK: - API Calls

    // Register a new user
    func register(_ payload: RegisterRequest) async throws -> RegisterResponse {
        guard let url = makeURL(path: "/api/v1/auth/register") else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)
        let (data, resp) = try await session.data(for: request)
        try validate(response: resp)
        let decoded = try JSONDecoder().decode(RegisterResponse.self, from: data)
        // Store tokens
        self.accessToken = decoded.access_token
        self.refreshToken = decoded.refresh_token
        return decoded
    }

    // Login existing user
    func login(_ payload: LoginRequest) async throws -> LoginResponse {
        guard let url = makeURL(path: "/api/v1/auth/login") else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)
        let (data, resp) = try await session.data(for: request)
        try validate(response: resp)
        let decoded = try JSONDecoder().decode(LoginResponse.self, from: data)
        self.accessToken = decoded.access_token
        self.refreshToken = decoded.refresh_token
        return decoded
    }

    // Upload a body scan (multipart/form-data)
    func uploadScan(imageData: Data, filename: String = "scan.jpg") async throws -> ScanUploadResponse {
        guard let url = makeURL(path: "/api/v1/scan/upload") else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let boundary = "Boundary-\(UUID().uuidString)"
        request.allHTTPHeaderFields = authHeader
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("true", forHTTPHeaderField: "X-Consent-Given")
        
        print("REQUEST URL =", url)
        print("HEADERS =", request.allHTTPHeaderFields ?? [:])
        
        let body = createMultipartBody(data: imageData, name: "front", filename: filename, mimeType: "image/jpeg", boundary: boundary)
        request.httpBody = body
        let (data, resp) = try await session.data(for: request)
        if let http = resp as? HTTPURLResponse {
            print("STATUS =", http.statusCode)
            print("BODY =", String(data: data, encoding: .utf8) ?? "")
        }
        try validate(response: resp)
        return try JSONDecoder().decode(ScanUploadResponse.self, from: data)
    }

    // Upload a garment image (multipart/form-data)
    func uploadGarment(imageData: Data, filename: String = "garment.jpg") async throws -> GarmentUploadResponse {
        guard let url = makeURL(path: "/api/v1/garment/user-upload") else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let boundary = "Boundary-\(UUID().uuidString)"
        request.allHTTPHeaderFields = authHeader
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        
        print("REQUEST URL =", url)
        print("HEADERS =", request.allHTTPHeaderFields ?? [:])
        
        let fields = [
            "product_name": "User Uploaded Garment",
            "garment_type_hint": "unknown",
            "size_chart": "{}"
        ]
        let body = createMultipartBody(fields: fields, fileData: imageData, fileName: filename, fileMimeType: "image/jpeg", fileFieldName: "images", boundary: boundary)
        request.httpBody = body
        let (data, resp) = try await session.data(for: request)
        if let http = resp as? HTTPURLResponse {
            print("STATUS =", http.statusCode)
            print("BODY =", String(data: data, encoding: .utf8) ?? "")
        }
        try validate(response: resp)
        return try JSONDecoder().decode(GarmentUploadResponse.self, from: data)
    }

    // Start try‑on job
    func startTryOn(scanId: String, garmentId: String) async throws -> TryOnStartResponse {
        guard let url = makeURL(path: "/api/v1/tryon/start") else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
print("REQUEST URL =", url)
print("HEADERS =", request.allHTTPHeaderFields)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.allHTTPHeaderFields?.merge(authHeader) { _, new in new }
        let payload = ["scan_id": scanId, "garment_id": garmentId]
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, resp) = try await session.data(for: request)
if let http = resp as? HTTPURLResponse {
    print("STATUS =", http.statusCode)
    print("BODY =", String(data: data, encoding: .utf8) ?? "")
}
try validate(response: resp)
        try validate(response: resp)
        return try JSONDecoder().decode(TryOnStartResponse.self, from: data)
    }

    // Poll job status
    func pollJobStatus(jobId: String) async throws -> JobStatusResponse {
        guard let url = makeURL(path: "/api/v1/tryon/\(jobId)") else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
print("REQUEST URL =", url)
print("HEADERS =", request.allHTTPHeaderFields)
        request.allHTTPHeaderFields?.merge(authHeader) { _, new in new }
        let (data, resp) = try await session.data(for: request)
        try validate(response: resp)
        return try JSONDecoder().decode(JobStatusResponse.self, from: data)
    }

    // Fetch final result
    func fetchResult(jobId: String) async throws -> TryOnResultResponse {
        guard let url = makeURL(path: "/api/v1/tryon/\(jobId)/result") else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
print("REQUEST URL =", url)
print("HEADERS =", request.allHTTPHeaderFields)
        request.allHTTPHeaderFields?.merge(authHeader) { _, new in new }
        let (data, resp) = try await session.data(for: request)
if let http = resp as? HTTPURLResponse {
    print("STATUS =", http.statusCode)
    print("BODY =", String(data: data, encoding: .utf8) ?? "")
}
try validate(response: resp)
        try validate(response: resp)
        return try JSONDecoder().decode(TryOnResultResponse.self, from: data)
    }

    // Download image helpers
    func downloadImage(from urlString: String) async throws -> UIImage {
        let data = try await downloadImageData(from: urlString)
        guard let image = UIImage(data: data) else { throw APIError.decodingError }
        return image
    }

    func downloadImageData(from urlString: String) async throws -> Data {
        guard let url = URL(string: urlString) else { throw APIError.invalidURL }
        let (data, resp) = try await session.data(from: url)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.invalidResponse
        }
        return data
    }

    // Model for product from image API response
    private struct ProductAPIResponse: Codable {
        let product_id: String
        let status: String
        let product: ProductDetails
        let fallback_required: Bool
        
        struct ProductDetails: Codable {
            let title: String
            let brand: String
            let price: String?
            let images: [ProductImageDetail]?
            let sizes: [String]
            let garment_type: String?
            
            struct ProductImageDetail: Codable {
                let url: String
                let angle: String
            }
        }
    }

    // Extract product data from screenshot/image via backend vision extraction
    func extractProduct(fromImage image: UIImage) async throws -> ProductData {
        guard let url = makeURL(path: "/api/v1/product/from-image") else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        
        guard let imageData = image.jpegData(compressionQuality: 0.8) else {
            throw APIError.decodingError
        }
        
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.allHTTPHeaderFields?.merge(authHeader) { _, new in new }
        
        let body = createMultipartBody(data: imageData, name: "image", filename: "image.jpg", mimeType: "image/jpeg", boundary: boundary)
        request.httpBody = body
        
        let (data, resp) = try await session.data(for: request)
        try validate(response: resp)
        
        let decoded = try JSONDecoder().decode(ProductAPIResponse.self, from: data)
        let details = decoded.product
        
        return ProductData(
            title: details.title,
            brand: details.brand,
            platform: "Camera",
            price: details.price ?? "—",
            originalPrice: nil,
            discountPercent: 0,
            sizes: details.sizes.isEmpty ? ["S", "M", "L", "XL"] : details.sizes,
            garmentType: details.garment_type ?? "garment",
            description: nil,
            fabricType: nil,
            dominantColors: [],
            imageURL: details.images?.first?.url,
            imageURLs: details.images?.map { $0.url } ?? []
        )
    }

    // MARK: - Utilities

    private func validate(response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw APIError.httpError(status: http.statusCode) }
    }

    private func createMultipartBody(data: Data, name: String, filename: String, mimeType: String, boundary: String) -> Data {
        var body = Data()
        let lineBreak = "\r\n"
        body.append("--\(boundary)\(lineBreak)".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\(lineBreak)".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\(lineBreak)\(lineBreak)".data(using: .utf8)!)
        body.append(data)
        body.append(lineBreak.data(using: .utf8)!)
        body.append("--\(boundary)--\(lineBreak)".data(using: .utf8)!)
        return body
    }

    private func createMultipartBody(
        fields: [String: String],
        fileData: Data,
        fileName: String,
        fileMimeType: String,
        fileFieldName: String,
        boundary: String
    ) -> Data {
        var body = Data()
        let lineBreak = "\r\n"
        
        for (key, value) in fields {
            body.append("--\(boundary)\(lineBreak)".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(key)\"\(lineBreak)\(lineBreak)".data(using: .utf8)!)
            body.append("\(value)\(lineBreak)".data(using: .utf8)!)
        }
        
        body.append("--\(boundary)\(lineBreak)".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(fileFieldName)\"; filename=\"\(fileName)\"\(lineBreak)".data(using: .utf8)!)
        body.append("Content-Type: \(fileMimeType)\(lineBreak)\(lineBreak)".data(using: .utf8)!)
        body.append(fileData)
        body.append(lineBreak.data(using: .utf8)!)
        
        body.append("--\(boundary)--\(lineBreak)".data(using: .utf8)!)
        return body
    }
}

// MARK: - APIError

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(status: Int)
    case decodingError
    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid API URL."
        case .invalidResponse: return "Invalid server response."
        case .httpError(let status): return "HTTP error code \(status)."
        case .decodingError: return "Failed to decode response."
        }
    }
}
