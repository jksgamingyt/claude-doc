//
//  TemporaryNotesView.swift
//  MySchedule
//
//  Notes with a deadline. Write one, answer three questions, and it takes its
//  place on the schedule until its time runs out.
//

import Foundation
import SwiftUI

/// One sheet, several reasons to open it. Two `.sheet` modifiers on one view
/// fight each other; an enum does not.
enum TemporarySheet: Identifiable {
    case create(String)
    case edit(TemporaryNote)

    var id: String {
        switch self {
        case .create:            return "create"
        case .edit(let note):    return "edit-\(note.id.uuidString)"
        }
    }
}

struct TemporaryNotesView: View {

    @EnvironmentObject private var store: ScheduleStore

    @State private var draft = ""
    @State private var sheet: TemporarySheet?
    @State private var confirmingDelete: TemporaryNote?

    var body: some View {
        NavigationStack {
            ZStack {
                NatureBackground(intensity: 0.28, showsRidges: false)

                if store.activeTemporaryNotes.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .navigationTitle("Temporary")
            .navigationBarTitleDisplayMode(.large)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ComposeBar(
                    text: $draft,
                    placeholder: "Something with a deadline…",
                    hint: "Return opens the date, time and expiry questions.",
                    tint: Palette.clay,
                    symbol: "hourglass",
                    onSubmit: openWizard
                )
            }
            .sheet(item: $sheet) { which in
                switch which {
                case .create(let text):
                    TemporaryNoteWizard(seedText: text, settings: store.settings, calendar: store.calendar)
                        .environmentObject(store)
                case .edit(let note):
                    TemporaryNoteWizard(editing: note, calendar: store.calendar)
                        .environmentObject(store)
                }
            }
            .confirmationDialog(
                "Remove this note?",
                isPresented: Binding(
                    get: { confirmingDelete != nil },
                    set: { if !$0 { confirmingDelete = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Remove", role: .destructive) {
                    if let note = confirmingDelete {
                        store.delete(temporaryID: note.id)
                        Haptics.warning()
                    }
                    confirmingDelete = nil
                }
                Button("Keep it", role: .cancel) { confirmingDelete = nil }
            } message: {
                Text("It moves to Recently cleared, where you can bring it back.")
            }
            .onChange(of: store.pendingDeepLink) { _, link in
                guard let link, link.kind == .temporary,
                      let note = store.temporaryNote(id: link.noteID) else { return }
                sheet = .edit(note)
                store.pendingDeepLink = nil
            }
        }
    }

    // MARK: - List

    private var list: some View {
        List {
            summarySection

            ForEach(store.groupedTemporaryNotes) { bucket in
                Section {
                    ForEach(bucket.notes) { note in
                        TemporaryNoteRow(note: note, now: store.clockTick, calendar: store.calendar)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                Haptics.tap()
                                sheet = .edit(note)
                            }
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 4, leading: Metrics.gutter, bottom: 4, trailing: Metrics.gutter))
                            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                Button {
                                    Haptics.success()
                                    store.markTemporaryDone(id: note.id, done: !note.isDone)
                                } label: {
                                    Label(note.isDone ? "Not done" : "Done", systemImage: note.isDone ? "arrow.uturn.backward" : "checkmark")
                                }
                                .tint(Palette.moss)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    confirmingDelete = note
                                } label: {
                                    Label("Remove", systemImage: "trash")
                                }
                            }
                    }
                } header: {
                    SectionHeader(bucket.group.title, symbol: bucket.group.symbol, tint: headerTint(bucket.group))
                        .textCase(nil)
                        .padding(.top, 4)
                }
                .listRowSeparator(.hidden)
            }

            Color.clear
                .frame(height: 8)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 10)
    }

    private func headerTint(_ group: TemporaryGroup) -> Color {
        switch group {
        case .overdue: return Palette.clay
        case .done:    return Palette.moss
        default:       return Palette.inkSecondary
        }
    }

    private var summarySection: some View {
        Section {
            HStack(spacing: 10) {
                StatTile(
                    value: store.groupedTemporaryNotes.first(where: { $0.group == .overdue })?.notes.count ?? 0,
                    label: "past due",
                    tint: Palette.clay
                )
                StatTile(
                    value: store.groupedTemporaryNotes.first(where: { $0.group == .today })?.notes.count ?? 0,
                    label: "today",
                    tint: Palette.gold
                )
                StatTile(
                    value: store.activeTemporaryNotes.filter { !$0.isDone }.count,
                    label: "open",
                    tint: Palette.moss
                )
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 6, leading: Metrics.gutter, bottom: 10, trailing: Metrics.gutter))
        }
    }

    // MARK: - Empty

    private var emptyState: some View {
        VStack {
            Spacer()
            EmptyState(
                symbol: "hourglass",
                title: "Nothing on the clock",
                message: "Write a note below and press return. You'll be asked which day it's due, what time, and how long it should linger before clearing itself."
            )
            Spacer()
            Spacer()
        }
    }

    // MARK: - Actions

    private func openWizard() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sheet = .create(text)
        draft = ""
    }
}

// MARK: - Row

struct TemporaryNoteRow: View {

    let note: TemporaryNote
    let now: Date
    let calendar: Calendar

    private var isOverdue: Bool { note.isOverdue(asOf: now) }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(note.tag.color.opacity(note.isDone ? 0.3 : 0.9))
                .frame(width: 3.5)
                .frame(maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 6) {
                Text(note.title)
                    .font(TypeScale.bodyEmphasis)
                    .foregroundStyle(Palette.ink)
                    .strikethrough(note.isDone, color: Palette.inkTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)

                if !note.details.isEmpty {
                    Text(note.details)
                        .font(TypeScale.caption)
                        .foregroundStyle(Palette.inkSecondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }

                HStack(spacing: 7) {
                    Pill(
                        text: dueText,
                        symbol: note.isAllDay ? "sun.horizon" : "clock",
                        tint: isOverdue ? Palette.clay : Palette.inkSecondary,
                        background: isOverdue ? Palette.claySoft : Palette.mossSoft
                    )

                    if !note.isDone {
                        Text(RelativeFormatting.countdown(to: note.due, from: now))
                            .font(TypeScale.micro)
                            .foregroundStyle(isOverdue ? Palette.clay : Palette.inkTertiary)
                    }
                }

                HStack(spacing: 10) {
                    if note.reminders.isEmpty {
                        Label("No reminders", systemImage: "bell.slash")
                            .font(TypeScale.micro)
                            .foregroundStyle(Palette.inkTertiary)
                    } else {
                        Label(reminderText, systemImage: "bell")
                            .font(TypeScale.micro)
                            .foregroundStyle(Palette.inkTertiary)
                    }

                    Label(clearText, systemImage: "wind")
                        .font(TypeScale.micro)
                        .foregroundStyle(Palette.inkTertiary)
                }
            }

            Spacer(minLength: 0)

            Image(systemName: note.isDone ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 21, weight: .light))
                .foregroundStyle(note.isDone ? Palette.moss : Palette.inkTertiary.opacity(0.6))
                .padding(.top, 1)
        }
        .padding(13)
        .background(
            RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                .fill(Palette.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                .strokeBorder(isOverdue && !note.isDone ? Palette.clay.opacity(0.4) : Palette.hairline, lineWidth: 1)
        )
        .dimmedWhenDone(note.isDone)
    }

    private var dueText: String {
        let day = RelativeFormatting.dayName(for: note.due, calendar: calendar, now: now)
        if note.isAllDay { return "\(day) · all day" }
        return "\(day) · \(TimeFormatting.clock.string(from: note.due))"
    }

    private var reminderText: String {
        let sorted = note.reminders.sorted(by: >)
        return sorted.map { $0.shortLabel }.joined(separator: " · ")
    }

    private var clearText: String {
        "Clears \(RelativeFormatting.dayName(for: note.expiresAt, calendar: calendar, now: now))"
    }
}

// MARK: - Stat tile

struct StatTile: View {
    let value: Int
    let label: String
    let tint: Color

    var body: some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(TypeScale.title(23))
                .foregroundStyle(value > 0 ? tint : Palette.inkTertiary)
                .monospacedDigit()
            Text(label)
                .font(TypeScale.micro)
                .foregroundStyle(Palette.inkTertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: Metrics.smallRadius, style: .continuous)
                .fill(Palette.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.smallRadius, style: .continuous)
                .strokeBorder(Palette.hairline, lineWidth: 1)
        )
    }
}
