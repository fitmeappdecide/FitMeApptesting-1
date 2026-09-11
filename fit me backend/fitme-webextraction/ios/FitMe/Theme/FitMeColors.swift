import SwiftUI

enum FitMeColors {
    static let pageBackground = Color(hex: "#1A1208")
    static let cardBackground = Color(hex: "#2A2018")
    static let cardBorder = Color(hex: "#3A3028")
    static let primaryText = Color.white
    static let secondaryText = Color(hex: "#9E9080")
    static let mutedText = Color(hex: "#6A5A48")
    static let accent = Color(hex: "#C9974A")
    static let accentMuted = Color(hex: "#C9974A").opacity(0.15)
    static let primaryButton = Color(hex: "#A0392B")
    static let primaryButtonHover = Color(hex: "#B8432F")
    static let successGreen = Color(hex: "#4A8C3F")
    static let successBackground = Color(hex: "#1E3A1E")
    static let divider = Color(hex: "#3A3028")
    static let warning = Color(hex: "#D4A017")
    static let overlay = Color.black.opacity(0.6)
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
