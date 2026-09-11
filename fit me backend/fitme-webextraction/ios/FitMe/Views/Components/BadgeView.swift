import SwiftUI

struct BadgeView: View {
    let text: String
    let backgroundColor: Color
    let textColor: Color
    
    var body: some View {
        Text(text)
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(textColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(backgroundColor)
            .clipShape(.rect(cornerRadius: 4))
    }
}

struct PlatformDot: View {
    let color: String
    let size: CGFloat
    
    init(color: String, size: CGFloat = 8) {
        self.color = color
        self.size = size
    }
    
    var body: some View {
        Circle()
            .fill(Color(hex: color))
            .frame(width: size, height: size)
    }
}
