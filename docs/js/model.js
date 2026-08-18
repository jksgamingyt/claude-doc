// model.js — the two note species, and the vocabulary they share.
//
// A direct port of the Swift model. Kept deliberately plain: no classes, no
// framework, just objects that survive JSON.stringify unharmed.

export const DAY = 86400000;
export const MINUTE = 60000;

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const TAGS = {
  moss: { name: 'Moss', light: '#4a7c59', dark: '#78b98c' },
  fern: { name: 'Fern', light: '#5f9268', dark: '#8cc896' },
  sky:  { name: 'Sky',  light: '#5a8aa8', dark: '#82b3d2' },
  clay: { name: 'Clay', light: '#b45f3d', dark: '#e08a6a' },
  gold: { name: 'Gold', light: '#bf9034', dark: '#e4b75c' },
  plum: { name: 'Plum', light: '#856693', dark: '#b195bd' },
  bark: { name: 'Bark', light: '#6b5744', dark: '#a48c74' },
};

export const TAG_KEYS = Object.keys(TAGS);

// ---------------------------------------------------------------------------
// Reminder lead times, in minutes before the moment
// ---------------------------------------------------------------------------

export const REMINDER_PRESETS = [0, 5, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080];

export function leadShort(minutes) {
  if (minutes === 0) return 'At time';
  if (minutes % 10080 === 0) {
    const weeks = minutes / 10080;
    return weeks === 1 ? '1 wk' : `${weeks} wks`;
  }
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hr' : `${hours} hrs`;
  }
  return `${minutes} min`;
}

export function leadLong(minutes) {
  return minutes === 0 ? 'Right on time' : `${leadShort(minutes)} before`;
}

// ---------------------------------------------------------------------------
// Linger: how long a temporary note outlives its deadline
// ---------------------------------------------------------------------------

export const LINGERS = {
  atDue:     { short: 'On time',    label: "The moment it's due" },
  oneHour:   { short: '+1 hr',      label: '1 hour after' },
  sixHours:  { short: '+6 hrs',     label: '6 hours after' },
  endOfDay:  { short: 'End of day', label: 'End of that day' },
  oneDay:    { short: '+1 day',     label: '1 day after' },
  threeDays: { short: '+3 days',    label: '3 days after' },
  oneWeek:   { short: '+1 wk',      label: '1 week after' },
};

export const LINGER_KEYS = Object.keys(LINGERS);

export function expiryFor(dueMs, linger) {
  const due = new Date(dueMs);
  switch (linger) {
    case 'oneHour':   return dueMs + 3600000;
    case 'sixHours':  return dueMs + 6 * 3600000;
    case 'endOfDay':  return startOfDay(dueMs) + DAY;
    case 'oneDay':    return dueMs + DAY;
    case 'threeDays': return dueMs + 3 * DAY;
    case 'oneWeek':   return dueMs + 7 * DAY;
    case 'atDue':
    default:          return dueMs;
  }
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

export const RECURRENCE_KINDS = {
  daily:        { label: 'Every day',      icon: 'sun' },
  weekdays:     { label: 'Weekdays',       icon: 'case' },
  weekends:     { label: 'Weekends',       icon: 'hill' },
  selectedDays: { label: 'Pick the days',  icon: 'week' },
  everyNDays:   { label: 'Every few days', icon: 'repeat' },
  dayOfMonth:   { label: 'Once a month',   icon: 'cal' },
};

export function defaultRecurrence() {
  return { kind: 'daily', weekdays: [1, 2, 3, 4, 5], interval: 2, dayOfMonth: 1 };
}

/** Does this recurrence land on `dayMs` (a midnight), given it began on `startMs`? */
export function recurrenceOccurs(rec, dayMs, startMs) {
  const day = startOfDay(dayMs);
  const origin = startOfDay(startMs);
  if (day < origin) return false;

  const date = new Date(day);
  const weekday = date.getDay(); // 0 = Sunday

  switch (rec.kind) {
    case 'daily':
      return true;
    case 'weekdays':
      return weekday >= 1 && weekday <= 5;
    case 'weekends':
      return weekday === 0 || weekday === 6;
    case 'selectedDays':
      return (rec.weekdays || []).includes(weekday);
    case 'everyNDays': {
      const step = Math.max(1, rec.interval || 1);
      const elapsed = Math.round((day - origin) / DAY);
      return elapsed >= 0 && elapsed % step === 0;
    }
    case 'dayOfMonth': {
      const wanted = Math.min(Math.max(1, rec.dayOfMonth || 1), 31);
      const dayNumber = date.getDate();
      if (dayNumber === wanted) return true;
      // Short months fall back to their last day, so the note is never lost.
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      return wanted > lastDay && dayNumber === lastDay;
    }
    default:
      return false;
  }
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NARROW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function weekdayShort(index) { return WEEKDAY_SHORT[index]; }
export function weekdayNarrow(index) { return WEEKDAY_NARROW[index]; }

export function recurrenceSummary(rec) {
  switch (rec.kind) {
    case 'daily':    return 'Every day';
    case 'weekdays': return 'Weekdays';
    case 'weekends': return 'Weekends';
    case 'selectedDays': {
      const days = (rec.weekdays || []).slice().sort((a, b) => a - b);
      if (!days.length) return 'No days chosen';
      return days.map(weekdayShort).join(', ');
    }
    case 'everyNDays': {
      const step = Math.max(1, rec.interval || 1);
      return step === 1 ? 'Every day' : `Every ${step} days`;
    }
    case 'dayOfMonth':
      return `Day ${Math.min(Math.max(1, rec.dayOfMonth || 1), 31)} of each month`;
    default:
      return '';
  }
}

/** The start instant on a given day, or null if the note does not occur then. */
export function occurrenceStart(note, dayMs) {
  if (!recurrenceOccurs(note.recurrence, dayMs, note.startDate)) return null;
  return startOfDay(dayMs) + note.startMinutes * MINUTE;
}

export const ALL_DAY_MINUTES = 24 * 60;

export function isAllDayPermanent(note) {
  return note.durationMinutes >= ALL_DAY_MINUTES;
}

// ---------------------------------------------------------------------------
// Date helpers. Everything is a local-time millisecond epoch.
// ---------------------------------------------------------------------------

export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ms, count) {
  const d = new Date(ms);
  d.setDate(d.getDate() + count);
  return d.getTime();
}

export function addMonths(ms, count) {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + count);
  return d.getTime();
}

export function startOfMonth(ms) {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function sameDay(a, b) {
  return startOfDay(a) === startOfDay(b);
}

export function sameMonth(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth();
}

export function minutesOfDay(ms) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

export function dayKey(ms) {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${month}${day}`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtWeekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const fmtMonthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'long' });
const fmtMonthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fmtDayHeadline = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const fmtFull = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

export const formatTime = (ms) => fmtTime.format(ms);
export const formatWeekday = (ms) => fmtWeekday.format(ms);
export const formatMonthYear = (ms) => fmtMonthYear.format(ms);
export const formatMonth = (ms) => fmtMonth.format(ms);
export const formatMonthDay = (ms) => fmtMonthDay.format(ms);
export const formatDayHeadline = (ms) => fmtDayHeadline.format(ms);
export const formatFull = (ms) => fmtFull.format(ms);

export function formatMinutes(minutes) {
  const base = new Date(2000, 0, 1, Math.floor(minutes / 60) % 24, minutes % 60);
  return fmtTime.format(base);
}

export function formatDuration(minutes) {
  if (minutes >= ALL_DAY_MINUTES) return 'All day';
  if (minutes < 60) return `${Math.max(0, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "in 3 days" / "2 hours ago" */
export function countdown(targetMs, nowMs = Date.now()) {
  const delta = targetMs - nowMs;
  const size = Math.abs(delta);
  let phrase;

  if (size < 60000) phrase = 'less than a minute';
  else if (size < 3600000) {
    const m = Math.floor(size / 60000);
    phrase = m === 1 ? '1 minute' : `${m} minutes`;
  } else if (size < DAY) {
    const h = Math.floor(size / 3600000);
    phrase = h === 1 ? '1 hour' : `${h} hours`;
  } else if (size < DAY * 14) {
    const d = Math.floor(size / DAY);
    phrase = d === 1 ? '1 day' : `${d} days`;
  } else {
    const w = Math.floor(size / (DAY * 7));
    phrase = w === 1 ? '1 week' : `${w} weeks`;
  }

  return delta < 0 ? `${phrase} ago` : `in ${phrase}`;
}

/** "Today" / "Tomorrow" / "Yesterday" / weekday / "Aug 25" */
export function dayName(targetMs, nowMs = Date.now()) {
  const delta = Math.round((startOfDay(targetMs) - startOfDay(nowMs)) / DAY);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (Math.abs(delta) < 7) return formatWeekday(targetMs);
  return formatMonthDay(targetMs);
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function newId() {
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function makeTemporary(fields) {
  const linger = fields.linger || 'atDue';
  return {
    id: fields.id || newId(),
    title: fields.title,
    details: fields.details || '',
    due: fields.due,
    isAllDay: !!fields.isAllDay,
    linger,
    expiresAt: expiryFor(fields.due, linger),
    reminders: (fields.reminders || []).slice().sort((a, b) => b - a),
    notifyOnExpiry: fields.notifyOnExpiry !== false,
    tag: fields.tag || 'clay',
    createdAt: fields.createdAt || Date.now(),
    isDone: !!fields.isDone,
    doneAt: fields.doneAt || null,
  };
}

export function makePermanent(fields) {
  return {
    id: fields.id || newId(),
    title: fields.title,
    details: fields.details || '',
    recurrence: fields.recurrence || defaultRecurrence(),
    startDate: startOfDay(fields.startDate || Date.now()),
    startMinutes: fields.startMinutes == null ? 8 * 60 : fields.startMinutes,
    durationMinutes: fields.durationMinutes == null ? 60 : fields.durationMinutes,
    reminders: (fields.reminders || []).slice().sort((a, b) => b - a),
    tag: fields.tag || 'moss',
    isMuted: !!fields.isMuted,
    createdAt: fields.createdAt || Date.now(),
  };
}
