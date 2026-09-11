import SwiftUI

struct PhotoSourceSheet: View {
    let title: String
    let onCamera: () -> Void
    let onGallery: () -> Void
    
    var body: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2)
                .fill(FitMeColors.mutedText)
                .frame(width: 36, height: 4)
                .padding(.top, 12)
                .padding(.bottom, 20)
            
            Text(title)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(FitMeColors.primaryText)
                .padding(.bottom, 20)
            
            VStack(spacing: 12) {
                Button(action: onCamera) {
                    HStack(spacing: 16) {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(FitMeColors.accent)
                            .frame(width: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Take Photo")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(FitMeColors.primaryText)
                            Text("Use your camera")
                                .font(.system(size: 13))
                                .foregroundStyle(FitMeColors.secondaryText)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 14))
                            .foregroundStyle(FitMeColors.mutedText)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(FitMeColors.cardBackground)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(FitMeColors.cardBorder, lineWidth: 1)
                    )
                    .clipShape(.rect(cornerRadius: 12))
                }
                
                Button(action: onGallery) {
                    HStack(spacing: 16) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.system(size: 22))
                            .foregroundStyle(FitMeColors.accent)
                            .frame(width: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Choose From Gallery")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(FitMeColors.primaryText)
                            Text("Select from your photos")
                                .font(.system(size: 13))
                                .foregroundStyle(FitMeColors.secondaryText)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 14))
                            .foregroundStyle(FitMeColors.mutedText)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(FitMeColors.cardBackground)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(FitMeColors.cardBorder, lineWidth: 1)
                    )
                    .clipShape(.rect(cornerRadius: 12))
                }
            }
            .padding(.horizontal, 20)
            
            Spacer(minLength: 20)
        }
        .background(FitMeColors.pageBackground)
        .presentationDetents([.height(280)])
        .presentationContentInteraction(.scrolls)
    }
}
