//
//  Notes.swift
//  MySchedule
//
//  The two note species that drive everything else in the app.
//
//  A TemporaryNote has a deadline. It rides the schedule until it expires,
//  then it leaves on its own (with a notification on the way out).
//
//  A PermanentNote is a standing arrangement. It appears on the days you tell
//  it to, for as long as you tell it to, forever, until you remove it by hand.
//

import Foundation
import SwiftUI

// MARK: - Note kind

enum NoteKind: String, Codable, CaseIterable, Identifiable, Hashable {
    case temporary
    case permanent

    var id: String { rawValue }

    var title: String {
        switch self {
        case .temporary: return "Temporary"
        case .permanent: return "Permanent"
        }
    }

    var subtitle: String {
        switch self {
        case .temporary: return "Has a deadline. Leaves when it passes."
        case .permanent: return "Stands until you take it down."
        }
    }

    var symbol: String {
        switch self {
        case .temporary: return "hourglass"
        case .permanent: return "leaf.fill"
        }
    }
}

// MARK: - Tag colours

/// A small, deliberately narrow palette. Every tag is legible on both the
/// light (parchment) and dark (night forest) canvases.
enum TagColor: String, Codable, CaseIterable, Identifiable, Hashable {
    case moss
    case fern
    case sky
    case clay
    case gold
    case plum
    case bark

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .moss: return "Moss"
        case .fern: return "Fern"
        case .sky: return "Sky"
        case .clay: return "Clay"
        case .gold: return "Gold"
        case .plum: return "Plum"
        case .bark: return "Bark"
        }
    }

    /// Used for dots, rails and accents.
    var color: Color {
        switch self {
        case .moss: return Color(red: 0.29, green: 0.49, blue: 0.35)
        case .fern: return Color(red: 0.45, green: 0.66, blue: 0.44)
        case .sky:  return Color(red: 0.40, green: 0.60, blue: 0.73)
        case .clay: return Color(red: 0.77, green: 0.44, blue: 0.29)
        case .gold: return Color(red: 0.85, green: 0.64, blue: 0.25)
        case .plum: return Color(red: 0.52, green: 0.40, blue: 0.58)
        case .bark: return Color(red: 0.42, green: 0.34, blue: 0.27)
        }
    }

    static var defaultForTemporary: TagColor { .clay }
    static var defaultForPermanent: TagColor { .moss }
}

// MARK: - Reminder leads

/// How far ahead of a note's moment we want to be nudged.
/// Stored as plain minutes so the JSON on disk stays boring and stable.
struct ReminderLead: Codable, Hashable, Identifiable, Comparable {
    var minutes: Int

    var id: Int { minutes }

    init(_ minutes: Int) {
        self.minutes = max(0, minutes)
    }

    static func < (lhs: ReminderLead, rhs: ReminderLead) -> Bool {
        lhs.minutes < rhs.minutes
    }

    /// Short form, for chips and dense rows.
    var shortLabel: String {
        if minutes == 0 { return "At time" }
        if minutes % 10080 == 0 {
            let weeks = minutes / 10080
            return weeks == 1 ? "1 wk" : "\(weeks) wks"
        }
        if minutes % 1440 == 0 {
            let days = minutes / 1440
            return days == 1 ? "1 day" : "\(days) days"
        }
        if minutes % 60 == 0 {
            let hours = minutes / 60
            return hours == 1 ? "1 hr" : "\(hours) hrs"
        }
        return "\(minutes) min"
    }

    /// Long form, for the notification body and the wizard.
    var longLabel: String {
        if minutes == 0 { return "Right on time" }
        return "\(shortLabel) before"
    }

    static let presets: [ReminderLead] = [
        ReminderLead(0),
        ReminderLead(5),
        ReminderLead(15),
        ReminderLead(30),
        ReminderLead(60),
        ReminderLead(120),
        ReminderLead(180),
        ReminderLead(360),
        ReminderLead(720),
        ReminderLead(1440),
        ReminderLead(2880),
        ReminderLead(10080)
    ]
}

// MARK: - Linger (how long a temporary note outlives its deadline)

/// A temporary note does not have to vanish the instant it is due. This is the
/// grace period between "due" and "gone".
enum LingerPreset: String, Codable, CaseIterable, Identifiable, Hashable {
    case atDue
    case oneHour
    case sixHours
    case endOfDay
    case oneDay
    case threeDays
    case oneWeek

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .atDue:     return "The moment it's due"
        case .oneHour:   return "1 hour after"
        case .sixHours:  return "6 hours after"
        case .endOfDay:  return "End of that day"
        case .oneDay:    return "1 day after"
        case .threeDays: return "3 days after"
        case .oneWeek:   return "1 week after"
        }
    }

    var shortName: String {
        switch self {
        case .atDue:     return "On time"
        case .oneHour:   return "+1 hr"
        case .sixHours:  return "+6 hrs"
        case .endOfDay:  return "End of day"
        case .oneDay:    return "+1 day"
        case .threeDays: return "+3 days"
        case .oneWeek:   return "+1 wk"
        }
    }

    /// Resolve the expiry instant for a given deadline.
    func expiry(after due: Date, calendar: Calendar) -> Date {
        switch self {
        case .atDue:
            return due
        case .oneHour:
            return due.addingTimeInterval(3600)
        case .sixHours:
            return due.addingTimeInterval(6 * 3600)
        case .endOfDay:
            let startOfNextDay = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: due))
            return startOfNextDay ?? due.addingTimeInterval(3600)
        case .oneDay:
            return due.addingTimeInterval(24 * 3600)
        case .threeDays:
            return due.addingTimeInterval(3 * 24 * 3600)
        case .oneWeek:
            return due.addingTimeInterval(7 * 24 * 3600)
        }
    }
}

// MARK: - Recurrence (when a permanent note shows up)

/// Flattened on purpose: a `kind` plus the fields that kind happens to use.
/// Enums with associated values encode awkwardly and migrate worse.
struct Recurrence: Codable, Hashable {
    enum Kind: String, Codable, CaseIterable, Identifiable, Hashable {
        case daily
        case weekdays
        case weekends
        case selectedDays
        case everyNDays
        case dayOfMonth

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .daily:        return "Every day"
            case .weekdays:     return "Weekdays"
            case .weekends:     return "Weekends"
            case .selectedDays: return "Pick the days"
            case .everyNDays:   return "Every few days"
            case .dayOfMonth:   return "Once a month"
            }
        }

        var symbol: String {
            switch self {
            case .daily:        return "sun.max"
            case .weekdays:     return "briefcase"
            case .weekends:     return "figure.hiking"
            case .selectedDays: return "calendar.day.timeline.left"
            case .everyNDays:   return "arrow.triangle.2.circlepath"
            case .dayOfMonth:   return "calendar"
            }
        }
    }

    var kind: Kind = .daily

    /// Calendar weekday numbers, 1 = Sunday ... 7 = Saturday. Used by `.selectedDays`.
    var weekdays: [Int] = [2, 3, 4, 5, 6]

    /// Used by `.everyNDays`. Always at least 1.
    var interval: Int = 2

    /// Used by `.dayOfMonth`. 1...31, clamped to the real length of each month.
    var dayOfMonth: Int = 1

    static let everyDay = Recurrence(kind: .daily)

    /// Does this recurrence land on `day`, given it began on `start`?
    init(
        kind: Kind = .daily,
        weekdays: [Int] = [2, 3, 4, 5, 6],
        interval: Int = 2,
        dayOfMonth: Int = 1
    ) {
        self.kind = kind
        self.weekdays = weekdays
        self.interval = interval
        self.dayOfMonth = dayOfMonth
    }

    enum CodingKeys: String, CodingKey {
        case kind, weekdays, interval, dayOfMonth
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = container.value(.kind, or: Kind.daily)
        weekdays = container.value(.weekdays, or: [2, 3, 4, 5, 6])
        interval = container.value(.interval, or: 2)
        dayOfMonth = container.value(.dayOfMonth, or: 1)
    }

    func occurs(on day: Date, start: Date, calendar: Calendar) -> Bool {
        let target = calendar.startOfDay(for: day)
        let origin = calendar.startOfDay(for: start)
        if target < origin { return false }

        switch kind {
        case .daily:
            return true

        case .weekdays:
            let wd = calendar.component(.weekday, from: target)
            return wd >= 2 && wd <= 6

        case .weekends:
            let wd = calendar.component(.weekday, from: target)
            return wd == 1 || wd == 7

        case .selectedDays:
            if weekdays.isEmpty { return false }
            return weekdays.contains(calendar.component(.weekday, from: target))

        case .everyNDays:
            let step = max(1, interval)
            let days = calendar.dateComponents([.day], from: origin, to: target).day ?? 0
            return days >= 0 && days % step == 0

        case .dayOfMonth:
            let wanted = min(max(1, dayOfMonth), 31)
            let dayNumber = calendar.component(.day, from: target)
            if dayNumber == wanted { return true }
            // If the month is too short (e.g. the 31st in a 30-day month),
            // fall back to the last day of that month so the note is never lost.
            guard let range = calendar.range(of: .day, in: .month, for: target) else { return false }
            let lastDay = range.upperBound - 1
            return wanted > lastDay && dayNumber == lastDay
        }
    }

    /// A one-line human description, e.g. "Mon, Wed, Fri".
    func summary(calendar: Calendar) -> String {
        switch kind {
        case .daily:
            return "Every day"
        case .weekdays:
            return "Weekdays"
        case .weekends:
            return "Weekends"
        case .selectedDays:
            if weekdays.isEmpty { return "No days chosen" }
            let symbols = calendar.shortWeekdaySymbols
            let names = weekdays.sorted().compactMap { index -> String? in
                let slot = index - 1
                guard slot >= 0 && slot < symbols.count else { return nil }
                return symbols[slot]
            }
            return names.joined(separator: ", ")
        case .everyNDays:
            let step = max(1, interval)
            return step == 1 ? "Every day" : "Every \(step) days"
        case .dayOfMonth:
            return "Day \(min(max(1, dayOfMonth), 31)) of each month"
        }
    }
}

// MARK: - Temporary note

struct TemporaryNote: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var title: String
    var details: String = ""

    /// The deadline itself: day and time already folded together.
    var due: Date

    /// True when only the day matters. The due time is pinned to 9am for
    /// notification purposes but the UI shows it as an all-day item.
    var isAllDay: Bool = false

    /// Grace period, and the instant it resolves to. `expiresAt` is stored so a
    /// note's disappearance never shifts underneath the user.
    var linger: LingerPreset = .atDue
    var expiresAt: Date

    var reminders: [ReminderLead] = []
    var notifyOnExpiry: Bool = true

    var tag: TagColor = .clay
    var createdAt: Date = Date()

    var isDone: Bool = false
    var doneAt: Date? = nil

    init(
        id: UUID = UUID(),
        title: String,
        details: String = "",
        due: Date,
        isAllDay: Bool = false,
        linger: LingerPreset = .atDue,
        expiresAt: Date? = nil,
        reminders: [ReminderLead] = [],
        notifyOnExpiry: Bool = true,
        tag: TagColor = .clay,
        createdAt: Date = Date(),
        isDone: Bool = false,
        doneAt: Date? = nil,
        calendar: Calendar = .current
    ) {
        self.id = id
        self.title = title
        self.details = details
        self.due = due
        self.isAllDay = isAllDay
        self.linger = linger
        self.expiresAt = expiresAt ?? linger.expiry(after: due, calendar: calendar)
        self.reminders = reminders
        self.notifyOnExpiry = notifyOnExpiry
        self.tag = tag
        self.createdAt = createdAt
        self.isDone = isDone
        self.doneAt = doneAt
    }

    /// Recompute `expiresAt` from the current `due` + `linger`.
    mutating func refreshExpiry(calendar: Calendar = .current) {
        expiresAt = linger.expiry(after: due, calendar: calendar)
    }

    // MARK: Tolerant decoding

    enum CodingKeys: String, CodingKey {
        case id, title, details, due, isAllDay, linger, expiresAt
        case reminders, notifyOnExpiry, tag, createdAt, isDone, doneAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let due = container.value(.due, or: Date())

        self.id = container.value(.id, or: UUID())
        self.title = container.value(.title, or: "Untitled")
        self.details = container.value(.details, or: "")
        self.due = due
        self.isAllDay = container.value(.isAllDay, or: false)
        self.linger = container.value(.linger, or: LingerPreset.atDue)
        self.expiresAt = container.value(.expiresAt, or: due)
        self.reminders = container.value(.reminders, or: LossyArray<ReminderLead>()).elements
        self.notifyOnExpiry = container.value(.notifyOnExpiry, or: true)
        self.tag = container.value(.tag, or: TagColor.clay)
        self.createdAt = container.value(.createdAt, or: due)
        self.isDone = container.value(.isDone, or: false)
        self.doneAt = container.value(.doneAt, or: Optional<Date>.none)
    }

    func isExpired(asOf now: Date = Date()) -> Bool {
        expiresAt <= now
    }

    func isOverdue(asOf now: Date = Date()) -> Bool {
        !isDone && due < now
    }
}

// MARK: - Permanent note

struct PermanentNote: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var title: String
    var details: String = ""

    /// Which days it shows up on.
    var recurrence: Recurrence = .everyDay

    /// The first day it is allowed to appear.
    var startDate: Date = Date()

    /// Minutes from midnight. 8 * 60 == 08:00.
    var startMinutes: Int = 8 * 60

    /// How long it holds its place on the schedule, in minutes.
    /// `PermanentNote.allDayDuration` means "the whole day".
    var durationMinutes: Int = 60

    var reminders: [ReminderLead] = []

    var tag: TagColor = .moss
    var isMuted: Bool = false
    var createdAt: Date = Date()

    static let allDayDuration = 24 * 60

    var isAllDay: Bool { durationMinutes >= PermanentNote.allDayDuration }

    /// The start instant on a given day, or nil if the note does not occur then.
    init(
        id: UUID = UUID(),
        title: String,
        details: String = "",
        recurrence: Recurrence = .everyDay,
        startDate: Date = Date(),
        startMinutes: Int = 8 * 60,
        durationMinutes: Int = 60,
        reminders: [ReminderLead] = [],
        tag: TagColor = .moss,
        isMuted: Bool = false,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.details = details
        self.recurrence = recurrence
        self.startDate = startDate
        self.startMinutes = startMinutes
        self.durationMinutes = durationMinutes
        self.reminders = reminders
        self.tag = tag
        self.isMuted = isMuted
        self.createdAt = createdAt
    }

    // MARK: Tolerant decoding

    enum CodingKeys: String, CodingKey {
        case id, title, details, recurrence, startDate, startMinutes
        case durationMinutes, reminders, tag, isMuted, createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        self.id = container.value(.id, or: UUID())
        self.title = container.value(.title, or: "Untitled")
        self.details = container.value(.details, or: "")
        self.recurrence = container.value(.recurrence, or: Recurrence.everyDay)
        self.startDate = container.value(.startDate, or: Date())
        self.startMinutes = container.value(.startMinutes, or: 8 * 60)
        self.durationMinutes = container.value(.durationMinutes, or: 60)
        self.reminders = container.value(.reminders, or: LossyArray<ReminderLead>()).elements
        self.tag = container.value(.tag, or: TagColor.moss)
        self.isMuted = container.value(.isMuted, or: false)
        self.createdAt = container.value(.createdAt, or: Date())
    }

    func occurrenceStart(on day: Date, calendar: Calendar) -> Date? {
        guard recurrence.occurs(on: day, start: startDate, calendar: calendar) else { return nil }
        let base = calendar.startOfDay(for: day)
        return calendar.date(byAdding: .minute, value: startMinutes, to: base)
    }

    func timeSummary(calendar: Calendar) -> String {
        if isAllDay { return "All day" }
        let formatted = TimeFormatting.time(fromMinutes: startMinutes, calendar: calendar)
        return "\(formatted) · \(DurationFormatting.describe(minutes: durationMinutes))"
    }
}

// MARK: - Archive

/// Where temporary notes go once they have run their course. Nothing the user
/// wrote is thrown away silently; the archive is trimmed on a schedule they set.
struct ArchivedNote: Identifiable, Codable, Hashable {
    enum Reason: String, Codable, Hashable {
        case expired
        case completed
        case deleted

        var displayName: String {
            switch self {
            case .expired:   return "Expired"
            case .completed: return "Done"
            case .deleted:   return "Removed"
            }
        }

        var symbol: String {
            switch self {
            case .expired:   return "hourglass.bottomhalf.filled"
            case .completed: return "checkmark.circle.fill"
            case .deleted:   return "trash"
            }
        }
    }

    var id: UUID = UUID()
    var title: String
    var details: String
    var due: Date
    var tag: TagColor
    var reason: Reason
    var archivedAt: Date
    var kind: NoteKind

    init(from note: TemporaryNote, reason: Reason, at date: Date = Date()) {
        self.id = note.id
        self.title = note.title
        self.details = note.details
        self.due = note.due
        self.tag = note.tag
        self.reason = reason
        self.archivedAt = date
        self.kind = .temporary
    }

    init(from note: PermanentNote, reason: Reason, at date: Date = Date()) {
        self.id = note.id
        self.title = note.title
        self.details = note.details
        self.due = note.startDate
        self.tag = note.tag
        self.reason = reason
        self.archivedAt = date
        self.kind = .permanent
    }
}
