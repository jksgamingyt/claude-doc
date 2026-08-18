//
//  ArchiveView.swift
//  MySchedule
//
//  Where expired and removed notes land. A temporary note disappearing is the
//  point of the feature, but disappearing without a trace is just data loss.
//

import Foundation
import SwiftUI

struct ArchiveView: View {

    @EnvironmentObject private var store: ScheduleStore
    @State private var confirmingClear = false

    var body: some View {
        ZStack {
            NatureBackground(intensity: 0.22, showsRidges: false)

            if store.archive.isEmpty {
                VStack {
                    Spacer()
                    EmptyState(
                        symbol: "wind",
                        title: "Nothing cleared yet",
                        message: "Temporary notes land here when their time runs out, and anything you remove by hand keeps them company."
                    )
                    Spacer()
                    Spacer()
                }
            } else {
                List {
                    ForEach(store.sortedArchive) { item in
                        ArchiveRow(item: item, calendar: store.calendar)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 4, leading: Metrics.gutter, bottom: 4, trailing: Metrics.gutter))
                            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                Button {
                                    Haptics.success()
                                    store.restore(archived: item)
                                } label: {
                                    Label("Bring back", systemImage: "arrow.uturn.backward")
                                }
                                .tint(Palette.moss)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    Haptics.warning()
                                    store.removeFromArchive(item)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                    }

                    Section {
                        Button(role: .destructive) {
                            confirmingClear = true
                        } label: {
                            Label("Empty this list", systemImage: "trash")
                                .frame(maxWidth: .infinity)
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    } footer: {
                        Text(retentionFooter)
                            .font(TypeScale.micro)
                            .foregroundStyle(Palette.inkTertiary)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .environment(\.defaultMinListRowHeight, 10)
            }
        }
        .navigationTitle("Recently cleared")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            "Empty Recently cleared?",
            isPresented: $confirmingClear,
            titleVisibility: .visible
        ) {
            Button("Empty it", role: .destructive) {
                store.clearArchive()
                Haptics.warning()
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("These notes will be gone for good.")
        }
    }

    private var retentionFooter: String {
        let days = store.settings.archiveRetentionDays
        if days <= 0 { return "Cleared notes are kept indefinitely. Swipe right on any of them to bring it back." }
        return "Cleared notes are kept for \(days) days, then removed. Swipe right on any of them to bring it back."
    }
}

// MARK: - Row

struct ArchiveRow: View {

    let item: ArchivedNote
    let calendar: Calendar

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: item.reason.symbol)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 22)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(TypeScale.bodyEmphasis)
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)

                if !item.details.isEmpty {
                    Text(item.details)
                        .font(TypeScale.caption)
                        .foregroundStyle(Palette.inkSecondary)
                        .lineLimit(2)
                }

                HStack(spacing: 8) {
                    Pill(text: item.reason.displayName, tint: tint, background: Palette.hairline)
                    Text("\(item.kind.title.lowercased()) · \(TimeFormatting.full.string(from: item.archivedAt))")
                        .font(TypeScale.micro)
                        .foregroundStyle(Palette.inkTertiary)
                }
            }

            Spacer(minLength: 0)

            TagDot(tag: item.tag, size: 8)
                .padding(.top, 5)
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
    }

    private var tint: Color {
        switch item.reason {
        case .expired:   return Palette.gold
        case .completed: return Palette.moss
        case .deleted:   return Palette.bark
        }
    }
}
