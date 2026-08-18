//
//  Theme.swift
//  MySchedule
//
//  A small, disciplined palette drawn from actual landscape: moss, fern, bark,
//  overcast sky, low sun. Two versions of every colour — parchment daylight and
//  a dark forest floor — resolved by iOS from the trait collection, so the whole
//  app follows the phone (or the override in Settings) without any extra work.
//

import Foundation
import SwiftUI
import UIKit

// MARK: - Dynamic colour helper

extension Color {
    /// Build a colour that resolves itself for light and dark.
    static func adaptive(
        light: (r: Double, g: Double, b: Double),
        dark: (r: Double, g: Double, b: Double)
    ) -> Color {
        Color(uiColor: UIColor { traits in
            let tuple = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat(tuple.r),
                green: CGFloat(tuple.g),
                blue: CGFloat(tuple.b),
                alpha: 1.0
            )
        })
    }
}

// MARK: - Palette

enum Palette {

    // Surfaces
    static let canvas = Color.adaptive(
        light: (0.949, 0.960, 0.937),
        dark:  (0.043, 0.075, 0.063)
    )
    static let canvasSunken = Color.adaptive(
        light: (0.906, 0.929, 0.894),
        dark:  (0.027, 0.051, 0.043)
    )
    static let card = Color.adaptive(
        light: (0.996, 0.996, 0.988),
        dark:  (0.086, 0.129, 0.110)
    )
    static let cardRaised = Color.adaptive(
        light: (1.000, 1.000, 1.000),
        dark:  (0.114, 0.169, 0.145)
    )

    // Ink
    static let ink = Color.adaptive(
        light: (0.106, 0.149, 0.125),
        dark:  (0.906, 0.937, 0.910)
    )
    static let inkSecondary = Color.adaptive(
        light: (0.333, 0.388, 0.357),
        dark:  (0.639, 0.698, 0.659)
    )
    static let inkTertiary = Color.adaptive(
        light: (0.541, 0.588, 0.557),
        dark:  (0.431, 0.494, 0.455)
    )

    // Accents
    static let moss = Color.adaptive(
        light: (0.243, 0.420, 0.310),
        dark:  (0.471, 0.725, 0.549)
    )
    static let mossSoft = Color.adaptive(
        light: (0.863, 0.910, 0.871),
        dark:  (0.133, 0.196, 0.157)
    )
    static let fern = Color.adaptive(
        light: (0.376, 0.573, 0.404),
        dark:  (0.549, 0.784, 0.588)
    )
    static let bark = Color.adaptive(
        light: (0.404, 0.325, 0.259),
        dark:  (0.643, 0.549, 0.455)
    )
    static let clay = Color.adaptive(
        light: (0.706, 0.365, 0.239),
        dark:  (0.882, 0.545, 0.416)
    )
    static let claySoft = Color.adaptive(
        light: (0.976, 0.910, 0.878),
        dark:  (0.216, 0.129, 0.098)
    )
    static let gold = Color.adaptive(
        light: (0.749, 0.565, 0.204),
        dark:  (0.898, 0.729, 0.376)
    )
    static let sky = Color.adaptive(
        light: (0.353, 0.541, 0.663),
        dark:  (0.510, 0.702, 0.824)
    )

    // Structure
    static let hairline = Color.adaptive(
        light: (0.855, 0.886, 0.843),
        dark:  (0.157, 0.208, 0.180)
    )
    static let shadow = Color.adaptive(
        light: (0.180, 0.239, 0.204),
        dark:  (0.000, 0.000, 0.000)
    )

    // Backdrop washes
    static let washTop = Color.adaptive(
        light: (0.878, 0.918, 0.878),
        dark:  (0.055, 0.106, 0.090)
    )
    static let washBottom = Color.adaptive(
        light: (0.965, 0.965, 0.937),
        dark:  (0.031, 0.059, 0.051)
    )
    static let washGlow = Color.adaptive(
        light: (0.918, 0.882, 0.780),
        dark:  (0.078, 0.157, 0.129)
    )
}

// MARK: - Metrics

enum Metrics {
    static let cardRadius: CGFloat = 18
    static let smallRadius: CGFloat = 12
    static let pillRadius: CGFloat = 999

    static let gutter: CGFloat = 18
    static let stackSpacing: CGFloat = 14
    static let tightSpacing: CGFloat = 8

    static let hairlineWidth: CGFloat = 1
    static let touchTarget: CGFloat = 44
}

// MARK: - Type

enum TypeScale {
    static func display(_ size: CGFloat = 34) -> Font {
        .system(size: size, weight: .semibold, design: .serif)
    }

    static func title(_ size: CGFloat = 22) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
    }

    static func heading(_ size: CGFloat = 17) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
    }

    static let body = Font.system(size: 16, weight: .regular)
    static let bodyEmphasis = Font.system(size: 16, weight: .medium)
    static let caption = Font.system(size: 13, weight: .regular)
    static let captionEmphasis = Font.system(size: 13, weight: .semibold, design: .rounded)
    static let micro = Font.system(size: 11, weight: .medium, design: .rounded)
    static let numeral = Font.system(size: 16, weight: .medium, design: .rounded)
}

// MARK: - Haptics

enum Haptics {
    static var enabled = true

    static func tap() {
        guard enabled else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func select() {
        guard enabled else { return }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    static func success() {
        guard enabled else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func warning() {
        guard enabled else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
}

// MARK: - Motion

enum Motion {
    /// Everything in the app uses one of these three. Nothing bounces.
    static let settle = Animation.spring(response: 0.42, dampingFraction: 0.86)
    static let quick = Animation.spring(response: 0.28, dampingFraction: 0.9)
    static let drift = Animation.easeInOut(duration: 0.6)
}

// MARK: - Appearance bridging

extension AppearanceMode {
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light:  return .light
        case .dark:   return .dark
        }
    }
}

// MARK: - System chrome

enum Chrome {
    /// Nudges UIKit's bars towards the same palette the SwiftUI views use.
    /// Called once at launch.
    static func configure() {
        let tabAppearance = UITabBarAppearance()
        tabAppearance.configureWithDefaultBackground()
        UITabBar.appearance().standardAppearance = tabAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabAppearance

        let navAppearance = UINavigationBarAppearance()
        navAppearance.configureWithTransparentBackground()
        navAppearance.titleTextAttributes = [
            .font: UIFont.systemFont(ofSize: 17, weight: .semibold)
        ]
        navAppearance.largeTitleTextAttributes = [
            .font: UIFont.systemFont(ofSize: 32, weight: .bold)
        ]

        let scrollAppearance = UINavigationBarAppearance()
        scrollAppearance.configureWithDefaultBackground()
        scrollAppearance.titleTextAttributes = navAppearance.titleTextAttributes
        scrollAppearance.largeTitleTextAttributes = navAppearance.largeTitleTextAttributes

        UINavigationBar.appearance().standardAppearance = scrollAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navAppearance
        UINavigationBar.appearance().compactAppearance = scrollAppearance
    }
}
