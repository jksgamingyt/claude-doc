//
//  NotificationManager.swift
//  MySchedule
//
//  The thin, impure half: takes a plan and hands it to iOS.
//
//  Everything is local. Nothing leaves the phone, and nothing needs a server —
//  which also means the app cannot run code while it is closed. Alerts are
//  scheduled ahead of time; the tidying up they announce happens the next time
//  the app is opened.
//

import Foundation
import UserNotifications

enum NotificationAuthorization: Equatable {
    case unknown
    case notDetermined
    case denied
    case authorized
    case provisional

    var isUsable: Bool {
        self == .authorized || self == .provisional
    }

    var explanation: String {
        switch self {
        case .unknown:        return "Checking with iOS…"
        case .notDetermined:  return "MySchedule hasn't asked for permission yet."
        case .denied:         return "Notifications are turned off in iOS Settings."
        case .authorized:     return "Reminders will arrive on time."
        case .provisional:    return "Reminders arrive quietly, in Notification Centre."
        }
    }
}

final class NotificationManager: NSObject {

    // Action identifiers, surfaced on the notification itself.
    enum Action {
        static let markDone = "MYSCHEDULE_MARK_DONE"
        static let snoozeHour = "MYSCHEDULE_SNOOZE_HOUR"
        static let temporaryCategory = "MYSCHEDULE_TEMPORARY"
        static let permanentCategory = "MYSCHEDULE_PERMANENT"
    }

    enum UserInfoKey {
        static let noteID = "noteID"
        static let kind = "kind"
        static let flavor = "flavor"
    }

    static let shared = NotificationManager()

    private let center = UNUserNotificationCenter.current()

    /// Set by the app so notification buttons can reach the store.
    var onMarkDone: ((UUID) -> Void)?
    var onSnooze: ((UUID, TimeInterval) -> Void)?
    var onOpenNote: ((UUID, NoteKind) -> Void)?

    /// iOS can launch the app straight into a notification response, before the
    /// store exists to handle it. Those responses wait here instead of being lost.
    private var queued: [(action: String, noteID: UUID, kind: NoteKind)] = []

    private override init() {
        super.init()
    }

    // MARK: - Setup

    /// Called from the app delegate at launch, before any view exists, so a
    /// notification tapped while the app was closed still finds a delegate.
    func bootstrap() {
        center.delegate = self
        registerCategories()
    }

    /// Called once the store has installed its handlers.
    func flushQueuedResponses() {
        let pending = queued
        queued.removeAll()
        for item in pending {
            deliver(action: item.action, noteID: item.noteID, kind: item.kind)
        }
    }

    private func deliver(action: String, noteID: UUID, kind: NoteKind) {
        switch action {
        case Action.markDone:
            guard let handler = onMarkDone else { break }
            handler(noteID)
            return
        case Action.snoozeHour:
            guard let handler = onSnooze else { break }
            handler(noteID, 3600)
            return
        case UNNotificationDefaultActionIdentifier:
            guard let handler = onOpenNote else { break }
            handler(noteID, kind)
            return
        default:
            return
        }
        // No handler yet — hold onto it.
        queued.append((action: action, noteID: noteID, kind: kind))
    }

    private func registerCategories() {
        let done = UNNotificationAction(
            identifier: Action.markDone,
            title: "Mark done",
            options: [.authenticationRequired]
        )
        let snooze = UNNotificationAction(
            identifier: Action.snoozeHour,
            title: "Remind me in an hour",
            options: []
        )

        let temporary = UNNotificationCategory(
            identifier: Action.temporaryCategory,
            actions: [done, snooze],
            intentIdentifiers: [],
            options: []
        )
        let permanent = UNNotificationCategory(
            identifier: Action.permanentCategory,
            actions: [snooze],
            intentIdentifiers: [],
            options: []
        )

        center.setNotificationCategories([temporary, permanent])
    }

    // MARK: - Authorization

    func refreshAuthorization(_ completion: @escaping (NotificationAuthorization) -> Void) {
        center.getNotificationSettings { settings in
            let mapped: NotificationAuthorization
            switch settings.authorizationStatus {
            case .notDetermined: mapped = .notDetermined
            case .denied:        mapped = .denied
            case .authorized:    mapped = .authorized
            case .provisional:   mapped = .provisional
            case .ephemeral:     mapped = .authorized
            @unknown default:    mapped = .unknown
            }
            DispatchQueue.main.async { completion(mapped) }
        }
    }

    func requestAuthorization(_ completion: @escaping (NotificationAuthorization) -> Void) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] _, _ in
            guard let self else {
                DispatchQueue.main.async { completion(.unknown) }
                return
            }
            self.refreshAuthorization(completion)
        }
    }

    // MARK: - Scheduling

    /// Wipes the pending set and lays down the current plan. Cheap enough to run
    /// on every edit and every foreground; iOS coalesces the work.
    func apply(
        plans: [PlannedNotification],
        calendar: Calendar,
        now: Date = Date(),
        badgeCount: Int? = nil,
        completion: (() -> Void)? = nil
    ) {
        center.removeAllPendingNotificationRequests()

        let group = DispatchGroup()

        for plan in plans {
            guard let request = makeRequest(from: plan, calendar: calendar, now: now, badgeCount: badgeCount) else { continue }
            group.enter()
            center.add(request) { _ in group.leave() }
        }

        group.notify(queue: .main) {
            completion?()
        }
    }

    private func makeRequest(
        from plan: PlannedNotification,
        calendar: Calendar,
        now: Date,
        badgeCount: Int?
    ) -> UNNotificationRequest? {
        let content = UNMutableNotificationContent()
        content.title = plan.title
        content.body = plan.body
        content.sound = .default
        content.threadIdentifier = plan.threadID
        content.categoryIdentifier = plan.kind == .temporary
            ? Action.temporaryCategory
            : Action.permanentCategory
        content.userInfo = [
            UserInfoKey.noteID: plan.noteID.uuidString,
            UserInfoKey.kind: plan.kind.rawValue,
            UserInfoKey.flavor: plan.flavor.rawValue
        ]
        if let badgeCount {
            content.badge = NSNumber(value: badgeCount)
        }

        let trigger: UNNotificationTrigger
        switch plan.trigger {
        case .oneShot(let date):
            guard date > now else { return nil }
            let components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
            trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)

        case .daily(let hour, let minute):
            var components = DateComponents()
            components.hour = hour
            components.minute = minute
            trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)

        case .weekly(let weekday, let hour, let minute):
            var components = DateComponents()
            components.weekday = weekday
            components.hour = hour
            components.minute = minute
            trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
        }

        return UNNotificationRequest(identifier: plan.id, content: content, trigger: trigger)
    }

    /// One-off alert used by the snooze action.
    func scheduleSnooze(noteID: UUID, title: String, after interval: TimeInterval) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = "Snoozed reminder."
        content.sound = .default
        content.threadIdentifier = "temporary-\(noteID.uuidString)"
        content.categoryIdentifier = Action.temporaryCategory
        content.userInfo = [
            UserInfoKey.noteID: noteID.uuidString,
            UserInfoKey.kind: NoteKind.temporary.rawValue,
            UserInfoKey.flavor: PlannedNotification.Flavor.lead.rawValue
        ]

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(60, interval), repeats: false)
        let request = UNNotificationRequest(
            identifier: "snooze.\(noteID.uuidString).\(Int(Date().timeIntervalSince1970))",
            content: content,
            trigger: trigger
        )
        center.add(request, withCompletionHandler: nil)
    }

    func cancelAll() {
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }

    func pendingCount(_ completion: @escaping (Int) -> Void) {
        center.getPendingNotificationRequests { requests in
            DispatchQueue.main.async { completion(requests.count) }
        }
    }

    func setBadge(_ count: Int) {
        if #available(iOS 16.0, *) {
            center.setBadgeCount(max(0, count), withCompletionHandler: nil)
        }
    }
}

// MARK: - Delegate

extension NotificationManager: UNUserNotificationCenterDelegate {

    /// Show banners even while the app is open — otherwise a reminder that fires
    /// while you are looking at the schedule vanishes without a trace.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        guard
            let rawID = info[UserInfoKey.noteID] as? String,
            let noteID = UUID(uuidString: rawID)
        else {
            completionHandler()
            return
        }

        let kind = (info[UserInfoKey.kind] as? String).flatMap(NoteKind.init(rawValue:)) ?? .temporary

        DispatchQueue.main.async { [weak self] in
            guard let self else {
                completionHandler()
                return
            }

            self.deliver(action: response.actionIdentifier, noteID: noteID, kind: kind)
            completionHandler()
        }
    }
}
