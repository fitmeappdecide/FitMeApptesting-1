import SwiftUI
import PhotosUI

struct BodyScanScreen: View {
    @Bindable var appState: AppState
    @State private var showPhotoSourceSheet = false
    @State private var showGalleryPicker = false
    @State private var showCamera = false
    @State private var selectedSlot: AppState.BodyScanPhotoSlot?
    @State private var selectedGalleryItem: PhotosPickerItem?
    @State private var showPreviewScreen = false
    
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                headerSection
                photoGrid
                infoSection
                generateButton
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
        }
        .background(FitMeColors.pageBackground.ignoresSafeArea())
        .navigationTitle("Body Scan")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(FitMeColors.pageBackground, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .sheet(isPresented: $showPhotoSourceSheet) {
            PhotoSourceSheet(
                title: "Add \(selectedSlot?.rawValue ?? "Photo")",
                onCamera: {
                    showPhotoSourceSheet = false
                    showCamera = true
                },
                onGallery: {
                    showPhotoSourceSheet = false
                    showGalleryPicker = true
                }
            )
        }
        .photosPicker(isPresented: $showGalleryPicker, selection: $selectedGalleryItem, matching: .images)
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                handleImageCaptured(image)
            } onCancel: {}
        }
        .onChange(of: selectedGalleryItem) { _, newValue in
            Task {
                if let data = try? await newValue?.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    await MainActor.run {
                        handleImageCaptured(image)
                    }
                }
            }
        }
        .sheet(isPresented: $showPreviewScreen) {
            selfiePreviewSheet
        }
    }
    
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("STEP 02 SCAN")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(FitMeColors.accent)
                .tracking(0.12)
            
            Text("Take your photos")
                .font(.system(size: 28, weight: .bold, design: .serif))
                .foregroundStyle(FitMeColors.primaryText)
            
            Text("Front photo is required for the best result. Add back and side views for higher accuracy.")
                .font(.system(size: 14))
                .foregroundStyle(FitMeColors.secondaryText)
                .lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    
    private var photoGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 14) {
            ForEach(AppState.BodyScanPhotoSlot.allCases, id: \.self) { slot in
                photoSlot(slot)
            }
        }
    }
    
    private func photoSlot(_ slot: AppState.BodyScanPhotoSlot) -> some View {
        let hasPhoto = photoData(for: slot) != nil
        
        return Button(action: {
            selectedSlot = slot
            showPhotoSourceSheet = true
        }) {
            VStack(spacing: 12) {
                if let data = photoData(for: slot), let uiImage = UIImage(data: data) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(height: 160)
                        .clipped()
                        .overlay(alignment: .topTrailing) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 22))
                                .foregroundStyle(FitMeColors.successGreen)
                                .background(Circle().fill(FitMeColors.pageBackground))
                                .padding(8)
                        }
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: slot.icon)
                            .font(.system(size: 36))
                            .foregroundStyle(FitMeColors.mutedText)
                        Text(slot.rawValue)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(FitMeColors.secondaryText)
                        if slot == .front {
                            Text("Required")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(FitMeColors.accent)
                                .tracking(0.1)
                        }
                    }
                    .frame(height: 160)
                }
            }
            .frame(maxWidth: .infinity)
            .background(hasPhoto ? FitMeColors.successBackground : FitMeColors.cardBackground)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(hasPhoto ? FitMeColors.successGreen : FitMeColors.cardBorder, style: StrokeStyle(lineWidth: hasPhoto ? 2 : 1, dash: hasPhoto ? [CGFloat]() : [6, 4]))
            )
            .clipShape(.rect(cornerRadius: 12))
        }
    }
    
    private var infoSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "lightbulb.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(FitMeColors.accent)
                Text("Photo tips for best results")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(FitMeColors.primaryText)
            }
            
            VStack(alignment: .leading, spacing: 8) {
                tipRow("Stand 1.5 metres from the camera")
                tipRow("Wear fitted clothes or undergarments")
                tipRow("Use good lighting facing you")
                tipRow("Keep arms slightly away from body")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(FitMeColors.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
    }
    
    private func tipRow(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(FitMeColors.accent)
                .frame(width: 5, height: 5)
                .padding(.top, 6)
            Text(text)
                .font(.system(size: 13))
                .foregroundStyle(FitMeColors.secondaryText)
        }
    }
    
    private var generateButton: some View {
        VStack(spacing: 8) {
            Button(action: {
                showPreviewScreen = true
            }) {
                HStack(spacing: 10) {
                    Image(systemName: "wand.and.stars")
                    Text("Preview & Generate")
                }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(FitMeColors.primaryButton)
                .clipShape(.rect(cornerRadius: 12))
            }
            .disabled(appState.bodyScan.frontPhoto == nil)
            .opacity(appState.bodyScan.frontPhoto == nil ? 0.4 : 1)
            
            if appState.bodyScan.frontPhoto == nil {
                Text("Add a front photo to continue")
                    .font(.system(size: 12))
                    .foregroundStyle(FitMeColors.secondaryText)
            }
        }
    }
    
    private var selfiePreviewSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    if let data = appState.bodyScan.frontPhoto,
                       let uiImage = UIImage(data: data) {
                        VStack(spacing: 12) {
                            Image(uiImage: uiImage)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(maxHeight: 400)
                                .clipShape(.rect(cornerRadius: 12))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(FitMeColors.cardBorder, lineWidth: 1)
                                )
                            
                            HStack(spacing: 12) {
                                detectionBadge(icon: "face.smiling.fill", text: "Face detected")
                                detectionBadge(icon: "figure.stand", text: "Body detected")
                            }
                        }
                    }
                    
                    if let product = appState.currentProduct {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("SELECTED GARMENT")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(FitMeColors.accent)
                                .tracking(0.12)
                            
                            HStack(spacing: 12) {
                                if appState.uploadedProductImage != nil {
                                    if let uiImage = appState.uploadedProductImage {
                                        Image(uiImage: uiImage)
                                            .resizable()
                                            .aspectRatio(contentMode: .fill)
                                            .frame(width: 60, height: 60)
                                            .clipShape(.rect(cornerRadius: 8))
                                    }
                                } else {
                                    AsyncImageView(url: product.images.first?.url ?? "", cornerRadius: 8)
                                        .frame(width: 60, height: 60)
                                }
                                
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(product.title)
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(FitMeColors.primaryText)
                                        .lineLimit(2)
                                    Text(product.brand)
                                        .font(.system(size: 13))
                                        .foregroundStyle(FitMeColors.secondaryText)
                                }
                                
                                Spacer()
                            }
                        }
                        .padding(16)
                        .background(FitMeColors.cardBackground)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(FitMeColors.cardBorder, lineWidth: 1)
                        )
                    }
                    
                    Button(action: {
                        showPreviewScreen = false
                        appState.navigationPath.append(NavigationDestination.processing)
                        Task {
                            await appState.startTryOn()
                            appState.navigationPath.removeLast()
                            appState.navigationPath.append(NavigationDestination.tryOnResult)
                        }
                    }) {
                        HStack(spacing: 10) {
                            Image(systemName: "sparkles")
                            Text("Generate Try-On")
                        }
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(FitMeColors.primaryButton)
                        .clipShape(.rect(cornerRadius: 12))
                    }
                    
                    Text("This usually takes 15-25 seconds. Please keep the app open.")
                        .font(.system(size: 12))
                        .foregroundStyle(FitMeColors.secondaryText)
                        .multilineTextAlignment(.center)
                }
                .padding(20)
            }
            .background(FitMeColors.pageBackground.ignoresSafeArea())
            .navigationTitle("Preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(FitMeColors.pageBackground, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close") {
                        showPreviewScreen = false
                    }
                    .foregroundStyle(FitMeColors.accent)
                }
            }
        }
    }
    
    private func detectionBadge(icon: String, text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundStyle(FitMeColors.successGreen)
            Text(text)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(FitMeColors.successGreen)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(FitMeColors.successBackground)
        .clipShape(.rect(cornerRadius: 16))
    }
    
    private func handleImageCaptured(_ image: UIImage) {
        guard let slot = selectedSlot else { return }
        if let data = image.jpegData(compressionQuality: 0.9) {
            switch slot {
            case .front:
                appState.bodyScan.frontPhoto = data
                appState.userSelfieImage = image
            case .back:
                appState.bodyScan.backPhoto = data
            case .left:
                appState.bodyScan.leftPhoto = data
            case .right:
                appState.bodyScan.rightPhoto = data
            }
        }
    }
    
    private func photoData(for slot: AppState.BodyScanPhotoSlot) -> Data? {
        switch slot {
        case .front: return appState.bodyScan.frontPhoto
        case .back: return appState.bodyScan.backPhoto
        case .left: return appState.bodyScan.leftPhoto
        case .right: return appState.bodyScan.rightPhoto
        }
    }
}
