//
//  WizardChrome.swift
//  MySchedule
//
//  The frame both note wizards sit in: the note you typed at the top, the
//  question in the middle, and Back/Next along the bottom.
//

import Foundation
import SwiftUI

struct WizardChrome<Content: View>: View {

    let title: String
    let subtitle: String
    let tint: Color
    let stepCount: Int
    @Binding var step: Int
    @Binding var noteTitle: String

    var canAdvance: Bool
    var advanceTitle: String
    var onCancel: () -> Void
    var onFinish: () -> Void

    @ViewBuilder var content: () -> Content

    @FocusState private var titleFocused: Bool

    private var isLastStep: Bool { step >= stepCount - 1 }

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.canvasSunken.ignoresSafeArea()

                VStack(spacing: 0) {
                    noteHeader
                        .padding(.horizontal, Metrics.gutter)
                        .padding(.top, 6)
                        .padding(.bottom, 14)

                    ScrollView {
                        content()
                            .padding(.horizontal, Metrics.gutter)
                            .padding(.bottom, 24)
                    }
                    .scrollDismissesKeyboard(.interactively)

                    controls
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel", role: .cancel, action: onCancel)
                        .foregroundStyle(Palette.inkSecondary)
                }
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 2) {
                        Text(title)
                            .font(TypeScale.heading(16))
                            .foregroundStyle(Palette.ink)
                        StepIndicator(total: stepCount, current: step, tint: tint)
                    }
                }
            }
        }
    }

    // MARK: The note itself

    private var noteHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) {
                Image(systemName: "quote.opening")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(tint)
                Text(subtitle)
                    .font(TypeScale.micro)
                    .tracking(0.9)
                    .foregroundStyle(Palette.inkTertiary)
            }

            TextField("Your note", text: $noteTitle, axis: .vertical)
                .font(TypeScale.title(19))
                .foregroundStyle(Palette.ink)
                .lineLimit(1...3)
                .focused($titleFocused)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface(raised: true, padding: 15)
    }

    // MARK: Bottom bar

    private var controls: some View {
        VStack(spacing: 0) {
            Hairline()

            HStack(spacing: 11) {
                if step > 0 {
                    Button {
                        Haptics.select()
                        withAnimation(Motion.settle) { step -= 1 }
                    } label: {
                        Label("Back", systemImage: "chevron.left")
                            .labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(SoftButtonStyle())
                    .transition(.opacity)
                }

                Button {
                    Haptics.tap()
                    if isLastStep {
                        onFinish()
                    } else {
                        withAnimation(Motion.settle) { step += 1 }
                    }
                } label: {
                    HStack(spacing: 7) {
                        Text(isLastStep ? advanceTitle : "Next")
                        Image(systemName: isLastStep ? "checkmark" : "chevron.right")
                            .font(.system(size: 13, weight: .bold))
                    }
                }
                .buttonStyle(PrimaryButtonStyle(tint: tint))
                .disabled(!canAdvance)
                .opacity(canAdvance ? 1 : 0.5)
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .background(.bar)
            .animation(Motion.settle, value: step)
        }
    }
}

// MARK: - Shared wizard pieces

struct TagPicker: View {
    @Binding var selection: TagColor

    var body: some View {
        HStack(spacing: 10) {
            ForEach(TagColor.allCases) { tag in
                Button {
                    Haptics.select()
                    selection = tag
                } label: {
                    ZStack {
                        Circle()
                            .fill(tag.color)
                            .frame(width: 26, height: 26)
                        if selection == tag {
                            Circle()
                                .strokeBorder(Palette.canvas, lineWidth: 2)
                                .frame(width: 26, height: 26)
                            Circle()
                                .strokeBorder(tag.color, lineWidth: 1.8)
                                .frame(width: 33, height: 33)
                        }
                    }
                    .frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tag.displayName)
            }
            Spacer(minLength: 0)
        }
        .animation(Motion.quick, value: selection)
    }
}

/// Multi-select lead times. Empty is a legitimate choice: the note still lands
/// on the schedule, it just never buzzes.
struct ReminderPicker: View {

    @Binding var selection: [ReminderLead]
    var tint: Color = Palette.moss
    var presets: [ReminderLead] = ReminderLead.presets
    var emptyMessage: String = "No reminders. It will still appear on your schedule."

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            FlowLayout(spacing: 8, runSpacing: 8) {
                ForEach(presets) { lead in
                    SelectChip(
                        title: lead.shortLabel,
                        isSelected: selection.contains(lead),
                        tint: tint
                    ) {
                        toggle(lead)
                    }
                }
            }

            HStack(spacing: 6) {
                Image(systemName: selection.isEmpty ? "bell.slash" : "bell.badge")
                    .font(.system(size: 11, weight: .semibold))
                Text(summary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .font(TypeScale.caption)
            .foregroundStyle(Palette.inkSecondary)
        }
    }

    private var summary: String {
        guard !selection.isEmpty else { return emptyMessage }
        let ordered = selection.sorted(by: >)
        let names = ordered.map { $0.longLabel.lowercased() }
        if names.count == 1 { return "You'll be nudged \(names[0])." }
        let head = names.dropLast().joined(separator: ", ")
        return "You'll be nudged \(head), then \(names[names.count - 1])."
    }

    private func toggle(_ lead: ReminderLead) {
        if let index = selection.firstIndex(of: lead) {
            selection.remove(at: index)
        } else {
            selection.append(lead)
            selection.sort(by: >)
        }
    }
}

/// A labelled row of mutually exclusive chips.
struct ChipRow<Option: Hashable & Identifiable>: View {
    var options: [Option]
    var label: (Option) -> String
    var symbol: ((Option) -> String?)? = nil
    var tint: Color = Palette.moss
    @Binding var selection: Option

    var body: some View {
        FlowLayout(spacing: 8, runSpacing: 8) {
            ForEach(options) { option in
                SelectChip(
                    title: label(option),
                    symbol: symbol.flatMap { $0(option) },
                    isSelected: selection == option,
                    tint: tint
                ) {
                    selection = option
                }
            }
        }
    }
}
