// store.js — the single source of truth, and the only thing that touches storage.

import {
  DAY, startOfDay, expiryFor, makeTemporary, makePermanent, makeDaily, makeGoal,
} from './model.js';
import { signatureTemporary, signaturePermanent } from './ics.js';

const KEY = 'myschedule.state.v1';
const BACKUP_KEY = 'myschedule.state.backup.v1';

export const DEFAULT_SETTINGS = {
  defaultTemporaryReminders: [1440, 60],
  defaultPermanentReminders: [0],
  defaultLinger: 'atDue',
  notifyOnExpiry: true,
  calendarYear: 2026,
  weekStartsOnMonday: false,
  showCompletedOnSchedule: true,
  showPermanentOnSchedule: true,
  archiveRetentionDays: 30,
  theme: 'system',
  showWelcomeOnLaunch: true,
  startTab: 'ask',
  remindToExport: true,
  // App Lock. The PIN itself is never stored — only a salted hash. Off by
  // default so nothing about existing behaviour changes until opted into.
  pinEnabled: false,
  pinSalt: null,
  pinHash: null,
  pinRememberMinutes: 60,
};

function blankState() {
  return {
    version: 1,
    temporary: [],
    permanent: [],
    daily: [],
    goals: [],
    archive: [],
    exported: {},
    settings: { ...DEFAULT_SETTINGS },
    lastSweepAt: null,
    now: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Loading — deliberately forgiving, so one bad record cannot take the rest
// ---------------------------------------------------------------------------

function loadRaw(key) {
  try {
    const text = localStorage.getItem(key);
    if (!text) return null;
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function reviveTemporary(raw) {
  if (!raw || typeof raw.title !== 'string' || typeof raw.due !== 'number') return null;
  const note = makeTemporary(raw);
  // Trust the stored expiry over a recomputed one, so a note's disappearance
  // never shifts underneath the user after a settings change.
  if (typeof raw.expiresAt === 'number') note.expiresAt = raw.expiresAt;
  return note;
}

function revivePermanent(raw) {
  if (!raw || typeof raw.title !== 'string') return null;
  return makePermanent(raw);
}

function reviveGoal(raw) {
  if (!raw || typeof raw.text !== 'string' || typeof raw.dueDate !== 'number') return null;
  return makeGoal(raw);
}

export function load() {
  const state = blankState();
  const raw = loadRaw(KEY) || loadRaw(BACKUP_KEY);
  if (!raw) return state;

  if (Array.isArray(raw.temporary)) {
    state.temporary = raw.temporary.map(reviveTemporary).filter(Boolean);
  }
  if (Array.isArray(raw.permanent)) {
    state.permanent = raw.permanent.map(revivePermanent).filter(Boolean);
  }
  if (Array.isArray(raw.daily)) {
    state.daily = raw.daily
      .filter((item) => item && typeof item.text === 'string' && typeof item.forDate === 'number')
      .map(makeDaily);
  }
  if (Array.isArray(raw.goals)) {
    state.goals = raw.goals.map(reviveGoal).filter(Boolean);
  }
  if (Array.isArray(raw.archive)) {
    state.archive = raw.archive.filter((item) => item && typeof item.title === 'string');
  }
  if (raw.exported && typeof raw.exported === 'object') {
    state.exported = { ...raw.exported };
  }
  if (raw.settings && typeof raw.settings === 'object') {
    // Merge key by key so a new setting never resets the existing ones.
    state.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
  }
  state.lastSweepAt = typeof raw.lastSweepAt === 'number' ? raw.lastSweepAt : null;
  state.now = Date.now();
  return state;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export class Store {
  constructor() {
    this.state = load();
    this.listeners = new Set();
    this.saveTimer = null;
    this.lastSweep = null;
    this.storageError = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) listener(this.state);
  }

  changed() {
    this.scheduleSave();
    this.emit();
  }

  // --- persistence

  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 250);
  }

  saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      const previous = localStorage.getItem(KEY);
      if (previous) localStorage.setItem(BACKUP_KEY, previous);
      const { now, ...persisted } = this.state;
      localStorage.setItem(KEY, JSON.stringify(persisted));
      this.storageError = null;
    } catch (error) {
      this.storageError = error && error.name === 'QuotaExceededError'
        ? 'This device is out of storage for the app.'
        : 'Could not save to this device.';
    }
  }

  // --- temporary notes

  addTemporary(fields) {
    const note = makeTemporary(fields);
    this.state.temporary.push(note);
    this.changed();
    return note;
  }

  updateTemporary(fields) {
    const index = this.state.temporary.findIndex((n) => n.id === fields.id);
    if (index < 0) return null;
    const note = makeTemporary({ ...this.state.temporary[index], ...fields });
    note.expiresAt = expiryFor(note.due, note.linger);
    this.state.temporary[index] = note;
    this.changed();
    return note;
  }

  setDone(id, done) {
    const note = this.state.temporary.find((n) => n.id === id);
    if (!note) return;
    note.isDone = done;
    note.doneAt = done ? Date.now() : null;
    this.changed();
  }

  deleteTemporary(id, reason = 'deleted') {
    const index = this.state.temporary.findIndex((n) => n.id === id);
    if (index < 0) return;
    const [note] = this.state.temporary.splice(index, 1);
    this.state.archive.push(archiveEntry(note, 'temporary', reason, Date.now()));
    delete this.state.exported[note.id];
    this.trimArchive();
    this.changed();
  }

  // --- permanent notes

  addPermanent(fields) {
    const note = makePermanent(fields);
    this.state.permanent.push(note);
    this.changed();
    return note;
  }

  updatePermanent(fields) {
    const index = this.state.permanent.findIndex((n) => n.id === fields.id);
    if (index < 0) return null;
    const note = makePermanent({ ...this.state.permanent[index], ...fields });
    this.state.permanent[index] = note;
    this.changed();
    return note;
  }

  setMuted(id, muted) {
    const note = this.state.permanent.find((n) => n.id === id);
    if (!note) return;
    note.isMuted = muted;
    this.changed();
  }

  deletePermanent(id) {
    const index = this.state.permanent.findIndex((n) => n.id === id);
    if (index < 0) return;
    const [note] = this.state.permanent.splice(index, 1);
    this.state.archive.push(archiveEntry(note, 'permanent', 'deleted', Date.now()));
    delete this.state.exported[note.id];
    this.trimArchive();
    this.changed();
  }

  // --- daily reminders

  addDaily(fields) {
    const reminder = makeDaily(fields);
    this.state.daily.push(reminder);
    this.changed();
    return reminder;
  }

  updateDaily(fields) {
    const index = this.state.daily.findIndex((r) => r.id === fields.id);
    if (index < 0) return null;
    const reminder = makeDaily({ ...this.state.daily[index], ...fields });
    this.state.daily[index] = reminder;
    this.changed();
    return reminder;
  }

  deleteDaily(id) {
    this.state.daily = this.state.daily.filter((r) => r.id !== id);
    this.changed();
  }

  /**
   * What should greet you right now: anything aimed at today or at a morning
   * that has already gone by without being seen. A reminder you slept through
   * still gets said, once, rather than disappearing.
   */
  pendingDaily(now = Date.now()) {
    const today = startOfDay(now);
    return this.state.daily
      .filter((reminder) => !reminder.seenAt && reminder.forDate <= today)
      .sort((a, b) => a.forDate - b.forDate);
  }

  markDailySeen(ids, now = Date.now()) {
    const wanted = new Set(ids);
    let touched = false;
    for (const reminder of this.state.daily) {
      if (wanted.has(reminder.id) && !reminder.seenAt) {
        reminder.seenAt = now;
        touched = true;
      }
    }
    if (touched) this.changed();
  }

  get upcomingDaily() {
    const today = startOfDay(this.state.now || Date.now());
    return this.state.daily
      .filter((reminder) => !reminder.seenAt && reminder.forDate >= today)
      .sort((a, b) => a.forDate - b.forDate);
  }

  get deliveredDaily() {
    return this.state.daily
      .filter((reminder) => reminder.seenAt)
      .sort((a, b) => b.seenAt - a.seenAt);
  }

  /** Delivered reminders are kept for a while, then cleared out on sweep. */
  trimDaily(now = Date.now()) {
    const days = this.state.settings.archiveRetentionDays;
    if (!days || days <= 0) return 0;
    const cutoff = now - days * DAY;
    const before = this.state.daily.length;
    this.state.daily = this.state.daily.filter(
      (reminder) => !reminder.seenAt || reminder.seenAt >= cutoff,
    );
    return before - this.state.daily.length;
  }

  // --- goals
  //
  // Deliberately apart from everything above: no due-time, no reminders, no
  // recurrence, and never fed into engine.js or ics.js. A goal is either
  // overdue, still open, or achieved — nothing else touches it, and nothing
  // ever removes one but you.

  addGoal(fields) {
    const goal = makeGoal(fields);
    this.state.goals.push(goal);
    this.changed();
    return goal;
  }

  updateGoal(fields) {
    const index = this.state.goals.findIndex((g) => g.id === fields.id);
    if (index < 0) return null;
    const goal = makeGoal({ ...this.state.goals[index], ...fields });
    this.state.goals[index] = goal;
    this.changed();
    return goal;
  }

  setGoalAchieved(id, achieved) {
    const goal = this.state.goals.find((g) => g.id === id);
    if (!goal) return;
    goal.achievedAt = achieved ? Date.now() : null;
    this.changed();
  }

  deleteGoal(id) {
    this.state.goals = this.state.goals.filter((g) => g.id !== id);
    this.changed();
  }

  groupedGoals() {
    const today = startOfDay(this.state.now || Date.now());
    const buckets = { overdue: [], upcoming: [], achieved: [] };

    for (const goal of this.state.goals) {
      if (goal.achievedAt) buckets.achieved.push(goal);
      else if (goal.dueDate < today) buckets.overdue.push(goal);
      else buckets.upcoming.push(goal);
    }

    buckets.overdue.sort((a, b) => a.dueDate - b.dueDate);
    buckets.upcoming.sort((a, b) => a.dueDate - b.dueDate);
    buckets.achieved.sort((a, b) => b.achievedAt - a.achievedAt);

    return ['overdue', 'upcoming', 'achieved']
      .filter((group) => buckets[group].length)
      .map((group) => ({ group, goals: buckets[group] }));
  }

  // --- archive

  restore(entry) {
    if (entry.kind === 'temporary') {
      const due = Math.max(entry.due, Date.now() + 3600000);
      this.state.temporary.push(makeTemporary({
        title: entry.title,
        details: entry.details,
        due,
        linger: this.state.settings.defaultLinger,
        reminders: this.state.settings.defaultTemporaryReminders,
        tag: entry.tag,
      }));
    } else {
      this.state.permanent.push(makePermanent({
        title: entry.title,
        details: entry.details,
        startDate: Date.now(),
        reminders: this.state.settings.defaultPermanentReminders,
        tag: entry.tag,
      }));
    }
    this.state.archive = this.state.archive.filter((item) => item.archiveId !== entry.archiveId);
    this.changed();
  }

  forget(entry) {
    this.state.archive = this.state.archive.filter((item) => item.archiveId !== entry.archiveId);
    this.changed();
  }

  clearArchive() {
    this.state.archive = [];
    this.changed();
  }

  trimArchive() {
    const days = this.state.settings.archiveRetentionDays;
    if (!days || days <= 0) return 0;
    const cutoff = Date.now() - days * DAY;
    const before = this.state.archive.length;
    this.state.archive = this.state.archive.filter((item) => item.archivedAt >= cutoff);
    return before - this.state.archive.length;
  }

  // --- sweep

  /**
   * Retires temporary notes whose time has come. A web app cannot run while it
   * is closed, so this is where the promised removal actually happens.
   *
   * Trimming runs first: a note is archived under the moment it expired, so if
   * the app went unopened for longer than the retention window, doing it the
   * other way round would file a note and delete it in the same pass while
   * still naming it in the banner.
   */
  sweep(now = Date.now()) {
    const report = { expired: [], trimmed: 0, at: now };
    report.trimmed = this.trimArchive() + this.trimDaily(now);

    const expired = this.state.temporary.filter((note) => note.expiresAt <= now);
    if (expired.length) {
      for (const note of expired) {
        this.state.archive.push(
          archiveEntry(note, 'temporary', note.isDone ? 'completed' : 'expired', note.expiresAt),
        );
        if (!note.isDone) report.expired.push(note.title);
        delete this.state.exported[note.id];
      }
      const gone = new Set(expired.map((n) => n.id));
      this.state.temporary = this.state.temporary.filter((note) => !gone.has(note.id));
    }

    this.state.lastSweepAt = now;
    this.lastSweep = report.expired.length ? report : null;

    if (expired.length || report.trimmed) this.changed();
    return report;
  }

  dismissSweep() {
    this.lastSweep = null;
    this.emit();
  }

  // --- settings

  set(key, value) {
    this.state.settings[key] = value;
    this.changed();
  }

  // --- calendar export bookkeeping

  markExported(temporary, permanent) {
    for (const note of temporary) this.state.exported[note.id] = signatureTemporary(note);
    for (const note of permanent) this.state.exported[note.id] = signaturePermanent(note);
    this.changed();
  }

  clearExportMarks() {
    this.state.exported = {};
    this.changed();
  }

  // --- data management

  exportJSON() {
    const { now, ...persisted } = this.state;
    return JSON.stringify(persisted, null, 2);
  }

  importJSON(text, replace) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return false;
    }
    if (!raw || typeof raw !== 'object') return false;

    const incomingTemp = (raw.temporary || []).map(reviveTemporary).filter(Boolean);
    const incomingPerm = (raw.permanent || []).map(revivePermanent).filter(Boolean);
    const incomingGoals = (raw.goals || []).map(reviveGoal).filter(Boolean);

    if (replace) {
      this.state.temporary = incomingTemp;
      this.state.permanent = incomingPerm;
      this.state.daily = Array.isArray(raw.daily)
        ? raw.daily.filter((item) => item && typeof item.text === 'string').map(makeDaily)
        : [];
      this.state.goals = incomingGoals;
      this.state.archive = Array.isArray(raw.archive) ? raw.archive : [];
      this.state.exported = raw.exported && typeof raw.exported === 'object' ? raw.exported : {};
      if (raw.settings) this.state.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
    } else {
      const haveTemp = new Set(this.state.temporary.map((n) => n.id));
      const havePerm = new Set(this.state.permanent.map((n) => n.id));
      const haveGoals = new Set(this.state.goals.map((g) => g.id));
      this.state.temporary.push(...incomingTemp.filter((n) => !haveTemp.has(n.id)));
      this.state.permanent.push(...incomingPerm.filter((n) => !havePerm.has(n.id)));
      this.state.goals.push(...incomingGoals.filter((g) => !haveGoals.has(g.id)));
    }

    this.saveNow();
    this.changed();
    return true;
  }

  eraseEverything() {
    const settings = this.state.settings;
    this.state = { ...blankState(), settings };
    this.saveNow();
    this.changed();
  }

  // --- derived

  get activeTemporary() {
    const now = this.state.now || Date.now();
    return this.state.temporary
      .filter((note) => note.expiresAt > now)
      .sort((a, b) => {
        if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
        if (a.due !== b.due) return a.due - b.due;
        return a.createdAt - b.createdAt;
      });
  }

  get sortedPermanent() {
    return this.state.permanent.slice().sort((a, b) => {
      if (a.isMuted !== b.isMuted) return a.isMuted ? 1 : -1;
      if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
      return a.title.localeCompare(b.title);
    });
  }

  get sortedArchive() {
    return this.state.archive.slice().sort((a, b) => b.archivedAt - a.archivedAt);
  }

  /** Overdue plus due today — the number worth putting on a badge. */
  get attentionCount() {
    const now = this.state.now || Date.now();
    const today = startOfDay(now);
    return this.state.temporary.filter((note) => {
      if (note.isDone || note.expiresAt <= now) return false;
      return note.due < now || startOfDay(note.due) === today;
    }).length;
  }

  groupedTemporary() {
    const now = this.state.now || Date.now();
    const today = startOfDay(now);
    const tomorrow = today + DAY;
    const weekOut = today + 7 * DAY;
    const buckets = new Map();

    for (const note of this.activeTemporary) {
      let group;
      if (note.isDone) group = 'done';
      else if (note.due < now) group = 'overdue';
      else {
        const dueDay = startOfDay(note.due);
        if (dueDay === today) group = 'today';
        else if (dueDay === tomorrow) group = 'tomorrow';
        else if (dueDay < weekOut) group = 'thisWeek';
        else group = 'later';
      }
      if (!buckets.has(group)) buckets.set(group, []);
      buckets.get(group).push(note);
    }

    const order = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later', 'done'];
    return order
      .filter((group) => buckets.has(group))
      .map((group) => ({ group, notes: buckets.get(group) }));
  }
}

export const GROUP_LABELS = {
  overdue: 'Past due',
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This week',
  later: 'Later',
  done: 'Done',
};

export const GOAL_GROUP_LABELS = {
  overdue: 'Past due',
  upcoming: 'In progress',
  achieved: 'Achieved',
};

function archiveEntry(note, kind, reason, at) {
  return {
    archiveId: `${note.id}-${at}`,
    id: note.id,
    title: note.title,
    details: note.details || '',
    due: kind === 'temporary' ? note.due : note.startDate,
    tag: note.tag,
    kind,
    reason,
    archivedAt: at,
  };
}
