//
//  NoteInspector.swift
//  MySchedule
//
//  Tapping something on the schedule opens the note behind it. The schedule is
//  a view of the notes, so this is always a round trip back to the source.
//

import Foundation
import SwiftUI

struct NoteInspector: View {

    let entry: ScheduleEntry

    @EnvironmentObject private var store: ScheduleStore
    @Environment(\.dismiss) private var dismiss

    @State private var isEditing = false
    @State private var confirmingDelete = false

    private var temporary: TemporaryNote? {
        guard entry.kind == .temporary else { return nil }
        return store.temporaryNote(id: entry.noteID)
    }

    private var permanent: PermanentNote? {
        guard entry.kind == .permanent else { return nil }
        return store.permanentNote(id: entry.noteID)
    }

    private var tint: Color {
        entry.kind == .temporary ? Palette.clay : Palette.moss
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.canvasSunken.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        headerCard
                        factsCard

                        if let note = temporary {
                            temporaryActions(note)
                        } else if let note = permanent {
                            permanentActions(note)
                        } else {
                            missingNote
                        }
                    }
                    .padding(.horizontal, Metrics.gutter)
                    .padding(.vertical, 16)
                }
            }
            .navigationTitle(entry.kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $isEditing) {
                Group {
                    if let note = temporary {
                        TemporaryNoteWizard(editing: note, calendar: store.calendar)
                    } else if let note = permanent {
                        PermanentNoteWizard(editing: note, calendar: store.calendar)
                    } else {
                        EmptyView()
                    }
                }
                .environmentObject(store)
            }
            .confirmationDialog(
                "Remove this note?",
                isPresented: $confirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Remove", role: .destructive, action: remove)
                Button("Keep it", role: .cancel) { }
            } message: {
                Text("It moves to Recently cleared, where you can bring it back.")
            }
        }
    }

    // MARK: - Cards

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                TagDot(tag: entry.tag, size: 10)
                Text(entry.kind.title.uppercased())
                    .font(TypeScale.micro)
                    .tracking(1.2)
                    .foregroundStyle(tint)
                Spacer(minLength: 0)
                if entry.isOverdue {
                    Pill(text: "Past due", symbol: "exclamationmark", tint: Palette.clay, background: Palette.claySoft)
                }
            }

            Text(entry.title)
                .font(TypeScale.title(24))
                .foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)

            if !entry.details.isEmpty {
                Text(entry.details)
                    .font(TypeScale.body)
                    .foregroundStyle(Palette.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface(raised: true)
    }

    private var factsCard: some View {
        VStack(spacing: 0) {
            factRow(symbol: "calendar", label: "On", value: TimeFormatting.dayHeadline.string(from: entry.day))
            Hairline(inset: 34)
            factRow(symbol: "clock", label: "Time", value: entry.rangeLabel)

            if let note = temporary {
                Hairline(inset: 34)
                factRow(
                    symbol: "wind",
                    label: "Clears",
                    value: note.linger == .atDue
                        ? "The moment it's due"
                        : TimeFormatting.full.string(from: note.expiresAt)
                )
                Hairline(inset: 34)
                factRow(
                    symbol: note.reminders.isEmpty ? "bell.slash" : "bell",
                    label: "Reminders",
                    value: note.reminders.isEmpty
                        ? "None"
                        : note.reminders.sorted(by: >).map { $0.longLabel }.joined(separator: ", ")
                )
            }

            if let note = permanent {
                Hairline(inset: 34)
                factRow(symbol: "repeat", label: "Repeats", value: note.recurrence.summary(calendar: store.calendar))
                Hairline(inset: 34)
                factRow(symbol: "hourglass", label: "Holds", value: DurationFormatting.describe(minutes: note.durationMinutes))
                Hairline(inset: 34)
                factRow(
                    symbol: note.reminders.isEmpty ? "bell.slash" : "bell",
                    label: "Reminders",
                    value: note.reminders.isEmpty
                        ? "None"
                        : note.reminders.sorted(by: >).map { $0.longLabel }.joined(separator: ", ")
                )
            }
        }
        .cardSurface(padding: 0)
    }

    private func factRow(symbol: String, label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Palette.inkTertiary)
                .frame(width: 20)

            Text(label)
                .font(TypeScale.caption)
                .foregroundStyle(Palette.inkTertiary)
                .frame(width: 74, alignment: .leading)

            Text(value)
                .font(TypeScale.caption)
                .foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Actions

    private func temporaryActions(_ note: TemporaryNote) -> some View {
        VStack(spacing: 10) {
            Button {
                Haptics.success()
                store.markTemporaryDone(id: note.id, done: !note.isDone)
            } label: {
                Label(note.isDone ? "Mark as not done" : "Mark as done",
                      systemImage: note.isDone ? "arrow.uturn.backward" : "checkmark.circle")
            }
            .buttonStyle(PrimaryButtonStyle(tint: note.isDone ? Palette.bark : Palette.moss))

            Button {
                Haptics.tap()
                isEditing = true
            } label: {
                Label("Edit this note", systemImage: "slider.horizontal.3")
            }
            .buttonStyle(SoftButtonStyle(fullWidth: true))

            Button(role: .destructive) {
                confirmingDelete = true
            } label: {
                Label("Remove", systemImage: "trash")
                    .font(TypeScale.caption)
                    .foregroundStyle(Palette.clay)
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
    }

    private func permanentActions(_ note: PermanentNote) -> some View {
        VStack(spacing: 10) {
            Button {
                Haptics.tap()
                isEditing = true
            } label: {
                Label("Edit this note", systemImage: "slider.horizontal.3")
            }
            .buttonStyle(PrimaryButtonStyle(tint: Palette.moss))

            Button {
                Haptics.select()
                store.setMuted(permanentID: note.id, muted: !note.isMuted)
            } label: {
                Label(note.isMuted ? "Resume this note" : "Pause this note",
                      systemImage: note.isMuted ? "play" : "pause")
            }
            .buttonStyle(SoftButtonStyle(fullWidth: true))

            Text("Permanent notes never expire. Pausing hides one from the schedule without removing it.")
                .font(TypeScale.micro)
                .foregroundStyle(Palette.inkTertiary)
                .multilineTextAlignment(.center)
                .padding(.top, 2)

            Button(role: .destructive) {
                confirmingDelete = true
            } label: {
                Label("Remove permanently", systemImage: "trash")
                    .font(TypeScale.caption)
                    .foregroundStyle(Palette.clay)
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
    }

    private var missingNote: some View {
        Text("This note is no longer in your list. It may have expired while the app was closed.")
            .font(TypeScale.caption)
            .foregroundStyle(Palette.inkTertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .cardSurface()
    }

    private func remove() {
        switch entry.kind {
        case .temporary:
            store.delete(temporaryID: entry.noteID)
        case .permanent:
            store.delete(permanentID: entry.noteID)
        }
        Haptics.warning()
        dismiss()
    }
}
