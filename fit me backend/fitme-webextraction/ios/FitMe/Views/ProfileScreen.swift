import SwiftUI

struct ProfileScreen: View {
    @Bindable var appState: AppState
    @State private var selectedTab: ProfileTab = .closet
    
    enum ProfileTab: String, CaseIterable {
        case closet = "My Closet"
        case history = "History"
        case settings = "Settings"
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                profileHeader
                tabSelector
                
                switch selectedTab {
                case .closet:
                    closetSection
                case .history:
                    historySection
                case .settings:
                    settingsSection
                }
            }
        }
        .background(FitMeColors.pageBackground.ignoresSafeArea())
    }
    
    private var profileHeader: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(FitMeColors.cardBackground)
                    .frame(width: 80, height: 80)
                    .overlay(
                        Circle()
                            .stroke(FitMeColors.cardBorder, lineWidth: 1)
                    )
                Image(systemName: "person.fill")
                    .font(.system(size: 36))
                    .foregroundStyle(FitMeColors.accent)
            }
            
            VStack(spacing: 4) {
                Text("Guest User")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(FitMeColors.primaryText)
                Text("Sign in to sync your closet across devices")
                    .font(.system(size: 14))
                    .foregroundStyle(FitMeColors.secondaryText)
            }
            
            Button(action: {}) {
                Text("Sign In")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FitMeColors.primaryButton)
                    .clipShape(.rect(cornerRadius: 12))
            }
        }
        .padding(20)
        .background(FitMeColors.cardBackground)
        .overlay(
            Rectangle()
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
    }
    
    private var tabSelector: some View {
        HStack(spacing: 0) {
            ForEach(ProfileTab.allCases, id: \.self) { tab in
                Button(action: { selectedTab = tab }) {
                    VStack(spacing: 8) {
                        Text(tab.rawValue)
                            .font(.system(size: 14, weight: selectedTab == tab ? .semibold : .medium))
                            .foregroundStyle(selectedTab == tab ? FitMeColors.primaryText : FitMeColors.secondaryText)
                        
                        Rectangle()
                            .fill(selectedTab == tab ? FitMeColors.accent : Color.clear)
                            .frame(height: 2)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 8)
    }
    
    private var closetSection: some View {
        VStack(spacing: 12) {
            if appState.savedOutfits.isEmpty {
                emptyState(
                    icon: "hanger",
                    title: "Your closet is empty",
                    description: "Save outfits from try-ons to build your personal collection"
                )
            } else {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(appState.savedOutfits) { outfit in
                        closetCard(outfit)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 24)
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
    
    private var historySection: some View {
        VStack(spacing: 12) {
            if appState.tryOnHistory.isEmpty {
                emptyState(
                    icon: "clock.arrow.circlepath",
                    title: "No try-ons yet",
                    description: "Your try-on history will appear here"
                )
            } else {
                ForEach(appState.tryOnHistory, id: \.id) { result in
                    historyCard(result)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 24)
    }
    
    private var settingsSection: some View {
        VStack(spacing: 0) {
            settingRow(icon: "ruler.fill", title: "Body Measurements", subtitle: "Height, chest, waist, and more")
            Divider().background(FitMeColors.divider)
            settingRow(icon: "bell.fill", title: "Notifications", subtitle: "Price drop alerts and updates")
            Divider().background(FitMeColors.divider)
            settingRow(icon: "shield.fill", title: "Privacy", subtitle: "Photo deletion and data controls")
            Divider().background(FitMeColors.divider)
            settingRow(icon: "globe", title: "Language", subtitle: "English")
            Divider().background(FitMeColors.divider)
            settingRow(icon: "questionmark.circle.fill", title: "Help & Support", subtitle: "FAQs and contact")
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .background(FitMeColors.cardBackground)
        .overlay(
            Rectangle()
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .padding(.horizontal, 16)
        .padding(.bottom, 24)
    }
    
    private func historyCard(_ result: TryOnResult) -> some View {
        HStack(spacing: 14) {
            Color(FitMeColors.cardBackground)
                .frame(width: 72, height: 72)
                .overlay {
                    Image(systemName: "person.fill.viewfinder")
                        .font(.system(size: 28))
                        .foregroundStyle(FitMeColors.mutedText)
                }
                .clipShape(.rect(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(FitMeColors.cardBorder, lineWidth: 1)
                )
            
            VStack(alignment: .leading, spacing: 6) {
                Text(result.garmentName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FitMeColors.primaryText)
                    .lineLimit(1)
                Text("")
                    .font(.system(size: 13))
                    .foregroundStyle(FitMeColors.secondaryText)
                Text("\(result.processingTime, specifier: "%.1f")s processing")
                    .font(.system(size: 12))
                    .foregroundStyle(FitMeColors.mutedText)
            }
            
            Spacer()
            
            Image(systemName: "chevron.right")
                .font(.system(size: 14))
                .foregroundStyle(FitMeColors.mutedText)
        }
        .padding(14)
        .background(FitMeColors.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 12))
    }
    
    private func settingRow(icon: String, title: String, subtitle: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(FitMeColors.accent)
                .frame(width: 32, height: 32)
            
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FitMeColors.primaryText)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(FitMeColors.secondaryText)
            }
            
            Spacer()
            
            Image(systemName: "chevron.right")
                .font(.system(size: 14))
                .foregroundStyle(FitMeColors.mutedText)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
    
    private func emptyState(icon: String, title: String, description: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 48))
                .foregroundStyle(FitMeColors.mutedText)
            Text(title)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(FitMeColors.primaryText)
            Text(description)
                .font(.system(size: 14))
                .foregroundStyle(FitMeColors.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
        .background(FitMeColors.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 12))
    }
}
