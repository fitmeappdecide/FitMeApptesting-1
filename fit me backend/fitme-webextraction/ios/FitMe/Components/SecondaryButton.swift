import SwiftUI

struct SecondaryButton: View {
    let title: String
    let action: () -> Void
    var disabled: Bool = false
    var body: some View {
        Button(action: {
            action()
        }) {
            Text(title)
                .font(FitMeTypography.bodyMedium)
                .foregroundColor(FitMeColors.accent)
                .padding(.vertical, FitMeSpacing.sm)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: FitMeRadius.medium)
                        .stroke(FitMeColors.accent, lineWidth: 2)
                )
        }
        .disabled(disabled)
        .opacity(disabled ? 0.6 : 1.0)
    }
}

// Preview for SwiftUI canvas
struct SecondaryButton_Previews: PreviewProvider {
    static var previews: some View {
        VStack {
            SecondaryButton(title: "Secondary", action: {})
            SecondaryButton(title: "Disabled", action: {}, disabled: true)
        }
        .padding()
        .background(FitMeColors.pageBackground)
    }
}
