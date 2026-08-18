//
//  Components.swift
//  MySchedule
//
//  The handful of pieces every screen is built from. Keeping them here is what
//  stops the four sections from drifting into four different apps.
//

import Foundation
import SwiftUI

// MARK: - Card surface

struct CardSurface: ViewModifier {
    var radius: CGFloat = Metrics.cardRadius
    var raised: Bool = false
    var padding: CGFloat = 16

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(raised ? Palette.cardRaised : Palette.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(Palette.hairline, lineWidth: Metrics.hairlineWidth)
            )
            .shadow(
                color: Palette.shadow.opacity(raised ? 0.10 : 0.05),
                radius: raised ? 14 : 7,
                x: 0,
                y: raised ? 6 : 3
            )
    }
}

extension View {
    func cardSurface(
        radius: CGFloat = Metrics.cardRadius,
        raised: Bool = false,
        padding: CGFloat = 16
    ) -> some View {
        modifier(CardSurface(radius: radius, raised: raised, padding: padding))
    }
}

// MARK: - Hairline

struct Hairline: View {
    var inset: CGFloat = 0

    var body: some View {
        Rectangle()
            .fill(Palette.hairline)
            .frame(height: Metrics.hairlineWidth)
            .padding(.leading, inset)
    }
}

// MARK: - Section header

struct SectionHeader<Trailing: View>: View {
    let title: String
    var symbol: String?
    var tint: Color = Palette.inkSecondary
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(tint)
            }
            Text(title.uppercased())
                .font(TypeScale.micro)
                .tracking(1.1)
                .foregroundStyle(tint)
            Spacer(minLength: 8)
            trailing()
        }
    }
}

extension SectionHeader where Trailing == EmptyView {
    init(_ title: String, symbol: String? = nil, tint: Color = Palette.inkSecondary) {
        self.init(title: title, symbol: symbol, tint: tint, trailing: { EmptyView() })
    }
}

// MARK: - Tag dot

struct TagDot: View {
    var tag: TagColor
    var size: CGFloat = 8
    var hollow: Bool = false

    var body: some View {
        Group {
            if hollow {
                Circle()
                    .strokeBorder(tag.color, lineWidth: max(1.2, size * 0.22))
            } else {
                Circle()
                    .fill(tag.color)
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Pills and chips

struct Pill: View {
    var text: String
    var symbol: String?
    var tint: Color = Palette.inkSecondary
    var background: Color = Palette.mossSoft

    var body: some View {
        HStack(spacing: 4) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 10, weight: .bold))
            }
            Text(text)
                .font(TypeScale.micro)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(
            Capsule(style: .continuous).fill(background)
        )
    }
}

/// A selectable chip. The workhorse of both note wizards.
struct SelectChip: View {
    var title: String
    var symbol: String?
    var isSelected: Bool
    var tint: Color = Palette.moss
    var action: () -> Void

    var body: some View {
        Button(action: {
            Haptics.select()
            action()
        }) {
            HStack(spacing: 6) {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 12, weight: .semibold))
                }
                Text(title)
                    .font(TypeScale.captionEmphasis)
            }
            .foregroundStyle(isSelected ? Palette.canvas : Palette.ink)
            .padding(.horizontal, 13)
            .padding(.vertical, 9)
            .background(
                Capsule(style: .continuous)
                    .fill(isSelected ? tint : Palette.card)
            )
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(isSelected ? Color.clear : Palette.hairline, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .animation(Motion.quick, value: isSelected)
    }
}

/// Chips that wrap onto as many rows as they need. A real Layout rather than
/// the alignment-guide trick — it measures correctly the first time, which the
/// trick famously does not.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var runSpacing: CGFloat = 8
    var alignment: HorizontalAlignment = .leading

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        let rows = makeRows(maxWidth: maxWidth, subviews: subviews)

        let width = rows.map { $0.width }.max() ?? 0
        let height = rows.reduce(CGFloat.zero) { partial, row in
            partial + row.height
        } + runSpacing * CGFloat(max(0, rows.count - 1))

        return CGSize(
            width: maxWidth.isFinite ? min(width, maxWidth) : width,
            height: height
        )
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {
        let rows = makeRows(maxWidth: bounds.width, subviews: subviews)
        var y = bounds.minY

        for row in rows {
            var x: CGFloat
            switch alignment {
            case .center:
                x = bounds.minX + (bounds.width - row.width) / 2
            case .trailing:
                x = bounds.maxX - row.width
            default:
                x = bounds.minX
            }

            for item in row.items {
                subviews[item.index].place(
                    at: CGPoint(x: x, y: y + (row.height - item.size.height) / 2),
                    proposal: ProposedViewSize(item.size)
                )
                x += item.size.width + spacing
            }
            y += row.height + runSpacing
        }
    }

    // MARK: Row measurement

    private struct Item {
        var index: Int
        var size: CGSize
    }

    private struct Row {
        var items: [Item] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func makeRows(maxWidth: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()

        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let projected = current.items.isEmpty ? size.width : current.width + spacing + size.width

            if !current.items.isEmpty && projected > maxWidth {
                rows.append(current)
                current = Row()
                current.items = [Item(index: index, size: size)]
                current.width = size.width
                current.height = size.height
            } else {
                current.items.append(Item(index: index, size: size))
                current.width = projected
                current.height = max(current.height, size.height)
            }
        }

        if !current.items.isEmpty { rows.append(current) }
        return rows
    }
}

/// A View wrapper around `FlowLayout`.
///
/// A Layout *can* be written as `FlowLayout(spacing: 8) { … }`, but that leans
/// on the compiler pairing an initialiser call with `callAsFunction` — subtle
/// enough that it is not worth depending on at ten call sites. Invoking the
/// layout on a value is unambiguous under any reading.
struct ChipFlow<Content: View>: View {
    var spacing: CGFloat = 8
    var runSpacing: CGFloat = 8
    var alignment: HorizontalAlignment = .leading
    @ViewBuilder var content: () -> Content

    var body: some View {
        let layout = FlowLayout(spacing: spacing, runSpacing: runSpacing, alignment: alignment)
        return layout { content() }
    }
}

// MARK: - Buttons

struct PrimaryButtonStyle: ButtonStyle {
    var tint: Color = Palette.moss
    var fullWidth: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(TypeScale.heading(16))
            .foregroundStyle(Palette.canvas)
            .padding(.vertical, 14)
            .padding(.horizontal, 22)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(
                Capsule(style: .continuous)
                    .fill(tint)
                    .opacity(configuration.isPressed ? 0.82 : 1)
            )
            .shadow(color: tint.opacity(0.28), radius: configuration.isPressed ? 4 : 10, x: 0, y: 4)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(Motion.quick, value: configuration.isPressed)
    }
}

struct SoftButtonStyle: ButtonStyle {
    var tint: Color = Palette.ink
    var fullWidth: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(TypeScale.heading(15))
            .foregroundStyle(tint)
            .padding(.vertical, 12)
            .padding(.horizontal, 18)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(
                Capsule(style: .continuous)
                    .fill(Palette.card)
                    .opacity(configuration.isPressed ? 0.7 : 1)
            )
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(Palette.hairline, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(Motion.quick, value: configuration.isPressed)
    }
}

// MARK: - Empty state

struct EmptyState: View {
    var symbol: String = "leaf"
    var title: String
    var message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(Palette.mossSoft)
                    .frame(width: 76, height: 76)
                Image(systemName: symbol)
                    .font(.system(size: 28, weight: .light))
                    .foregroundStyle(Palette.moss)
            }

            VStack(spacing: 6) {
                Text(title)
                    .font(TypeScale.title(19))
                    .foregroundStyle(Palette.ink)
                Text(message)
                    .font(TypeScale.body)
                    .foregroundStyle(Palette.inkSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(SoftButtonStyle())
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: 320)
        .padding(.horizontal, 24)
        .padding(.vertical, 32)
    }
}

// MARK: - Step indicator

struct StepIndicator: View {
    var total: Int
    var current: Int
    var tint: Color = Palette.moss

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<max(1, total), id: \.self) { index in
                Capsule(style: .continuous)
                    .fill(index <= current ? tint : Palette.hairline)
                    .frame(width: index == current ? 22 : 7, height: 5)
                    .animation(Motion.settle, value: current)
            }
        }
        .accessibilityLabel("Step \(current + 1) of \(total)")
    }
}

// MARK: - Field wrapper

struct FieldBlock<Content: View>: View {
    var title: String
    var caption: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(TypeScale.heading(15))
                    .foregroundStyle(Palette.ink)
                if let caption {
                    Text(caption)
                        .font(TypeScale.caption)
                        .foregroundStyle(Palette.inkTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Small helpers

struct CountBadge: View {
    var count: Int
    var tint: Color = Palette.clay

    var body: some View {
        Text("\(count)")
            .font(TypeScale.micro)
            .foregroundStyle(Palette.canvas)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule(style: .continuous).fill(tint))
            .opacity(count > 0 ? 1 : 0)
    }
}

/// A row that dims and strikes through when its note is done.
struct DoneModifier: ViewModifier {
    var isDone: Bool

    func body(content: Content) -> some View {
        content
            .opacity(isDone ? 0.5 : 1)
            .animation(Motion.quick, value: isDone)
    }
}

extension View {
    func dimmedWhenDone(_ isDone: Bool) -> some View {
        modifier(DoneModifier(isDone: isDone))
    }
}
