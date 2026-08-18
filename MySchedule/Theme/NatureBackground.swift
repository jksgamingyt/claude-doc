//
//  NatureBackground.swift
//  MySchedule
//
//  The backdrop. Two soft ridgelines, one low sun, a vertical wash — enough to
//  read as landscape at a glance and quiet enough to put text on top of.
//

import Foundation
import SwiftUI

// MARK: - Ridge shape

/// A gentle sine ridge filled down to the bottom of its frame.
struct Ridge: Shape {
    /// How tall the crests are, as a fraction of the frame height.
    var amplitude: CGFloat = 0.03
    /// Horizontal offset in radians — used to make stacked ridges differ.
    var phase: CGFloat = 0
    /// Where the ridge sits, 0 = top, 1 = bottom.
    var baseline: CGFloat = 0.72
    /// How many crests fit across the frame.
    var frequency: CGFloat = 1.4

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let base = rect.minY + rect.height * baseline
        let amp = rect.height * amplitude
        let steps = 48

        path.move(to: CGPoint(x: rect.minX, y: base))
        for step in 0...steps {
            let progress = CGFloat(step) / CGFloat(steps)
            let x = rect.minX + progress * rect.width
            let angle = progress * frequency * 2 * .pi + phase
            let y = base + sin(angle) * amp - amp * 0.35
            path.addLine(to: CGPoint(x: x, y: y))
        }
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

// MARK: - Backdrop

struct NatureBackground: View {

    /// 0 = barely there (behind dense content), 1 = full welcome-screen treatment.
    var intensity: Double = 0.5
    /// Ridges are omitted on scrolling screens where they would fight the content.
    var showsRidges: Bool = true

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Palette.washTop, Palette.canvas, Palette.washBottom],
                startPoint: .top,
                endPoint: .bottom
            )

            // Low sun, top trailing.
            GeometryReader { proxy in
                RadialGradient(
                    colors: [Palette.washGlow.opacity(0.85 * intensity), Palette.washGlow.opacity(0)],
                    center: .init(x: 0.82, y: 0.14),
                    startRadius: 0,
                    endRadius: max(proxy.size.width, proxy.size.height) * 0.75
                )
                .blendMode(.plusLighter)
                .opacity(0.7)
            }
            .allowsHitTesting(false)

            if showsRidges {
                Ridge(amplitude: 0.035, phase: 0.9, baseline: 0.66, frequency: 1.1)
                    .fill(Palette.moss.opacity(0.10 * intensity))
                    .allowsHitTesting(false)

                Ridge(amplitude: 0.028, phase: 2.6, baseline: 0.78, frequency: 1.7)
                    .fill(Palette.moss.opacity(0.14 * intensity))
                    .allowsHitTesting(false)

                Ridge(amplitude: 0.02, phase: 4.1, baseline: 0.9, frequency: 2.3)
                    .fill(Palette.bark.opacity(0.09 * intensity))
                    .allowsHitTesting(false)
            }
        }
        .ignoresSafeArea()
    }
}

// MARK: - Drifting motes (welcome screen only)

/// Slow, sparse specks — pollen in a shaft of light. Deliberately few, and
/// deliberately slow; this is atmosphere, not confetti.
struct DriftingMotes: View {

    struct Mote {
        var x: Double
        var y: Double
        var radius: Double
        var speed: Double
        var sway: Double
        var opacity: Double
    }

    /// A fixed, hand-picked spread. Random placement tends to clump.
    static let motes: [Mote] = [
        Mote(x: 0.08, y: 0.22, radius: 2.2, speed: 0.014, sway: 0.9, opacity: 0.40),
        Mote(x: 0.19, y: 0.61, radius: 1.6, speed: 0.020, sway: 1.7, opacity: 0.28),
        Mote(x: 0.31, y: 0.12, radius: 2.8, speed: 0.011, sway: 0.4, opacity: 0.34),
        Mote(x: 0.42, y: 0.78, radius: 1.9, speed: 0.017, sway: 2.4, opacity: 0.30),
        Mote(x: 0.55, y: 0.34, radius: 2.4, speed: 0.013, sway: 1.2, opacity: 0.38),
        Mote(x: 0.63, y: 0.69, radius: 1.4, speed: 0.023, sway: 3.1, opacity: 0.24),
        Mote(x: 0.74, y: 0.18, radius: 2.6, speed: 0.012, sway: 0.7, opacity: 0.36),
        Mote(x: 0.83, y: 0.52, radius: 1.8, speed: 0.019, sway: 2.0, opacity: 0.30),
        Mote(x: 0.91, y: 0.85, radius: 2.1, speed: 0.015, sway: 1.5, opacity: 0.26),
        Mote(x: 0.27, y: 0.44, radius: 1.5, speed: 0.021, sway: 2.7, opacity: 0.22),
        Mote(x: 0.69, y: 0.92, radius: 2.3, speed: 0.016, sway: 1.0, opacity: 0.28),
        Mote(x: 0.47, y: 0.05, radius: 1.7, speed: 0.018, sway: 2.2, opacity: 0.32)
    ]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24.0, paused: false)) { timeline in
            Canvas { context, size in
                let seconds = timeline.date.timeIntervalSinceReferenceDate

                for mote in DriftingMotes.motes {
                    // Rise slowly, wrapping at the top.
                    var y = mote.y - seconds * mote.speed
                    y = y.truncatingRemainder(dividingBy: 1.0)
                    if y < 0 { y += 1.0 }

                    let sway = sin(seconds * 0.22 + mote.sway) * 0.012
                    let point = CGPoint(
                        x: CGFloat(mote.x + sway) * size.width,
                        y: CGFloat(y) * size.height
                    )

                    let radius = CGFloat(mote.radius)
                    let rect = CGRect(
                        x: point.x - radius,
                        y: point.y - radius,
                        width: radius * 2,
                        height: radius * 2
                    )

                    context.fill(
                        Path(ellipseIn: rect),
                        with: .color(Palette.gold.opacity(mote.opacity))
                    )
                }
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - A single leaf, used as the app's mark

struct LeafMark: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let width = rect.width
        let height = rect.height
        let tip = CGPoint(x: rect.midX, y: rect.minY)
        let base = CGPoint(x: rect.midX, y: rect.maxY)

        path.move(to: tip)
        path.addQuadCurve(
            to: base,
            control: CGPoint(x: rect.minX + width * 0.02, y: rect.minY + height * 0.42)
        )
        path.addQuadCurve(
            to: tip,
            control: CGPoint(x: rect.maxX - width * 0.02, y: rect.minY + height * 0.42)
        )
        path.closeSubpath()
        return path
    }
}

/// The leaf plus its midrib — used on the welcome screen and empty states.
struct LeafEmblem: View {
    var size: CGFloat = 64
    var tint: Color = Palette.moss

    private var width: CGFloat { size * 0.72 }

    var body: some View {
        ZStack {
            LeafMark()
                .fill(
                    LinearGradient(
                        colors: [tint.opacity(0.96), tint.opacity(0.60)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            // Midrib
            Path { path in
                path.move(to: CGPoint(x: width * 0.5, y: size * 0.10))
                path.addLine(to: CGPoint(x: width * 0.5, y: size * 0.90))
            }
            .stroke(Palette.canvas.opacity(0.50), lineWidth: max(1, size * 0.026))

            // Side veins
            ForEach(0..<3, id: \.self) { index in
                let t = CGFloat(0.34 + Double(index) * 0.18)

                Path { path in
                    path.move(to: CGPoint(x: width * 0.5, y: size * t))
                    path.addLine(to: CGPoint(x: width * 0.20, y: size * (t + 0.12)))
                }
                .stroke(Palette.canvas.opacity(0.32), lineWidth: max(0.8, size * 0.016))

                Path { path in
                    path.move(to: CGPoint(x: width * 0.5, y: size * t))
                    path.addLine(to: CGPoint(x: width * 0.80, y: size * (t + 0.12)))
                }
                .stroke(Palette.canvas.opacity(0.32), lineWidth: max(0.8, size * 0.016))
            }
        }
        .frame(width: width, height: size)
    }
}
