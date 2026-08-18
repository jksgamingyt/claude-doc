//
//  NotificationPlan.swift
//  MySchedule
//
//  Works out *what* should be scheduled, with no reference to UserNotifications
//  at all. Keeping the planning pure means the awkward parts — lead times that
//  cross midnight, quiet hours, iOS's 64-notification ceiling — are ordinary
//  data transformations rather than side effects.
//

import Foundation

// MARK: - Trigger shapes

enum PlannedTrigger: Hashable {
    /// Fires once, then it is done.
    case oneShot(Date)
    /// Fires at the same clock time every day, forever.
    case daily(hour: Int, minute: Int)
    /// Fires at the same clock time on one weekday, every week, forever.
    case weekly(weekday: Int, hour: Int, minute: Int)
}

struct PlannedNotification: Identifiable, Hashable {
    enum Flavor: String, Hashable {
        case lead        // "coming up"
        case due         // "this is due now"
        case expiry      // "this has left your schedule"
        case standing    // a permanent note starting
    }

    let id: String
    let title: String
    let body: String
    let trigger: PlannedTrigger
    let flavor: Flavor
    let kind: NoteKind
    let noteID: UUID
    /// Groups a note's alerts together in Notification Centre.
    let threadID: String

    /// The soonest moment this will actually fire — the sort key used when the
    /// plan has to be trimmed to fit iOS's ceiling.
    func nextFire(after now: Date, calendar: Calendar) -> Date? {
        switch trigger {
        case .oneShot(let date):
            return date > now ? date : nil
        case .daily(let hour, let minute):
            var components = DateComponents()
            components.hour = hour
            components.minute = minute
            return calendar.nextDate(
                after: now,
                matching: components,
                matchingPolicy: .nextTimePreservingSmallerComponents
            )
        case .weekly(let weekday, let hour, let minute):
            var components = DateComponents()
            components.weekday = weekday
            components.hour = hour
            components.minute = minute
            return calendar.nextDate(
                after: now,
                matching: components,
                matchingPolicy: .nextTimePreservingSmallerComponents
            )
        }
    }

    var isRepeating: Bool {
        if case .oneShot = trigger { return false }
        return true
    }
}

// MARK: - The planner

struct NotificationPlanner {

    /// iOS keeps at most 64 pending local notifications per app and silently
    /// drops the rest. We stay under it deliberately and leave a little headroom.
    static let ceiling = 58
    /// Temporary notes are the ones with real deadlines, so they get a floor.
    static let temporaryFloor = 30
    /// How far out to enumerate permanent notes that cannot be expressed as a
    /// repeating trigger.
    static let irregularHorizonDays = 45

    var calendar: Calendar
    var settings: AppSettings
    var now: Date

    // MARK: Entry point

    func plan(temporary: [TemporaryNote], permanent: [PermanentNote]) -> [PlannedNotification] {
        let temporaryPlans = temporary
            .flatMap { planTemporary($0) }
            .sorted { lhs, rhs in
                let left = lhs.nextFire(after: now, calendar: calendar) ?? .distantFuture
                let right = rhs.nextFire(after: now, calendar: calendar) ?? .distantFuture
                return left < right
            }

        let permanentPlans = permanent
            .flatMap { planPermanent($0) }
            .sorted { lhs, rhs in
                let left = lhs.nextFire(after: now, calendar: calendar) ?? .distantFuture
                let right = rhs.nextFire(after: now, calendar: calendar) ?? .distantFuture
                return left < right
            }

        return merge(temporary: temporaryPlans, permanent: permanentPlans)
    }

    /// Fill the budget: guarantee a slice for deadlines, split the rest evenly,
    /// then hand any unused slots back to whichever side still has work.
    private func merge(
        temporary: [PlannedNotification],
        permanent: [PlannedNotification]
    ) -> [PlannedNotification] {
        let budget = NotificationPlanner.ceiling
        if temporary.count + permanent.count <= budget {
            return sortByFire(temporary + permanent)
        }

        let guaranteed = min(NotificationPlanner.temporaryFloor, temporary.count)
        var chosen = Array(temporary.prefix(guaranteed))
        let remaining = budget - chosen.count

        let permanentSlice = Array(permanent.prefix(remaining))
        chosen.append(contentsOf: permanentSlice)

        if chosen.count < budget {
            let leftover = temporary.dropFirst(guaranteed).prefix(budget - chosen.count)
            chosen.append(contentsOf: leftover)
        }

        return sortByFire(chosen)
    }

    private func sortByFire(_ plans: [PlannedNotification]) -> [PlannedNotification] {
        plans.sorted { lhs, rhs in
            let left = lhs.nextFire(after: now, calendar: calendar) ?? .distantFuture
            let right = rhs.nextFire(after: now, calendar: calendar) ?? .distantFuture
            if left != right { return left < right }
            return lhs.id < rhs.id
        }
    }

    // MARK: Temporary notes

    func planTemporary(_ note: TemporaryNote) -> [PlannedNotification] {
        guard !note.isDone else { return [] }
        guard note.expiresAt > now else { return [] }

        var plans: [PlannedNotification] = []
        let thread = "temporary-\(note.id.uuidString)"
        let expiresAtDue = note.expiresAt <= note.due.addingTimeInterval(60)

        // Lead reminders.
        for lead in Set(note.reminders).sorted(by: >) where lead.minutes > 0 {
            guard let raw = calendar.date(byAdding: .minute, value: -lead.minutes, to: note.due) else { continue }
            let fire = settings.shiftedOutOfQuietHours(raw, calendar: calendar)
            guard fire > now, fire < note.due else { continue }

            plans.append(
                PlannedNotification(
                    id: "temp.\(note.id.uuidString).lead.\(lead.minutes)",
                    title: note.title,
                    body: "Due \(RelativeFormatting.countdown(to: note.due, from: fire)) — \(TimeFormatting.full.string(from: note.due))",
                    trigger: .oneShot(fire),
                    flavor: .lead,
                    kind: .temporary,
                    noteID: note.id,
                    threadID: thread
                )
            )
        }

        // "Right now" — either its own alert, or folded into the expiry alert
        // when the note leaves the moment it is due.
        let wantsDueAlert = settings.notifyAtDueTime || note.reminders.contains(ReminderLead(0))
        if wantsDueAlert && note.due > now {
            let fire = settings.shiftedOutOfQuietHours(note.due, calendar: calendar)
            if fire > now {
                let body: String
                if expiresAtDue && note.notifyOnExpiry && settings.notifyOnExpiry {
                    body = "Due now. This note is coming off your schedule."
                } else {
                    body = note.details.isEmpty ? "This is due now." : note.details
                }
                plans.append(
                    PlannedNotification(
                        id: "temp.\(note.id.uuidString).due",
                        title: note.title,
                        body: body,
                        trigger: .oneShot(fire),
                        flavor: .due,
                        kind: .temporary,
                        noteID: note.id,
                        threadID: thread
                    )
                )
            }
        }

        // Expiry — the note announces its own departure.
        if note.notifyOnExpiry && settings.notifyOnExpiry {
            let alreadyCovered = expiresAtDue && wantsDueAlert && note.due > now
            if !alreadyCovered && note.expiresAt > now {
                let fire = settings.shiftedOutOfQuietHours(note.expiresAt, calendar: calendar)
                if fire > now {
                    plans.append(
                        PlannedNotification(
                            id: "temp.\(note.id.uuidString).expiry",
                            title: "\(note.title) has expired",
                            body: "It has come off your schedule. It's in Recently cleared if you need it back.",
                            trigger: .oneShot(fire),
                            flavor: .expiry,
                            kind: .temporary,
                            noteID: note.id,
                            threadID: thread
                        )
                    )
                }
            }
        }

        return plans
    }

    // MARK: Permanent notes

    func planPermanent(_ note: PermanentNote) -> [PlannedNotification] {
        guard !note.isMuted else { return [] }

        // A permanent note with no reminders is a schedule entry, not an alarm.
        let leads = note.reminders.isEmpty ? [] : Set(note.reminders).sorted(by: >)
        guard !leads.isEmpty else { return [] }

        let thread = "permanent-\(note.id.uuidString)"
        var plans: [PlannedNotification] = []

        for lead in leads {
            switch note.recurrence.kind {
            case .daily:
                plans.append(contentsOf: dailyPlans(note: note, lead: lead, thread: thread))
            case .weekdays:
                plans.append(contentsOf: weeklyPlans(note: note, lead: lead, thread: thread, weekdays: [2, 3, 4, 5, 6]))
            case .weekends:
                plans.append(contentsOf: weeklyPlans(note: note, lead: lead, thread: thread, weekdays: [1, 7]))
            case .selectedDays:
                plans.append(contentsOf: weeklyPlans(note: note, lead: lead, thread: thread, weekdays: note.recurrence.weekdays))
            case .everyNDays, .dayOfMonth:
                plans.append(contentsOf: enumeratedPlans(note: note, lead: lead, thread: thread))
            }
        }

        return plans
    }

    private func body(for note: PermanentNote, lead: ReminderLead) -> String {
        if lead.minutes == 0 {
            return note.details.isEmpty
                ? "Starting now · \(note.timeSummary(calendar: calendar))"
                : note.details
        }
        return "Starts \(lead.shortLabel) from now · \(TimeFormatting.time(fromMinutes: note.startMinutes, calendar: calendar))"
    }

    /// A daily note is a single repeating trigger, regardless of the lead time —
    /// subtracting the lead just rotates the clock time (and possibly the day,
    /// which does not matter when it repeats every day anyway).
    private func dailyPlans(note: PermanentNote, lead: ReminderLead, thread: String) -> [PlannedNotification] {
        let minutes = normalisedMinuteOfDay(note.startMinutes - lead.minutes)
        let shifted = shiftMinutesOutOfQuietHours(minutes)
        return [
            PlannedNotification(
                id: "perm.\(note.id.uuidString).daily.\(lead.minutes)",
                title: note.title,
                body: body(for: note, lead: lead),
                trigger: .daily(hour: shifted / 60, minute: shifted % 60),
                flavor: .standing,
                kind: .permanent,
                noteID: note.id,
                threadID: thread
            )
        ]
    }

    /// Weekly patterns rotate through the week when the lead pushes them back
    /// past midnight: Monday 8am minus 12 hours is Sunday 8pm.
    private func weeklyPlans(
        note: PermanentNote,
        lead: ReminderLead,
        thread: String,
        weekdays: [Int]
    ) -> [PlannedNotification] {
        let minutesInWeek = 7 * 24 * 60
        var plans: [PlannedNotification] = []

        for weekday in Set(weekdays).sorted() where (1...7).contains(weekday) {
            // Position in the week, measured in minutes from Sunday 00:00.
            let position = (weekday - 1) * 24 * 60 + note.startMinutes - lead.minutes
            var wrapped = position % minutesInWeek
            if wrapped < 0 { wrapped += minutesInWeek }

            let newWeekday = wrapped / (24 * 60) + 1
            let minuteOfDay = shiftMinutesOutOfQuietHours(wrapped % (24 * 60))

            plans.append(
                PlannedNotification(
                    id: "perm.\(note.id.uuidString).weekly.\(weekday).\(lead.minutes)",
                    title: note.title,
                    body: body(for: note, lead: lead),
                    trigger: .weekly(weekday: newWeekday, hour: minuteOfDay / 60, minute: minuteOfDay % 60),
                    flavor: .standing,
                    kind: .permanent,
                    noteID: note.id,
                    threadID: thread
                )
            )
        }

        return plans
    }

    /// "Every N days" and "day N of the month" have no repeating-trigger
    /// equivalent, so they are laid out one occurrence at a time and refreshed
    /// every time the app comes to the foreground.
    private func enumeratedPlans(note: PermanentNote, lead: ReminderLead, thread: String) -> [PlannedNotification] {
        var plans: [PlannedNotification] = []
        var cursor = calendar.startOfDay(for: now)
        var scanned = 0
        let maxOccurrences = note.recurrence.kind == .dayOfMonth ? 4 : 8

        while scanned < NotificationPlanner.irregularHorizonDays && plans.count < maxOccurrences {
            scanned += 1
            defer { cursor = calendar.date(byAdding: .day, value: 1, to: cursor) ?? cursor.addingTimeInterval(86_400) }

            guard let start = note.occurrenceStart(on: cursor, calendar: calendar) else { continue }
            guard let raw = calendar.date(byAdding: .minute, value: -lead.minutes, to: start) else { continue }
            let fire = settings.shiftedOutOfQuietHours(raw, calendar: calendar)
            guard fire > now else { continue }

            let stamp = TimeFormatting.minuteKey.string(from: start)
            plans.append(
                PlannedNotification(
                    id: "perm.\(note.id.uuidString).at.\(stamp).\(lead.minutes)",
                    title: note.title,
                    body: body(for: note, lead: lead),
                    trigger: .oneShot(fire),
                    flavor: .standing,
                    kind: .permanent,
                    noteID: note.id,
                    threadID: thread
                )
            )
        }

        return plans
    }

    // MARK: Helpers

    private func normalisedMinuteOfDay(_ minutes: Int) -> Int {
        let dayLength = 24 * 60
        var value = minutes % dayLength
        if value < 0 { value += dayLength }
        return value
    }

    /// Quiet-hours shifting for repeating triggers, which have no date to work
    /// from — only a clock time.
    private func shiftMinutesOutOfQuietHours(_ minutes: Int) -> Int {
        guard settings.quietHoursEnabled else { return normalisedMinuteOfDay(minutes) }
        let value = normalisedMinuteOfDay(minutes)
        let start = settings.quietStartMinutes
        let end = settings.quietEndMinutes
        if start == end { return value }

        let inside: Bool
        if start < end {
            inside = value >= start && value < end
        } else {
            inside = value >= start || value < end
        }
        return inside ? normalisedMinuteOfDay(end) : value
    }
}
