// notify.js — reminders, and an honest account of what a web app can do.
//
// Three tiers, in descending order of reliability:
//
//   1. Calendar. Notes are exported as events carrying alarms, and the iPhone's
//      Calendar fires them natively — on time, offline, app closed. This is the
//      only tier that works while MySchedule is not running, so it is the one
//      the app pushes you towards. See ics.js.
//
//   2. Live notifications. While the app is open (or very recently
//      backgrounded) it can raise real notifications itself. iOS suspends
//      timers soon after you leave, so this covers the current session only.
//
//   3. Catch-up. On every launch the app works out which reminders came due
//      while it was closed and tells you, so nothing passes unnoticed even
//      when tiers 1 and 2 both missed it.

import {
  MINUTE, occurrenceStart, startOfDay, addDays, sameTimeOn,
} from './model.js';

const SEEN_KEY = 'myschedule.seenReminders.v1';
const MAX_TIMERS = 40;

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function isInstalled() {
  if (typeof window === 'undefined') return false;
  if (window.navigator.standalone === true) return true;
  return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
}

export function permission() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch (error) {
    return Notification.permission;
  }
}

async function show(title, body, tag) {
  if (permission() !== 'granted') return false;
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration && registration.showNotification) {
      await registration.showNotification(title, {
        body,
        tag,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        renotify: false,
      });
      return true;
    }
    // eslint-disable-next-line no-new
    new Notification(title, { body, tag, icon: './icons/icon-192.png' });
    return true;
  } catch (error) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The reminder timetable
// ---------------------------------------------------------------------------

/**
 * Every reminder moment implied by the current notes, within `horizonDays`.
 * Pure — the same input always gives the same list, which is what makes the
 * catch-up pass reliable.
 */
export function reminderTimetable(state, fromMs, horizonDays = 14) {
  const until = fromMs + horizonDays * 86400000;
  const out = [];

  for (const note of state.temporary) {
    if (note.isDone) continue;

    if (note.repeatUntil != null) {
      // A separate occurrence — and its own reminders — for every day in
      // the range, not just the first. Bounded by whichever ends sooner:
      // the repeat range itself, or the horizon being asked about, so a
      // long-running repeat does not walk hundreds of days doing nothing
      // when only the next two are wanted.
      const lastDay = Math.min(note.repeatUntil, startOfDay(until));
      let day = startOfDay(note.due);
      let guard = 0;
      while (day <= lastDay && guard < 400) {
        const occurrence = sameTimeOn(day, note.due);
        for (const lead of note.reminders || []) {
          const at = occurrence - lead * MINUTE;
          if (at > until) continue;
          out.push({
            key: `t.${note.id}.${day}.${lead}`,
            at,
            title: note.title,
            body: lead === 0 ? 'Due now.' : `Due in ${describeLead(lead)}.`,
            noteId: note.id,
            kind: 'temporary',
          });
        }
        day = addDays(day, 1);
        guard += 1;
      }
    } else {
      for (const lead of note.reminders || []) {
        const at = note.due - lead * MINUTE;
        if (at > until) continue;
        out.push({
          key: `t.${note.id}.${lead}`,
          at,
          title: note.title,
          body: lead === 0
            ? 'Due now.'
            : `Due in ${describeLead(lead)}.`,
          noteId: note.id,
          kind: 'temporary',
        });
      }
    }

    if (note.notifyOnExpiry && state.settings.notifyOnExpiry && note.expiresAt <= until) {
      out.push({
        key: `t.${note.id}.expiry`,
        at: note.expiresAt,
        title: `${note.title} has expired`,
        body: "It's come off your schedule. Find it in Recently cleared.",
        noteId: note.id,
        kind: 'temporary',
      });
    }
  }

  for (const note of state.permanent) {
    if (note.isMuted) continue;
    if (!(note.reminders || []).length) continue;
    let cursor = new Date(fromMs);
    cursor.setHours(0, 0, 0, 0);
    let cursorMs = cursor.getTime();

    for (let day = 0; day < horizonDays + 1; day += 1) {
      const start = occurrenceStart(note, cursorMs);
      if (start != null) {
        for (const lead of note.reminders) {
          const at = start - lead * MINUTE;
          if (at <= until) {
            out.push({
              key: `p.${note.id}.${start}.${lead}`,
              at,
              title: note.title,
              body: lead === 0 ? 'Starting now.' : `Starts in ${describeLead(lead)}.`,
              noteId: note.id,
              kind: 'permanent',
            });
          }
        }
      }
      cursorMs += 86400000;
    }
  }

  out.sort((a, b) => a.at - b.at);
  return out;
}

function describeLead(minutes) {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? 'a day' : `${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? 'an hour' : `${hours} hours`;
  }
  return `${minutes} minutes`;
}

// ---------------------------------------------------------------------------
// Seen bookkeeping, so a reminder is never announced twice
// ---------------------------------------------------------------------------

function loadSeen() {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
  } catch (error) {
    return {};
  }
}

function saveSeen(seen) {
  try {
    // Keep it from growing forever: drop anything older than a month.
    const cutoff = Date.now() - 30 * 86400000;
    const trimmed = {};
    for (const [key, at] of Object.entries(seen)) {
      if (at >= cutoff) trimmed[key] = at;
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
  } catch (error) {
    /* storage full; the worst case is a repeated reminder */
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class Reminders {
  constructor(store) {
    this.store = store;
    this.timers = [];
    this.seen = loadSeen();
    this.missed = [];
  }

  /**
   * What came due while the app was closed. Returns the list rather than firing
   * blindly, so the UI can show a digest instead of a burst of notifications.
   */
  catchUp(now = Date.now()) {
    const state = this.store.state;
    const since = state.lastSweepAt || now;
    const timetable = reminderTimetable(state, since - 30 * 86400000, 45);

    const missed = timetable.filter((item) => {
      if (item.at > now) return false;
      if (item.at < since - 30 * 86400000) return false;
      return !this.seen[item.key];
    });

    for (const item of missed) this.seen[item.key] = now;
    saveSeen(this.seen);

    this.missed = missed;
    return missed;
  }

  /** Arm timers for everything due in this session. */
  arm(now = Date.now()) {
    this.disarm();
    if (permission() !== 'granted') return 0;

    const timetable = reminderTimetable(this.store.state, now, 2);
    let armed = 0;

    for (const item of timetable) {
      if (armed >= MAX_TIMERS) break;
      const delay = item.at - now;
      // setTimeout past ~24 days overflows; anything that far out is the
      // calendar's job anyway.
      if (delay <= 0 || delay > 2 * 86400000) continue;
      if (this.seen[item.key]) continue;

      const timer = setTimeout(() => {
        this.seen[item.key] = Date.now();
        saveSeen(this.seen);
        show(item.title, item.body, item.key);
      }, delay);

      this.timers.push(timer);
      armed += 1;
    }

    return armed;
  }

  disarm() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** Fire one now — used to prove permission works. */
  async test() {
    return show(
      'MySchedule',
      'Notifications are working while the app is open.',
      'myschedule-test',
    );
  }
}
