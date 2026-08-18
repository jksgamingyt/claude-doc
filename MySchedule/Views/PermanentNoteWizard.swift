//
//  PermanentNoteWizard.swift
//  MySchedule
//
//  Three questions again, but different ones: which days it shows up on, what
//  time of day, and how long it holds its place. Nothing here expires — a
//  permanent note only ever leaves because you removed it.
//

import Foundation
import SwiftUI

struct PermanentNoteWizard: View {

    @EnvironmentObject private var store: ScheduleStore
    @Environment(\.dismiss) private var dismiss

    private let editingID: UUID?
    private let createdAt: Date
    private let wasMuted: Bool

    @State private var step = 0
    @State private var title: String
    @State private var details: String
    @State private var recurrence: Recurrence
    @State private var startDate: Date
    @State private var time: Date
    @State private var durationMinutes: Int
    @State private var reminders: [ReminderLead]
    @State private var tag: TagColor

    private static let stepCount = 3

    // MARK: - Init

    init(seedText: String, settings: AppSettings, calendar: Calendar = .current) {
        editingID = nil
        createdAt = Date()
        wasMuted = false

        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)

        _title = State(initialValue: seedText.trimmingCharacters(in: .whitespacesAndNewlines))
        _details = State(initialValue: "")
        _recurrence = State(initialValue: .everyDay)
        _startDate = State(initialValue: startOfToday)
        _time = State(initialValue: calendar.date(byAdding: .minute, value: 8 * 60, to: startOfToday) ?? now)
        _durationMinutes = State(initialValue: 60)
        _reminders = State(initialValue: settings.permanentReminderLeads)
        _tag = State(initialValue: .defaultForPermanent)
    }

    init(editing note: PermanentNote, calendar: Calendar = .current) {
        editingID = note.id
        createdAt = note.createdAt
        wasMuted = note.isMuted

        let startOfToday = calendar.startOfDay(for: Date())

        _title = State(initialValue: note.title)
        _details = State(initialValue: note.details)
        _recurrence = State(initialValue: note.recurrence)
        _startDate = State(initialValue: calendar.startOfDay(for: note.startDate))
        _time = State(initialValue: calendar.date(byAdding: .minute, value: note.startMinutes, to: startOfToday) ?? Date())
        _durationMinutes = State(initialValue: note.durationMinutes)
        _reminders = State(initialValue: note.reminders)
        _tag = State(initialValue: note.tag)
    }

    // MARK: - Body

    var body: some View {
        WizardChrome(
            title: editingID == nil ? "New permanent note" : "Edit standing note",
            subtitle: "PERMANENT · STAYS UNTIL YOU REMOVE IT",
            tint: Palette.moss,
            stepCount: PermanentNoteWizard.stepCount,
            step: $step,
            noteTitle: $title,
            canAdvance: canAdvance,
            advanceTitle: editingID == nil ? "Add to schedule" : "Save changes",
            onCancel: { dismiss() },
            onFinish: save
        ) {
            VStack(alignment: .leading, spacing: 22) {
                switch step {
                case 0: appearanceStep
                case 1: timeStep
                default: durationStep
                }
            }
            .padding(.top, 4)
        }
    }

    private var canAdvance: Bool {
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return false }
        if step == 0 && recurrence.kind == .selectedDays && recurrence.weekdays.isEmpty { return false }
        return true
    }

    // MARK: - Step 1: which days

    private var appearanceStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            FieldBlock(
                title: "Which days should it appear?",
                caption: "This is the rhythm the note keeps. It repeats forever."
            ) {
                ChipFlow {
                    ForEach(Recurrence.Kind.allCases) { kind in
                        SelectChip(
                            title: kind.displayName,
                            symbol: kind.symbol,
                            isSelected: recurrence.kind == kind,
                            tint: Palette.moss
                        ) {
                            withAnimation(Motion.quick) { recurrence.kind = kind }
                        }
                    }
                }
            }

            switch recurrence.kind {
            case .selectedDays:
                FieldBlock(title: "Pick the days") {
                    weekdayPicker
                }
            case .everyNDays:
                FieldBlock(title: "How often?", caption: "Counted from the start date below.") {
                    intervalPicker
                }
            case .dayOfMonth:
                FieldBlock(title: "Which day of the month?", caption: "Short months fall back to their last day.") {
                    dayOfMonthPicker
                }
            default:
                EmptyView()
            }

            FieldBlock(
                title: "Starting from",
                caption: "The note will not appear before this date."
            ) {
                DatePicker(
                    "Start date",
                    selection: $startDate,
                    in: startPickerRange,
                    displayedComponents: [.date]
                )
                .datePickerStyle(.compact)
                .tint(Palette.moss)
                .labelsHidden()
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            summaryCard(
                symbol: "repeat",
                headline: recurrence.summary(calendar: store.calendar),
                detail: nextOccurrenceDescription
            )
        }
    }

    private var weekdayPicker: some View {
        let symbols = store.calendar.shortWeekdaySymbols
        let order = weekdayOrder

        return ChipFlow {
            ForEach(order, id: \.self) { weekday in
                SelectChip(
                    title: symbols.indices.contains(weekday - 1) ? symbols[weekday - 1] : "\(weekday)",
                    isSelected: recurrence.weekdays.contains(weekday),
                    tint: Palette.moss
                ) {
                    toggleWeekday(weekday)
                }
            }
        }
    }

    private var intervalPicker: some View {
        HStack(spacing: 14) {
            Stepper(value: $recurrence.interval, in: 1...30) {
                Text(recurrence.interval == 1 ? "Every day" : "Every \(recurrence.interval) days")
                    .font(TypeScale.bodyEmphasis)
                    .foregroundStyle(Palette.ink)
            }
            .tint(Palette.moss)
        }
        .cardSurface(padding: 13)
    }

    private var dayOfMonthPicker: some View {
        ChipFlow(spacing: 6, runSpacing: 6) {
            ForEach(1...31, id: \.self) { number in
                Button {
                    Haptics.select()
                    recurrence.dayOfMonth = number
                } label: {
                    Text("\(number)")
                        .font(TypeScale.captionEmphasis)
                        .monospacedDigit()
                        .foregroundStyle(recurrence.dayOfMonth == number ? Palette.canvas : Palette.ink)
                        .frame(width: 34, height: 34)
                        .background(
                            Circle().fill(recurrence.dayOfMonth == number ? Palette.moss : Palette.card)
                        )
                        .overlay(
                            Circle().strokeBorder(
                                recurrence.dayOfMonth == number ? Color.clear : Palette.hairline,
                                lineWidth: 1
                            )
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Step 2: time of day

    private var timeStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            FieldBlock(
                title: "What time of day?",
                caption: "Where the note sits on each day it appears."
            ) {
                ChipFlow {
                    ForEach(TimeShortcut.allCases) { shortcut in
                        SelectChip(
                            title: shortcut.title,
                            symbol: shortcut.symbol,
                            isSelected: minuteOfDay(time) == shortcut.minutes,
                            tint: Palette.moss
                        ) {
                            setTime(minutes: shortcut.minutes)
                        }
                    }
                }
            }

            DatePicker(
                "Time of day",
                selection: $time,
                displayedComponents: [.hourAndMinute]
            )
            .datePickerStyle(.wheel)
            .labelsHidden()
            .frame(maxWidth: .infinity)
            .cardSurface(padding: 4)

            summaryCard(
                symbol: "clock",
                headline: "Appears at \(TimeFormatting.time(fromMinutes: minuteOfDay(time), calendar: store.calendar))",
                detail: recurrence.summary(calendar: store.calendar)
            )
        }
    }

    // MARK: - Step 3: how long it stays

    private var durationStep: some View {
        VStack(alignment: .leading, spacing: 22) {
            FieldBlock(
                title: "How long should it stay on the schedule?",
                caption: "This is the block it occupies each time it appears — not how long the note lives. Permanent notes never expire."
            ) {
                ChipFlow {
                    ForEach(DurationOption.allCases) { option in
                        SelectChip(
                            title: option.title,
                            isSelected: durationMinutes == option.minutes,
                            tint: Palette.moss
                        ) {
                            withAnimation(Motion.quick) { durationMinutes = option.minutes }
                        }
                    }
                }
            }

            FieldBlock(
                title: "Reminders",
                caption: "Leave this empty and the note simply sits on your schedule without buzzing."
            ) {
                ReminderPicker(
                    selection: $reminders,
                    tint: Palette.moss,
                    emptyMessage: "Silent. It appears on the schedule, nothing more."
                )
            }

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
                symbol: "leaf.fill",
                headline: "\(recurrence.summary(calendar: store.calendar)) at \(TimeFormatting.time(fromMinutes: minuteOfDay(time), calendar: store.calendar))",
                detail: "Holds \(DurationFormatting.describe(minutes: durationMinutes)) · never expires"
            )
        }
    }

    // MARK: - Derived

    private var weekdayOrder: [Int] {
        let first = store.calendar.firstWeekday
        return (0..<7).map { ((first - 1 + $0) % 7) + 1 }
    }

    private var startPickerRange: ClosedRange<Date> {
        let calendar = store.calendar
        let bounds = store.calendarBounds
        let lower = min(bounds.start, calendar.startOfDay(for: startDate))
        let upper = max(bounds.end, calendar.startOfDay(for: startDate))
        return lower...upper
    }

    private var nextOccurrenceDescription: String {
        let calendar = store.calendar
        let probe = PermanentNote(
            title: title,
            recurrence: recurrence,
            startDate: startDate,
            startMinutes: minuteOfDay(time),
            durationMinutes: durationMinutes
        )

        var cursor = calendar.startOfDay(for: max(store.clockTick, startDate))
        for _ in 0..<400 {
            if let start = probe.occurrenceStart(on: cursor, calendar: calendar) {
                return "Next on \(RelativeFormatting.dayName(for: start, calendar: calendar, now: store.clockTick)), \(TimeFormatting.monthDay.string(from: start))"
            }
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return "No upcoming day matches this pattern yet."
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

    private func toggleWeekday(_ weekday: Int) {
        if let index = recurrence.weekdays.firstIndex(of: weekday) {
            recurrence.weekdays.remove(at: index)
        } else {
            recurrence.weekdays.append(weekday)
            recurrence.weekdays.sort()
        }
    }

    // MARK: - Save

    private func save() {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let note = PermanentNote(
            id: editingID ?? UUID(),
            title: trimmed,
            details: details.trimmingCharacters(in: .whitespacesAndNewlines),
            recurrence: recurrence,
            startDate: store.calendar.startOfDay(for: startDate),
            startMinutes: minuteOfDay(time),
            durationMinutes: durationMinutes,
            reminders: reminders.sorted(by: >),
            tag: tag,
            isMuted: wasMuted,
            createdAt: createdAt
        )

        if editingID == nil {
            store.add(permanent: note)
        } else {
            store.update(permanent: note)
        }

        Haptics.success()
        dismiss()
    }

    // MARK: - Summary card

    private func summaryCard(symbol: String, headline: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Palette.moss)
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
                .fill(Palette.mossSoft)
        )
    }
}

// MARK: - Durations

enum DurationOption: Int, CaseIterable, Identifiable {
    case fifteen = 15
    case thirty = 30
    case hour = 60
    case ninety = 90
    case twoHours = 120
    case threeHours = 180
    case fourHours = 240
    case allDay = 1440

    var id: Int { rawValue }
    var minutes: Int { rawValue }

    var title: String {
        DurationFormatting.describe(minutes: rawValue)
    }
}
