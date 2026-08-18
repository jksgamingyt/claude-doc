//
//  TemporaryNoteWizard.swift
//  MySchedule
//
//  Three questions, asked in the order they matter: which day, what time, and
//  what happens once that moment passes.
//

import Foundation
import SwiftUI

struct TemporaryNoteWizard: View {

    @EnvironmentObject private var store: ScheduleStore
    @Environment(\.dismiss) private var dismiss

    // Identity
    private let editingID: UUID?
    private let createdAt: Date
    private let wasDone: Bool
    private let doneAt: Date?

    // Draft
    @State private var step = 0
    @State private var title: String
    @State private var details: String
    @State private var day: Date
    @State private var time: Date
    @State private var isAllDay: Bool
    @State private var linger: LingerPreset
    @State private var reminders: [ReminderLead]
    @State private var notifyOnExpiry: Bool
    @State private var tag: TagColor

    private static let stepCount = 3

    // MARK: - Init

    /// Fresh note, seeded with whatever was typed into the compose bar.
    init(seedText: String, settings: AppSettings, calendar: Calendar = .current) {
        editingID = nil
        createdAt = Date()
        wasDone = false
        doneAt = nil

        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        // Default to later today if there is still a sensible slot, else tomorrow.
        let hour = calendar.component(.hour, from: now)
        let defaultDay = hour < 20 ? startOfToday : (calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? startOfToday)
        let defaultMinutes = hour < 20 ? min(1260, (hour + 2) * 60) : 9 * 60

        _title = State(initialValue: seedText.trimmingCharacters(in: .whitespacesAndNewlines))
        _details = State(initialValue: "")
        _day = State(initialValue: defaultDay)
        _time = State(initialValue: calendar.date(byAdding: .minute, value: defaultMinutes, to: startOfToday) ?? now)
        _isAllDay = State(initialValue: false)
        _linger = State(initialValue: settings.defaultLinger)
        _reminders = State(initialValue: settings.temporaryReminderLeads)
        _notifyOnExpiry = State(initialValue: settings.notifyOnExpiry)
        _tag = State(initialValue: .defaultForTemporary)
    }

    /// Editing an existing note. Opens on the last step, where the useful knobs are.
    init(editing note: TemporaryNote, calendar: Calendar = .current) {
        editingID = note.id
        createdAt = note.createdAt
        wasDone = note.isDone
        doneAt = note.doneAt

        _step = State(initialValue: 0)
        _title = State(initialValue: note.title)
        _details = State(initialValue: note.details)
        _day = State(initialValue: calendar.startOfDay(for: note.due))
        _time = State(initialValue: note.due)
        _isAllDay = State(initialValue: note.isAllDay)
        _linger = State(initialValue: note.linger)
        _reminders = State(initialValue: note.reminders)
        _notifyOnExpiry = State(initialValue: note.notifyOnExpiry)
        _tag = State(initialValue: note.tag)
    }

    // MARK: - Body

    var body: some View {
        WizardChrome(
            title: editingID == nil ? "New temporary note" : "Edit note",
            subtitle: "TEMPORARY · CLEARS ITSELF",
            tint: Palette.clay,
            stepCount: TemporaryNoteWizard.stepCount,
            step: $step,
            noteTitle: $title,
            canAdvance: !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            advanceTitle: editingID == nil ? "Add to schedule" : "Save changes",
            onCancel: { dismiss() },
            onFinish: save
        ) {
            VStack(alignment: .leading, spacing: 22) {
                switch step {
                case 0: dayStep
                case 1: timeStep
                default: clearingStep
                }
            }
            .padding(.top, 4)
        }
    }

    // MARK: - Step 1: the day

    private var dayStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            FieldBlock(
                title: "Which day is this due?",
                caption: "Pick a shortcut or choose from the calendar."
            ) {
                FlowLayout(spacing: 8, runSpacing: 8) {
                    ForEach(DayShortcut.allCases) { shortcut in
                        SelectChip(
                            title: shortcut.title,
                            symbol: shortcut.symbol,
                            isSelected: isSelected(shortcut),
                            tint: Palette.clay
                        ) {
                            if let date = shortcut.date(from: store.clockTick, calendar: store.calendar) {
                                withAnimation(Motion.quick) { day = date }
                            }
                        }
                    }
                }
            }

            DatePicker(
                "Due date",
                selection: $day,
                in: pickerRange,
                displayedComponents: [.date]
            )
            .datePickerStyle(.graphical)
            .tint(Palette.clay)
            .labelsHidden()
            .cardSurface(padding: 8)

            summaryCard(
                symbol: "calendar",
                headline: TimeFormatting.dayHeadline.string(from: day),
                detail: RelativeFormatting.countdown(to: store.calendar.startOfDay(for: day), from: store.calendar.startOfDay(for: store.clockTick))
            )
        }
    }

    // MARK: - Step 2: the time

    private var timeStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            FieldBlock(
                title: "What time is it due?",
                caption: "All-day notes sit at the top of the day instead of at a clock time."
            ) {
                Toggle(isOn: $isAllDay.animation(Motion.quick)) {
                    Label("All day", systemImage: "sun.horizon")
                        .font(TypeScale.bodyEmphasis)
                        .foregroundStyle(Palette.ink)
                }
                .tint(Palette.clay)
            }

            if !isAllDay {
                FlowLayout(spacing: 8, runSpacing: 8) {
                    ForEach(TimeShortcut.allCases) { shortcut in
                        SelectChip(
                            title: shortcut.title,
                            symbol: shortcut.symbol,
                            isSelected: minuteOfDay(time) == shortcut.minutes,
                            tint: Palette.clay
                        ) {
                            setTime(minutes: shortcut.minutes)
                        }
                    }
                }

                DatePicker(
                    "Due time",
                    selection: $time,
                    displayedComponents: [.hourAndMinute]
                )
                .datePickerStyle(.wheel)
                .labelsHidden()
                .frame(maxWidth: .infinity)
                .cardSurface(padding: 4)
            }

            summaryCard(
                symbol: "clock",
                headline: isAllDay ? "All day on \(TimeFormatting.monthDay.string(from: day))" : TimeFormatting.full.string(from: due),
                detail: "Due \(RelativeFormatting.countdown(to: due, from: store.clockTick))"
            )
        }
    }

    // MARK: - Step 3: how it clears

    private var clearingStep: some View {
        VStack(alignment: .leading, spacing: 22) {
            FieldBlock(
                title: "When should it disappear?",
                caption: "Once this moment passes the note leaves your schedule on its own. Nothing is lost — it moves to Recently cleared."
            ) {
                FlowLayout(spacing: 8, runSpacing: 8) {
                    ForEach(LingerPreset.allCases) { preset in
                        SelectChip(
                            title: preset.shortName,
                            isSelected: linger == preset,
                            tint: Palette.clay
                        ) {
                            linger = preset
                        }
                    }
                }
            }

            FieldBlock(
                title: "Reminders",
                caption: "Nudges ahead of the deadline. Stack as many as you like."
            ) {
                ReminderPicker(selection: $reminders, tint: Palette.clay)
            }

            Toggle(isOn: $notifyOnExpiry) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tell me when it expires")
                        .font(TypeScale.bodyEmphasis)
                        .foregroundStyle(Palette.ink)
                    Text("One last notification as it comes off the schedule.")
                        .font(TypeScale.caption)
                        .foregroundStyle(Palette.inkTertiary)
                }
            }
            .tint(Palette.clay)

            FieldBlock(title: "Colour") {
                TagPicker(selection: $tag)
            }

            FieldBlock(title: "Anything else?", caption: "Optional. Shows underneath the note on your schedule.") {
                TextField("Details", text: $details, axis: .vertical)
                    .font(TypeScale.body)
                    .lineLimit(2...6)
                    .cardSurface(padding: 13)
            }

            summaryCard(
                symbol: "checkmark.seal",
                headline: "Due \(TimeFormatting.full.string(from: due))",
                detail: expiryDescription
            )
        }
    }

    // MARK: - Derived

    private var due: Date {
        let calendar = store.calendar
        let base = calendar.startOfDay(for: day)
        let minutes = isAllDay ? 9 * 60 : minuteOfDay(time)
        return calendar.date(byAdding: .minute, value: minutes, to: base) ?? base
    }

    private var expiresAt: Date {
        linger.expiry(after: due, calendar: store.calendar)
    }

    private var expiryDescription: String {
        let calendar = store.calendar
        if linger == .atDue {
            return "Clears the moment it's due."
        }
        if calendar.isDate(expiresAt, inSameDayAs: due) {
            return "Clears at \(TimeFormatting.clock.string(from: expiresAt)) the same day."
        }
        return "Clears \(TimeFormatting.full.string(from: expiresAt))."
    }

    private var pickerRange: ClosedRange<Date> {
        let bounds = store.calendarBounds
        let lower = min(bounds.start, store.calendar.startOfDay(for: day))
        let upper = max(bounds.end, store.calendar.startOfDay(for: day))
        return lower...upper
    }

    private func minuteOfDay(_ date: Date) -> Int {
        let components = store.calendar.dateComponents([.hour, .minute], from: date)
        return (components.hour ?? 0) * 60 + (components.minute ?? 0)
    }

    private func setTime(minutes: Int) {
        let calendar = store.calendar
        let base = calendar.startOfDay(for: time)
        if let updated = calendar.date(byAdding: .minute, value: minutes, to: base) {
            withAnimation(Motion.quick) { time = updated }
        }
    }

    private func isSelected(_ shortcut: DayShortcut) -> Bool {
        guard let date = shortcut.date(from: store.clockTick, calendar: store.calendar) else { return false }
        return store.calendar.isDate(date, inSameDayAs: day)
    }

    // MARK: - Save

    private func save() {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let note = TemporaryNote(
            id: editingID ?? UUID(),
            title: trimmed,
            details: details.trimmingCharacters(in: .whitespacesAndNewlines),
            due: due,
            isAllDay: isAllDay,
            linger: linger,
            reminders: reminders.sorted(by: >),
            notifyOnExpiry: notifyOnExpiry,
            tag: tag,
            createdAt: createdAt,
            isDone: wasDone,
            doneAt: doneAt,
            calendar: store.calendar
        )

        if editingID == nil {
            store.add(temporary: note)
        } else {
            store.update(temporary: note)
        }

        Haptics.success()
        dismiss()
    }

    // MARK: - Summary card

    private func summaryCard(symbol: String, headline: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Palette.clay)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 3) {
                Text(headline)
                    .font(TypeScale.bodyEmphasis)
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(TypeScale.caption)
                    .foregroundStyle(Palette.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: Metrics.smallRadius, style: .continuous)
                .fill(Palette.claySoft)
        )
    }
}

// MARK: - Shortcuts

enum DayShortcut: String, CaseIterable, Identifiable {
    case today
    case tomorrow
    case inThreeDays
    case thisWeekend
    case nextWeek
    case inAMonth

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today:        return "Today"
        case .tomorrow:     return "Tomorrow"
        case .inThreeDays:  return "In 3 days"
        case .thisWeekend:  return "This weekend"
        case .nextWeek:     return "Next week"
        case .inAMonth:     return "In a month"
        }
    }

    var symbol: String {
        switch self {
        case .today:        return "sun.max"
        case .tomorrow:     return "sunrise"
        case .inThreeDays:  return "arrow.right"
        case .thisWeekend:  return "figure.hiking"
        case .nextWeek:     return "calendar"
        case .inAMonth:     return "moon.stars"
        }
    }

    func date(from now: Date, calendar: Calendar) -> Date? {
        let today = calendar.startOfDay(for: now)
        switch self {
        case .today:
            return today
        case .tomorrow:
            return calendar.date(byAdding: .day, value: 1, to: today)
        case .inThreeDays:
            return calendar.date(byAdding: .day, value: 3, to: today)
        case .thisWeekend:
            // The coming Saturday. If today is Saturday, today counts.
            let weekday = calendar.component(.weekday, from: today)
            let delta = (7 - weekday + 7) % 7
            return calendar.date(byAdding: .day, value: delta, to: today)
        case .nextWeek:
            return calendar.date(byAdding: .day, value: 7, to: today)
        case .inAMonth:
            return calendar.date(byAdding: .month, value: 1, to: today)
        }
    }
}

enum TimeShortcut: String, CaseIterable, Identifiable {
    case earlyMorning
    case morning
    case midday
    case afternoon
    case evening
    case night

    var id: String { rawValue }

    var minutes: Int {
        switch self {
        case .earlyMorning: return 7 * 60
        case .morning:      return 9 * 60
        case .midday:       return 12 * 60
        case .afternoon:    return 15 * 60
        case .evening:      return 18 * 60
        case .night:        return 21 * 60
        }
    }

    var title: String {
        TimeFormatting.time(fromMinutes: minutes)
    }

    var symbol: String {
        switch self {
        case .earlyMorning: return "sunrise"
        case .morning:      return "sun.max"
        case .midday:       return "sun.max.fill"
        case .afternoon:    return "cloud.sun"
        case .evening:      return "sunset"
        case .night:        return "moon"
        }
    }
}
