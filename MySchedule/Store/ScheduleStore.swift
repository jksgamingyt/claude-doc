//
//  ScheduleStore.swift
//  MySchedule
//
//  One object holds the notes, the settings and the archive. Views read from it,
//  the schedule derives from it, and notifications are rebuilt from it whenever
//  it changes. There is no second copy of the truth anywhere in the app.
//

import Combine
import Foundation
import SwiftUI

/// What the app cleared out while it was closed.
struct SweepReport: Equatable {
    var expiredTitles: [String] = []
    var trimmedArchiveCount: Int = 0
    var at: Date = Date()

    var isEmpty: Bool { expiredTitles.isEmpty }
}

/// The buckets the temporary list is grouped into.
enum TemporaryGroup: Int, CaseIterable, Identifiable, Hashable {
    case overdue
    case today
    case tomorrow
    case thisWeek
    case later
    case done

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .overdue:  return "Past due"
        case .today:    return "Today"
        case .tomorrow: return "Tomorrow"
        case .thisWeek: return "This week"
        case .later:    return "Later"
        case .done:     return "Done"
        }
    }

    var symbol: String {
        switch self {
        case .overdue:  return "exclamationmark.triangle.fill"
        case .today:    return "sun.max.fill"
        case .tomorrow: return "sunrise.fill"
        case .thisWeek: return "calendar"
        case .later:    return "mountain.2.fill"
        case .done:     return "checkmark.seal.fill"
        }
    }
}

/// A labelled group of temporary notes. Named for the same reason AgendaDay is.
struct TemporaryBucket: Identifiable, Hashable {
    let group: TemporaryGroup
    let notes: [TemporaryNote]

    var id: Int { group.rawValue }
}

final class ScheduleStore: ObservableObject {

    // MARK: - State

    @Published private(set) var temporaryNotes: [TemporaryNote] = []
    @Published private(set) var permanentNotes: [PermanentNote] = []
    @Published private(set) var archive: [ArchivedNote] = []

    @Published var settings: AppSettings = .default {
        didSet {
            guard !isBootstrapping, oldValue != settings else { return }
            persistAndReschedule()
        }
    }

    @Published private(set) var notificationStatus: NotificationAuthorization = .unknown
    @Published private(set) var pendingNotificationCount: Int = 0
    @Published private(set) var lastSweep: SweepReport?

    /// Bumped on the minute so relative labels ("in 2 hours") stay honest and
    /// the schedule re-derives as time passes.
    @Published private(set) var clockTick: Date = Date()

    /// The day the schedule is focused on.
    @Published var focusDate: Date = Date()

    /// Set when a notification is tapped so the UI can jump to that note.
    @Published var pendingDeepLink: DeepLink?

    struct DeepLink: Equatable, Hashable {
        var noteID: UUID
        var kind: NoteKind
    }

    // MARK: - Private

    private var saveWork: DispatchWorkItem?
    private var rescheduleWork: DispatchWorkItem?
    private var minuteTimer: Timer?
    private var isBootstrapping = true
    private var hasBootstrapped = false
    private let notifications = NotificationManager.shared

    // MARK: - Lifecycle

    init(preloaded: StoreFile? = nil, startClock: Bool = true) {
        let file = preloaded ?? Persistence.load()
        temporaryNotes = file.temporaryNotes
        permanentNotes = file.permanentNotes
        archive = file.archive
        settings = file.settings
        focusDate = Calendar.current.startOfDay(for: Date())
        isBootstrapping = false

        if startClock {
            beginClock()
        }
    }

    deinit {
        minuteTimer?.invalidate()
    }

    /// Called once from the app entry point. Safe to call again; the body only
    /// runs the first time.
    func bootstrap() {
        guard !hasBootstrapped else { return }
        hasBootstrapped = true

        notifications.onMarkDone = { [weak self] id in
            self?.markTemporaryDone(id: id, done: true)
        }
        notifications.onSnooze = { [weak self] id, interval in
            self?.snooze(id: id, by: interval)
        }
        notifications.onOpenNote = { [weak self] id, kind in
            self?.pendingDeepLink = DeepLink(noteID: id, kind: kind)
        }

        // A notification tapped while the app was closed may already be waiting.
        notifications.flushQueuedResponses()

        refreshAuthorization()
        sweep()
        persistAndReschedule(immediate: true)
    }

    private func beginClock() {
        let timer = Timer(timeInterval: 30, repeats: true) { [weak self] _ in
            self?.tick()
        }
        RunLoop.main.add(timer, forMode: .common)
        minuteTimer = timer
    }

    private func tick() {
        let now = Date()
        let calendar = Calendar.current

        let dayChanged = !calendar.isDate(now, inSameDayAs: clockTick)
        if !calendar.isDate(now, equalTo: clockTick, toGranularity: .minute) {
            clockTick = now
        }
        if dayChanged {
            sweep()
            persistAndReschedule()
        }
    }

    // MARK: - Derived

    var calendar: Calendar {
        var calendar = Calendar.current
        calendar.firstWeekday = settings.weekStartsOnMonday ? 2 : 1
        return calendar
    }

    var engine: ScheduleEngine {
        ScheduleEngine(
            calendar: calendar,
            temporaryNotes: temporaryNotes,
            permanentNotes: permanentNotes,
            settings: settings,
            now: clockTick
        )
    }

    /// The span the calendar is allowed to browse. Anchored on the configured
    /// year, then widened so a note can never be placed off the edge of the map.
    var calendarBounds: (start: Date, end: Date) {
        let calendar = self.calendar
        var lower = DateComponents()
        lower.year = settings.calendarYear
        lower.month = 1
        lower.day = 1
        var upper = DateComponents()
        upper.year = settings.calendarYear
        upper.month = 12
        upper.day = 31

        var start = calendar.date(from: lower) ?? Date()
        var end = calendar.date(from: upper) ?? Date()

        for note in temporaryNotes {
            start = min(start, note.due)
            end = max(end, note.expiresAt)
        }
        for note in permanentNotes {
            start = min(start, note.startDate)
        }
        // Permanent notes run forever; give them a year of runway past the end.
        if !permanentNotes.isEmpty {
            end = max(end, calendar.date(byAdding: .year, value: 1, to: Date()) ?? end)
        }
        end = max(end, calendar.date(byAdding: .month, value: 2, to: Date()) ?? end)
        start = min(start, calendar.startOfDay(for: Date()))

        return (calendar.startOfDay(for: start), calendar.startOfDay(for: end))
    }

    /// Temporary notes that still have life in them.
    var activeTemporaryNotes: [TemporaryNote] {
        temporaryNotes
            .filter { !$0.isExpired(asOf: clockTick) }
            .sorted { lhs, rhs in
                if lhs.isDone != rhs.isDone { return !lhs.isDone }
                if lhs.due != rhs.due { return lhs.due < rhs.due }
                return lhs.createdAt < rhs.createdAt
            }
    }

    var groupedTemporaryNotes: [TemporaryBucket] {
        let calendar = self.calendar
        let now = clockTick
        let today = calendar.startOfDay(for: now)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: today) ?? today
        let weekOut = calendar.date(byAdding: .day, value: 7, to: today) ?? today

        var buckets: [TemporaryGroup: [TemporaryNote]] = [:]

        for note in activeTemporaryNotes {
            let group: TemporaryGroup
            if note.isDone {
                group = .done
            } else if note.due < now {
                group = .overdue
            } else {
                let dueDay = calendar.startOfDay(for: note.due)
                if dueDay == today {
                    group = .today
                } else if dueDay == tomorrow {
                    group = .tomorrow
                } else if dueDay < weekOut {
                    group = .thisWeek
                } else {
                    group = .later
                }
            }
            buckets[group, default: []].append(note)
        }

        return TemporaryGroup.allCases.compactMap { group -> TemporaryBucket? in
            guard let notes = buckets[group], !notes.isEmpty else { return nil }
            return TemporaryBucket(group: group, notes: notes)
        }
    }

    var sortedPermanentNotes: [PermanentNote] {
        permanentNotes.sorted { lhs, rhs in
            if lhs.isMuted != rhs.isMuted { return !lhs.isMuted }
            if lhs.startMinutes != rhs.startMinutes { return lhs.startMinutes < rhs.startMinutes }
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
    }

    var sortedArchive: [ArchivedNote] {
        archive.sorted { $0.archivedAt > $1.archivedAt }
    }

    /// Overdue + due today. Drives the app badge and the welcome screen line.
    var attentionCount: Int {
        let today = calendar.startOfDay(for: clockTick)
        return temporaryNotes.filter { note in
            guard !note.isDone, !note.isExpired(asOf: clockTick) else { return false }
            return note.due < clockTick || calendar.startOfDay(for: note.due) == today
        }.count
    }

    func temporaryNote(id: UUID) -> TemporaryNote? {
        temporaryNotes.first { $0.id == id }
    }

    func permanentNote(id: UUID) -> PermanentNote? {
        permanentNotes.first { $0.id == id }
    }

    // MARK: - Temporary notes

    func add(temporary note: TemporaryNote) {
        var note = note
        note.refreshExpiry(calendar: calendar)
        temporaryNotes.append(note)
        requestPermissionIfThisIsTheFirstAsk()
        persistAndReschedule()
    }

    func update(temporary note: TemporaryNote) {
        guard let index = temporaryNotes.firstIndex(where: { $0.id == note.id }) else { return }
        var note = note
        note.refreshExpiry(calendar: calendar)
        temporaryNotes[index] = note
        persistAndReschedule()
    }

    func markTemporaryDone(id: UUID, done: Bool) {
        guard let index = temporaryNotes.firstIndex(where: { $0.id == id }) else { return }
        temporaryNotes[index].isDone = done
        temporaryNotes[index].doneAt = done ? Date() : nil
        persistAndReschedule()
    }

    func delete(temporaryID id: UUID, reason: ArchivedNote.Reason = .deleted) {
        guard let index = temporaryNotes.firstIndex(where: { $0.id == id }) else { return }
        let note = temporaryNotes.remove(at: index)
        archive.append(ArchivedNote(from: note, reason: reason))
        trimArchive()
        persistAndReschedule()
    }

    private func snooze(id: UUID, by interval: TimeInterval) {
        guard let note = temporaryNote(id: id) else { return }
        notifications.scheduleSnooze(noteID: id, title: note.title, after: interval)
    }

    // MARK: - Permanent notes

    func add(permanent note: PermanentNote) {
        permanentNotes.append(note)
        requestPermissionIfThisIsTheFirstAsk()
        persistAndReschedule()
    }

    func update(permanent note: PermanentNote) {
        guard let index = permanentNotes.firstIndex(where: { $0.id == note.id }) else { return }
        permanentNotes[index] = note
        persistAndReschedule()
    }

    func setMuted(permanentID id: UUID, muted: Bool) {
        guard let index = permanentNotes.firstIndex(where: { $0.id == id }) else { return }
        permanentNotes[index].isMuted = muted
        persistAndReschedule()
    }

    /// Permanent notes only ever leave by hand. That is the whole point of them.
    func delete(permanentID id: UUID) {
        guard let index = permanentNotes.firstIndex(where: { $0.id == id }) else { return }
        let note = permanentNotes.remove(at: index)
        archive.append(ArchivedNote(from: note, reason: .deleted))
        trimArchive()
        persistAndReschedule()
    }

    // MARK: - Archive

    func restore(archived: ArchivedNote) {
        switch archived.kind {
        case .temporary:
            // Give it a fresh deadline: an expired note restored to its old date
            // would simply expire again on the next sweep.
            let newDue = max(archived.due, calendar.date(byAdding: .hour, value: 1, to: Date()) ?? Date())
            let note = TemporaryNote(
                title: archived.title,
                details: archived.details,
                due: newDue,
                linger: settings.defaultLinger,
                reminders: settings.temporaryReminderLeads,
                notifyOnExpiry: settings.notifyOnExpiry,
                tag: archived.tag,
                calendar: calendar
            )
            temporaryNotes.append(note)
        case .permanent:
            let note = PermanentNote(
                title: archived.title,
                details: archived.details,
                startDate: Date(),
                reminders: settings.permanentReminderLeads,
                tag: archived.tag
            )
            permanentNotes.append(note)
        }
        archive.removeAll { $0.id == archived.id }
        persistAndReschedule()
    }

    func removeFromArchive(_ archived: ArchivedNote) {
        archive.removeAll { $0.id == archived.id }
        scheduleSave()
    }

    func clearArchive() {
        archive.removeAll()
        scheduleSave()
    }

    private func trimArchive() {
        let days = settings.archiveRetentionDays
        guard days > 0 else { return }
        guard let cutoff = calendar.date(byAdding: .day, value: -days, to: Date()) else { return }
        archive.removeAll { $0.archivedAt < cutoff }
    }

    // MARK: - Sweep

    /// Retires temporary notes whose time has come. The app cannot run while it
    /// is closed, so this is the moment the promised removal actually happens —
    /// the notification announcing it was scheduled in advance and has already
    /// arrived on its own.
    @discardableResult
    func sweep(now: Date = Date()) -> SweepReport {
        var report = SweepReport(at: now)

        // Trim before filing, not after. A note is archived under the moment it
        // actually expired, so if the app has gone unopened for longer than the
        // retention window, doing this the other way round would file a note and
        // delete it in the same pass — while still announcing it in the banner.
        let before = archive.count
        trimArchive()
        report.trimmedArchiveCount = before - archive.count

        let expired = temporaryNotes.filter { $0.isExpired(asOf: now) }
        if !expired.isEmpty {
            for note in expired {
                archive.append(ArchivedNote(from: note, reason: note.isDone ? .completed : .expired, at: note.expiresAt))
                if !note.isDone {
                    report.expiredTitles.append(note.title)
                }
            }
            let expiredIDs = Set(expired.map { $0.id })
            temporaryNotes.removeAll { expiredIDs.contains($0.id) }
        }

        settings.lastSweepAt = now
        if !report.isEmpty {
            lastSweep = report
        }

        if !expired.isEmpty {
            scheduleSave()
        }

        return report
    }

    func dismissSweepReport() {
        lastSweep = nil
    }

    // MARK: - Notifications

    func refreshAuthorization() {
        notifications.refreshAuthorization { [weak self] status in
            guard let self else { return }
            let wasUsable = self.notificationStatus.isUsable
            self.notificationStatus = status
            // The first authorization check comes back asynchronously, after the
            // launch-time reschedule has already bailed out. Run it again now
            // that we know alerts are allowed.
            if status.isUsable && !wasUsable {
                self.rescheduleNotifications()
            }
        }
    }

    /// The first note is the honest moment to ask: the user has just told the
    /// app when they want to be reminded of something.
    private func requestPermissionIfThisIsTheFirstAsk() {
        guard !settings.hasRequestedNotificationPermission else { return }
        guard notificationStatus == .notDetermined || notificationStatus == .unknown else {
            settings.hasRequestedNotificationPermission = true
            return
        }
        requestNotificationPermission()
    }

    func requestNotificationPermission() {
        settings.hasRequestedNotificationPermission = true
        notifications.requestAuthorization { [weak self] status in
            guard let self else { return }
            self.notificationStatus = status
            self.persistAndReschedule(immediate: true)
        }
    }

    var notificationPlan: [PlannedNotification] {
        NotificationPlanner(calendar: calendar, settings: settings, now: Date())
            .plan(temporary: temporaryNotes, permanent: permanentNotes)
    }

    private func rescheduleNotifications() {
        guard notificationStatus.isUsable else { return }
        let plans = notificationPlan
        let badge = attentionCount
        notifications.apply(plans: plans, calendar: calendar, badgeCount: nil) { [weak self] in
            guard let self else { return }
            self.notifications.setBadge(badge)
            self.notifications.pendingCount { count in
                self.pendingNotificationCount = count
            }
        }
    }

    // MARK: - Persistence

    func snapshot() -> StoreFile {
        StoreFile(
            temporaryNotes: temporaryNotes,
            permanentNotes: permanentNotes,
            archive: archive,
            settings: settings
        )
    }

    func scheduleSave() {
        saveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            Persistence.save(self.snapshot())
        }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    func saveNow() {
        saveWork?.cancel()
        Persistence.save(snapshot())
    }

    private func persistAndReschedule(immediate: Bool = false) {
        scheduleSave()

        rescheduleWork?.cancel()
        if immediate {
            rescheduleNotifications()
            return
        }
        let work = DispatchWorkItem { [weak self] in
            self?.rescheduleNotifications()
        }
        rescheduleWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
    }

    // MARK: - App lifecycle

    func handleForeground() {
        clockTick = Date()
        refreshAuthorization()
        sweep()
        persistAndReschedule(immediate: true)
    }

    func handleBackground() {
        saveNow()
        rescheduleNotifications()
    }

    // MARK: - Data management

    func exportJSON() -> Data? {
        Persistence.exportData(snapshot())
    }

    @discardableResult
    func importJSON(_ data: Data, replacing: Bool) -> Bool {
        guard let file = Persistence.importData(data) else { return false }
        isBootstrapping = true
        if replacing {
            temporaryNotes = file.temporaryNotes
            permanentNotes = file.permanentNotes
            archive = file.archive
            settings = file.settings
        } else {
            let existingTemporary = Set(temporaryNotes.map { $0.id })
            let existingPermanent = Set(permanentNotes.map { $0.id })
            temporaryNotes.append(contentsOf: file.temporaryNotes.filter { !existingTemporary.contains($0.id) })
            permanentNotes.append(contentsOf: file.permanentNotes.filter { !existingPermanent.contains($0.id) })
        }
        isBootstrapping = false
        persistAndReschedule(immediate: true)
        return true
    }

    func eraseEverything() {
        temporaryNotes.removeAll()
        permanentNotes.removeAll()
        archive.removeAll()
        lastSweep = nil
        notifications.cancelAll()
        notifications.setBadge(0)
        saveNow()
    }
}
