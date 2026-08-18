//
//  HowItWorksView.swift
//  MySchedule
//
//  A short, honest account of the model — including the one thing an offline
//  iPhone app genuinely cannot do.
//

import Foundation
import SwiftUI

struct HowItWorksView: View {

    var body: some View {
        ZStack {
            NatureBackground(intensity: 0.24, showsRidges: false)

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    intro

                    ExplainerCard(
                        symbol: "hourglass",
                        tint: Palette.clay,
                        title: "Temporary notes",
                        text: "Give one a day and a time and it takes a place on your schedule. Reminders arrive ahead of the deadline, then at the deadline itself. When its expiry moment passes, the note announces itself one last time and comes off the schedule."
                    )

                    ExplainerCard(
                        symbol: "leaf.fill",
                        tint: Palette.moss,
                        title: "Permanent notes",
                        text: "Give one a rhythm — every day, weekdays, certain days, once a month — a time of day, and how long it holds its place. It then repeats forever. Nothing removes it but you."
                    )

                    ExplainerCard(
                        symbol: "calendar",
                        tint: Palette.sky,
                        title: "The schedule",
                        text: "Nothing is created here. Every day is assembled from the two notes sections each time you look at it, which is why the schedule can never fall out of step with what you wrote."
                    )

                    ExplainerCard(
                        symbol: "wind",
                        tint: Palette.gold,
                        title: "What happens while the app is closed",
                        text: "Notifications are handed to iOS in advance, so they arrive whether or not MySchedule is running. The tidying up they announce — moving an expired note off the schedule — happens the next time you open the app. That is why a note occasionally clears itself the moment you launch: the alert was already delivered, the housekeeping was waiting for you."
                    )

                    ExplainerCard(
                        symbol: "lock",
                        tint: Palette.bark,
                        title: "Where your notes live",
                        text: "In one file on this phone. There is no account, no server, and nothing leaves the device. Settings can write a backup file you can send yourself."
                    )

                    footer
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, 18)
            }
        }
        .navigationTitle("How it works")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 10) {
            LeafEmblem(size: 46)

            Text("Two kinds of note, one schedule")
                .font(TypeScale.title(21))
                .foregroundStyle(Palette.ink)

            Text("You never edit the schedule directly. You write notes, answer three short questions, and the schedule keeps itself in order.")
                .font(TypeScale.body)
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface(raised: true)
    }

    private var footer: some View {
        Text("Built for one person, on one phone.")
            .font(TypeScale.micro)
            .foregroundStyle(Palette.inkTertiary)
            .frame(maxWidth: .infinity)
            .padding(.top, 6)
    }
}

struct ExplainerCard: View {
    let symbol: String
    let tint: Color
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            ZStack {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(tint.opacity(0.15))
                    .frame(width: 38, height: 38)
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(tint)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(TypeScale.heading(16))
                    .foregroundStyle(Palette.ink)
                Text(text)
                    .font(TypeScale.caption)
                    .foregroundStyle(Palette.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
    }
}
