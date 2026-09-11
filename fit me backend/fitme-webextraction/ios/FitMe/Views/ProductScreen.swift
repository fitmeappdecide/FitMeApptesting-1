import SwiftUI

struct ProductScreen: View {
    @Bindable var appState: AppState
    @State private var selectedSize: String?
    @State private var showSizeGuide = false
    
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if let product = appState.currentProduct {
                    productImagesCarousel(product)
                    productDetails(product)
                    sizeSection(product)
                    productInfoSection(product)
                    tryOnButton
                } else {
                    ContentUnavailableView {
                        Label("No Product", systemImage: "bag")
                    } description: {
                        Text("Paste a product URL or upload an image to get started")
                    }
                    .foregroundStyle(FitMeColors.secondaryText)
                }
            }
        }
        .background(FitMeColors.pageBackground.ignoresSafeArea())
        .navigationTitle("Product")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(FitMeColors.pageBackground, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
    
    @ViewBuilder
    private func productImagesCarousel(_ product: Product) -> some View {
        if let uploaded = appState.uploadedProductImage {
            Image(uiImage: uploaded)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(height: 360)
                .frame(maxWidth: .infinity)
                .background(FitMeColors.cardBackground)
        } else if !product.images.isEmpty {
            TabView {
                ForEach(product.images) { image in
                    AsyncImageView(url: image.url, contentMode: .fit, cornerRadius: 0)
                }
            }
            .frame(height: 420)
            .background(FitMeColors.cardBackground)
            .tabViewStyle(.page(indexDisplayMode: .automatic))
            .onAppear {
                // Debug diagnostics
                print("Product image count:", product.images.count)
                print("Image URLs:", product.images.map { $0.url })
            }
        } else if let data = product.garmentImageData, let uiImage = UIImage(data: data) {
            Image(uiImage: uiImage)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(height: 360)
                .frame(maxWidth: .infinity)
                .background(FitMeColors.cardBackground)
        } else {
            Color(FitMeColors.cardBackground)
                .frame(height: 360)
                .overlay {
                    VStack(spacing: 12) {
                        Image(systemName: "photo")
                            .font(.system(size: 44))
                            .foregroundStyle(FitMeColors.mutedText)
                        Text("No image available")
                            .font(.system(size: 13))
                            .foregroundStyle(FitMeColors.secondaryText)
                    }
                }
        }
    }
    
    private func productDetails(_ product: Product) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(product.brand.uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(FitMeColors.accent)
                    .tracking(0.12)
                Spacer()
                if let platform = allPlatforms.first(where: { $0.name == product.platform }) {
                    HStack(spacing: 6) {
                        PlatformDot(color: platform.color)
                        Text(platform.name)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(FitMeColors.secondaryText)
                    }
                }
            }
            
            Text(product.title)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(FitMeColors.primaryText)
                .lineSpacing(2)
            
            if let desc = product.description {
                Text(desc)
                    .font(.system(size: 13))
                    .foregroundStyle(FitMeColors.secondaryText)
                    .lineSpacing(2)
            }
            
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(product.price)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(FitMeColors.primaryText)
                if let original = product.originalPrice {
                    Text(original)
                        .font(.system(size: 16))
                        .foregroundStyle(FitMeColors.mutedText)
                        .strikethrough(true, color: FitMeColors.mutedText)
                }
                if product.discountPercent > 0 {
                    Text("\(product.discountPercent)% off")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(FitMeColors.successGreen)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(FitMeColors.successBackground)
                        .clipShape(.rect(cornerRadius: 4))
                }
            }
            
            HStack(spacing: 12) {
                Label(product.garmentType, systemImage: "tag.fill")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(FitMeColors.secondaryText)
                
                if let fabric = product.fabricType {
                    Label(fabric, systemImage: "leaf.fill")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(FitMeColors.secondaryText)
                }
            }
        }
        .padding(20)
        .background(FitMeColors.cardBackground)
        .overlay(
            Rectangle()
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
    }
    
    private func sizeSection(_ product: Product) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("SELECT SIZE")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(FitMeColors.accent)
                    .tracking(0.12)
                
                Spacer()
                
                Button(action: { showSizeGuide = true }) {
                    Text("Size Guide")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(FitMeColors.accent)
                }
            }
            
            HStack(spacing: 10) {
                ForEach(product.sizes, id: \.self) { size in
                    Button(action: { selectedSize = size }) {
                        Text(size)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(selectedSize == size ? FitMeColors.pageBackground : FitMeColors.primaryText)
                            .frame(width: 52, height: 44)
                            .background(selectedSize == size ? FitMeColors.accent : FitMeColors.pageBackground)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(selectedSize == size ? FitMeColors.accent : FitMeColors.cardBorder, lineWidth: 1)
                            )
                            .clipShape(.rect(cornerRadius: 8))
                    }
                }
            }
        }
        .padding(20)
        .background(FitMeColors.cardBackground)
        .overlay(
            Rectangle()
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .sheet(isPresented: $showSizeGuide) {
            sizeGuideSheet
        }
    }
    
    private var sizeGuideSheet: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2)
                .fill(FitMeColors.mutedText)
                .frame(width: 36, height: 4)
                .padding(.top, 12)
                .padding(.bottom, 20)
            
            Text("Size Guide")
                .font(.system(size: 20, weight: .bold, design: .serif))
                .foregroundStyle(FitMeColors.primaryText)
                .padding(.bottom, 20)
            
            VStack(spacing: 0) {
                sizeGuideRow(size: "S", chest: "36-38", length: "27")
                Divider().background(FitMeColors.divider)
                sizeGuideRow(size: "M", chest: "38-40", length: "28")
                Divider().background(FitMeColors.divider)
                sizeGuideRow(size: "L", chest: "40-42", length: "29")
                Divider().background(FitMeColors.divider)
                sizeGuideRow(size: "XL", chest: "42-44", length: "30")
                Divider().background(FitMeColors.divider)
                sizeGuideRow(size: "XXL", chest: "44-46", length: "31")
            }
            .background(FitMeColors.cardBackground)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(FitMeColors.cardBorder, lineWidth: 1)
            )
            .clipShape(.rect(cornerRadius: 12))
            .padding(.horizontal, 20)
            
            Spacer()
        }
        .background(FitMeColors.pageBackground)
        .presentationDetents([.height(420)])
    }
    
    private func sizeGuideRow(size: String, chest: String, length: String) -> some View {
        HStack {
            Text(size)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(FitMeColors.primaryText)
                .frame(width: 50, alignment: .leading)
            
            Text("Chest: \(chest)\"")
                .font(.system(size: 14))
                .foregroundStyle(FitMeColors.secondaryText)
            
            Spacer()
            
            Text("Length: \(length)\"")
                .font(.system(size: 14))
                .foregroundStyle(FitMeColors.secondaryText)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
    
    private func productInfoSection(_ product: Product) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if !product.dominantColors.isEmpty {
                HStack(spacing: 8) {
                    Text("COLORS")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(FitMeColors.accent)
                        .tracking(0.12)
                    
                    HStack(spacing: 6) {
                        ForEach(product.dominantColors, id: \.self) { color in
                            Circle()
                                .fill(Color(hex: color))
                                .frame(width: 18, height: 18)
                                .overlay(
                                    Circle()
                                        .stroke(FitMeColors.cardBorder, lineWidth: 1)
                                )
                        }
                    }
                }
            }
            
            HStack(spacing: 6) {
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(FitMeColors.successGreen)
                Text("Authentic product verified")
                    .font(.system(size: 12))
                    .foregroundStyle(FitMeColors.secondaryText)
            }
        }
        .padding(20)
        .background(FitMeColors.cardBackground)
        .overlay(
            Rectangle()
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
    }
    
    private var tryOnButton: some View {
        VStack(spacing: 10) {
            Button(action: {
                appState.navigationPath.append(NavigationDestination.bodyScan)
            }) {
                HStack(spacing: 10) {
                    Image(systemName: "camera.viewfinder")
                    Text("Try On Me")
                }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(FitMeColors.primaryButton)
                .clipShape(.rect(cornerRadius: 12))
            }
            
            Text("See yourself in this garment with AI-powered fit analysis")
                .font(.system(size: 12))
                .foregroundStyle(FitMeColors.secondaryText)
                .multilineTextAlignment(.center)
        }
        .padding(20)
    }
}
