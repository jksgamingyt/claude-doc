//
//  PermanentNotesView.swift
//  MySchedule
//
//  Standing notes. These never expire on their own — removing one is always a
//  deliberate act, which is why deleting asks first.
//

import Foundation
import SwiftUI

enum PermanentSheet: Identifiable {
    case create(String)
    case edit(PermanentNote)

    var id: String {
        switch self {
        case .create:         return "create"
        case .edit(let note): return "edit-\(note.id.uuidString)"
        }
    }
}

struct PermanentNotesView: View {

    @EnvironmentObject private var store: ScheduleStore

    @State private var draft = ""
    @State private var sheet: PermanentSheet?
    @State private var confirmingDelete: PermanentNote?

    var body: some View {
        NavigationStack {
            ZStack {
                NatureBackground(intensity: 0.28, showsRidges: false)

                if store.permanentNotes.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .navigationTitle("Permanent")
            .navigationBarTitleDisplayMode(.large)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ComposeBar(
                    text: $draft,
                    placeholder: "Something that comes round again…",
                    hint: "Return asks which days, what time, and how long it holds.",
                    tint: Palette.moss,
                    symbol: "leaf.fill",
                    onSubmit: openWizard
                )
            }
            .sheet(item: $sheet) { which in
                switch which {
                case .create(let text):
                    PermanentNoteWizard(seedText: text, settings: store.settings, calendar: store.calendar)
                        .environmentObject(store)
                case .edit(let note):
                    PermanentNoteWizard(editing: note, calendar: store.calendar)
                        .environmentObject(store)
                }
            }
            .confirmationDialog(
                "Remove this standing note?",
                isPresented: Binding(
                    get: { confirmingDelete != nil },
                    set: { if !$0 { confirmingDelete = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Remove permanently", role: .destructive) {
                    if let note = confirmingDelete {
                        store.delete(permanentID: note.id)
                        Haptics.warning()
                    }
                    confirmingDelete = nil
                }
                Button("Keep it", role: .cancel) { confirmingDelete = nil }
            } message: {
                Text("Permanent notes don't expire, so this is the only way one comes off your schedule. A copy stays in Recently cleared.")
            }
            .onChange(of: store.pendingDeepLink) { _, link in
                guard let link, link.kind == .permanent,
                      let note = store.permanentNote(id: link.noteID) else { return }
                sheet = .edit(note)
                store.pendingDeepLink = nil
            }
        }
    }

    // MARK: - List

    private var list: some View {
        List {
            Section {
                explainer
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 6, leading: Metrics.gutter, bottom: 10, trailing: Metrics.gutter))
            }

            Section {
                ForEach(store.sortedPermanentNotes) { note in
                    PermanentNoteRow(note: note, calendar: store.calendar, now: store.clockTick)
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
                                Haptics.select()
                                store.setMuted(permanentID: note.id, muted: !note.isMuted)
                            } label: {
                                Label(note.isMuted ? "Resume" : "Pause", systemImage: note.isMuted ? "play" : "pause")
                            }
                            .tint(Palette.gold)
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
                SectionHeader(
                    "\(store.permanentNotes.count) standing",
                    symbol: "leaf.fill"
                )
                .textCase(nil)
                .padding(.top, 4)
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

    private var explainer: some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: "infinity")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Palette.moss)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 3) {
                Text("These never lapse")
                    .font(TypeScale.heading(15))
                    .foregroundStyle(Palette.ink)
                Text("A permanent note keeps its place on the schedule until you remove it by hand. Pause one to hide it without losing it.")
                    .font(TypeScale.caption)
                    .foregroundStyle(Palette.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: Metrics.smallRadius, style: .continuous)
                .fill(Palette.mossSoft)
        )
    }

    // MARK: - Empty

    private var emptyState: some View {
        VStack {
            Spacer()
            EmptyState(
                symbol: "leaf",
                title: "No standing notes yet",
                message: "Write one below and press return. You'll be asked which days it appears, what time of day, and how long it holds its place. After that it simply stays."
            )
            Spacer()
            Spacer()
        }
    }

    private func openWizard() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sheet = .create(text)
        draft = ""
    }
}

// MARK: - Row

struct PermanentNoteRow: View {

    let note: PermanentNote
    let calendar: Calendar
    let now: Date

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(note.tag.color.opacity(note.isMuted ? 0.3 : 0.9))
                .frame(width: 3.5)
                .frame(maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 7) {
                    Text(note.title)
                        .font(TypeScale.bodyEmphasis)
                        .foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)

                    if note.isMuted {
                        Pill(text: "Paused", symbol: "pause.fill", tint: Palette.bark, background: Palette.hairline)
                    }
                }

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
                        text: note.recurrence.summary(calendar: calendar),
                        symbol: "repeat",
                        tint: Palette.moss,
                        background: Palette.mossSoft
                    )
                    Text(note.timeSummary(calendar: calendar))
                        .font(TypeScale.micro)
                        .foregroundStyle(Palette.inkTertiary)
                }

                HStack(spacing: 10) {
                    if note.reminders.isEmpty {
                        Label("Silent", systemImage: "bell.slash")
                            .font(TypeScale.micro)
                            .foregroundStyle(Palette.inkTertiary)
                    } else {
                        Label(reminderText, systemImage: "bell")
                            .font(TypeScale.micro)
                            .foregroundStyle(Palette.inkTertiary)
                    }

                    if let next = nextOccurrence {
                        Label("Next \(RelativeFormatting.dayName(for: next, calendar: calendar, now: now))", systemImage: "arrow.right")
                            .font(TypeScale.micro)
                            .foregroundStyle(Palette.inkTertiary)
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(13)
        .background(
            RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                .fill(Palette.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                .strokeBorder(Palette.hairline, lineWidth: 1)
        )
        .opacity(note.isMuted ? 0.55 : 1)
    }

    private var reminderText: String {
        note.reminders.sorted(by: >).map { $0.shortLabel }.joined(separator: " · ")
    }

    private var nextOccurrence: Date? {
        var cursor = calendar.startOfDay(for: max(now, note.startDate))
        for _ in 0..<400 {
            if let start = note.occurrenceStart(on: cursor, calendar: calendar), start >= calendar.startOfDay(for: now) {
                return start
            }
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { return nil }
            cursor = next
        }
        return nil
    }
}
