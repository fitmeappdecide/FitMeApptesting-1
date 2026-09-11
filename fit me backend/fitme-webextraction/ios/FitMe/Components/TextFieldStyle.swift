// TextFieldStyle.swift
import SwiftUI

struct FitMeTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<_Label>) -> some View {
        configuration
            .padding(FitMeSpacing.medium)
            .background(FitMeColors.cardBackground)
            .cornerRadius(FitMeRadius.medium)
            .overlay(
                RoundedRectangle(cornerRadius: FitMeRadius.medium)
                    .stroke(FitMeColors.divider, lineWidth: 1)
            )
            .foregroundColor(FitMeColors.primaryText)
            .font(FitMeTypography.bodyMedium)
    }
}
