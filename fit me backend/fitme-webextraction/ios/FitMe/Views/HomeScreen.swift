// HomeScreen.swift – Lovable design migration (full UI replacement)
import SwiftUI
import PhotosUI

struct HomeScreen: View {
    // MARK: - App State & UI State
    @Bindable var appState: AppState
    @State private var showAllPlatforms = false
    @State private var animateHero = false
    @State private var showProductPhotoSheet = false
    @State private var showProductImagePicker = false
    @State private var showScreenshotPicker = false
    @State private var showCamera = false
    @State private var selectedProductItem: PhotosPickerItem?
    @State private var selectedScreenshotItem: PhotosPickerItem?
    
    // MARK: - Constants
    private let visiblePlatforms = Array(allPlatforms.prefix(5))
    private let remainingCount = allPlatforms.count - 5
    
    // MARK: - Body (Lovable UI)
    var body: some View {
        ZStack(alignment: .bottom) {
            // Main scrollable content
            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    topBar
                    heroCard
                    urlInputBar
                    platformsSection
                    recentTryOnsSection
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 80) // space for bottom nav
            }
            .background(FitMeColors.pageBackground.ignoresSafeArea())
            
            // Bottom navigation – stays fixed at the bottom
            bottomNavBar
                .background(FitMeColors.pageBackground)
                .shadow(color: Color.black.opacity(0.1), radius: 6, x: 0, y: -2)
        }
        // MARK: - Modals & Pickers (unchanged)
        .sheet(isPresented: $showProductPhotoSheet) {
            PhotoSourceSheet(
                title: "Upload Product",
                onCamera: {
                    showProductPhotoSheet = false
                    showCamera = true
                },
                onGallery: {
                    showProductPhotoSheet = false
                    showProductImagePicker = true
                }
            )
        }
        .photosPicker(isPresented: $showProductImagePicker, selection: $selectedProductItem, matching: .images)
        .photosPicker(isPresented: $showScreenshotPicker, selection: $selectedScreenshotItem, matching: .images)
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                appState.loadProductFromImage(image)
                appState.navigationPath.append(NavigationDestination.productDetail)
            } onCancel: {}
        }
        .onChange(of: selectedProductItem) { _, newValue in
            Task {
                if let data = try? await newValue?.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    await MainActor.run {
                        appState.loadProductFromImage(image)
                        appState.navigationPath.append(NavigationDestination.productDetail)
                    }
                }
            }
        }
        .onChange(of: selectedScreenshotItem) { _, newValue in
            Task {
                if let data = try? await newValue?.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    await MainActor.run {
                        appState.loadProductFromImage(image)
                        appState.navigationPath.append(NavigationDestination.productDetail)
                    }
                }
            }
        }
    }
    
    // MARK: - Top Bar (logo + notification)
    private var topBar: some View {
        HStack {
            Image("fitme_logo") // replace with actual asset name if different
                .resizable()
                .scaledToFit()
                .frame(width: 48, height: 48)
            Spacer()
            Image(systemName: "bell.fill")
                .font(.system(size: 20))
                .foregroundStyle(FitMeColors.accent)
        }
        .padding(.vertical, 8)
    }
    
    // MARK: - Hero Card (large rounded pastel card)
    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("See any outfit on you.")
                .font(.system(size: 28, weight: .bold, design: .serif))
                .foregroundStyle(FitMeColors.primaryText)
            Text("Paste a product link, upload a screenshot, or share a product image. Watch yourself wear it before you buy.")
                .font(.system(size: 15))
                .foregroundStyle(FitMeColors.secondaryText)
                .lineSpacing(4)
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FitMeColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .shadow(color: Color.black.opacity(0.08), radius: 8, x: 0, y: 4)
    }
    
    // MARK: - URL Input Bar (rounded field with embedded Try On button)
    private var urlInputBar: some View {
        HStack(spacing: 0) {
            Image(systemName: "link")
                .foregroundStyle(FitMeColors.mutedText)
                .font(.system(size: 16))
                .padding(.leading, 16)
            
            TextField("", text: $appState.productURL, prompt: Text("Paste product URL…").foregroundStyle(FitMeColors.mutedText))
                .foregroundStyle(FitMeColors.primaryText)
                .padding(.horizontal, 12)
                .padding(.vertical, 14)
            
            if let platform = appState.detectPlatform(from: appState.productURL) {
                HStack(spacing: 6) {
                    PlatformDot(color: platform.color)
                    Text(platform.name)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(FitMeColors.secondaryText)
                }
                .padding(.trailing, 8)
            }
            
            Button(action: {
                Task {
                    await appState.loadProductFromURL()
                    if appState.currentProduct != nil {
                        appState.navigationPath.append(NavigationDestination.productDetail)
                    }
                }
            }) {
                Text("Try it on me")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(FitMeColors.primaryButton)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
            }
            .disabled(appState.productURL.isEmpty || appState.isLoadingProduct)
            .opacity(appState.productURL.isEmpty ? 0.5 : 1)
            .padding(.trailing, 6)
        }
        .background(FitMeColors.cardBackground)
        .overlay(RoundedRectangle(cornerRadius: 28).stroke(FitMeColors.cardBorder, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 28))
    }
    
    // MARK: - Platforms Section (chips)
    private var platformsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("SUPPORTED PLATFORMS")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(FitMeColors.accent)
                .tracking(0.12)
            
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(visiblePlatforms) { platform in
                        platformChip(platform)
                    }
                    if remainingCount > 0 {
                        Button(action: { showAllPlatforms = true }) {
                            Text("+\(remainingCount) more")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(FitMeColors.secondaryText)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(FitMeColors.cardBackground)
                                .overlay(RoundedRectangle(cornerRadius: 16).stroke(FitMeColors.cardBorder, lineWidth: 1))
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                        }
                    }
                }
                .contentMargins(.horizontal, 20, for: .scrollContent)
            }
        }
    }
    
    // MARK: - Recent Try‑Ons Section (saved outfits preview)
    private var recentTryOnsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("MY CLOSET")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(FitMeColors.accent)
                    .tracking(0.12)
                Spacer()
                if !appState.savedOutfits.isEmpty {
                    Text("\(appState.savedOutfits.count) saved")
                        .font(.system(size: 12))
                        .foregroundStyle(FitMeColors.secondaryText)
                }
            }
            .padding(.horizontal, 20)
            
            if appState.savedOutfits.isEmpty {
                emptyClosetCard
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(appState.savedOutfits.prefix(5)) { outfit in
                            closetPreviewCard(outfit)
                        }
                    }
                    .contentMargins(.horizontal, 20, for: .scrollContent)
                }
            }
        }
    }
    
    // MARK: - Bottom Navigation Bar (simple placeholder icons)
    private var bottomNavBar: some View {
        HStack {
            Spacer()
            NavButton(icon: "house.fill", label: "Home") {}
            Spacer()
            NavButton(icon: "camera.viewfinder", label: "Try‑On") {
                showProductPhotoSheet = true
            }
            Spacer()
            NavButton(icon: "person.crop.circle", label: "Profile") {}
            Spacer()
        }
        .padding(.vertical, 10)
    }
    
    private func NavButton(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundStyle(FitMeColors.primaryText)
                Text(label)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(FitMeColors.secondaryText)
            }
        }
    }
    
    // MARK: - Helper Views (unchanged from original file)
    private func fallbackButton(icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(FitMeColors.primaryButton)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }
    
    private func platformChip(_ platform: PlatformChip) -> some View {
        HStack(spacing: 8) {
            PlatformDot(color: platform.color)
            Text(platform.name)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(FitMeColors.primaryText)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(FitMeColors.cardBackground)
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(FitMeColors.cardBorder, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
    
    private var emptyClosetCard: some View {
        HStack(spacing: 14) {
            Image(systemName: "hanger")
                .font(.system(size: 28))
                .foregroundStyle(FitMeColors.mutedText)
                .frame(width: 60, height: 60)
                .background(FitMeColors.cardBackground)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(FitMeColors.cardBorder, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 3) {
                Text("Your closet is empty")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FitMeColors.primaryText)
                Text("Save outfits from try‑ons to build your collection")
                    .font(.system(size: 13))
                    .foregroundStyle(FitMeColors.secondaryText)
            }
            Spacer()
        }
        .padding(14)
        .background(FitMeColors.cardBackground)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(FitMeColors.cardBorder, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 20)
    }
    
    private func closetPreviewCard(_ outfit: SavedOutfit) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Color(FitMeColors.cardBackground)
                .frame(width: 120, height: 140)
                .overlay {
                    Image(systemName: "person.fill.viewfinder")
                        .font(.system(size: 36))
                        .foregroundStyle(FitMeColors.mutedText)
                }
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(FitMeColors.cardBorder, lineWidth: 1))
            Text(outfit.garmentName)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(FitMeColors.primaryText)
                .lineLimit(1)
                .frame(width: 120, alignment: .leading)
            Text(outfit.savedAt, style: .date)
                .font(.system(size: 11))
                .foregroundStyle(FitMeColors.mutedText)
        }
    }
}
