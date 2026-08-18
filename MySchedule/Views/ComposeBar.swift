//
//  ComposeBar.swift
//  MySchedule
//
//  Type a note, hit return, and the app asks you the questions it needs. The
//  bar itself never saves anything — pressing return hands the text to a wizard.
//

import Foundation
import SwiftUI

struct ComposeBar: View {

    @Binding var text: String
    var placeholder: String
    var hint: String
    var tint: Color
    var symbol: String
    var onSubmit: () -> Void

    @FocusState private var isFocused: Bool

    private var canSubmit: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            Hairline()

            VStack(spacing: 7) {
                HStack(spacing: 10) {
                    Image(systemName: symbol)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(tint)

                    // Deliberately single-line: a vertical TextField turns the
                    // return key into a newline, and pressing return is the
                    // whole interaction here.
                    TextField(placeholder, text: $text)
                        .font(TypeScale.body)
                        .foregroundStyle(Palette.ink)
                        .focused($isFocused)
                        .submitLabel(.next)
                        .onSubmit(submit)

                    Button(action: submit) {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 27))
                            .foregroundStyle(canSubmit ? tint : Palette.inkTertiary.opacity(0.45))
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSubmit)
                    .animation(Motion.quick, value: canSubmit)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(
                    RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                        .fill(Palette.card)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                        .strokeBorder(isFocused ? tint.opacity(0.5) : Palette.hairline, lineWidth: 1)
                )
                .animation(Motion.quick, value: isFocused)

                if isFocused || canSubmit {
                    Text(hint)
                        .font(TypeScale.micro)
                        .foregroundStyle(Palette.inkTertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
                        .transition(.opacity)
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 10)
            .padding(.bottom, 8)
            .background(.bar)
            .animation(Motion.quick, value: isFocused)
        }
    }

    private func submit() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        Haptics.tap()
        isFocused = false
        onSubmit()
    }
}
