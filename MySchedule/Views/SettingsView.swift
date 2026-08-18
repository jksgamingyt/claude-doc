//
//  SettingsView.swift
//  MySchedule
//
//  Defaults, notification permissions, and the honest explanation of what the
//  app can and cannot do while it is closed.
//

import Foundation
import SwiftUI
import UIKit

struct SettingsView: View {

    @EnvironmentObject private var store: ScheduleStore
    @Environment(\.openURL) private var openURL

    @State private var exportURL: URL?
    @State private var confirmingErase = false

    var body: some View {
        NavigationStack {
            ZStack {
                NatureBackground(intensity: 0.25, showsRidges: false)

                Form {
                    notificationsSection
                    defaultRemindersSection
                    quietHoursSection
                    scheduleSection
                    appearanceSection
                    dataSection
                    aboutSection
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.large)
            .confirmationDialog(
                "Erase everything?",
                isPresented: $confirmingErase,
                titleVisibility: .visible
            ) {
                Button("Erase all notes", role: .destructive) {
                    store.eraseEverything()
                    Haptics.warning()
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("Every note, both kinds, plus the archive. This cannot be undone.")
            }
        }
    }

    // MARK: - Notifications

    private var notificationsSection: some View {
        Section {
            HStack(spacing: 11) {
                Image(systemName: store.notificationStatus.isUsable ? "bell.badge.fill" : "bell.slash")
                    .font(.system(size: 16))
                    .foregroundStyle(store.notificationStatus.isUsable ? Palette.moss : Palette.clay)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text(store.notificationStatus.isUsable ? "Reminders are on" : "Reminders are off")
                        .font(TypeScale.bodyEmphasis)
                    Text(store.notificationStatus.explanation)
                        .font(TypeScale.caption)
                        .foregroundStyle(Palette.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.vertical, 3)

            switch store.notificationStatus {
            case .notDetermined, .unknown:
                Button("Allow notifications") {
                    Haptics.tap()
                    store.requestNotificationPermission()
                }
            case .denied:
                Button("Open iOS Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        openURL(url)
                    }
                }
            default:
                LabeledContent("Scheduled alerts") {
                    Text("\(store.pendingNotificationCount)")
                        .monospacedDigit()
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
        } header: {
            Text("Notifications")
        } footer: {
            Text("iOS holds at most 64 pending alerts per app, so MySchedule keeps the nearest ones scheduled and refreshes the list every time you open it.")
        }
    }

    // MARK: - Default reminders

    private var defaultRemindersSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Text("New temporary notes")
                    .font(TypeScale.captionEmphasis)
                    .foregroundStyle(Palette.inkSecondary)
                ReminderPicker(selection: temporaryRemindersBinding, tint: Palette.clay)
            }
            .padding(.vertical, 4)

            VStack(alignment: .leading, spacing: 10) {
                Text("New permanent notes")
                    .font(TypeScale.captionEmphasis)
                    .foregroundStyle(Palette.inkSecondary)
                ReminderPicker(
                    selection: permanentRemindersBinding,
                    tint: Palette.moss,
                    emptyMessage: "Silent by default."
                )
            }
            .padding(.vertical, 4)

            Picker("Clears by default", selection: $store.settings.defaultLinger) {
                ForEach(LingerPreset.allCases) { preset in
                    Text(preset.displayName).tag(preset)
                }
            }

            Toggle("Alert at the due time", isOn: $store.settings.notifyAtDueTime)
            Toggle("Alert when a note expires", isOn: $store.settings.notifyOnExpiry)
        } header: {
            Text("Default reminders")
        } footer: {
            Text("These fill in the last step of each wizard. You can always change them per note.")
        }
    }

    // MARK: - Quiet hours

    private var quietHoursSection: some View {
        Section {
            Toggle("Hold alerts overnight", isOn: $store.settings.quietHoursEnabled)

            if store.settings.quietHoursEnabled {
                DatePicker(
                    "Quiet from",
                    selection: minutesBinding(get: { $0.quietStartMinutes }, set: { $0.quietStartMinutes = $1 }),
                    displayedComponents: [.hourAndMinute]
                )
                DatePicker(
                    "Until",
                    selection: minutesBinding(get: { $0.quietEndMinutes }, set: { $0.quietEndMinutes = $1 }),
                    displayedComponents: [.hourAndMinute]
                )
            }
        } header: {
            Text("Quiet hours")
        } footer: {
            Text("Alerts that would land inside this window are pushed to the moment it ends. The note itself still expires on time.")
        }
    }

    // MARK: - Schedule

    private var scheduleSection: some View {
        Section {
            Stepper(value: $store.settings.calendarYear, in: 2020...2100) {
                LabeledContent("Calendar year") {
                    Text(String(store.settings.calendarYear))
                        .monospacedDigit()
                        .foregroundStyle(Palette.inkSecondary)
                }
            }

            Toggle("Weeks start on Monday", isOn: $store.settings.weekStartsOnMonday)
            Toggle("Keep finished notes visible", isOn: $store.settings.showCompletedOnSchedule)
            Toggle("Show permanent notes", isOn: $store.settings.showPermanentOnSchedule)
        } header: {
            Text("Schedule")
        } footer: {
            Text("The calendar opens on this year and covers all of it, day by day. It widens automatically if you place a note outside it.")
        }
    }

    // MARK: - Appearance

    private var appearanceSection: some View {
        Section {
            Picker("Theme", selection: $store.settings.appearance) {
                ForEach(AppearanceMode.allCases) { mode in
                    Label(mode.displayName, systemImage: mode.symbol).tag(mode)
                }
            }

            Toggle("Haptics", isOn: $store.settings.hapticsEnabled)
            Toggle("Welcome screen on launch", isOn: $store.settings.showWelcomeOnLaunch)

            Picker("Open to", selection: $store.settings.startTab) {
                ForEach(StartTab.allCases) { tab in
                    Text(tab.displayName).tag(tab)
                }
            }
        } header: {
            Text("Look and feel")
        }
    }

    // MARK: - Data

    private var dataSection: some View {
        Section {
            NavigationLink {
                ArchiveView()
                    .environmentObject(store)
            } label: {
                LabeledContent("Recently cleared") {
                    Text("\(store.archive.count)")
                        .monospacedDigit()
                        .foregroundStyle(Palette.inkSecondary)
                }
            }

            Picker("Keep cleared notes for", selection: $store.settings.archiveRetentionDays) {
                Text("7 days").tag(7)
                Text("30 days").tag(30)
                Text("90 days").tag(90)
                Text("Forever").tag(0)
            }

            Button {
                Haptics.tap()
                exportURL = writeBackup()
            } label: {
                Label("Create a backup file", systemImage: "tray.and.arrow.down")
            }

            if let exportURL {
                ShareLink(item: exportURL) {
                    Label("Share backup", systemImage: "square.and.arrow.up")
                }
            }

            Button(role: .destructive) {
                confirmingErase = true
            } label: {
                Label("Erase everything", systemImage: "trash")
            }
        } header: {
            Text("Your data")
        } footer: {
            Text("Everything lives in a single file on this phone. Nothing is uploaded and there is no account.")
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        Section {
            NavigationLink {
                HowItWorksView()
            } label: {
                Label("How MySchedule works", systemImage: "book")
            }

            LabeledContent("Notes") {
                Text("\(store.temporaryNotes.count) temporary · \(store.permanentNotes.count) permanent")
                    .font(TypeScale.caption)
                    .foregroundStyle(Palette.inkSecondary)
            }

            if let sweep = store.settings.lastSweepAt {
                LabeledContent("Last tidy-up") {
                    Text(TimeFormatting.full.string(from: sweep))
                        .font(TypeScale.caption)
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
        } header: {
            Text("About")
        }
    }

    // MARK: - Bindings

    private var temporaryRemindersBinding: Binding<[ReminderLead]> {
        Binding(
            get: { store.settings.defaultTemporaryReminders.sorted(by: >).map { ReminderLead($0) } },
            set: { store.settings.defaultTemporaryReminders = $0.map { $0.minutes }.sorted(by: >) }
        )
    }

    private var permanentRemindersBinding: Binding<[ReminderLead]> {
        Binding(
            get: { store.settings.defaultPermanentReminders.sorted(by: >).map { ReminderLead($0) } },
            set: { store.settings.defaultPermanentReminders = $0.map { $0.minutes }.sorted(by: >) }
        )
    }

    private func minutesBinding(
        get getter: @escaping (AppSettings) -> Int,
        set setter: @escaping (inout AppSettings, Int) -> Void
    ) -> Binding<Date> {
        Binding(
            get: {
                let calendar = store.calendar
                let base = calendar.startOfDay(for: Date())
                return calendar.date(byAdding: .minute, value: getter(store.settings), to: base) ?? base
            },
            set: { newValue in
                let calendar = store.calendar
                let components = calendar.dateComponents([.hour, .minute], from: newValue)
                let minutes = (components.hour ?? 0) * 60 + (components.minute ?? 0)
                var settings = store.settings
                setter(&settings, minutes)
                store.settings = settings
            }
        )
    }

    // MARK: - Backup

    private func writeBackup() -> URL? {
        guard let data = store.exportJSON() else { return nil }
        let stamp = TimeFormatting.dayKey.string(from: Date())
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("MySchedule-backup-\(stamp).json")
        do {
            try data.write(to: url, options: [.atomic])
            return url
        } catch {
            return nil
        }
    }
}
