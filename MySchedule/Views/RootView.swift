//
//  RootView.swift
//  MySchedule
//
//  The welcome screen sits in front of a four-tab shell. Which door you walk
//  through only decides where you land — everything stays reachable.
//

import Foundation
import SwiftUI

enum MainTab: Int, Hashable, CaseIterable, Identifiable {
    case schedule
    case temporary
    case permanent
    case settings

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .schedule:  return "Schedule"
        case .temporary: return "Temporary"
        case .permanent: return "Permanent"
        case .settings:  return "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .schedule:  return "calendar"
        case .temporary: return "hourglass"
        case .permanent: return "leaf.fill"
        case .settings:  return "gearshape"
        }
    }

    init(startTab: StartTab) {
        switch startTab {
        case .schedule, .ask: self = .schedule
        case .temporary:      self = .temporary
        case .permanent:      self = .permanent
        }
    }
}

// MARK: - Shell

struct AppShell: View {

    @EnvironmentObject private var store: ScheduleStore

    @State private var hasEntered = false
    @State private var tab: MainTab = .schedule
    @State private var didConfigure = false

    var body: some View {
        ZStack {
            Palette.canvas.ignoresSafeArea()

            if hasEntered {
                MainTabView(tab: $tab)
                    .transition(.opacity.combined(with: .scale(scale: 1.02)))
            } else {
                WelcomeView { destination in
                    enter(destination)
                }
                .transition(.opacity)
            }
        }
        .animation(Motion.settle, value: hasEntered)
        .overlay(alignment: .top) {
            if let report = store.lastSweep, hasEntered {
                SweepBanner(report: report) {
                    store.dismissSweepReport()
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, 6)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(Motion.settle, value: store.lastSweep)
        .task(id: store.lastSweep) {
            // The banner is a courtesy, not a decision to make. It leaves on its own.
            guard store.lastSweep != nil else { return }
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard !Task.isCancelled else { return }
            store.dismissSweepReport()
        }
        .onAppear(perform: configureOnce)
        .onChange(of: store.pendingDeepLink) { _, link in
            guard let link else { return }
            hasEntered = true
            tab = link.kind == .temporary ? .temporary : .permanent
        }
    }

    private func configureOnce() {
        guard !didConfigure else { return }
        didConfigure = true

        if !store.settings.showWelcomeOnLaunch {
            tab = MainTab(startTab: store.settings.startTab)
            hasEntered = true
        }
    }

    private func enter(_ destination: MainTab) {
        Haptics.tap()
        tab = destination
        hasEntered = true
    }
}

// MARK: - Tabs

struct MainTabView: View {

    @Binding var tab: MainTab
    @EnvironmentObject private var store: ScheduleStore

    var body: some View {
        TabView(selection: $tab) {
            ScheduleView()
                .tabItem { Label(MainTab.schedule.title, systemImage: MainTab.schedule.symbol) }
                .tag(MainTab.schedule)

            TemporaryNotesView()
                .tabItem { Label(MainTab.temporary.title, systemImage: MainTab.temporary.symbol) }
                .tag(MainTab.temporary)
                .badge(store.attentionCount)

            PermanentNotesView()
                .tabItem { Label(MainTab.permanent.title, systemImage: MainTab.permanent.symbol) }
                .tag(MainTab.permanent)

            SettingsView()
                .tabItem { Label(MainTab.settings.title, systemImage: MainTab.settings.symbol) }
                .tag(MainTab.settings)
        }
        .onChange(of: tab) { _, _ in
            Haptics.select()
        }
    }
}

// MARK: - Sweep banner

/// "Two notes expired while you were away." The app cannot run in the
/// background, so this is where the promised tidy-up becomes visible.
struct SweepBanner: View {
    let report: SweepReport
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: "wind")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Palette.gold)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 3) {
                Text(headline)
                    .font(TypeScale.heading(15))
                    .foregroundStyle(Palette.ink)
                Text(detail)
                    .font(TypeScale.caption)
                    .foregroundStyle(Palette.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 4)

            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Palette.inkTertiary)
                    .padding(6)
            }
            .buttonStyle(.plain)
        }
        .cardSurface(raised: true, padding: 14)
    }

    private var headline: String {
        let count = report.expiredTitles.count
        return count == 1 ? "A note has expired" : "\(count) notes have expired"
    }

    private var detail: String {
        let names = report.expiredTitles.prefix(3).joined(separator: ", ")
        if report.expiredTitles.count > 3 {
            return "\(names) and \(report.expiredTitles.count - 3) more came off your schedule. They're in Recently cleared."
        }
        return "\(names) came off your schedule. Find them in Settings › Recently cleared."
    }
}
