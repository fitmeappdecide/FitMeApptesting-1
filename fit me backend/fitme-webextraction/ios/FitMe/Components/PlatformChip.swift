import SwiftUI

/// A small chip representing a platform (e.g., "Shopify", "Amazon")
///
/// The chip uses the global design tokens defined in `FitMeColors`, `FitMeTypography` and `FitMeSpacing`.
struct PlatformChipView: View {
    let title: String
    var backgroundColor: Color = FitMeColors.accentMuted
    var foregroundColor: Color = FitMeColors.primaryText
    var body: some View {
        Text(title)
            .font(FitMeTypography.bodySmall)
            .foregroundColor(foregroundColor)
            .padding(.horizontal, FitMeSpacing.xs)
            .padding(.vertical, FitMeSpacing.xxxs)
            .background(backgroundColor)
            .cornerRadius(FitMeRadius.sm)
    }
}

struct PlatformChip_Previews: PreviewProvider {
    static var previews: some View {
        HStack(spacing: FitMeSpacing.sm) {
            PlatformChipView(title: "Shopify")
            PlatformChipView(title: "Amazon")
        }
        .padding()
        .background(FitMeColors.pageBackground)
    }
}
