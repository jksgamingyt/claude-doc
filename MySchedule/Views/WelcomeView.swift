//
//  WelcomeView.swift
//  MySchedule
//
//  The front door. One tap opens it, then three ways in.
//

import Foundation
import SwiftUI

struct WelcomeView: View {

    let onEnter: (MainTab) -> Void

    @EnvironmentObject private var store: ScheduleStore
    @State private var doorsOpen = false
    @State private var emblemSettled = false

    var body: some View {
        ZStack {
            NatureBackground(intensity: 1.0)
            DriftingMotes()

            VStack(spacing: 0) {
                Spacer(minLength: 24)

                header
                    .padding(.horizontal, 28)

                Spacer(minLength: 18)

                if doorsOpen {
                    doors
                        .padding(.horizontal, 22)
                        .transition(.asymmetric(
                            insertion: .move(edge: .bottom).combined(with: .opacity),
                            removal: .opacity
                        ))
                } else {
                    enterButton
                        .padding(.horizontal, 40)
                        .transition(.opacity)
                }

                Spacer(minLength: 26)

                footer
                    .padding(.bottom, 10)
            }
            .padding(.vertical, 10)
        }
        .animation(Motion.settle, value: doorsOpen)
        .onAppear {
            withAnimation(Motion.drift.delay(0.15)) {
                emblemSettled = true
            }
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(spacing: 16) {
            LeafEmblem(size: 88)
                .scaleEffect(emblemSettled ? 1 : 0.9)
                .opacity(emblemSettled ? 1 : 0)
                .shadow(color: Palette.moss.opacity(0.25), radius: 18, x: 0, y: 10)

            VStack(spacing: 8) {
                Text("MySchedule")
                    .font(TypeScale.display(38))
                    .foregroundStyle(Palette.ink)

                Text(greeting)
                    .font(TypeScale.body)
                    .foregroundStyle(Palette.inkSecondary)

                Text(todayLine)
                    .font(TypeScale.captionEmphasis)
                    .foregroundStyle(Palette.inkTertiary)
                    .tracking(0.6)
                    .padding(.top, 2)
            }
            .opacity(emblemSettled ? 1 : 0)
            .offset(y: emblemSettled ? 0 : 8)

            statusLine
                .opacity(emblemSettled ? 1 : 0)
        }
    }

    private var statusLine: some View {
        let count = store.attentionCount
        let upcoming = store.engine.upcoming(within: 7, limit: 1).first

        return Group {
            if count > 0 {
                Pill(
                    text: count == 1 ? "1 thing needs you today" : "\(count) things need you today",
                    symbol: "bell.fill",
                    tint: Palette.clay,
                    background: Palette.claySoft
                )
            } else if let upcoming {
                Pill(
                    text: "Next: \(upcoming.title) · \(RelativeFormatting.dayName(for: upcoming.start, calendar: store.calendar, now: store.clockTick))",
                    symbol: "arrow.right",
                    tint: Palette.moss,
                    background: Palette.mossSoft
                )
            } else {
                Pill(
                    text: "Nothing pressing",
                    symbol: "leaf",
                    tint: Palette.moss,
                    background: Palette.mossSoft
                )
            }
        }
        .padding(.top, 4)
    }

    // MARK: Enter

    private var enterButton: some View {
        VStack(spacing: 14) {
            Button {
                Haptics.tap()
                if store.settings.startTab == .ask {
                    doorsOpen = true
                } else {
                    onEnter(MainTab(startTab: store.settings.startTab))
                }
            } label: {
                HStack(spacing: 9) {
                    Text(store.settings.startTab == .ask ? "Step in" : "Continue")
                    Image(systemName: "arrow.right")
                        .font(.system(size: 14, weight: .bold))
                }
            }
            .buttonStyle(PrimaryButtonStyle())

            Text(store.settings.startTab == .ask
                 ? "Then choose where to begin"
                 : "Opening \(store.settings.startTab.displayName.lowercased())")
                .font(TypeScale.caption)
                .foregroundStyle(Palette.inkTertiary)
        }
    }

    // MARK: Doors

    private var doors: some View {
        VStack(spacing: 11) {
            DoorCard(
                title: "Temporary notes",
                subtitle: "Deadlines that clear themselves out",
                symbol: "hourglass",
                tint: Palette.clay,
                count: store.activeTemporaryNotes.filter { !$0.isDone }.count,
                countNoun: "waiting"
            ) {
                onEnter(.temporary)
            }

            DoorCard(
                title: "Permanent notes",
                subtitle: "Standing arrangements that never lapse",
                symbol: "leaf.fill",
                tint: Palette.moss,
                count: store.permanentNotes.filter { !$0.isMuted }.count,
                countNoun: "standing"
            ) {
                onEnter(.permanent)
            }

            DoorCard(
                title: "The schedule",
                subtitle: "Everything you've written, laid out by day",
                symbol: "calendar",
                tint: Palette.sky,
                count: store.engine.entries(on: Date()).count,
                countNoun: "today"
            ) {
                onEnter(.schedule)
            }
        }
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 16) {
            if doorsOpen {
                Button {
                    Haptics.tap()
                    doorsOpen = false
                } label: {
                    Label("Back", systemImage: "chevron.left")
                        .font(TypeScale.caption)
                        .foregroundStyle(Palette.inkTertiary)
                }
                .buttonStyle(.plain)
            }

            Button {
                Haptics.tap()
                onEnter(.settings)
            } label: {
                Label("Settings", systemImage: "gearshape")
                    .font(TypeScale.caption)
                    .foregroundStyle(Palette.inkTertiary)
            }
            .buttonStyle(.plain)
        }
        .animation(Motion.quick, value: doorsOpen)
    }

    // MARK: Copy

    private var greeting: String {
        let hour = store.calendar.component(.hour, from: store.clockTick)
        switch hour {
        case 0..<5:   return "Still up. Let's keep it light."
        case 5..<9:   return "Early. The day's still folded up."
        case 9..<12:  return "Good morning."
        case 12..<17: return "Good afternoon."
        case 17..<21: return "Good evening."
        default:      return "Winding down."
        }
    }

    private var todayLine: String {
        TimeFormatting.dayHeadline.string(from: store.clockTick).uppercased()
    }
}

// MARK: - Door card

struct DoorCard: View {
    let title: String
    let subtitle: String
    let symbol: String
    let tint: Color
    let count: Int
    let countNoun: String
    let action: () -> Void

    var body: some View {
        Button(action: {
            Haptics.tap()
            action()
        }) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .fill(tint.opacity(0.16))
                        .frame(width: 46, height: 46)
                    Image(systemName: symbol)
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(tint)
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(TypeScale.heading(17))
                        .foregroundStyle(Palette.ink)
                    Text(subtitle)
                        .font(TypeScale.caption)
                        .foregroundStyle(Palette.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 6)

                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(count)")
                        .font(TypeScale.title(20))
                        .foregroundStyle(count > 0 ? tint : Palette.inkTertiary)
                    Text(countNoun)
                        .font(TypeScale.micro)
                        .foregroundStyle(Palette.inkTertiary)
                }
            }
            .cardSurface(raised: true, padding: 15)
        }
        .buttonStyle(.plain)
    }
}
