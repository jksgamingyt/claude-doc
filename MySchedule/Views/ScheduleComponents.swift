//
//  ScheduleComponents.swift
//  MySchedule
//
//  The calendar grid and the row that represents one thing on one day.
//

import Foundation
import SwiftUI

// MARK: - Day cell

struct DayCell: View {
    let date: Date
    let calendar: Calendar
    let isInMonth: Bool
    let isToday: Bool
    let isSelected: Bool
    let marker: DayMarker
    let action: () -> Void

    private var dayNumber: String {
        "\(calendar.component(.day, from: date))"
    }

    var body: some View {
        Button(action: {
            Haptics.select()
            action()
        }) {
            VStack(spacing: 3) {
                ZStack {
                    if isSelected {
                        Circle()
                            .fill(Palette.moss)
                            .frame(width: 32, height: 32)
                    } else if isToday {
                        Circle()
                            .strokeBorder(Palette.moss.opacity(0.55), lineWidth: 1.6)
                            .frame(width: 32, height: 32)
                    }

                    Text(dayNumber)
                        .font(.system(size: 15, weight: isToday || isSelected ? .semibold : .regular, design: .rounded))
                        .foregroundStyle(numberColor)
                }
                .frame(height: 32)

                dots
                    .frame(height: 6)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(isInMonth ? 1 : 0.34)
        .animation(Motion.quick, value: isSelected)
    }

    private var numberColor: Color {
        if isSelected { return Palette.canvas }
        if !isInMonth { return Palette.inkTertiary }
        if marker.overdueCount > 0 { return Palette.clay }
        return Palette.ink
    }

    @ViewBuilder
    private var dots: some View {
        if marker.isEmpty {
            Color.clear
        } else {
            HStack(spacing: 3) {
                ForEach(Array(marker.dotTags.enumerated()), id: \.offset) { pair in
                    Circle()
                        .fill(isSelected ? Palette.canvas.opacity(0.9) : pair.element.color)
                        .frame(width: 5, height: 5)
                }
                if marker.hasOverflow {
                    Text("+")
                        .font(.system(size: 8, weight: .bold, design: .rounded))
                        .foregroundStyle(isSelected ? Palette.canvas.opacity(0.9) : Palette.inkTertiary)
                        .offset(y: -1)
                }
            }
        }
    }
}

// MARK: - Month grid

struct MonthGridView: View {

    let month: Date
    let calendar: Calendar
    let selectedDate: Date
    let today: Date
    let engine: ScheduleEngine
    let onSelect: (Date) -> Void

    /// Always six rows, so paging between a 5-row and 6-row month does not make
    /// the layout jump.
    private static let rowCount = 6

    private var days: [Date] {
        var days = CalendarRange.gridDays(for: month, calendar: calendar)
        let wanted = MonthGridView.rowCount * 7
        while days.count < wanted, let last = days.last,
              let next = calendar.date(byAdding: .day, value: 1, to: last) {
            days.append(next)
        }
        return Array(days.prefix(wanted))
    }

    private var monthValue: Int {
        calendar.component(.month, from: month)
    }

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 0) {
                ForEach(Array(CalendarRange.weekdayInitials(calendar: calendar).enumerated()), id: \.offset) { pair in
                    Text(pair.element)
                        .font(TypeScale.micro)
                        .foregroundStyle(Palette.inkTertiary)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.bottom, 2)

            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7),
                spacing: 2
            ) {
                ForEach(days, id: \.timeIntervalSince1970) { day in
                    DayCell(
                        date: day,
                        calendar: calendar,
                        isInMonth: calendar.component(.month, from: day) == monthValue,
                        isToday: calendar.isDate(day, inSameDayAs: today),
                        isSelected: calendar.isDate(day, inSameDayAs: selectedDate),
                        marker: engine.marker(for: day),
                        action: { onSelect(day) }
                    )
                }
            }
        }
    }
}

// MARK: - Schedule row

struct ScheduleRow: View {

    let entry: ScheduleEntry
    var showsDate: Bool = false
    var onToggleDone: (() -> Void)?
    var onTap: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Colour rail
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(entry.tag.color.opacity(entry.isDone ? 0.35 : 0.9))
                .frame(width: 3.5)
                .frame(maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(entry.timeLabel)
                        .font(TypeScale.numeral)
                        .foregroundStyle(entry.isOverdue ? Palette.clay : Palette.inkSecondary)
                        .monospacedDigit()

                    if entry.isOverdue {
                        Pill(text: "Past due", symbol: "exclamationmark", tint: Palette.clay, background: Palette.claySoft)
                    }

                    Spacer(minLength: 0)

                    Image(systemName: entry.kind.symbol)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Palette.inkTertiary)
                }

                Text(entry.title)
                    .font(TypeScale.bodyEmphasis)
                    .foregroundStyle(Palette.ink)
                    .strikethrough(entry.isDone, color: Palette.inkTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)

                if !entry.details.isEmpty {
                    Text(entry.details)
                        .font(TypeScale.caption)
                        .foregroundStyle(Palette.inkSecondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }

                subtitleRow
            }

            if entry.kind == .temporary, let onToggleDone {
                Button(action: {
                    Haptics.success()
                    onToggleDone()
                }) {
                    Image(systemName: entry.isDone ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 21, weight: .light))
                        .foregroundStyle(entry.isDone ? Palette.moss : Palette.inkTertiary)
                }
                .buttonStyle(.plain)
                .padding(.top, 1)
            }
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 13)
        .background(
            RoundedRectangle(cornerRadius: Metrics.smallRadius, style: .continuous)
                .fill(Palette.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.smallRadius, style: .continuous)
                .strokeBorder(entry.isOverdue ? Palette.clay.opacity(0.35) : Palette.hairline, lineWidth: 1)
        )
        .dimmedWhenDone(entry.isDone)
        .contentShape(Rectangle())
        .onTapGesture {
            guard let onTap else { return }
            Haptics.tap()
            onTap()
        }
    }

    @ViewBuilder
    private var subtitleRow: some View {
        HStack(spacing: 8) {
            if let summary = entry.recurrenceSummary {
                Label(summary, systemImage: "repeat")
                    .font(TypeScale.micro)
                    .foregroundStyle(Palette.inkTertiary)
            }

            if !entry.isAllDay && entry.end > entry.start.addingTimeInterval(60) {
                Label(entry.rangeLabel, systemImage: "clock")
                    .font(TypeScale.micro)
                    .foregroundStyle(Palette.inkTertiary)
            }

            if let expires = entry.expiresAt, entry.kind == .temporary {
                Label("Clears \(RelativeFormatting.dayName(for: expires))", systemImage: "wind")
                    .font(TypeScale.micro)
                    .foregroundStyle(Palette.inkTertiary)
            }

            if showsDate {
                Label(TimeFormatting.monthDay.string(from: entry.day), systemImage: "calendar")
                    .font(TypeScale.micro)
                    .foregroundStyle(Palette.inkTertiary)
            }
        }
    }
}

// MARK: - Day heading

struct DayHeading: View {
    let date: Date
    let calendar: Calendar
    let today: Date
    var entryCount: Int = 0

    private var isToday: Bool {
        calendar.isDate(date, inSameDayAs: today)
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 9) {
            Text("\(calendar.component(.day, from: date))")
                .font(TypeScale.title(24))
                .foregroundStyle(isToday ? Palette.moss : Palette.ink)
                .monospacedDigit()

            VStack(alignment: .leading, spacing: 0) {
                Text(TimeFormatting.weekdayFull.string(from: date))
                    .font(TypeScale.heading(15))
                    .foregroundStyle(Palette.ink)
                Text(TimeFormatting.monthYear.string(from: date))
                    .font(TypeScale.micro)
                    .foregroundStyle(Palette.inkTertiary)
            }

            if isToday {
                Pill(text: "Today", tint: Palette.moss, background: Palette.mossSoft)
            }

            Spacer(minLength: 4)

            if entryCount > 0 {
                Text(entryCount == 1 ? "1 item" : "\(entryCount) items")
                    .font(TypeScale.micro)
                    .foregroundStyle(Palette.inkTertiary)
            }
        }
    }
}
