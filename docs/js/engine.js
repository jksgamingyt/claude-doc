// engine.js — notes become days.
//
// The single place where "what did I write down" turns into "what is on my
// schedule". Entries are derived on every read and never stored, which is what
// keeps the schedule from drifting away from the notes.

import {
  DAY, MINUTE, startOfDay, addDays, dayKey, sameTimeOn,
  occurrenceStart, isAllDayPermanent, recurrenceSummary,
  formatTime, formatMonthDay,
} from './model.js';

/** All entries for one day, sorted. */
export function entriesOn(state, dayMs) {
  const dayStart = startOfDay(dayMs);
  const dayEnd = dayStart + DAY;
  const key = dayKey(dayStart);
  const now = state.now || Date.now();
  const out = [];

  // --- Temporary notes occupy the day they are due, plus any day they linger
  // or repeat into.
  for (const note of state.temporary) {
    if (note.isDone && !state.settings.showCompletedOnSchedule) continue;

    const firstDay = startOfDay(note.due);
    const lastDay = startOfDay(note.expiresAt);
    if (dayStart < firstDay || dayStart > lastDay) continue;
    // A note expiring exactly at midnight does not bleed into the new day.
    if (dayStart === lastDay && note.expiresAt === lastDay && lastDay > firstDay) continue;

    const repeating = note.repeatUntil != null;
    let start;
    let end;
    if (note.isAllDay) {
      start = dayStart;
      end = Math.min(note.expiresAt, dayEnd);
    } else if (repeating) {
      // Every day in the range gets its own occurrence at the note's actual
      // time of day — not the "ongoing item sitting at the top of the day"
      // treatment a merely-lingering note gets on the days after its due
      // day, which is a different feature: something still overdue and not
      // yet cleared, not something meant to alert you again on schedule.
      start = sameTimeOn(dayStart, note.due);
      end = start;
    } else if (dayStart === firstDay) {
      start = note.due;
      end = Math.max(note.due, Math.min(note.expiresAt, dayEnd));
    } else {
      // A carried-over day (lingering, not repeating): sits at the top as
      // an ongoing item.
      start = dayStart;
      end = Math.min(note.expiresAt, dayEnd);
    }

    out.push({
      id: `t-${note.id}-${key}`,
      kind: 'temporary',
      noteId: note.id,
      title: note.title,
      details: note.details,
      day: dayStart,
      start,
      end,
      isAllDay: note.isAllDay,
      tag: note.tag,
      isDone: note.isDone,
      // A repeating note's overdue-ness is judged per occurrence — a future
      // day in the range is not overdue just because an earlier one has
      // already passed.
      isOverdue: !note.isDone && (repeating ? start : note.due) < now,
      recurrenceSummary: repeating ? `Through ${formatMonthDay(note.repeatUntil)}` : null,
      expiresAt: note.expiresAt,
    });
  }

  // --- Permanent notes: one occurrence per matching day.
  if (state.settings.showPermanentOnSchedule) {
    for (const note of state.permanent) {
      if (note.isMuted) continue;
      const start = occurrenceStart(note, dayStart);
      if (start == null) continue;

      const allDay = isAllDayPermanent(note);
      out.push({
        id: `p-${note.id}-${key}`,
        kind: 'permanent',
        noteId: note.id,
        title: note.title,
        details: note.details,
        day: dayStart,
        start: allDay ? dayStart : start,
        end: allDay ? dayEnd : start + note.durationMinutes * MINUTE,
        isAllDay: allDay,
        tag: note.tag,
        isDone: false,
        isOverdue: false,
        recurrenceSummary: recurrenceSummary(note.recurrence),
        expiresAt: null,
      });
    }
  }

  out.sort((a, b) => {
    const aAll = a.isAllDay ? 0 : 1;
    const bAll = b.isAllDay ? 0 : 1;
    if (aAll !== bAll) return aAll - bAll;
    if (a.start !== b.start) return a.start - b.start;
    return a.title.localeCompare(b.title);
  });

  return out;
}

/** A compact summary for painting one cell of the month grid. */
export function markerFor(state, dayMs) {
  const marker = { temporary: 0, permanent: 0, overdue: 0, done: 0, tags: [] };
  for (const entry of entriesOn(state, dayMs)) {
    if (entry.kind === 'temporary') marker.temporary += 1;
    else marker.permanent += 1;
    if (entry.isOverdue) marker.overdue += 1;
    if (entry.isDone) marker.done += 1;
    if (!marker.tags.includes(entry.tag)) marker.tags.push(entry.tag);
  }
  marker.total = marker.temporary + marker.permanent;
  return marker;
}

/** Every day in the range that has something on it. */
export function agenda(state, fromMs, throughMs, limit = 400) {
  const out = [];
  let cursor = startOfDay(fromMs);
  const stop = startOfDay(throughMs);
  let guard = 0;

  while (cursor <= stop && guard < limit) {
    const entries = entriesOn(state, cursor);
    if (entries.length) out.push({ day: cursor, entries });
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return out;
}

/** The next few things due, across both note kinds. */
export function upcoming(state, withinDays = 14, limit = 6) {
  const now = state.now || Date.now();
  const groups = agenda(state, now, addDays(now, withinDays));
  const flat = [];
  for (const group of groups) {
    for (const entry of group.entries) {
      if (entry.end > now && !entry.isDone) flat.push(entry);
    }
  }
  flat.sort((a, b) => a.start - b.start);
  return flat.slice(0, limit);
}

/** The next occurrence of a permanent note, at or after `fromMs`. */
export function nextOccurrence(note, fromMs) {
  let cursor = startOfDay(Math.max(fromMs, note.startDate));
  for (let i = 0; i < 400; i += 1) {
    const start = occurrenceStart(note, cursor);
    if (start != null && start >= startOfDay(fromMs)) return start;
    cursor = addDays(cursor, 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Calendar grid
// ---------------------------------------------------------------------------

/** The 42 days drawn for a month, including the padding days either side. */
export function gridDays(monthMs, weekStartsMonday) {
  const first = new Date(monthMs);
  first.setDate(1);
  first.setHours(0, 0, 0, 0);

  const firstWeekday = weekStartsMonday ? 1 : 0;
  const leading = (first.getDay() - firstWeekday + 7) % 7;
  const gridStart = addDays(first.getTime(), -leading);

  const days = [];
  for (let i = 0; i < 42; i += 1) days.push(addDays(gridStart, i));
  return days;
}

export function weekdayHeadings(weekStartsMonday) {
  const narrow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const offset = weekStartsMonday ? 1 : 0;
  return Array.from({ length: 7 }, (_, i) => narrow[(i + offset) % 7]);
}

/** Every month start between two dates, inclusive. */
export function monthsBetween(fromMs, throughMs) {
  const out = [];
  const cursor = new Date(fromMs);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  const stop = new Date(throughMs);
  stop.setDate(1);
  stop.setHours(0, 0, 0, 0);

  let guard = 0;
  while (cursor.getTime() <= stop.getTime() && guard < 600) {
    out.push(cursor.getTime());
    cursor.setMonth(cursor.getMonth() + 1);
    guard += 1;
  }
  return out;
}

/**
 * How far the calendar can be browsed. Anchored on the configured year, then
 * widened so a note can never be placed off the edge of the map.
 */
export function calendarBounds(state) {
  const now = state.now || Date.now();
  let start = new Date(state.settings.calendarYear, 0, 1).getTime();
  let end = new Date(state.settings.calendarYear, 11, 31).getTime();

  for (const note of state.temporary) {
    start = Math.min(start, note.due);
    end = Math.max(end, note.expiresAt);
  }
  for (const note of state.permanent) {
    start = Math.min(start, note.startDate);
  }
  if (state.permanent.length) {
    const oneYearOut = new Date(now);
    oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);
    end = Math.max(end, oneYearOut.getTime());
  }
  const twoMonthsOut = new Date(now);
  twoMonthsOut.setMonth(twoMonthsOut.getMonth() + 2);
  end = Math.max(end, twoMonthsOut.getTime());
  start = Math.min(start, startOfDay(now));

  return { start: startOfDay(start), end: startOfDay(end) };
}

/** Range labels for a schedule row. */
export function rangeLabel(entry) {
  if (entry.isAllDay) return 'All day';
  const startText = formatTime(entry.start);
  if (entry.end <= entry.start + MINUTE) return startText;
  return `${startText} – ${formatTime(entry.end)}`;
}
