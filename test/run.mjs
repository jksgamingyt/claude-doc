// A plain Node test run over the pure logic: model, engine, store, ICS.
// No framework — just assertions and a count.
//
//   node test/run.mjs

import assert from 'node:assert/strict';

// localStorage shim, so store.js runs outside a browser.
const memory = new Map();
globalThis.window = { matchMedia: () => ({ matches: false }), navigator: {} };
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  clear: () => memory.clear(),
};

const M = await import('../docs/js/model.js');
const E = await import('../docs/js/engine.js');
const S = await import('../docs/js/store.js');
const I = await import('../docs/js/ics.js');
const N = await import('../docs/js/notify.js');
const C = await import('../docs/js/crypto.js');
const L = await import('../docs/js/lock.js');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') await result;
    passed += 1;
  } catch (error) {
    failed += 1;
    failures.push(`${name}\n    ${error.message.split('\n')[0]}`);
  }
}

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo, d, h, mi).getTime();

function freshStore() {
  memory.clear();
  return new S.Store();
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

await test('daily recurrence occurs on every day at or after the start', () => {
  const rec = { kind: 'daily' };
  const start = at(2026, 7, 18);
  assert.equal(M.recurrenceOccurs(rec, start, start), true);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 25), start), true);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 17), start), false, 'before start');
});

await test('weekdays recurrence skips the weekend', () => {
  const rec = { kind: 'weekdays' };
  const start = at(2026, 7, 1);
  for (let day = 17; day <= 23; day += 1) {
    const ms = at(2026, 7, day);
    const weekday = new Date(ms).getDay();
    const expected = weekday >= 1 && weekday <= 5;
    assert.equal(M.recurrenceOccurs(rec, ms, start), expected, `day ${day}`);
  }
});

await test('weekends recurrence is exactly the complement of weekdays', () => {
  const start = at(2026, 7, 1);
  for (let day = 1; day <= 28; day += 1) {
    const ms = at(2026, 7, day);
    const wd = M.recurrenceOccurs({ kind: 'weekdays' }, ms, start);
    const we = M.recurrenceOccurs({ kind: 'weekends' }, ms, start);
    assert.equal(wd, !we, `day ${day}`);
  }
});

await test('everyNDays counts from the start date', () => {
  const rec = { kind: 'everyNDays', interval: 3 };
  const start = at(2026, 7, 18);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 18), start), true);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 19), start), false);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 21), start), true);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 24), start), true);
});

await test('everyNDays survives a daylight-saving boundary', () => {
  // US DST ends 1 Nov 2026; a naive ms/86400000 would drift here.
  const rec = { kind: 'everyNDays', interval: 2 };
  const start = at(2026, 9, 30);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 10, 1), start), true);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 10, 2), start), false);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 10, 3), start), true);
});

await test('dayOfMonth falls back to the last day of a short month', () => {
  const rec = { kind: 'dayOfMonth', dayOfMonth: 31 };
  const start = at(2026, 0, 1);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 0, 31), start), true, 'Jan 31');
  assert.equal(M.recurrenceOccurs(rec, at(2026, 1, 28), start), true, 'Feb 28 fallback');
  assert.equal(M.recurrenceOccurs(rec, at(2026, 1, 27), start), false);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 3, 30), start), true, 'Apr 30 fallback');
});

await test('dayOfMonth does not double-fire in a long month', () => {
  const rec = { kind: 'dayOfMonth', dayOfMonth: 31 };
  const start = at(2026, 0, 1);
  let hits = 0;
  for (let d = 1; d <= 31; d += 1) {
    if (M.recurrenceOccurs(rec, at(2026, 0, d), start)) hits += 1;
  }
  assert.equal(hits, 1);
});

await test('selectedDays with no days chosen never occurs', () => {
  const rec = { kind: 'selectedDays', weekdays: [] };
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 18), at(2026, 7, 1)), false);
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

await test('atDue expiry equals the deadline', () => {
  const due = at(2026, 7, 20, 18, 0);
  assert.equal(M.expiryFor(due, 'atDue'), due);
});

await test('endOfDay expiry is the following midnight', () => {
  const due = at(2026, 7, 20, 18, 0);
  assert.equal(M.expiryFor(due, 'endOfDay'), at(2026, 7, 21));
});

await test('endOfDay on a late-evening deadline still lands the same night', () => {
  const due = at(2026, 7, 20, 23, 30);
  assert.equal(M.expiryFor(due, 'endOfDay'), at(2026, 7, 21));
});

// ---------------------------------------------------------------------------
// Custom-day linger — the 1-to-365-day scroller alongside the seven presets
// ---------------------------------------------------------------------------

await test('a custom linger adds that many days to the deadline', () => {
  const due = at(2026, 7, 20, 18, 0);
  assert.equal(M.expiryFor(due, M.CUSTOM_LINGER, 10), due + 10 * M.DAY);
  assert.equal(M.expiryFor(due, M.CUSTOM_LINGER, 1), due + M.DAY);
  assert.equal(M.expiryFor(due, M.CUSTOM_LINGER, 365), due + 365 * M.DAY);
});

await test('a custom linger day count is clamped to 1-365', () => {
  assert.equal(M.clampLingerDays(0), 1);
  assert.equal(M.clampLingerDays(-5), 1);
  assert.equal(M.clampLingerDays(366), 365);
  assert.equal(M.clampLingerDays(9999), 365);
  assert.equal(M.clampLingerDays(40.6), 41, 'rounds rather than truncates');
  assert.equal(M.clampLingerDays(undefined), 1, 'a missing value is not fatal');
  assert.equal(M.clampLingerDays(NaN), 1);
});

await test('a temporary note with a custom linger clamps and applies it', () => {
  const note = M.makeTemporary({
    title: 'Long-lived', due: at(2026, 7, 20, 18, 0), linger: M.CUSTOM_LINGER, lingerDays: 500,
  });
  assert.equal(note.lingerDays, 365, 'clamped on the way in');
  assert.equal(note.expiresAt, at(2026, 7, 20, 18, 0) + 365 * M.DAY);
});

await test('an ordinary linger ignores whatever lingerDays happens to hold', () => {
  const note = M.makeTemporary({
    title: 'Rent', due: at(2026, 7, 20, 18, 0), linger: 'oneDay', lingerDays: 200,
  });
  assert.equal(note.expiresAt, at(2026, 7, 21, 18, 0), 'still the plain +1 day rule');
});

await test('editing a note into a custom linger recomputes its expiry', () => {
  const store = freshStore();
  const note = store.addTemporary({ title: 'Rent', due: at(2026, 7, 20, 18, 0), linger: 'atDue' });
  assert.equal(note.expiresAt, at(2026, 7, 20, 18, 0));
  const updated = store.updateTemporary({ id: note.id, linger: M.CUSTOM_LINGER, lingerDays: 45 });
  assert.equal(updated.expiresAt, at(2026, 7, 20, 18, 0) + 45 * M.DAY);
});

await test('a custom-linger note carries the full 1-to-365-day range into the schedule', () => {
  const note = M.makeTemporary({
    title: 'Long haul', due: at(2026, 7, 20, 18, 0), linger: M.CUSTOM_LINGER, lingerDays: 200,
  });
  const state = stateWith([note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 1, 'shows on the due day');
  assert.equal(E.entriesOn(state, at(2026, 12, 1)).length, 1, 'still lingering months later');
});

await test('a custom linger survives a save and reload', () => {
  const store = freshStore();
  store.addTemporary({ title: 'Rent', due: at(2026, 7, 20, 18, 0), linger: M.CUSTOM_LINGER, lingerDays: 90 });
  store.saveNow();
  const reloaded = new S.Store();
  assert.equal(reloaded.state.temporary[0].linger, M.CUSTOM_LINGER);
  assert.equal(reloaded.state.temporary[0].lingerDays, 90);
  assert.equal(reloaded.state.temporary[0].expiresAt, at(2026, 7, 20, 18, 0) + 90 * M.DAY);
});

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function stateWith(temporary = [], permanent = [], now = at(2026, 7, 18, 9, 0)) {
  return {
    temporary,
    permanent,
    settings: { ...S.DEFAULT_SETTINGS },
    now,
  };
}

await test('a temporary note appears on its due day', () => {
  const note = M.makeTemporary({ title: 'Rent', due: at(2026, 7, 20, 18, 0) });
  const state = stateWith([note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 1);
  assert.equal(E.entriesOn(state, at(2026, 7, 19)).length, 0);
  assert.equal(E.entriesOn(state, at(2026, 7, 21)).length, 0);
});

await test('a note expiring at midnight does not bleed into the next day', () => {
  const note = M.makeTemporary({
    title: 'Rent', due: at(2026, 7, 20, 18, 0), linger: 'endOfDay',
  });
  const state = stateWith([note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 1, 'shows on the due day');
  assert.equal(E.entriesOn(state, at(2026, 7, 21)).length, 0, 'not the day after');
});

await test('a lingering note carries into the following day', () => {
  const note = M.makeTemporary({
    title: 'Rent', due: at(2026, 7, 20, 18, 0), linger: 'oneDay',
  });
  const state = stateWith([note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 1);
  assert.equal(E.entriesOn(state, at(2026, 7, 21)).length, 1);
  assert.equal(E.entriesOn(state, at(2026, 7, 22)).length, 0);
});

await test('all-day entries sort above timed ones', () => {
  const timed = M.makeTemporary({ title: 'Timed', due: at(2026, 7, 20, 9, 0) });
  const allDay = M.makeTemporary({ title: 'All day', due: at(2026, 7, 20, 12, 0), isAllDay: true });
  const state = stateWith([timed, allDay]);
  const entries = E.entriesOn(state, at(2026, 7, 20));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, 'All day');
});

await test('a permanent note appears on every matching day, forever', () => {
  const note = M.makePermanent({
    title: 'Walk',
    recurrence: { kind: 'weekdays' },
    startDate: at(2026, 7, 17),
    startMinutes: 7 * 60,
  });
  const state = stateWith([], [note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 17)).length, 1, 'Mon');
  assert.equal(E.entriesOn(state, at(2026, 7, 22)).length, 0, 'Sat');
  assert.equal(E.entriesOn(state, at(2027, 7, 17)).length, 1, 'a year later');
});

await test('a muted permanent note leaves the schedule but is not deleted', () => {
  const note = M.makePermanent({ title: 'Walk', recurrence: { kind: 'daily' }, startDate: at(2026, 7, 1) });
  note.isMuted = true;
  const state = stateWith([], [note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 0);
});

await test('a permanent note never appears before its start date', () => {
  const note = M.makePermanent({
    title: 'Walk', recurrence: { kind: 'daily' }, startDate: at(2026, 8, 1),
  });
  const state = stateWith([], [note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 0);
  assert.equal(E.entriesOn(state, at(2026, 8, 1)).length, 1);
});

await test('the month grid is always 42 days and starts on the right weekday', () => {
  const days = E.gridDays(at(2026, 7, 1), false);
  assert.equal(days.length, 42);
  assert.equal(new Date(days[0]).getDay(), 0, 'Sunday start');
  const monday = E.gridDays(at(2026, 7, 1), true);
  assert.equal(new Date(monday[0]).getDay(), 1, 'Monday start');
});

await test('the month grid contains every day of the month', () => {
  for (let month = 0; month < 12; month += 1) {
    const days = E.gridDays(at(2026, month, 1), false);
    const inMonth = days.filter((d) => new Date(d).getMonth() === month);
    const expected = new Date(2026, month + 1, 0).getDate();
    assert.equal(inMonth.length, expected, `month ${month}`);
  }
});

await test('agenda only returns days that have something on them', () => {
  const note = M.makeTemporary({ title: 'One', due: at(2026, 7, 25, 12, 0) });
  const state = stateWith([note]);
  const days = E.agenda(state, at(2026, 7, 18), at(2026, 7, 31));
  assert.equal(days.length, 1);
  assert.equal(days[0].day, at(2026, 7, 25));
});

await test('calendar bounds cover the configured year and stretch to fit outliers', () => {
  const far = M.makeTemporary({ title: 'Far', due: at(2028, 5, 1, 9, 0) });
  const state = stateWith([far]);
  const bounds = E.calendarBounds(state);
  assert.ok(bounds.start <= at(2026, 0, 1));
  assert.ok(bounds.end >= at(2028, 5, 1));
});

// ---------------------------------------------------------------------------
// Store and sweep
// ---------------------------------------------------------------------------

await test('a note survives a save and reload', () => {
  const store = freshStore();
  store.addTemporary({ title: 'Rent', due: at(2026, 7, 20, 18, 0), reminders: [60] });
  store.saveNow();
  const reloaded = new S.Store();
  assert.equal(reloaded.state.temporary.length, 1);
  assert.equal(reloaded.state.temporary[0].title, 'Rent');
  assert.deepEqual(reloaded.state.temporary[0].reminders, [60]);
});

await test('a corrupt record is skipped, not fatal', () => {
  memory.clear();
  localStorage.setItem('myschedule.state.v1', JSON.stringify({
    version: 1,
    temporary: [
      { title: 'Good', due: at(2026, 7, 20, 18, 0), id: 'a' },
      { nonsense: true },
      null,
    ],
    permanent: [],
  }));
  const store = new S.Store();
  assert.equal(store.state.temporary.length, 1);
  assert.equal(store.state.temporary[0].title, 'Good');
});

await test('unknown settings keys do not reset the known ones', () => {
  memory.clear();
  localStorage.setItem('myschedule.state.v1', JSON.stringify({
    settings: { calendarYear: 2030 },
  }));
  const store = new S.Store();
  assert.equal(store.state.settings.calendarYear, 2030, 'kept the stored value');
  assert.equal(store.state.settings.defaultLinger, 'atDue', 'filled in the missing one');
});

await test('sweep retires an expired note into the archive', () => {
  const store = freshStore();
  store.addTemporary({ title: 'Gone', due: at(2026, 7, 10, 9, 0) });
  const report = store.sweep(at(2026, 7, 18, 9, 0));
  assert.equal(store.state.temporary.length, 0);
  assert.equal(store.state.archive.length, 1);
  assert.equal(store.state.archive[0].reason, 'expired');
  assert.deepEqual(report.expired, ['Gone']);
});

await test('sweep leaves a note that has not expired yet', () => {
  const store = freshStore();
  store.addTemporary({ title: 'Soon', due: at(2026, 7, 20, 9, 0) });
  store.sweep(at(2026, 7, 18, 9, 0));
  assert.equal(store.state.temporary.length, 1);
});

await test('a completed note is archived as done, and not announced', () => {
  const store = freshStore();
  const note = store.addTemporary({ title: 'Done thing', due: at(2026, 7, 10, 9, 0) });
  store.setDone(note.id, true);
  const report = store.sweep(at(2026, 7, 18, 9, 0));
  assert.equal(store.state.archive[0].reason, 'completed');
  assert.deepEqual(report.expired, [], 'nothing to announce');
});

await test('a note expiring today is not trimmed away in the same sweep', () => {
  // The bug this guards: trimming after filing would archive a long-overdue
  // note and immediately delete it, while still naming it in the banner.
  const store = freshStore();
  store.state.settings.archiveRetentionDays = 30;
  const now = at(2026, 7, 18, 9, 0);
  store.addTemporary({ title: 'Ancient', due: at(2026, 4, 1, 9, 0) });
  const report = store.sweep(now);
  assert.deepEqual(report.expired, ['Ancient']);
  assert.equal(store.state.archive.length, 1, 'still in the archive it was announced for');
});

await test('permanent notes are never swept', () => {
  const store = freshStore();
  store.addPermanent({ title: 'Forever', recurrence: { kind: 'daily' }, startDate: at(2020, 0, 1) });
  store.sweep(at(2030, 0, 1));
  assert.equal(store.state.permanent.length, 1);
});

await test('grouping puts an overdue note in past due and a future one in later', () => {
  const store = freshStore();
  store.state.now = at(2026, 7, 18, 12, 0);
  store.addTemporary({ title: 'Late', due: at(2026, 7, 17, 9, 0), linger: 'oneWeek' });
  store.addTemporary({ title: 'Today', due: at(2026, 7, 18, 20, 0) });
  store.addTemporary({ title: 'Far', due: at(2026, 8, 30, 9, 0) });
  const groups = Object.fromEntries(store.groupedTemporary().map((g) => [g.group, g.notes.map((n) => n.title)]));
  assert.deepEqual(groups.overdue, ['Late']);
  assert.deepEqual(groups.today, ['Today']);
  assert.deepEqual(groups.later, ['Far']);
});

await test('attention count is overdue plus today, ignoring done', () => {
  const store = freshStore();
  store.state.now = at(2026, 7, 18, 12, 0);
  store.addTemporary({ title: 'Late', due: at(2026, 7, 17, 9, 0), linger: 'oneWeek' });
  store.addTemporary({ title: 'Today', due: at(2026, 7, 18, 20, 0) });
  const done = store.addTemporary({ title: 'Done', due: at(2026, 7, 18, 21, 0) });
  store.setDone(done.id, true);
  store.addTemporary({ title: 'Next week', due: at(2026, 7, 28, 9, 0) });
  assert.equal(store.attentionCount, 2);
});

await test('deleting a note archives it, and restoring brings it back', () => {
  const store = freshStore();
  const note = store.addTemporary({ title: 'Oops', due: at(2026, 8, 20, 9, 0) });
  store.deleteTemporary(note.id);
  assert.equal(store.state.temporary.length, 0);
  assert.equal(store.state.archive.length, 1);
  store.restore(store.state.archive[0]);
  assert.equal(store.state.temporary.length, 1);
  assert.equal(store.state.archive.length, 0);
});

await test('a restored note gets a deadline in the future', () => {
  const store = freshStore();
  const note = store.addTemporary({ title: 'Old', due: at(2020, 0, 1, 9, 0) });
  store.deleteTemporary(note.id);
  store.restore(store.state.archive[0]);
  assert.ok(store.state.temporary[0].due > Date.now(), 'would otherwise expire instantly');
});

await test('export round-trips through JSON', () => {
  const store = freshStore();
  store.addTemporary({ title: 'Rent', due: at(2026, 7, 20, 18, 0) });
  store.addPermanent({ title: 'Walk', recurrence: { kind: 'daily' }, startDate: at(2026, 7, 1) });
  const text = store.exportJSON();
  const fresh = freshStore();
  assert.equal(fresh.importJSON(text, true), true);
  assert.equal(fresh.state.temporary.length, 1);
  assert.equal(fresh.state.permanent.length, 1);
});

await test('importing junk is refused rather than clearing anything', () => {
  const store = freshStore();
  store.addTemporary({ title: 'Keep me', due: at(2026, 7, 20, 18, 0) });
  assert.equal(store.importJSON('not json at all', true), false);
  assert.equal(store.state.temporary.length, 1);
});

// ---------------------------------------------------------------------------
// Calendar export
// ---------------------------------------------------------------------------

await test('ICS text uses CRLF and folds long lines', () => {
  const note = M.makeTemporary({ title: 'x'.repeat(300), due: at(2026, 7, 20, 18, 0) });
  const { text } = I.buildICS({ temporary: [note], permanent: [] });
  assert.ok(!/[^\r]\n/.test(text), 'every LF is preceded by CR');
  for (const line of text.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, 'line within 75 octets');
  }
});

await test('ICS escapes the characters RFC 5545 reserves', () => {
  // String.raw throughout: a plain literal silently drops the backslash in
  // '\;', which is the exact trap that produced a malformed file first time.
  const note = M.makeTemporary({ title: String.raw`a;b,c\d`, due: at(2026, 7, 20, 18, 0) });
  const { text } = I.buildICS({ temporary: [note], permanent: [] });
  const summary = text.split('\r\n').find((l) => l.startsWith('SUMMARY'));
  assert.equal(summary, String.raw`SUMMARY:a\;b\,c\\d`);
});

await test('each reminder becomes its own VALARM with the right trigger', () => {
  const note = M.makeTemporary({
    title: 'Rent', due: at(2026, 7, 20, 18, 0), reminders: [1440, 60, 0],
  });
  const { text } = I.buildICS({ temporary: [note], permanent: [] });
  const triggers = text.split('\r\n').filter((l) => l.startsWith('TRIGGER:'));
  assert.deepEqual(triggers, ['TRIGGER:-P1D', 'TRIGGER:-PT1H', 'TRIGGER:-PT0S']);
});

await test('a recurring note becomes one event with an RRULE', () => {
  const note = M.makePermanent({
    title: 'Walk',
    recurrence: { kind: 'selectedDays', weekdays: [1, 3, 5] },
    startDate: at(2026, 7, 18),
    startMinutes: 7 * 60,
  });
  const { text, count } = I.buildICS({ temporary: [], permanent: [note] });
  assert.equal(count, 1, 'one event covers every occurrence');
  assert.ok(text.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'));
});

await test('a recurring event anchors on a day the pattern actually lands on', () => {
  // Start date is a Tuesday but the pattern is Mon/Wed/Fri; anchoring on the
  // start date would shift every occurrence by a day.
  const start = at(2026, 7, 18);
  assert.equal(new Date(start).getDay(), 2, 'fixture really is a Tuesday');
  const note = M.makePermanent({
    title: 'Walk',
    recurrence: { kind: 'selectedDays', weekdays: [1, 3, 5] },
    startDate: start,
    startMinutes: 7 * 60,
  });
  const { text } = I.buildICS({ temporary: [], permanent: [note] });
  const dtstart = text.split('\r\n').find((l) => l.startsWith('DTSTART'));
  assert.equal(dtstart, 'DTSTART:20260819T070000', 'moved to the Wednesday');
});

await test('an all-day note uses DATE values, not times', () => {
  const note = M.makeTemporary({ title: 'Birthday', due: at(2026, 7, 20, 9, 0), isAllDay: true });
  const { text } = I.buildICS({ temporary: [note], permanent: [] });
  assert.ok(text.includes('DTSTART;VALUE=DATE:20260820'));
  assert.ok(text.includes('DTEND;VALUE=DATE:20260821'));
});

await test('every RRULE kind produces a rule', () => {
  const kinds = ['daily', 'weekdays', 'weekends', 'everyNDays', 'dayOfMonth'];
  for (const kind of kinds) {
    const rule = I.rruleFor({ kind, weekdays: [1], interval: 3, dayOfMonth: 15 });
    assert.ok(rule && rule.startsWith('FREQ='), `${kind} -> ${rule}`);
  }
  assert.equal(I.rruleFor({ kind: 'selectedDays', weekdays: [] }), null, 'no days, no rule');
});

await test('export offers a note once, then not again until it changes', () => {
  const store = freshStore();
  const note = store.addTemporary({ title: 'Rent', due: Date.now() + 5 * M.DAY, reminders: [60] });
  let batch = I.exportable(store.state, true);
  assert.equal(batch.temporary.length, 1, 'offered first time');

  store.markExported(batch.temporary, batch.permanent);
  batch = I.exportable(store.state, true);
  assert.equal(batch.temporary.length, 0, 'not offered twice');

  store.updateTemporary({ id: note.id, title: 'Rent (updated)' });
  batch = I.exportable(store.state, true);
  assert.equal(batch.temporary.length, 1, 'offered again after an edit');
});

await test('export skips notes that are done or already past', () => {
  const store = freshStore();
  const past = store.addTemporary({ title: 'Past', due: Date.now() - M.DAY, linger: 'oneWeek' });
  const done = store.addTemporary({ title: 'Done', due: Date.now() + M.DAY });
  store.setDone(done.id, true);
  store.addTemporary({ title: 'Future', due: Date.now() + M.DAY });
  const batch = I.exportable(store.state, true);
  assert.deepEqual(batch.temporary.map((n) => n.title), ['Future']);
});

// ---------------------------------------------------------------------------
// Daily reminders
// ---------------------------------------------------------------------------

await test('a daily reminder defaults to tomorrow morning', () => {
  const reminder = M.makeDaily({ text: 'Bring the charger' });
  assert.equal(reminder.forDate, M.startOfDay(Date.now() + M.DAY));
  assert.equal(reminder.seenAt, null);
});

await test('a reminder for tomorrow is not pending today', () => {
  const store = freshStore();
  store.addDaily({ text: 'Charger', forDate: at(2026, 7, 19) });
  assert.equal(store.pendingDaily(at(2026, 7, 18, 8, 0)).length, 0);
});

await test('a reminder for today is pending', () => {
  const store = freshStore();
  store.addDaily({ text: 'Charger', forDate: at(2026, 7, 18) });
  assert.equal(store.pendingDaily(at(2026, 7, 18, 8, 0)).length, 1);
});

await test('a reminder left at 11:59pm is pending the next morning', () => {
  const store = freshStore();
  // Written just before midnight, aimed at the morning after.
  store.addDaily({ text: 'Charger', forDate: at(2026, 7, 19), createdAt: at(2026, 7, 18, 23, 59) });
  assert.equal(store.pendingDaily(at(2026, 7, 18, 23, 59)).length, 0, 'not that same night');
  assert.equal(store.pendingDaily(at(2026, 7, 19, 7, 0)).length, 1, 'waiting in the morning');
});

await test('a reminder slept through still waits, rather than vanishing', () => {
  const store = freshStore();
  store.addDaily({ text: 'Charger', forDate: at(2026, 7, 15) });
  const pending = store.pendingDaily(at(2026, 7, 18, 9, 0));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].text, 'Charger');
});

await test('being seen stands a reminder down for good', () => {
  const store = freshStore();
  const reminder = store.addDaily({ text: 'Charger', forDate: at(2026, 7, 18) });
  store.markDailySeen([reminder.id], at(2026, 7, 18, 8, 0));
  assert.equal(store.pendingDaily(at(2026, 7, 18, 9, 0)).length, 0);
  assert.equal(store.pendingDaily(at(2026, 7, 19, 9, 0)).length, 0, 'nor the next day');
});

await test('several reminders for one morning all come through, oldest first', () => {
  const store = freshStore();
  store.addDaily({ text: 'Second', forDate: at(2026, 7, 18) });
  store.addDaily({ text: 'First', forDate: at(2026, 7, 16) });
  const pending = store.pendingDaily(at(2026, 7, 18, 9, 0));
  assert.deepEqual(pending.map((r) => r.text), ['First', 'Second']);
});

await test('delivered reminders are cleared out on sweep, unseen ones are not', () => {
  const store = freshStore();
  const now = at(2026, 7, 18, 9, 0);
  store.state.settings.archiveRetentionDays = 30;
  const old = store.addDaily({ text: 'Ancient', forDate: at(2026, 4, 1) });
  store.markDailySeen([old.id], at(2026, 4, 1, 8, 0));
  store.addDaily({ text: 'Still waiting', forDate: at(2026, 4, 2) });

  store.sweep(now);
  assert.deepEqual(store.state.daily.map((r) => r.text), ['Still waiting']);
});

await test('daily reminders survive a save and reload', () => {
  const store = freshStore();
  store.addDaily({ text: 'Charger', forDate: at(2026, 7, 19) });
  store.saveNow();
  const reloaded = new S.Store();
  assert.equal(reloaded.state.daily.length, 1);
  assert.equal(reloaded.state.daily[0].text, 'Charger');
});

await test('a malformed daily reminder is skipped, not fatal', () => {
  memory.clear();
  localStorage.setItem('myschedule.state.v1', JSON.stringify({
    daily: [{ text: 'Good', forDate: at(2026, 7, 19) }, { text: 'no date' }, null],
  }));
  const store = new S.Store();
  assert.equal(store.state.daily.length, 1);
});

await test('daily reminders do not appear on the calendar', () => {
  // They greet you; they are not schedule entries. Guards against them
  // quietly leaking into the day grid.
  const store = freshStore();
  store.addDaily({ text: 'Charger', forDate: at(2026, 7, 19) });
  const state = { ...store.state, settings: { ...S.DEFAULT_SETTINGS }, now: at(2026, 7, 19, 9, 0) };
  assert.equal(E.entriesOn(state, at(2026, 7, 19)).length, 0);
});

// ---------------------------------------------------------------------------
// Goals — a third, separate thing: never the schedule, never a reminder
// ---------------------------------------------------------------------------

await test('a new goal defaults to a month out and unachieved', () => {
  const goal = M.makeGoal({ text: 'Learn Spanish' });
  assert.equal(goal.dueDate, M.startOfDay(Date.now() + 30 * M.DAY));
  assert.equal(goal.achievedAt, null);
});

await test('adding and updating a goal round-trips through the store', () => {
  const store = freshStore();
  const goal = store.addGoal({ text: 'Run a 10k', dueDate: at(2026, 9, 1) });
  assert.equal(store.state.goals.length, 1);
  store.updateGoal({ id: goal.id, text: 'Run a half marathon', dueDate: at(2026, 11, 1) });
  assert.equal(store.state.goals[0].text, 'Run a half marathon');
  assert.equal(store.state.goals[0].dueDate, at(2026, 11, 1));
  assert.equal(store.state.goals.length, 1, 'updated in place, not duplicated');
});

await test('marking a goal achieved and unmarking it toggles achievedAt', () => {
  const store = freshStore();
  const goal = store.addGoal({ text: 'Run a 10k', dueDate: at(2026, 9, 1) });
  store.setGoalAchieved(goal.id, true);
  assert.ok(store.state.goals[0].achievedAt);
  store.setGoalAchieved(goal.id, false);
  assert.equal(store.state.goals[0].achievedAt, null);
});

await test('deleting a goal removes it outright, no archive', () => {
  const store = freshStore();
  const goal = store.addGoal({ text: 'Run a 10k', dueDate: at(2026, 9, 1) });
  store.deleteGoal(goal.id);
  assert.equal(store.state.goals.length, 0);
  assert.equal(store.state.archive.length, 0, 'goals do not go through the archive');
});

await test('goals group into past due, in progress, and achieved', () => {
  const store = freshStore();
  store.state.now = at(2026, 7, 18, 9, 0);
  const late = store.addGoal({ text: 'Late', dueDate: at(2026, 7, 1) });
  store.addGoal({ text: 'On track', dueDate: at(2026, 8, 1) });
  const done = store.addGoal({ text: 'Done', dueDate: at(2026, 6, 1) });
  store.setGoalAchieved(done.id, true);

  const groups = store.groupedGoals();
  assert.deepEqual(groups.map((g) => g.group), ['overdue', 'upcoming', 'achieved']);
  assert.deepEqual(groups[0].goals.map((g) => g.id), [late.id]);
  assert.deepEqual(groups[2].goals.map((g) => g.id), [done.id]);
});

await test('within a group, overdue and upcoming sort soonest first, achieved sorts most-recent first', () => {
  const store = freshStore();
  store.state.now = at(2026, 7, 18, 9, 0);
  store.addGoal({ text: 'Sooner', dueDate: at(2026, 8, 1) });
  store.addGoal({ text: 'Later', dueDate: at(2026, 9, 1) });
  const first = store.addGoal({ text: 'Achieved first', dueDate: at(2026, 6, 1) });
  const second = store.addGoal({ text: 'Achieved second', dueDate: at(2026, 6, 1) });
  // Set explicit, unambiguously-ordered timestamps rather than two real
  // setGoalAchieved() calls back to back — those can land in the same
  // millisecond and make the sort order a coin flip.
  store.updateGoal({ id: first.id, achievedAt: at(2026, 7, 10) });
  store.updateGoal({ id: second.id, achievedAt: at(2026, 7, 12) });

  const groups = store.groupedGoals();
  const upcoming = groups.find((g) => g.group === 'upcoming');
  assert.deepEqual(upcoming.goals.map((g) => g.text), ['Sooner', 'Later']);
  const achieved = groups.find((g) => g.group === 'achieved');
  assert.deepEqual(achieved.goals.map((g) => g.text), ['Achieved second', 'Achieved first']);
});

await test('a malformed goal is skipped on load, not fatal', () => {
  memory.clear();
  localStorage.setItem('myschedule.state.v1', JSON.stringify({
    goals: [{ text: 'Good', dueDate: at(2026, 7, 19) }, { text: 'no date' }, null],
  }));
  const store = new S.Store();
  assert.equal(store.state.goals.length, 1);
});

await test('goals survive a save and reload', () => {
  const store = freshStore();
  store.addGoal({ text: 'Learn Spanish', dueDate: at(2026, 9, 1) });
  store.saveNow();
  const reloaded = new S.Store();
  assert.equal(reloaded.state.goals.length, 1);
  assert.equal(reloaded.state.goals[0].text, 'Learn Spanish');
});

await test('erasing everything clears goals too', () => {
  const store = freshStore();
  store.addGoal({ text: 'Learn Spanish', dueDate: at(2026, 9, 1) });
  store.eraseEverything();
  assert.equal(store.state.goals.length, 0);
});

await test('a backup replaces goals wholesale; a merge adds only the new ones', () => {
  const store = freshStore();
  const kept = store.addGoal({ text: 'Kept', dueDate: at(2026, 9, 1) });
  const backup = store.exportJSON();

  store.addGoal({ text: 'Written after the backup', dueDate: at(2026, 10, 1) });
  store.importJSON(backup, true);
  assert.deepEqual(store.state.goals.map((g) => g.id), [kept.id], 'replace wipes what came after the backup');

  const other = freshStore();
  other.addGoal({ text: 'Already here', dueDate: at(2026, 11, 1) });
  other.importJSON(backup, false);
  assert.equal(other.state.goals.length, 2, 'merge keeps both, does not duplicate the shared one');
});

await test('goals never appear on the schedule', () => {
  // Structurally impossible — entriesOn() never reads state.goals — but
  // worth asserting directly, the same way the daily-reminder guard is.
  const store = freshStore();
  store.addGoal({ text: 'Learn Spanish', dueDate: at(2026, 7, 19) });
  const state = { ...store.state, settings: { ...S.DEFAULT_SETTINGS }, now: at(2026, 7, 19, 9, 0) };
  assert.equal(E.entriesOn(state, at(2026, 7, 19)).length, 0);
});

await test('goals never appear in the calendar export', () => {
  const store = freshStore();
  store.addGoal({ text: 'Learn Spanish', dueDate: at(2026, 7, 19) });
  const batch = I.exportable(store.state, false);
  assert.equal(batch.temporary.length + batch.permanent.length, 0);
});

// ---------------------------------------------------------------------------
// PIN hashing (crypto.js)
// ---------------------------------------------------------------------------

await test('a correct PIN verifies, a wrong one does not', async () => {
  const { salt, hash } = await C.hashPin('4821');
  assert.equal(await C.verifyPin('4821', salt, hash), true);
  assert.equal(await C.verifyPin('4820', salt, hash), false);
});

await test('hashing the same PIN twice never produces the same salt or hash', async () => {
  const a = await C.hashPin('1234');
  const b = await C.hashPin('1234');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.equal(await C.verifyPin('1234', a.salt, a.hash), true);
  assert.equal(await C.verifyPin('1234', b.salt, b.hash), true);
});

await test('a one-digit-off PIN is rejected, not just a wildly different one', async () => {
  const { salt, hash } = await C.hashPin('5555');
  assert.equal(await C.verifyPin('5556', salt, hash), false);
});

await test('the stored hash never contains the PIN as plain text', async () => {
  const { salt, hash } = await C.hashPin('1379');
  assert.ok(!hash.includes('1379'));
  assert.ok(!salt.includes('1379'));
});

// ---------------------------------------------------------------------------
// Lock state (lock.js)
// ---------------------------------------------------------------------------

await test('App Lock off means never locked, regardless of session state', () => {
  const settings = { ...S.DEFAULT_SETTINGS, pinEnabled: false };
  assert.equal(L.isLocked(settings, { unlockedUntil: 0 }, at(2026, 7, 18)), false);
});

await test('App Lock on with no session is locked', () => {
  const settings = { ...S.DEFAULT_SETTINGS, pinEnabled: true, pinHash: 'x', pinSalt: 'y' };
  assert.equal(L.isLocked(settings, { unlockedUntil: 0 }, at(2026, 7, 18)), true);
});

await test('unlocking within the remembered window skips the lock screen', () => {
  const settings = { ...S.DEFAULT_SETTINGS, pinEnabled: true, pinHash: 'x', pinSalt: 'y', pinRememberMinutes: 60 };
  const now = at(2026, 7, 18, 9, 0);
  const until = L.rememberUntil(now, 60);
  assert.equal(L.isLocked(settings, { unlockedUntil: until }, now + 30 * 60000), false, 'still inside the hour');
  assert.equal(L.isLocked(settings, { unlockedUntil: until }, now + 90 * 60000), true, 'past the hour');
});

await test('"Every time" (0 minutes) never remembers, even a moment later', () => {
  const settings = { ...S.DEFAULT_SETTINGS, pinEnabled: true, pinHash: 'x', pinSalt: 'y' };
  const now = at(2026, 7, 18, 9, 0);
  const until = L.rememberUntil(now, 0);
  assert.equal(L.isLocked(settings, { unlockedUntil: until }, now + 1), true);
});

await test('a PIN missing its hash or salt does not lock the app out', () => {
  // Guards against a corrupt or partially-imported settings blob leaving
  // someone unable to reach their own notes with no PIN to enter.
  const settings = { ...S.DEFAULT_SETTINGS, pinEnabled: true, pinHash: null, pinSalt: null };
  assert.equal(L.isLocked(settings, { unlockedUntil: 0 }, Date.now()), false);
});

await test('the lockout schedule only escalates, never eases mid-streak', () => {
  const seen = [];
  for (let n = 0; n <= 20; n += 1) seen.push(L.lockoutSeconds(n));
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i] >= seen[i - 1], `attempt ${i}: ${seen[i]} should be >= ${seen[i - 1]}`);
  }
  assert.equal(L.lockoutSeconds(0), 0, 'no throttle on the first few tries');
  assert.equal(L.lockoutSeconds(4), 0);
  assert.ok(L.lockoutSeconds(5) > 0, 'throttle kicks in by the 5th');
});

// ---------------------------------------------------------------------------
// Reminder slots (the two nudge sliders)
// ---------------------------------------------------------------------------

await test('reminders split into two slots, furthest ahead first', () => {
  assert.deepEqual(M.splitReminders([60, 1440]), { nudgeA: 1440, nudgeB: 60 });
  assert.deepEqual(M.splitReminders([30]), { nudgeA: 30, nudgeB: null });
  assert.deepEqual(M.splitReminders([]), { nudgeA: null, nudgeB: null });
});

await test('slots rejoin without Offs or duplicates, furthest ahead first', () => {
  assert.deepEqual(M.joinNudges(1440, 60), [1440, 60]);
  assert.deepEqual(M.joinNudges(null, 60), [60]);
  assert.deepEqual(M.joinNudges(null, null), []);
  assert.deepEqual(M.joinNudges(60, 60), [60], 'the same value twice is one reminder');
  assert.deepEqual(M.joinNudges(60, 1440), [1440, 60], 'order of the slots does not matter');
});

await test('splitting then rejoining is lossless for two reminders', () => {
  const original = [10080, 15];
  const { nudgeA, nudgeB } = M.splitReminders(original);
  assert.deepEqual(M.joinNudges(nudgeA, nudgeB), original);
});

await test('Off is the first stop on the nudge track', () => {
  assert.equal(M.NUDGE_OPTIONS[0], null);
  assert.equal(M.nudgeLabel(M.NUDGE_OPTIONS[0]), 'Off');
  assert.equal(M.nudgeLabel(1440), '1 day before');
  assert.equal(M.nudgeLabel(0), 'Right on time');
});

// ---------------------------------------------------------------------------
// Silent notes
// ---------------------------------------------------------------------------

await test('a note with no reminders produces no reminder timetable entries', () => {
  const store = freshStore();
  store.addTemporary({
    title: 'Silent', due: at(2026, 7, 20, 18, 0), reminders: [], notifyOnExpiry: false,
  });
  const timetable = N.reminderTimetable(store.state, at(2026, 7, 18), 10);
  assert.equal(timetable.length, 0);
});

await test('turning the expiry alert off removes the only entry a reminderless note had', () => {
  const store = freshStore();
  store.addTemporary({
    title: 'Expiring', due: at(2026, 7, 20, 18, 0), linger: 'oneDay',
    reminders: [], notifyOnExpiry: true,
  });
  assert.equal(N.reminderTimetable(store.state, at(2026, 7, 18), 10).length, 1);

  store.updateTemporary({ id: store.state.temporary[0].id, notifyOnExpiry: false });
  assert.equal(N.reminderTimetable(store.state, at(2026, 7, 18), 10).length, 0);
});

await test('a silent permanent note never enters the timetable', () => {
  const store = freshStore();
  store.addPermanent({
    title: 'Quiet walk', recurrence: { kind: 'daily' },
    startDate: at(2026, 7, 1), reminders: [],
  });
  assert.equal(N.reminderTimetable(store.state, at(2026, 7, 18), 10).length, 0);
});

await test('a silent note still exports to the calendar, just without an alarm', () => {
  const note = M.makeTemporary({ title: 'Silent', due: at(2026, 7, 20, 18, 0), reminders: [] });
  const { text, count } = I.buildICS({ temporary: [note], permanent: [] });
  assert.equal(count, 1, 'still an event');
  assert.ok(text.includes('SUMMARY:Silent'));
  assert.ok(!text.includes('BEGIN:VALARM'), 'but no alarm');
});

await test('a silent note still appears on the schedule', () => {
  const note = M.makeTemporary({ title: 'Silent', due: at(2026, 7, 20, 18, 0), reminders: [] });
  const state = stateWith([note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 1);
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
for (const failure of failures) console.log(`\n  FAIL  ${failure}`);
process.exit(failed ? 1 : 0);
