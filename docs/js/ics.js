// ics.js — the bridge to real iPhone notifications.
//
// No web app on iOS can raise a notification while it is closed; Apple exposes
// no API for it. The iPhone's own Calendar can, so this turns notes into
// calendar events carrying VALARMs. One import and the alerts are native: they
// fire on time, offline, whether or not this app is running.
//
// Permanent notes become a single recurring event with an RRULE, so one import
// covers every future occurrence for good.

import {
  MINUTE, isAllDayPermanent, startOfDay, recurrenceOccurs, sameTimeOn,
} from './model.js';

const PRODID = '-//MySchedule//Personal Schedule//EN';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

/** Floating local time: no Z, no TZID. Read in whatever zone the phone is in. */
function localStamp(ms) {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function dateStamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function utcStamp(ms) {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** RFC 5545 TEXT escaping. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold to 75 octets per line, continuing with a leading space.
 * Measured in UTF-8 bytes, not characters, or a stray emoji breaks the file.
 */
function fold(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts = [];
  let current = '';
  let bytes = 0;

  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines carry a leading space, so they get one byte less.
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = char;
      bytes = size;
    } else {
      current += char;
      bytes += size;
    }
  }
  if (current) parts.push(current);

  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join('\r\n');
}

/** Minutes before an event, as an RFC 5545 duration. */
export function triggerFor(minutes) {
  if (minutes <= 0) return '-PT0S';
  if (minutes % 10080 === 0) return `-P${minutes / 10080}W`;
  if (minutes % 1440 === 0) return `-P${minutes / 1440}D`;
  if (minutes % 60 === 0) return `-PT${minutes / 60}H`;
  return `-PT${minutes}M`;
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function rruleFor(recurrence) {
  switch (recurrence.kind) {
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekends':
      return 'FREQ=WEEKLY;BYDAY=SA,SU';
    case 'selectedDays': {
      const days = (recurrence.weekdays || []).slice().sort((a, b) => a - b);
      if (!days.length) return null;
      return `FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(',')}`;
    }
    case 'everyNDays': {
      const step = Math.max(1, recurrence.interval || 1);
      return step === 1 ? 'FREQ=DAILY' : `FREQ=DAILY;INTERVAL=${step}`;
    }
    case 'dayOfMonth': {
      const day = Math.min(Math.max(1, recurrence.dayOfMonth || 1), 31);
      return `FREQ=MONTHLY;BYMONTHDAY=${day}`;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function alarms(reminders, title) {
  const lines = [];
  const unique = Array.from(new Set(reminders || [])).sort((a, b) => b - a);
  for (const minutes of unique) {
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${esc(title)}`);
    lines.push(`TRIGGER:${triggerFor(minutes)}`);
    lines.push('END:VALARM');
  }
  return lines;
}

function describe(note, extra) {
  const parts = [];
  if (note.details) parts.push(note.details);
  if (extra) parts.push(extra);
  parts.push('Added by MySchedule.');
  return parts.join('\n\n');
}

export function temporaryEvent(note, stamp, sequence = 0) {
  const lines = ['BEGIN:VEVENT'];
  lines.push(`UID:temp-${note.id}@myschedule.local`);
  lines.push(`DTSTAMP:${stamp}`);
  lines.push(`SEQUENCE:${sequence}`);

  const repeating = note.repeatUntil != null;

  if (note.isAllDay) {
    const day = startOfDay(note.due);
    lines.push(`DTSTART;VALUE=DATE:${dateStamp(day)}`);
    lines.push(`DTEND;VALUE=DATE:${dateStamp(day + 86400000)}`);
    // UNTIL must share DTSTART's value type (RFC 5545 §3.3.10) — a bare
    // date here, not a date-time, and never a day short: UNTIL is the last
    // *instance*, i.e. the repeatUntil day itself.
    if (repeating) lines.push(`RRULE:FREQ=DAILY;UNTIL=${dateStamp(note.repeatUntil)}`);
  } else {
    lines.push(`DTSTART:${localStamp(note.due)}`);
    lines.push(`DTEND:${localStamp(note.due + 30 * MINUTE)}`);
    if (repeating) {
      // DTSTART here is a floating local time (no Z, no TZID), so per the
      // same RFC rule UNTIL must float too — the same wall-clock moment as
      // every other occurrence, on the last day of the range.
      lines.push(`RRULE:FREQ=DAILY;UNTIL=${localStamp(sameTimeOn(note.repeatUntil, note.due))}`);
    }
  }

  lines.push(`SUMMARY:${esc(note.title)}`);
  lines.push(`DESCRIPTION:${esc(describe(note, repeating ? 'Repeats on the schedule.' : 'Deadline.'))}`);
  lines.push('CATEGORIES:MySchedule,Temporary');
  lines.push(...alarms(note.reminders, note.title));
  lines.push('END:VEVENT');
  return lines;
}

export function permanentEvent(note, stamp, sequence = 0) {
  const rule = rruleFor(note.recurrence);
  if (!rule) return null;

  const allDay = isAllDayPermanent(note);
  // The event must begin on a day the pattern actually lands on, or the RRULE
  // anchors to the wrong weekday.
  let first = startOfDay(note.startDate);
  for (let i = 0; i < 400; i += 1) {
    if (recurrenceOccurs(note.recurrence, first, note.startDate)) break;
    first += 86400000;
  }

  const lines = ['BEGIN:VEVENT'];
  lines.push(`UID:perm-${note.id}@myschedule.local`);
  lines.push(`DTSTAMP:${stamp}`);
  lines.push(`SEQUENCE:${sequence}`);

  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateStamp(first)}`);
    lines.push(`DTEND;VALUE=DATE:${dateStamp(first + 86400000)}`);
  } else {
    const start = first + note.startMinutes * MINUTE;
    lines.push(`DTSTART:${localStamp(start)}`);
    lines.push(`DTEND:${localStamp(start + Math.max(5, note.durationMinutes) * MINUTE)}`);
  }

  lines.push(`RRULE:${rule}`);
  lines.push(`SUMMARY:${esc(note.title)}`);
  lines.push(`DESCRIPTION:${esc(describe(note, 'Standing note — repeats.'))}`);
  lines.push('CATEGORIES:MySchedule,Permanent');
  lines.push(...alarms(note.reminders, note.title));
  lines.push('END:VEVENT');
  return lines;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * Build a calendar file. `temporary` and `permanent` are the notes to include;
 * pass only the ones that still need exporting to avoid duplicates.
 */
export function buildICS({ temporary = [], permanent = [], name = 'MySchedule' }) {
  const stamp = utcStamp(Date.now());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
  ];

  let count = 0;
  for (const note of temporary) {
    lines.push(...temporaryEvent(note, stamp, note.exportSequence || 0));
    count += 1;
  }
  for (const note of permanent) {
    const event = permanentEvent(note, stamp, note.exportSequence || 0);
    if (event) {
      lines.push(...event);
      count += 1;
    }
  }

  lines.push('END:VCALENDAR');

  return {
    text: lines.map(fold).join('\r\n') + '\r\n',
    count,
  };
}

/** Which notes carry at least one alarm and so are worth exporting. */
export function exportable(state, onlyNew = true) {
  const exported = state.exported || {};
  const wantsTemp = state.temporary.filter((note) => {
    if (note.isDone) return false;
    if (note.due < Date.now()) return false;
    if (!onlyNew) return true;
    return exported[note.id] !== signatureTemporary(note);
  });
  const wantsPerm = state.permanent.filter((note) => {
    if (note.isMuted) return false;
    if (!onlyNew) return true;
    return exported[note.id] !== signaturePermanent(note);
  });
  return { temporary: wantsTemp, permanent: wantsPerm };
}

/**
 * A note's export signature. Changing the title, timing or reminders changes
 * the signature, so an edited note is offered for re-export while an untouched
 * one is not.
 */
export function signatureTemporary(note) {
  return [note.title, note.due, note.isAllDay, note.repeatUntil, (note.reminders || []).join('.')].join('|');
}

export function signaturePermanent(note) {
  return [
    note.title,
    note.startMinutes,
    note.durationMinutes,
    note.startDate,
    JSON.stringify(note.recurrence),
    (note.reminders || []).join('.'),
  ].join('|');
}
