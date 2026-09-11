import SwiftUI

struct AsyncImageView: View {
    let url: String
    var contentMode: ContentMode = .fill
    var cornerRadius: CGFloat = 0
    
    var body: some View {
        if let imageURL = URL(string: url), !url.isEmpty {
            AsyncImage(url: imageURL) { phase in
                switch phase {
                case .empty:
                    let _ = print("[IMAGE LOADING]", url)
                    placeholder
                case .success(let image):
                    let _ = print("[IMAGE SUCCESS]", url)
                    image
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                case .failure(let error):
                    let _ = print("[IMAGE FAILURE]", url)
                    let _ = print("[IMAGE ERROR]", error.localizedDescription)
                    placeholder
                @unknown default:
                    placeholder
                }
            }
            .clipShape(.rect(cornerRadius: cornerRadius))
        } else {
            placeholder
        }
    }
    
    private var placeholder: some View {
        Color(FitMeColors.cardBackground)
            .overlay {
                Image(systemName: "photo")
                    .font(.system(size: 32))
                    .foregroundStyle(FitMeColors.mutedText)
            }
    }
}

struct ShimmerView: View {
    @State private var isAnimating = false
    
    var body: some View {
        GeometryReader { geo in
            LinearGradient(
                colors: [
                    FitMeColors.cardBackground,
                    FitMeColors.cardBackground.opacity(0.5),
                    FitMeColors.cardBackground
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            .frame(width: geo.size.width * 2)
            .offset(x: isAnimating ? geo.size.width : -geo.size.width)
        }
        .onAppear {
            withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                isAnimating = true
            }
        }
    }
}
