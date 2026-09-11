// FitMeShadows.swift
import SwiftUI

struct FitMeShadows {
    static let elevation1 = ShadowStyle(color: Color.black.opacity(0.2), radius: 4, x: 0, y: 2)
    static let elevation2 = ShadowStyle(color: Color.black.opacity(0.15), radius: 8, x: 0, y: 4)
    static let elevation3 = ShadowStyle(color: Color.black.opacity(0.1), radius: 12, x: 0, y: 6)
}

struct ShadowStyle {
    let color: Color
    let radius: CGFloat
    let x: CGFloat
    let y: CGFloat
}
