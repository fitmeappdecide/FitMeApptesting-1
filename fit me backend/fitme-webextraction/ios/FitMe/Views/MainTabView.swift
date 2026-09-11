import SwiftUI

enum NavigationDestination: Hashable {
    case productDetail
    case bodyScan
    case processing
    case tryOnResult
}

struct MainTabView: View {
    @State private var appState = AppState()
    @State private var selectedTab = 0
    
    var body: some View {
        NavigationStack(path: $appState.navigationPath) {
            TabView(selection: $selectedTab) {
                HomeScreen(appState: appState)
                    .tabItem {
                        Image(systemName: "sparkles")
                        Text("Try On")
                    }
                    .tag(0)
                
                ClosetTabView(appState: appState)
                    .tabItem {
                        Image(systemName: "hanger")
                        Text("Closet")
                    }
                    .tag(1)
                
                ProfileScreen(appState: appState)
                    .tabItem {
                        Image(systemName: "person.fill")
                        Text("Profile")
                    }
                    .tag(2)
            }
            .tint(FitMeColors.accent)
            .navigationDestination(for: NavigationDestination.self) { destination in
                switch destination {
                case .productDetail:
                    ProductScreen(appState: appState)
                case .bodyScan:
                    BodyScanScreen(appState: appState)
                case .processing:
                    ProcessingScreen(appState: appState)
                case .tryOnResult:
                    TryOnResultScreen(appState: appState)
                }
            }
        }
        .environment(appState)
    }
}

struct ClosetTabView: View {
    @Bindable var appState: AppState
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    closetHeader
                    
                    if appState.savedOutfits.isEmpty {
                        emptyClosetView
                    } else {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            ForEach(appState.savedOutfits) { outfit in
                                closetCard(outfit)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 16)
                    }
                }
            }
            .background(FitMeColors.pageBackground.ignoresSafeArea())
            .navigationTitle("My Closet")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(FitMeColors.pageBackground, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
    
    private var closetHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("MY CLOSET")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(FitMeColors.accent)
                .tracking(0.12)
            
            Text("Your saved outfits")
                .font(.system(size: 28, weight: .bold, design: .serif))
                .foregroundStyle(FitMeColors.primaryText)
            
            Text("All your try-ons in one place. Tap any outfit to view details or buy.")
                .font(.system(size: 14))
                .foregroundStyle(FitMeColors.secondaryText)
                .lineSpacing(3)
        }
        .padding(20)
        .padding(.top, 8)
    }
    
    private var emptyClosetView: some View {
        VStack(spacing: 20) {
            Image(systemName: "hanger")
                .font(.system(size: 64))
                .foregroundStyle(FitMeColors.mutedText)
            
            Text("Your closet is empty")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(FitMeColors.primaryText)
            
            Text("Save outfits from your try-ons to build your personal collection")
                .font(.system(size: 14))
                .foregroundStyle(FitMeColors.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }
    
    private func closetCard(_ outfit: SavedOutfit) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Color(FitMeColors.cardBackground)
                .frame(height: 180)
                .overlay {
                    Image(systemName: "person.fill.viewfinder")
                        .font(.system(size: 40))
                        .foregroundStyle(FitMeColors.mutedText)
                }
                .clipShape(.rect(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(FitMeColors.cardBorder, lineWidth: 1)
                )
            
            Text(outfit.garmentName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(FitMeColors.primaryText)
                .lineLimit(2)
            
            HStack {
                Text("")
                    .font(.system(size: 12))
                    .foregroundStyle(FitMeColors.secondaryText)
                Spacer()
                Button(action: {
                    if let url = URL(string: outfit.result.priceComparisons.first?.affiliateUrl ?? "") {
                        UIApplication.shared.open(url)
                    }
                }) {
                    Image(systemName: "bag")
                        .font(.system(size: 14))
                        .foregroundStyle(FitMeColors.accent)
                }
            }
        }
        .padding(10)
        .background(FitMeColors.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 12))
    }
    
}
