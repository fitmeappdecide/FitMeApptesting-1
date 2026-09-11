import SwiftUI

struct ProcessingScreen: View {
    @Bindable var appState: AppState
    @State private var visibleSteps: Set<Int> = []
    @State private var pulseAnimation = false
    
    var body: some View {
        VStack(spacing: 0) {
            headerSection
            
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(Array(processingSteps.enumerated()), id: \.element.id) { index, step in
                        stepRow(step, index: index, isLast: index == processingSteps.count - 1)
                            .opacity(visibleSteps.contains(index) ? 1 : 0)
                            .offset(y: visibleSteps.contains(index) ? 0 : 8)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
            }
            
            Spacer()
            
            progressSection
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
        }
        .background(FitMeColors.pageBackground.ignoresSafeArea())
        .onAppear {
            revealSteps()
        }
        .onChange(of: appState.currentProcessingStep) { _, newValue in
            withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) {
                _ = visibleSteps.insert(newValue)
            }
        }
        .navigationBarBackButtonHidden(true)
    }
    
    private var headerSection: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(FitMeColors.accent.opacity(0.1))
                    .frame(width: 80, height: 80)
                    .scaleEffect(pulseAnimation ? 1.1 : 1.0)
                    .opacity(pulseAnimation ? 0.5 : 1.0)
                
                Circle()
                    .fill(FitMeColors.accent.opacity(0.2))
                    .frame(width: 60, height: 60)
                
                Image(systemName: "sparkles")
                    .font(.system(size: 28))
                    .foregroundStyle(FitMeColors.accent)
            }
            .onAppear {
                withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
                    pulseAnimation = true
                }
            }
            
            Text("CREATING YOUR LOOK")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(FitMeColors.accent)
                .tracking(0.12)
            
            Text("Almost there...")
                .font(.system(size: 24, weight: .bold, design: .serif))
                .foregroundStyle(FitMeColors.primaryText)
            
            Text("This usually takes \(appState.estimatedWaitSeconds) seconds. Please keep the app open.")
                .font(.system(size: 14))
                .foregroundStyle(FitMeColors.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .padding(.top, 32)
        .padding(.bottom, 20)
    }
    
    private func stepRow(_ step: ProcessingStep, index: Int, isLast: Bool) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(spacing: 0) {
                ZStack {
                    Circle()
                        .fill(stepStatus(for: index).background)
                        .frame(width: 28, height: 28)
                    
                    if isStepComplete(index) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(stepStatus(for: index).foreground)
                    } else if isStepActive(index) {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: stepStatus(for: index).foreground))
                            .scaleEffect(0.6)
                    } else {
                        Text("\(step.number)")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(stepStatus(for: index).foreground)
                    }
                }
                
                if !isLast {
                    Rectangle()
                        .fill(stepConnectorColor(for: index))
                        .frame(width: 2, height: 32)
                }
            }
            
            VStack(alignment: .leading, spacing: 4) {
                Text(step.userFriendlyLabel)
                    .font(.system(size: 15, weight: isStepActive(index) ? .semibold : .regular))
                    .foregroundStyle(isStepActive(index) ? FitMeColors.primaryText : FitMeColors.secondaryText)
                
                if isStepActive(index) {
                    Text("In progress...")
                        .font(.system(size: 12))
                        .foregroundStyle(FitMeColors.accent)
                        .transition(.opacity)
                }
            }
            .padding(.top, 2)
            
            Spacer()
        }
    }
    
    private var progressSection: some View {
        VStack(spacing: 12) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(FitMeColors.cardBackground)
                        .frame(height: 8)
                    
                    RoundedRectangle(cornerRadius: 4)
                        .fill(
                            LinearGradient(
                                colors: [FitMeColors.accent, FitMeColors.primaryButton],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: geo.size.width * appState.processingProgress, height: 8)
                        .animation(.easeInOut(duration: 0.3), value: appState.processingProgress)
                }
            }
            .frame(height: 8)
            
            HStack {
                Text("\(Int(appState.processingProgress * 100))%")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(FitMeColors.accent)
                
                Spacer()
                
                if let currentStep = processingSteps[safe: appState.currentProcessingStep] {
                    Text(currentStep.userFriendlyLabel)
                        .font(.system(size: 13))
                        .foregroundStyle(FitMeColors.secondaryText)
                        .lineLimit(1)
                }
            }
            
            if appState.processingProgress < 1.0 {
                HStack(spacing: 6) {
                    Image(systemName: "clock")
                        .font(.system(size: 11))
                        .foregroundStyle(FitMeColors.mutedText)
                    Text("~\(max(1, Int(Double(appState.estimatedWaitSeconds) * (1.0 - appState.processingProgress)))) seconds remaining")
                        .font(.system(size: 12))
                        .foregroundStyle(FitMeColors.mutedText)
                }
            }
        }
        .padding(20)
        .background(FitMeColors.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(FitMeColors.cardBorder, lineWidth: 1)
        )
    }
    
    private func revealSteps() {
        for index in 0..<processingSteps.count {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(index) * 0.08) {
                withAnimation(.easeOut(duration: 0.3)) {
                    _ = visibleSteps.insert(index)
                }
            }
        }
    }
    
    private func isStepComplete(_ index: Int) -> Bool {
        index < appState.currentProcessingStep
    }
    
    private func isStepActive(_ index: Int) -> Bool {
        index == appState.currentProcessingStep
    }
    
    private func stepStatus(for index: Int) -> (background: Color, foreground: Color) {
        if isStepComplete(index) {
            return (FitMeColors.successBackground, FitMeColors.successGreen)
        } else if isStepActive(index) {
            return (FitMeColors.accent.opacity(0.2), FitMeColors.accent)
        } else {
            return (FitMeColors.cardBackground, FitMeColors.mutedText)
        }
    }
    
    private func stepConnectorColor(for index: Int) -> Color {
        if index < appState.currentProcessingStep {
            return FitMeColors.successGreen.opacity(0.5)
        } else {
            return FitMeColors.cardBorder
        }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
