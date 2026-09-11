import SwiftUI

struct TryOnResultScreen: View {
    @Bindable var appState: AppState
    @State private var showSaveConfirmation = false
    @State private var showShareSheet = false
    @State private var showOriginal = false
    @State private var selectedResultIndex = 0
    @State private var zoomScale: CGFloat = 1.0
    
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                headerSection
                resultImageSection
                realismScoreSection
                fitAnalysisSection
                buyDecisionSection
                priceComparisonSection
                alternativesSection
                actionButtonsSection
            }
        }
        .background(FitMeColors.pageBackground.ignoresSafeArea())
        .navigationTitle("Your Try-On")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(FitMeColors.pageBackground, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 16) {
                    Button(action: {
                        appState.saveCurrentOutfit()
                        showSaveConfirmation = true
                    }) {
                        Image(systemName: appState.savedOutfits.contains(where: { $0.id == appState.currentTryOnResult?.id }) ? "bookmark.fill" : "bookmark")
                            .foregroundStyle(FitMeColors.accent)
                    }
                    
                    Button(action: {
                        showShareSheet = true
                    }) {
                        Image(systemName: "square.and.arrow.up")
                            .foregroundStyle(FitMeColors.accent)
                    }
                }
            }
        }
        .overlay(alignment: .bottom) {
            if showSaveConfirmation {
                saveToast
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            withAnimation {
                                showSaveConfirmation = false
                            }
                        }
                    }
            }
        }
        .sheet(isPresented: $showShareSheet) {
            ShareSheet(activityItems: shareItems())
        }
    }
    
    private var headerSection: some View {
        VStack(spacing: 8) {
            Text("YOUR RESULT")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(FitMeColors.accent)
                .tracking(0.12)
            
            Text("Here you are.")
                .font(.system(size: 28, weight: .bold, design: .serif))
                .foregroundStyle(FitMeColors.primaryText)
        }
        .padding(.top, 20)
        .padding(.bottom, 16)
    }
    
    private var resultImageSection: some View {
        VStack(spacing: 12) {
            ZStack {
                Color(FitMeColors.cardBackground)
                    .frame(height: 420)
                    .overlay {
                        resultImageView
                    }
                    .overlay(alignment: .topTrailing) {
                        Text(showOriginal ? "ORIGINAL" : "AI TRY-ON")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(FitMeColors.accent)
                            .tracking(0.1)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(FitMeColors.pageBackground.opacity(0.8))
                            .clipShape(.rect(cornerRadius: 6))
                            .padding(12)
                    }
            }
            .background(FitMeColors.cardBackground)
            .overlay(
                Rectangle()
                    .stroke(FitMeColors.cardBorder, lineWidth: 1)
            )
            .clipShape(.rect(cornerRadius: 12))
            .padding(.horizontal, 16)
            
            Button(action: {
                withAnimation(.spring(duration: 0.3)) {
                    showOriginal.toggle()
                }
            }) {
                HStack(spacing: 8) {
                    Image(systemName: showOriginal ? "eye.slash" : "eye")
                        .font(.system(size: 14))
                    Text(showOriginal ? "Show AI Result" : "Show Original")
                        .font(.system(size: 14, weight: .medium))
                }
                .foregroundStyle(FitMeColors.accent)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(FitMeColors.accent.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(FitMeColors.accent.opacity(0.3), lineWidth: 1)
                )
                .clipShape(.rect(cornerRadius: 20))
            }
        }
    }
    
    @ViewBuilder
    private var resultImageView: some View {
        if let data = currentImageData(), let uiImage = UIImage(data: data) {
            Image(uiImage: uiImage)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: 420)
        } else {
            VStack(spacing: 16) {
                ProgressView()
                    .tint(FitMeColors.accent)
                Text("Loading your look…")
                    .font(.system(size: 14))
                    .foregroundStyle(FitMeColors.secondaryText)
            }
        }
    }

    private func currentImageData() -> Data? {
        guard let result = appState.currentTryOnResult else { return nil }
        // Debug prints for image data
        print("DEBUG currentImageData resultImageData nil:", result.resultImageData == nil)
        if let data = result.resultImageData {
            print("DEBUG currentImageData bytes:", data.count)
        }
        if showOriginal {
            return result.originalSelfieData ?? result.resultImageData
        }
        return result.resultImageData
    }

    private var realismScoreSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("REALISM CHECK")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(FitMeColors.accent)
                .tracking(0.12)
            
            if let score = appState.currentTryOnResult?.realismScore {
                HStack(spacing: 12) {
                    realismMetric(icon: "face.smiling.fill", label: "Face", value: score.faceAccuracy)
                    realismMetric(icon: "tshirt.fill", label: "Garment", value: score.garmentAccuracy)
                    realismMetric(icon: "figure.stand", label: "Fit", value: score.fitConfidence)
                }
                
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.shield.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(FitMeColors.successGreen)
                    Text("High realism confidence — this preview accurately represents how the garment will look on you")
                        .font(.system(size: 12))
                        .foregroundStyle(FitMeColors.secondaryText)
                        .lineSpacing(2)
                }
                .padding(12)
                .background(FitMeColors.successBackground)
                .clipShape(.rect(cornerRadius: 8))
            }
        }
        .padding(16)
        .background(FitMeColors.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }
    
    private func realismMetric(icon: String, label: String, value: Double) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(FitMeColors.accent)
            
            Text("\(Int(value * 100))%")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(FitMeColors.primaryText)
            
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(FitMeColors.accent)
                .tracking(0.1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(FitMeColors.pageBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 8))
    }
    
    private var fitAnalysisSection: some View {
        EmptyView()
    }
    
    private func skinToneCard(_ analysis: SkinToneAnalysis) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "sun.max.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(FitMeColors.accent)
                Text("Color & Skin Tone Analysis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(FitMeColors.accent)
            }
            
            Text(analysis.stylingAdvice)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(FitMeColors.primaryText)
                .lineSpacing(3)
            
            Text(analysis.colorCompatibilityNote)
                .font(.system(size: 13))
                .foregroundStyle(FitMeColors.secondaryText)
                .lineSpacing(2)
        }
        .padding(14)
        .background(FitMeColors.accent.opacity(0.08))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(FitMeColors.accent.opacity(0.2), lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 10))
    }
    
    private func fitChip(label: String, value: String) -> some View {
        VStack(spacing: 4) {
            Text(label)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(FitMeColors.accent)
                .tracking(0.1)
            Text(value.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(FitMeColors.primaryText)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(FitMeColors.pageBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 8))
    }
    
    private var buyDecisionSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("SHOULD YOU BUY THIS?")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(FitMeColors.accent)
                    .tracking(0.12)
                
                Spacer()
                
                if let decision = appState.currentTryOnResult?.buyDecision {
                    Image(systemName: decision.shouldBuy ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(decision.shouldBuy ? FitMeColors.successGreen : FitMeColors.warning)
                }
            }
            
            if let decision = appState.currentTryOnResult?.buyDecision {
                Text(decision.overallVerdict)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(FitMeColors.primaryText)
                
                VStack(alignment: .leading, spacing: 10) {
                    decisionRow(icon: "figure.stand", text: decision.fitAssessment, positive: true)
                    decisionRow(icon: "paintpalette.fill", text: decision.colorMatchAssessment, positive: true)
                    decisionRow(icon: "tag.fill", text: decision.valueAssessment, positive: decision.shouldBuy)
                    if let alt = decision.alternativeNote {
                        decisionRow(icon: "arrow.left.arrow.right", text: alt, positive: false)
                    }
                }
            }
        }
        .padding(16)
        .background(FitMeColors.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }
    
    private func decisionRow(icon: String, text: String, positive: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(positive ? FitMeColors.successGreen : FitMeColors.warning)
                .frame(width: 20)
            Text(text)
                .font(.system(size: 13))
                .foregroundStyle(FitMeColors.secondaryText)
                .lineSpacing(2)
            Spacer()
        }
    }
    
    private var priceComparisonSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("PRICE COMPARISON")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(FitMeColors.accent)
                    .tracking(0.12)
                
                Spacer()
                
                Text("Same brand only")
                    .font(.system(size: 12))
                    .foregroundStyle(FitMeColors.secondaryText)
            }
            
            if let comparisons = appState.currentTryOnResult?.priceComparisons {
                VStack(spacing: 10) {
                    ForEach(comparisons) { comparison in
                        priceRow(comparison)
                    }
                }
            }
        }
        .padding(16)
        .background(FitMeColors.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }
    
    private func priceRow(_ comparison: PriceComparison) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                HStack(spacing: 6) {
                    PlatformDot(color: comparison.platformColor)
                    Text(comparison.platform)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(FitMeColors.primaryText)
                }
                .frame(width: 90, alignment: .leading)
                
                Text(comparison.title)
                    .font(.system(size: 13))
                    .foregroundStyle(FitMeColors.primaryText)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                
                VStack(alignment: .trailing, spacing: 2) {
                    Text(comparison.price)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(FitMeColors.primaryText)
                    if let original = comparison.originalPrice {
                        Text(original)
                            .font(.system(size: 11))
                            .foregroundStyle(FitMeColors.mutedText)
                            .strikethrough(true, color: FitMeColors.mutedText)
                    }
                }
            }
            
            HStack {
                HStack(spacing: 6) {
                    if comparison.isBestPrice {
                        BadgeView(text: "BEST PRICE", backgroundColor: FitMeColors.successBackground, textColor: FitMeColors.successGreen)
                    }
                    if comparison.isFastDelivery {
                        BadgeView(text: "FAST", backgroundColor: FitMeColors.cardBackground, textColor: FitMeColors.secondaryText)
                    }
                    if comparison.isMostTrusted {
                        BadgeView(text: "TRUSTED", backgroundColor: FitMeColors.cardBackground, textColor: FitMeColors.secondaryText)
                    }
                }
                
                Spacer()
                
                Button(action: {
                    appState.openAffiliateLink(comparison.affiliateUrl)
                }) {
                    Text("Buy on \(comparison.platform)")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(FitMeColors.accent)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(FitMeColors.pageBackground)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(FitMeColors.cardBorder, lineWidth: 1)
                        )
                        .clipShape(.rect(cornerRadius: 6))
                }
            }
        }
        .padding(12)
        .background(FitMeColors.pageBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 8))
    }
    
    private var alternativesSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("SIMILAR STYLES YOU MAY LIKE")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(FitMeColors.accent)
                .tracking(0.12)
            
            if let recommendations = appState.currentTryOnResult?.recommendations {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(recommendations) { rec in
                            alternativeCard(rec)
                        }
                    }
                    .contentMargins(.horizontal, 0, for: .scrollContent)
                }
            }
        }
        .padding(16)
        .background(FitMeColors.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }
    
    private func alternativeCard(_ rec: ProductRecommendation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Color(FitMeColors.pageBackground)
                .frame(width: 150, height: 170)
                .overlay {
                    Image(systemName: "tshirt.fill")
                        .font(.system(size: 40))
                        .foregroundStyle(FitMeColors.mutedText)
                }
                .clipShape(.rect(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(FitMeColors.cardBorder, lineWidth: 1)
                )
                .overlay(alignment: .topLeading) {
                    Text(rec.reason.rawValue)
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(FitMeColors.pageBackground)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(FitMeColors.accent)
                        .clipShape(.rect(cornerRadius: 4))
                        .padding(8)
                }
            
            VStack(alignment: .leading, spacing: 3) {
                Text(rec.brand)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(FitMeColors.accent)
                Text(rec.title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(FitMeColors.primaryText)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Text(rec.price)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(FitMeColors.primaryText)
                    if let original = rec.originalPrice {
                        Text(original)
                            .font(.system(size: 11))
                            .foregroundStyle(FitMeColors.mutedText)
                            .strikethrough(true, color: FitMeColors.mutedText)
                    }
                }
            }
            .frame(width: 150, alignment: .leading)
        }
    }
    
    private var actionButtonsSection: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Button(action: {
                    showShareSheet = true
                }) {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.up")
                        Text("Share")
                    }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FitMeColors.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FitMeColors.cardBackground)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(FitMeColors.cardBorder, lineWidth: 1)
                    )
                    .clipShape(.rect(cornerRadius: 12))
                }
                
                Button(action: {
                    appState.saveCurrentOutfit()
                    showSaveConfirmation = true
                }) {
                    HStack(spacing: 8) {
                        Image(systemName: appState.savedOutfits.contains(where: { $0.id == appState.currentTryOnResult?.id }) ? "bookmark.fill" : "bookmark")
                        Text("Save")
                    }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FitMeColors.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FitMeColors.cardBackground)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(FitMeColors.cardBorder, lineWidth: 1)
                    )
                    .clipShape(.rect(cornerRadius: 12))
                }
            }
            
            if let bestPrice = appState.currentTryOnResult?.priceComparisons.first(where: { $0.isBestPrice }) {
                Button(action: {
                    appState.openAffiliateLink(bestPrice.affiliateUrl)
                }) {
                    HStack(spacing: 10) {
                        Image(systemName: "bag.fill")
                        Text("Buy Now — \(bestPrice.price) on \(bestPrice.platform)")
                    }
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(FitMeColors.primaryButton)
                    .clipShape(.rect(cornerRadius: 12))
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 32)
    }
    
    private var saveToast: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 18))
                .foregroundStyle(FitMeColors.successGreen)
            Text("Saved to your closet")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(FitMeColors.primaryText)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .background(FitMeColors.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 12))
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
    }

    private func shareItems() -> [Any] {
        var items: [Any] = ["Check out my FitMe try-on!"]
        if let image = appState.prepareShareImage() { items.insert(image, at: 0) }
        return items
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]
    
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }
    
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

// Placeholder removed; ShareSheet is the only top-level after the extension above.
