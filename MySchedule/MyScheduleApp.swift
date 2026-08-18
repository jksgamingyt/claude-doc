//
//  MyScheduleApp.swift
//  MySchedule
//
//  Entry point. One store, created once, handed to everything below.
//

import Foundation
import SwiftUI
import UIKit
import UserNotifications

/// The only reason this exists: iOS can launch the app directly into a
/// notification response, and the notification delegate has to be installed
/// before launch finishes or that response is dropped. SwiftUI's App has no
/// hook that early, so a minimal delegate does the job.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        NotificationManager.shared.bootstrap()
        return true
    }
}

@main
struct MyScheduleApp: App {

    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var store = ScheduleStore()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        Chrome.configure()
    }

    var body: some Scene {
        WindowGroup {
            AppShell()
                .environmentObject(store)
                .preferredColorScheme(store.settings.appearance.colorScheme)
                .tint(Palette.moss)
                .onAppear {
                    Haptics.enabled = store.settings.hapticsEnabled
                    store.bootstrap()
                }
                .onChange(of: store.settings.hapticsEnabled) { _, enabled in
                    Haptics.enabled = enabled
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                store.handleForeground()
            case .background, .inactive:
                store.handleBackground()
            @unknown default:
                break
            }
        }
    }
}
