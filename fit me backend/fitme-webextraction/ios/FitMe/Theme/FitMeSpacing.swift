// FitMeSpacing.swift
import SwiftUI

struct FitMeSpacing {
    // General layout spacing
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
    // Aliases for legacy component names
    static let small: CGFloat = sm
    static let medium: CGFloat = md
    static let xxxs: CGFloat = 2 // extra‑extra‑small spacing used by some chips
    // Vertical spacing used in stacks
    static let stackSpacing: CGFloat = 12
    // Card internal padding
    static let cardPadding: EdgeInsets = EdgeInsets(top: md, leading: md, bottom: md, trailing: md)
}
