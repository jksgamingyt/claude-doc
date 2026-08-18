//
//  ScheduleEntry.swift
//  MySchedule
//
//  The flattened, day-resolved thing the schedule actually draws. Entries are
//  derived from notes — never stored, never edited directly. Change a note and
//  the schedule follows on the next render. That is the whole contract of the
//  app: the notes sections are the source of truth, the schedule is the view.
//

import Foundation

struct ScheduleEntry: Identifiable, Hashable {

    enum Origin: Hashable {
        case temporary(UUID)
        case permanent(UUID)

        var noteID: UUID {
            switch self {
            case .temporary(let id): return id
            case .permanent(let id): return id
            }
        }

        var kind: NoteKind {
            switch self {
            case .temporary: return .temporary
            case .permanent: return .permanent
            }
        }
    }

    /// Stable across renders: note id + the day it lands on.
    let id: String
    let origin: Origin
    let title: String
    let details: String

    /// The day this entry belongs to (midnight, local).
    let day: Date

    /// The moment it starts. For all-day entries this is the start of the day.
    let start: Date

    /// The moment it stops holding a place on the schedule.
    let end: Date

    let isAllDay: Bool
    let tag: TagColor
    let isDone: Bool
    let isOverdue: Bool

    /// Permanent notes carry their pattern ("Weekdays") for the row subtitle.
    let recurrenceSummary: String?

    /// Temporary notes carry when they will drop off.
    let expiresAt: Date?

    var kind: NoteKind { origin.kind }

    var noteID: UUID { origin.noteID }

    /// Sort key: all-day items float to the top of a day, then by clock time.
    var sortKey: (Int, TimeInterval) {
        (isAllDay ? 0 : 1, start.timeIntervalSince1970)
    }

    var timeLabel: String {
        if isAllDay { return "All day" }
        return TimeFormatting.clock.string(from: start)
    }

    var rangeLabel: String {
        if isAllDay { return "All day" }
        let startText = TimeFormatting.clock.string(from: start)
        if end <= start.addingTimeInterval(60) { return startText }
        return "\(startText) – \(TimeFormatting.clock.string(from: end))"
    }
}

/// One day and everything on it. A named type rather than a tuple, because
/// SwiftUI's ForEach needs a key path and tuples cannot provide one.
struct AgendaDay: Identifiable, Hashable {
    let day: Date
    let entries: [ScheduleEntry]

    var id: Date { day }
}

/// One day's worth of summary, used to paint the month grid without building
/// every entry for every visible day.
struct DayMarker: Hashable {
    var temporaryCount: Int = 0
    var permanentCount: Int = 0
    var overdueCount: Int = 0
    var doneCount: Int = 0
    var tags: [TagColor] = []

    var total: Int { temporaryCount + permanentCount }
    var isEmpty: Bool { total == 0 }

    /// At most three dots on a calendar cell; more than that reads as noise.
    var dotTags: [TagColor] {
        Array(tags.prefix(3))
    }

    var hasOverflow: Bool { tags.count > 3 }
}
