//
//  Formatting.swift
//  MySchedule
//
//  Shared formatters. Building a DateFormatter is expensive, so they live here
//  once instead of being rebuilt inside view bodies.
//

import Foundation

enum TimeFormatting {
    /// 9:30 AM / 09:30 — follows the phone's 12h/24h setting.
    static let clock: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()

    /// Tuesday
    static let weekdayFull: DateFormatter = {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("EEEE")
        return formatter
    }()

    /// Tue
    static let weekdayShort: DateFormatter = {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("EEE")
        return formatter
    }()

    /// August 2026
    static let monthYear: DateFormatter = {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMMM yyyy")
        return formatter
    }()

    /// August
    static let monthOnly: DateFormatter = {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMMM")
        return formatter
    }()

    /// Aug 18
    static let monthDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMM d")
        return formatter
    }()

    /// Tuesday, August 18
    static let dayHeadline: DateFormatter = {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("EEEE MMMM d")
        return formatter
    }()

    /// Aug 18, 2026 at 9:30 AM
    static let full: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    /// Stable, sortable, locale-proof key: 20260818
    static let dayKey: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd"
        return formatter
    }()

    /// Stable identifier down to the minute: 202608180930
    static let minuteKey: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMddHHmm"
        return formatter
    }()

    static func time(fromMinutes minutes: Int, calendar: Calendar = .current) -> String {
        var components = DateComponents()
        components.year = 2000
        components.month = 1
        components.day = 1
        components.hour = (minutes / 60) % 24
        components.minute = minutes % 60
        guard let date = calendar.date(from: components) else { return "--:--" }
        return clock.string(from: date)
    }
}

enum DurationFormatting {
    /// 45m · 2h · 2h 30m · All day
    static func describe(minutes: Int) -> String {
        if minutes >= PermanentNote.allDayDuration { return "All day" }
        if minutes < 60 { return "\(max(0, minutes))m" }
        let hours = minutes / 60
        let remainder = minutes % 60
        if remainder == 0 { return "\(hours)h" }
        return "\(hours)h \(remainder)m"
    }
}

enum RelativeFormatting {
    /// "in 3 days" / "2 hours ago" — used on the temporary notes list.
    static func countdown(to date: Date, from now: Date = Date()) -> String {
        let interval = date.timeIntervalSince(now)
        let magnitude = abs(interval)
        let past = interval < 0

        let phrase: String
        switch magnitude {
        case ..<60:
            phrase = "less than a minute"
        case ..<3600:
            let minutes = Int(magnitude / 60)
            phrase = minutes == 1 ? "1 minute" : "\(minutes) minutes"
        case ..<86_400:
            let hours = Int(magnitude / 3600)
            phrase = hours == 1 ? "1 hour" : "\(hours) hours"
        case ..<(86_400 * 14):
            let days = Int(magnitude / 86_400)
            phrase = days == 1 ? "1 day" : "\(days) days"
        default:
            let weeks = Int(magnitude / (86_400 * 7))
            phrase = weeks == 1 ? "1 week" : "\(weeks) weeks"
        }

        return past ? "\(phrase) ago" : "in \(phrase)"
    }

    /// "Today" / "Tomorrow" / "Yesterday" / "Tue, Aug 25"
    static func dayName(for date: Date, calendar: Calendar = .current, now: Date = Date()) -> String {
        let target = calendar.startOfDay(for: date)
        let today = calendar.startOfDay(for: now)
        let delta = calendar.dateComponents([.day], from: today, to: target).day ?? 0
        switch delta {
        case 0: return "Today"
        case 1: return "Tomorrow"
        case -1: return "Yesterday"
        default:
            if abs(delta) < 7 {
                return TimeFormatting.weekdayFull.string(from: date)
            }
            return TimeFormatting.monthDay.string(from: date)
        }
    }
}
