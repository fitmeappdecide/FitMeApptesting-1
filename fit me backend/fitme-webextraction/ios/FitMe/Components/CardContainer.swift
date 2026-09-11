// CardContainer.swift
import SwiftUI

/// A reusable card view that applies the app's design tokens for background, border, radius, shadow and inner padding.
///
/// Usage:
/// ````swift
/// CardContainer {
///     VStack { ... }
/// }
/// ````
struct CardContainer<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
                        .padding(FitMeSpacing.md)
            .background(FitMeColors.cardBackground)
            .overlay(
                RoundedRectangle(cornerRadius: FitMeRadius.md)
                    .stroke(FitMeColors.cardBorder, lineWidth: 1)
            )
            .cornerRadius(FitMeRadius.md)
            .shadow(color: FitMeShadows.elevation2.color,
                    radius: FitMeShadows.elevation2.radius,
                    x: FitMeShadows.elevation2.x,
                    y: FitMeShadows.elevation2.y)
    }
}

struct CardContainer_Previews: PreviewProvider {
    static var previews: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: FitMeSpacing.small) {
                Text("Title")
                    .font(FitMeTypography.heading2)
                Text("Subtitle or description goes here.")
                    .font(FitMeTypography.bodyMedium)
            }
            .foregroundColor(FitMeColors.primaryText)
        }
        .padding()
        .background(FitMeColors.pageBackground)
    }
}
