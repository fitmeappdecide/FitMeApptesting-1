package com.fitme.webextraction.errors

/**
 * Represents non‑recoverable errors that can occur during WebView extraction.
 * Mirrors the error codes used by the iOS implementation for parity.
 */
sealed class ExtractionError(message: String) : Exception(message) {
    class InvalidUrl(url: String) : ExtractionError("Invalid URL: $url")
    class NetworkFailure : ExtractionError("Network failure")
    class SslError(details: String) : ExtractionError("SSL error: $details")
    class Timeout : ExtractionError("Rendering timeout")
    class UnexpectedTermination : ExtractionError("WebView terminated unexpectedly")
    class RenderingError(details: String) : ExtractionError("Rendering error: $details")
}
