//
//  AppSettings.swift
//  MySchedule
//
//  Every knob the app exposes, in one Codable blob saved next to the notes.
//

import Foundation

enum AppearanceMode: String, Codable, CaseIterable, Identifiable, Hashable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .system: return "Match phone"
        case .light:  return "Daylight"
        case .dark:   return "Nightfall"
        }
    }

    var symbol: String {
        switch self {
        case .system: return "iphone"
        case .light:  return "sun.max.fill"
        case .dark:   return "moon.stars.fill"
        }
    }
}

enum StartTab: String, Codable, CaseIterable, Identifiable, Hashable {
    case ask
    case schedule
    case temporary
    case permanent

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .ask:       return "Let me choose"
        case .schedule:  return "Schedule"
        case .temporary: return "Temporary notes"
        case .permanent: return "Permanent notes"
        }
    }
}

struct AppSettings: Codable, Hashable {

    // MARK: Reminders

    /// Applied to every new temporary note. Default: a day ahead, then an hour ahead.
    var defaultTemporaryReminders: [Int] = [1440, 60]

    /// Applied to every new permanent note. Default: a nudge right as it begins.
    var defaultPermanentReminders: [Int] = [0]

    /// Whether a temporary note announces its own departure.
    var notifyOnExpiry: Bool = true

    /// Default grace period for new temporary notes.
    var defaultLinger: LingerPreset = .atDue

    /// One last "this is due right now" alert, independent of the lead reminders.
    var notifyAtDueTime: Bool = true

    // MARK: Quiet hours

    var quietHoursEnabled: Bool = false
    /// Minutes from midnight.
    var quietStartMinutes: Int = 22 * 60
    var quietEndMinutes: Int = 7 * 60

    /// Is `date` inside the quiet window?
    func isQuiet(_ date: Date, calendar: Calendar = .current) -> Bool {
        guard quietHoursEnabled else { return false }
        let components = calendar.dateComponents([.hour, .minute], from: date)
        let minutes = (components.hour ?? 0) * 60 + (components.minute ?? 0)
        if quietStartMinutes == quietEndMinutes { return false }
        if quietStartMinutes < quietEndMinutes {
            return minutes >= quietStartMinutes && minutes < quietEndMinutes
        }
        // Window wraps past midnight.
        return minutes >= quietStartMinutes || minutes < quietEndMinutes
    }

    /// Push a notification out of the quiet window, to the moment it ends.
    func shiftedOutOfQuietHours(_ date: Date, calendar: Calendar = .current) -> Date {
        guard isQuiet(date, calendar: calendar) else { return date }
        let dayStart = calendar.startOfDay(for: date)
        let components = calendar.dateComponents([.hour, .minute], from: date)
        let minutes = (components.hour ?? 0) * 60 + (components.minute ?? 0)

        // If we are in the pre-dawn tail of a wrapping window, the end is today.
        // Otherwise it is tomorrow morning.
        let sameDay = quietStartMinutes < quietEndMinutes || minutes < quietEndMinutes
        let base = sameDay ? dayStart : (calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart)
        return calendar.date(byAdding: .minute, value: quietEndMinutes, to: base) ?? date
    }

    // MARK: Schedule

    /// The year the calendar opens on. The range grows automatically if a note
    /// is placed outside it.
    var calendarYear: Int = 2026

    var weekStartsOnMonday: Bool = false

    /// Keep finished temporary notes visible (dimmed) until they expire.
    var showCompletedOnSchedule: Bool = true

    /// Show permanent notes on the schedule. Off makes the schedule deadline-only.
    var showPermanentOnSchedule: Bool = true

    // MARK: Archive

    /// 0 means "keep forever".
    var archiveRetentionDays: Int = 30

    // MARK: Presentation

    var appearance: AppearanceMode = .system
    var hapticsEnabled: Bool = true
    var showWelcomeOnLaunch: Bool = true
    var startTab: StartTab = .ask

    // MARK: Bookkeeping

    var hasRequestedNotificationPermission: Bool = false
    var lastSweepAt: Date? = nil

    static let `default` = AppSettings()

    var temporaryReminderLeads: [ReminderLead] {
        defaultTemporaryReminders.sorted(by: >).map { ReminderLead($0) }
    }

    var permanentReminderLeads: [ReminderLead] {
        defaultPermanentReminders.sorted(by: >).map { ReminderLead($0) }
    }

    // MARK: - Tolerant decoding
    //
    // Synthesised Codable treats a missing key as an error, which would mean a
    // future settings field resets every existing preference. Decoding each key
    // independently keeps old files readable forever.

    enum CodingKeys: String, CodingKey {
        case defaultTemporaryReminders
        case defaultPermanentReminders
        case notifyOnExpiry
        case defaultLinger
        case notifyAtDueTime
        case quietHoursEnabled
        case quietStartMinutes
        case quietEndMinutes
        case calendarYear
        case weekStartsOnMonday
        case showCompletedOnSchedule
        case showPermanentOnSchedule
        case archiveRetentionDays
        case appearance
        case hapticsEnabled
        case showWelcomeOnLaunch
        case startTab
        case hasRequestedNotificationPermission
        case lastSweepAt
    }

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let fallback = AppSettings()

        defaultTemporaryReminders = container.value(.defaultTemporaryReminders, or: fallback.defaultTemporaryReminders)
        defaultPermanentReminders = container.value(.defaultPermanentReminders, or: fallback.defaultPermanentReminders)
        notifyOnExpiry = container.value(.notifyOnExpiry, or: fallback.notifyOnExpiry)
        defaultLinger = container.value(.defaultLinger, or: fallback.defaultLinger)
        notifyAtDueTime = container.value(.notifyAtDueTime, or: fallback.notifyAtDueTime)

        quietHoursEnabled = container.value(.quietHoursEnabled, or: fallback.quietHoursEnabled)
        quietStartMinutes = container.value(.quietStartMinutes, or: fallback.quietStartMinutes)
        quietEndMinutes = container.value(.quietEndMinutes, or: fallback.quietEndMinutes)

        calendarYear = container.value(.calendarYear, or: fallback.calendarYear)
        weekStartsOnMonday = container.value(.weekStartsOnMonday, or: fallback.weekStartsOnMonday)
        showCompletedOnSchedule = container.value(.showCompletedOnSchedule, or: fallback.showCompletedOnSchedule)
        showPermanentOnSchedule = container.value(.showPermanentOnSchedule, or: fallback.showPermanentOnSchedule)

        archiveRetentionDays = container.value(.archiveRetentionDays, or: fallback.archiveRetentionDays)

        appearance = container.value(.appearance, or: fallback.appearance)
        hapticsEnabled = container.value(.hapticsEnabled, or: fallback.hapticsEnabled)
        showWelcomeOnLaunch = container.value(.showWelcomeOnLaunch, or: fallback.showWelcomeOnLaunch)
        startTab = container.value(.startTab, or: fallback.startTab)

        hasRequestedNotificationPermission = container.value(.hasRequestedNotificationPermission, or: fallback.hasRequestedNotificationPermission)
        lastSweepAt = container.value(.lastSweepAt, or: fallback.lastSweepAt)
    }
}
