import SwiftUI

enum FitMeTypography {
    // MARK: - Font Families
    static let primary = "Inter"
    static let secondary = "Roboto"
    
    // MARK: - Font Sizes
    static let heading1: Font = .custom(primary, size: 34).weight(.bold)
    static let heading2: Font = .custom(primary, size: 28).weight(.semibold)
    static let heading3: Font = .custom(primary, size: 22).weight(.semibold)
    static let bodyLarge: Font = .custom(primary, size: 18).weight(.regular)
    static let bodyMedium: Font = .custom(primary, size: 16).weight(.regular)
    static let bodySmall: Font = .custom(primary, size: 14).weight(.regular)
    static let caption: Font = .custom(primary, size: 12).weight(.regular)
    
    // MARK: - Line Height Multipliers (approx)
    static let lineHeightMultiplier: CGFloat = 1.3
}
