// PrimaryButton.swift
import SwiftUI

struct PrimaryButton: View {
    let title: String
    let action: () -> Void
    var isEnabled: Bool = true
    var body: some View {
        Button {
            action()
        } label: {
            Text(title)
                .font(FitMeTypography.bodyMedium)
                .foregroundColor(FitMeColors.primaryText)
                .frame(maxWidth: .infinity)
                .padding(.vertical, FitMeSpacing.sm)
                .background(isEnabled ? FitMeColors.primaryButton : FitMeColors.primaryButton.opacity(0.5))
                .cornerRadius(FitMeRadius.button)
        }
        .disabled(!isEnabled)
    }
}

struct PrimaryButton_Previews: PreviewProvider {
    static var previews: some View {
        VStack {
            PrimaryButton(title: "Start Try‑On", action: {})
            PrimaryButton(title: "Disabled", action: {}, isEnabled: false)
        }
        .padding()
        .background(FitMeColors.pageBackground.ignoresSafeArea())
    }
}
