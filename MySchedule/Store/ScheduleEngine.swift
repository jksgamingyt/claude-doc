//
//  ScheduleEngine.swift
//  MySchedule
//
//  Turns notes into days. This is the single place where "what did I write down"
//  becomes "what is on my schedule", so the two can never drift apart.
//

import Foundation

struct ScheduleEngine {

    var calendar: Calendar
    var temporaryNotes: [TemporaryNote]
    var permanentNotes: [PermanentNote]
    var settings: AppSettings
    var now: Date

    init(
        calendar: Calendar,
        temporaryNotes: [TemporaryNote],
        permanentNotes: [PermanentNote],
        settings: AppSettings,
        now: Date = Date()
    ) {
        self.calendar = calendar
        self.temporaryNotes = temporaryNotes
        self.permanentNotes = permanentNotes
        self.settings = settings
        self.now = now
    }

    // MARK: - Single day

    func entries(on day: Date) -> [ScheduleEntry] {
        let dayStart = calendar.startOfDay(for: day)
        guard let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) else { return [] }
        let key = TimeFormatting.dayKey.string(from: dayStart)

        var result: [ScheduleEntry] = []

        // --- Temporary notes: they occupy the day their deadline falls on, and
        // every day in between if they linger past midnight.
        for note in temporaryNotes {
            if note.isDone && !settings.showCompletedOnSchedule { continue }
            // The note is visible from its due day through its expiry day.
            let firstDay = calendar.startOfDay(for: note.due)
            let lastDay = calendar.startOfDay(for: note.expiresAt)
            if dayStart < firstDay || dayStart > lastDay { continue }
            // A note that expires exactly at midnight does not bleed into the new day.
            if dayStart == lastDay && note.expiresAt == lastDay && lastDay > firstDay { continue }

            let start: Date
            let end: Date
            if note.isAllDay {
                start = dayStart
                end = min(note.expiresAt, dayEnd)
            } else if dayStart == firstDay {
                start = note.due
                end = max(note.due, min(note.expiresAt, dayEnd))
            } else {
                // A carried-over day: it sits at the top as an ongoing item.
                start = dayStart
                end = min(note.expiresAt, dayEnd)
            }

            result.append(
                ScheduleEntry(
                    id: "t-\(note.id.uuidString)-\(key)",
                    origin: .temporary(note.id),
                    title: note.title,
                    details: note.details,
                    day: dayStart,
                    start: start,
                    end: end,
                    isAllDay: note.isAllDay,
                    tag: note.tag,
                    isDone: note.isDone,
                    isOverdue: note.isOverdue(asOf: now),
                    recurrenceSummary: nil,
                    expiresAt: note.expiresAt
                )
            )
        }

        // --- Permanent notes: one occurrence per matching day.
        if settings.showPermanentOnSchedule {
            for note in permanentNotes where !note.isMuted {
                guard let start = note.occurrenceStart(on: dayStart, calendar: calendar) else { continue }
                let end: Date
                if note.isAllDay {
                    end = dayEnd
                } else {
                    end = calendar.date(byAdding: .minute, value: note.durationMinutes, to: start) ?? start
                }

                result.append(
                    ScheduleEntry(
                        id: "p-\(note.id.uuidString)-\(key)",
                        origin: .permanent(note.id),
                        title: note.title,
                        details: note.details,
                        day: dayStart,
                        start: note.isAllDay ? dayStart : start,
                        end: end,
                        isAllDay: note.isAllDay,
                        tag: note.tag,
                        isDone: false,
                        isOverdue: false,
                        recurrenceSummary: note.recurrence.summary(calendar: calendar),
                        expiresAt: nil
                    )
                )
            }
        }

        return result.sorted { lhs, rhs in
            let left = lhs.sortKey
            let right = rhs.sortKey
            if left.0 != right.0 { return left.0 < right.0 }
            if left.1 != right.1 { return left.1 < right.1 }
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
    }

    // MARK: - Day markers (for the month grid)

    func marker(for day: Date) -> DayMarker {
        var marker = DayMarker()
        for entry in entries(on: day) {
            switch entry.kind {
            case .temporary: marker.temporaryCount += 1
            case .permanent: marker.permanentCount += 1
            }
            if entry.isOverdue { marker.overdueCount += 1 }
            if entry.isDone { marker.doneCount += 1 }
            if !marker.tags.contains(entry.tag) {
                marker.tags.append(entry.tag)
            }
        }
        return marker
    }

    func markers(for days: [Date]) -> [String: DayMarker] {
        var output: [String: DayMarker] = [:]
        output.reserveCapacity(days.count)
        for day in days {
            let key = TimeFormatting.dayKey.string(from: day)
            output[key] = marker(for: day)
        }
        return output
    }

    // MARK: - Ranges

    /// Every day in `range` that has at least one entry, oldest first.
    func agenda(from start: Date, through end: Date, limit: Int = 400) -> [AgendaDay] {
        var output: [AgendaDay] = []
        var cursor = calendar.startOfDay(for: start)
        let stop = calendar.startOfDay(for: end)
        var guardRail = 0

        while cursor <= stop && guardRail < limit {
            let dayEntries = entries(on: cursor)
            if !dayEntries.isEmpty {
                output.append(AgendaDay(day: cursor, entries: dayEntries))
            }
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
            guardRail += 1
        }

        return output
    }

    // MARK: - Upcoming

    /// The next few things due, across both note types. Powers the schedule header.
    func upcoming(within days: Int = 14, limit: Int = 6) -> [ScheduleEntry] {
        let end = calendar.date(byAdding: .day, value: days, to: now) ?? now
        let agendaDays = agenda(from: now, through: end)
        var flattened: [ScheduleEntry] = []
        for group in agendaDays {
            for entry in group.entries where entry.end > now && !entry.isDone {
                flattened.append(entry)
            }
        }
        return Array(
            flattened
                .sorted { $0.start < $1.start }
                .prefix(limit)
        )
    }
}

// MARK: - Calendar range helpers

enum CalendarRange {

    /// Every day drawn in a month grid, including the leading/trailing days that
    /// pad the first and last weeks.
    static func gridDays(for month: Date, calendar: Calendar) -> [Date] {
        guard let monthInterval = calendar.dateInterval(of: .month, for: month) else { return [] }
        let firstOfMonth = monthInterval.start

        let weekdayOfFirst = calendar.component(.weekday, from: firstOfMonth)
        let leading = (weekdayOfFirst - calendar.firstWeekday + 7) % 7

        guard let gridStart = calendar.date(byAdding: .day, value: -leading, to: firstOfMonth) else { return [] }

        let daysInMonth = calendar.range(of: .day, in: .month, for: firstOfMonth)?.count ?? 30
        let totalCells = Int(ceil(Double(leading + daysInMonth) / 7.0)) * 7

        return (0..<totalCells).compactMap { offset in
            calendar.date(byAdding: .day, value: offset, to: gridStart)
        }
    }

    /// The first day of every month between two dates, inclusive.
    static func months(from start: Date, through end: Date, calendar: Calendar) -> [Date] {
        guard let firstMonth = calendar.dateInterval(of: .month, for: start)?.start,
              let lastMonth = calendar.dateInterval(of: .month, for: end)?.start else { return [] }

        var output: [Date] = []
        var cursor = firstMonth
        var guardRail = 0
        while cursor <= lastMonth && guardRail < 600 {
            output.append(cursor)
            guard let next = calendar.date(byAdding: .month, value: 1, to: cursor) else { break }
            cursor = next
            guardRail += 1
        }
        return output
    }

    /// Locale-aware weekday initials, rotated to match the user's first weekday.
    static func weekdayInitials(calendar: Calendar) -> [String] {
        let symbols = calendar.veryShortWeekdaySymbols
        guard symbols.count == 7 else { return ["S", "M", "T", "W", "T", "F", "S"] }
        let offset = calendar.firstWeekday - 1
        return (0..<7).map { symbols[($0 + offset) % 7] }
    }
}
