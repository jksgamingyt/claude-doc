//
//  ScheduleView.swift
//  MySchedule
//
//  The unified view. Nothing is created here — everything on this screen came
//  from one of the two notes sections and arrived automatically.
//

import Foundation
import SwiftUI

enum ScheduleMode: String, CaseIterable, Identifiable, Hashable {
    case month
    case agenda

    var id: String { rawValue }

    var title: String {
        switch self {
        case .month:  return "Month"
        case .agenda: return "Agenda"
        }
    }

    var symbol: String {
        switch self {
        case .month:  return "square.grid.3x3"
        case .agenda: return "list.bullet"
        }
    }
}

struct ScheduleView: View {

    @EnvironmentObject private var store: ScheduleStore

    @State private var mode: ScheduleMode = .month
    @State private var visibleMonth: Date = Date()
    @State private var inspecting: ScheduleEntry?
    @State private var didAlignMonth = false

    /// How far the agenda looks ahead. Permanent notes recur forever, so the
    /// list needs an end or it would never stop building.
    private static let agendaHorizonDays = 180

    private var calendar: Calendar { store.calendar }
    private var today: Date { calendar.startOfDay(for: store.clockTick) }

    var body: some View {
        NavigationStack {
            ZStack {
                NatureBackground(intensity: 0.32, showsRidges: false)

                VStack(spacing: 0) {
                    monthBar
                        .padding(.horizontal, Metrics.gutter)
                        .padding(.top, 4)
                        .padding(.bottom, 10)

                    modePicker
                        .padding(.horizontal, Metrics.gutter)
                        .padding(.bottom, 12)

                    if store.temporaryNotes.isEmpty && store.permanentNotes.isEmpty {
                        emptyState
                    } else if mode == .month {
                        monthLayout
                    } else {
                        agendaLayout
                    }
                }
            }
            .navigationTitle("Schedule")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Jump to month", selection: $visibleMonth) {
                            ForEach(months, id: \.timeIntervalSince1970) { month in
                                Text(TimeFormatting.monthYear.string(from: month))
                                    .tag(month)
                            }
                        }
                    } label: {
                        Image(systemName: "calendar.badge.clock")
                    }
                }
            }
            .sheet(item: $inspecting) { entry in
                NoteInspector(entry: entry)
                    .environmentObject(store)
            }
        }
        .onAppear(perform: alignToTodayOnce)
        .onChange(of: visibleMonth) { _, month in
            // Swiping to a new month should move the day panel with it, rather
            // than leaving it showing a day you can no longer see.
            guard !calendar.isDate(store.focusDate, equalTo: month, toGranularity: .month) else { return }
            if calendar.isDate(month, equalTo: store.clockTick, toGranularity: .month) {
                store.focusDate = today
            } else if let first = calendar.dateInterval(of: .month, for: month)?.start {
                store.focusDate = first
            }
        }
    }

    // MARK: - Month bar

    private var monthBar: some View {
        HStack(spacing: 10) {
            stepButton(symbol: "chevron.left", enabled: canStep(-1)) { step(-1) }

            VStack(alignment: .leading, spacing: 1) {
                Text(TimeFormatting.monthOnly.string(from: visibleMonth))
                    .font(TypeScale.title(21))
                    .foregroundStyle(Palette.ink)
                Text(yearString)
                    .font(TypeScale.micro)
                    .tracking(1.4)
                    .foregroundStyle(Palette.inkTertiary)
            }
            .frame(minWidth: 118, alignment: .leading)
            .animation(nil, value: visibleMonth)

            stepButton(symbol: "chevron.right", enabled: canStep(1)) { step(1) }

            Spacer(minLength: 4)

            Button {
                Haptics.tap()
                jumpToToday()
            } label: {
                Text("Today")
                    .font(TypeScale.captionEmphasis)
            }
            .buttonStyle(SoftButtonStyle(tint: Palette.moss))
        }
    }

    private func stepButton(symbol: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: {
            Haptics.select()
            action()
        }) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(enabled ? Palette.ink : Palette.inkTertiary.opacity(0.45))
                .frame(width: 34, height: 34)
                .background(Circle().fill(Palette.card))
                .overlay(Circle().strokeBorder(Palette.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    // MARK: - Mode picker

    private var modePicker: some View {
        HStack(spacing: 8) {
            ForEach(ScheduleMode.allCases) { option in
                SelectChip(
                    title: option.title,
                    symbol: option.symbol,
                    isSelected: mode == option
                ) {
                    withAnimation(Motion.settle) { mode = option }
                }
            }

            Spacer(minLength: 0)

            legend
        }
    }

    private var legend: some View {
        HStack(spacing: 10) {
            HStack(spacing: 4) {
                Circle().fill(Palette.clay).frame(width: 6, height: 6)
                Text("Temporary").font(TypeScale.micro).foregroundStyle(Palette.inkTertiary)
            }
            HStack(spacing: 4) {
                Circle().fill(Palette.moss).frame(width: 6, height: 6)
                Text("Permanent").font(TypeScale.micro).foregroundStyle(Palette.inkTertiary)
            }
        }
    }

    // MARK: - Month layout

    private var monthLayout: some View {
        VStack(spacing: 0) {
            TabView(selection: $visibleMonth) {
                ForEach(months, id: \.timeIntervalSince1970) { month in
                    MonthGridView(
                        month: month,
                        calendar: calendar,
                        selectedDate: store.focusDate,
                        today: today,
                        engine: store.engine,
                        onSelect: { day in
                            withAnimation(Motion.quick) { store.focusDate = day }
                        }
                    )
                    .padding(.horizontal, 10)
                    .tag(month)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .frame(height: 322)

            Hairline()
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, 2)

            selectedDayPanel
        }
    }

    private var selectedDayPanel: some View {
        let entries = store.engine.entries(on: store.focusDate)

        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                DayHeading(
                    date: store.focusDate,
                    calendar: calendar,
                    today: today,
                    entryCount: entries.count
                )
                .padding(.top, 14)

                if entries.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "wind")
                            .font(.system(size: 22, weight: .light))
                            .foregroundStyle(Palette.inkTertiary)
                        Text("Nothing on this day.")
                            .font(TypeScale.body)
                            .foregroundStyle(Palette.inkSecondary)
                        Text("Write a note and it will land here on its own.")
                            .font(TypeScale.caption)
                            .foregroundStyle(Palette.inkTertiary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 34)
                } else {
                    ForEach(entries) { entry in
                        ScheduleRow(
                            entry: entry,
                            onToggleDone: entry.kind == .temporary ? {
                                store.markTemporaryDone(id: entry.noteID, done: !entry.isDone)
                            } : nil,
                            onTap: { inspecting = entry }
                        )
                    }
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.bottom, 28)
        }
    }

    // MARK: - Agenda layout

    private var agendaLayout: some View {
        let start = max(today, calendar.startOfDay(for: store.focusDate))
        let horizon = calendar.date(byAdding: .day, value: ScheduleView.agendaHorizonDays, to: start) ?? start
        let end = min(horizon, store.calendarBounds.end)
        let groups = store.engine.agenda(from: start, through: max(start, end))

        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 20, pinnedViews: []) {
                if groups.isEmpty {
                    EmptyState(
                        symbol: "sparkles",
                        title: "The road ahead is clear",
                        message: "Nothing is scheduled between now and \(TimeFormatting.monthDay.string(from: end))."
                    )
                    .frame(maxWidth: .infinity)
                }

                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: 10) {
                        DayHeading(
                            date: group.day,
                            calendar: calendar,
                            today: today,
                            entryCount: group.entries.count
                        )

                        ForEach(group.entries) { entry in
                            ScheduleRow(
                                entry: entry,
                                onToggleDone: entry.kind == .temporary ? {
                                    store.markTemporaryDone(id: entry.noteID, done: !entry.isDone)
                                } : nil,
                                onTap: { inspecting = entry }
                            )
                        }
                    }
                }

                if !groups.isEmpty {
                    Text("Showing the next \(ScheduleView.agendaHorizonDays) days. Switch to Month to look further out.")
                        .font(TypeScale.micro)
                        .foregroundStyle(Palette.inkTertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 8)
            .padding(.bottom, 28)
        }
    }

    // MARK: - Empty

    private var emptyState: some View {
        VStack {
            Spacer()
            EmptyState(
                symbol: "leaf",
                title: "Your schedule is empty",
                message: "This screen never gets edited directly. Write something in Temporary or Permanent notes and it appears here on the right day, automatically."
            )
            Spacer()
            Spacer()
        }
    }

    // MARK: - Month plumbing

    private var months: [Date] {
        let bounds = store.calendarBounds
        return CalendarRange.months(from: bounds.start, through: bounds.end, calendar: calendar)
    }

    private var yearString: String {
        String(calendar.component(.year, from: visibleMonth))
    }

    private func monthStart(of date: Date) -> Date {
        calendar.dateInterval(of: .month, for: date)?.start ?? date
    }

    /// The pager selects by exact Date equality, so every jump resolves against
    /// the real month list rather than recomputing a date that only looks equal.
    private func monthIndex(of date: Date, in list: [Date]) -> Int? {
        list.firstIndex { calendar.isDate($0, equalTo: date, toGranularity: .month) }
    }

    private func canStep(_ delta: Int) -> Bool {
        let list = months
        guard let index = monthIndex(of: visibleMonth, in: list) else { return false }
        let target = index + delta
        return target >= 0 && target < list.count
    }

    private func step(_ delta: Int) {
        let list = months
        guard let index = monthIndex(of: visibleMonth, in: list) else { return }
        let target = index + delta
        guard target >= 0, target < list.count else { return }
        withAnimation(Motion.settle) {
            visibleMonth = list[target]
        }
    }

    private func jumpToToday() {
        let list = months
        store.focusDate = today
        if let index = monthIndex(of: store.clockTick, in: list) {
            withAnimation(Motion.settle) { visibleMonth = list[index] }
        }
    }

    private func alignToTodayOnce() {
        guard !didAlignMonth else { return }
        didAlignMonth = true

        // Snap onto an exact month start so the pager's tag matching works.
        let target = monthStart(of: store.focusDate)
        if let match = months.first(where: { calendar.isDate($0, equalTo: target, toGranularity: .month) }) {
            visibleMonth = match
        } else if let first = months.first {
            visibleMonth = first
        }
    }
}
