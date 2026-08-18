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

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      throw new Error('tests must be synchronous');
    }
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

test('daily recurrence occurs on every day at or after the start', () => {
  const rec = { kind: 'daily' };
  const start = at(2026, 7, 18);
  assert.equal(M.recurrenceOccurs(rec, start, start), true);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 25), start), true);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 17), start), false, 'before start');
});

test('weekdays recurrence skips the weekend', () => {
  const rec = { kind: 'weekdays' };
  const start = at(2026, 7, 1);
  for (let day = 17; day <= 23; day += 1) {
    const ms = at(2026, 7, day);
    const weekday = new Date(ms).getDay();
    const expected = weekday >= 1 && weekday <= 5;
    assert.equal(M.recurrenceOccurs(rec, ms, start), expected, `day ${day}`);
  }
});

test('weekends recurrence is exactly the complement of weekdays', () => {
  const start = at(2026, 7, 1);
  for (let day = 1; day <= 28; day += 1) {
    const ms = at(2026, 7, day);
    const wd = M.recurrenceOccurs({ kind: 'weekdays' }, ms, start);
    const we = M.recurrenceOccurs({ kind: 'weekends' }, ms, start);
    assert.equal(wd, !we, `day ${day}`);
  }
});

test('everyNDays counts from the start date', () => {
  const rec = { kind: 'everyNDays', interval: 3 };
  const start = at(2026, 7, 18);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 18), start), true);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 19), start), false);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 21), start), true);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 24), start), true);
});

test('everyNDays survives a daylight-saving boundary', () => {
  // US DST ends 1 Nov 2026; a naive ms/86400000 would drift here.
  const rec = { kind: 'everyNDays', interval: 2 };
  const start = at(2026, 9, 30);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 10, 1), start), true);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 10, 2), start), false);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 10, 3), start), true);
});

test('dayOfMonth falls back to the last day of a short month', () => {
  const rec = { kind: 'dayOfMonth', dayOfMonth: 31 };
  const start = at(2026, 0, 1);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 0, 31), start), true, 'Jan 31');
  assert.equal(M.recurrenceOccurs(rec, at(2026, 1, 28), start), true, 'Feb 28 fallback');
  assert.equal(M.recurrenceOccurs(rec, at(2026, 1, 27), start), false);
  assert.equal(M.recurrenceOccurs(rec, at(2026, 3, 30), start), true, 'Apr 30 fallback');
});

test('dayOfMonth does not double-fire in a long month', () => {
  const rec = { kind: 'dayOfMonth', dayOfMonth: 31 };
  const start = at(2026, 0, 1);
  let hits = 0;
  for (let d = 1; d <= 31; d += 1) {
    if (M.recurrenceOccurs(rec, at(2026, 0, d), start)) hits += 1;
  }
  assert.equal(hits, 1);
});

test('selectedDays with no days chosen never occurs', () => {
  const rec = { kind: 'selectedDays', weekdays: [] };
  assert.equal(M.recurrenceOccurs(rec, at(2026, 7, 18), at(2026, 7, 1)), false);
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

test('atDue expiry equals the deadline', () => {
  const due = at(2026, 7, 20, 18, 0);
  assert.equal(M.expiryFor(due, 'atDue'), due);
});

test('endOfDay expiry is the following midnight', () => {
  const due = at(2026, 7, 20, 18, 0);
  assert.equal(M.expiryFor(due, 'endOfDay'), at(2026, 7, 21));
});

test('endOfDay on a late-evening deadline still lands the same night', () => {
  const due = at(2026, 7, 20, 23, 30);
  assert.equal(M.expiryFor(due, 'endOfDay'), at(2026, 7, 21));
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

test('a temporary note appears on its due day', () => {
  const note = M.makeTemporary({ title: 'Rent', due: at(2026, 7, 20, 18, 0) });
  const state = stateWith([note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 1);
  assert.equal(E.entriesOn(state, at(2026, 7, 19)).length, 0);
  assert.equal(E.entriesOn(state, at(2026, 7, 21)).length, 0);
});

test('a note expiring at midnight does not bleed into the next day', () => {
  const note = M.makeTemporary({
    title: 'Rent', due: at(2026, 7, 20, 18, 0), linger: 'endOfDay',
  });
  const state = stateWith([note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 1, 'shows on the due day');
  assert.equal(E.entriesOn(state, at(2026, 7, 21)).length, 0, 'not the day after');
});

test('a lingering note carries into the following day', () => {
  const note = M.makeTemporary({
    title: 'Rent', due: at(2026, 7, 20, 18, 0), linger: 'oneDay',
  });
  const state = stateWith([note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 1);
  assert.equal(E.entriesOn(state, at(2026, 7, 21)).length, 1);
  assert.equal(E.entriesOn(state, at(2026, 7, 22)).length, 0);
});

test('all-day entries sort above timed ones', () => {
  const timed = M.makeTemporary({ title: 'Timed', due: at(2026, 7, 20, 9, 0) });
  const allDay = M.makeTemporary({ title: 'All day', due: at(2026, 7, 20, 12, 0), isAllDay: true });
  const state = stateWith([timed, allDay]);
  const entries = E.entriesOn(state, at(2026, 7, 20));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, 'All day');
});

test('a permanent note appears on every matching day, forever', () => {
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

test('a muted permanent note leaves the schedule but is not deleted', () => {
  const note = M.makePermanent({ title: 'Walk', recurrence: { kind: 'daily' }, startDate: at(2026, 7, 1) });
  note.isMuted = true;
  const state = stateWith([], [note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 0);
});

test('a permanent note never appears before its start date', () => {
  const note = M.makePermanent({
    title: 'Walk', recurrence: { kind: 'daily' }, startDate: at(2026, 8, 1),
  });
  const state = stateWith([], [note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 0);
  assert.equal(E.entriesOn(state, at(2026, 8, 1)).length, 1);
});

test('the month grid is always 42 days and starts on the right weekday', () => {
  const days = E.gridDays(at(2026, 7, 1), false);
  assert.equal(days.length, 42);
  assert.equal(new Date(days[0]).getDay(), 0, 'Sunday start');
  const monday = E.gridDays(at(2026, 7, 1), true);
  assert.equal(new Date(monday[0]).getDay(), 1, 'Monday start');
});

test('the month grid contains every day of the month', () => {
  for (let month = 0; month < 12; month += 1) {
    const days = E.gridDays(at(2026, month, 1), false);
    const inMonth = days.filter((d) => new Date(d).getMonth() === month);
    const expected = new Date(2026, month + 1, 0).getDate();
    assert.equal(inMonth.length, expected, `month ${month}`);
  }
});

test('agenda only returns days that have something on them', () => {
  const note = M.makeTemporary({ title: 'One', due: at(2026, 7, 25, 12, 0) });
  const state = stateWith([note]);
  const days = E.agenda(state, at(2026, 7, 18), at(2026, 7, 31));
  assert.equal(days.length, 1);
  assert.equal(days[0].day, at(2026, 7, 25));
});

test('calendar bounds cover the configured year and stretch to fit outliers', () => {
  const far = M.makeTemporary({ title: 'Far', due: at(2028, 5, 1, 9, 0) });
  const state = stateWith([far]);
  const bounds = E.calendarBounds(state);
  assert.ok(bounds.start <= at(2026, 0, 1));
  assert.ok(bounds.end >= at(2028, 5, 1));
});

// ---------------------------------------------------------------------------
// Store and sweep
// ---------------------------------------------------------------------------

test('a note survives a save and reload', () => {
  const store = freshStore();
  store.addTemporary({ title: 'Rent', due: at(2026, 7, 20, 18, 0), reminders: [60] });
  store.saveNow();
  const reloaded = new S.Store();
  assert.equal(reloaded.state.temporary.length, 1);
  assert.equal(reloaded.state.temporary[0].title, 'Rent');
  assert.deepEqual(reloaded.state.temporary[0].reminders, [60]);
});

test('a corrupt record is skipped, not fatal', () => {
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

test('unknown settings keys do not reset the known ones', () => {
  memory.clear();
  localStorage.setItem('myschedule.state.v1', JSON.stringify({
    settings: { calendarYear: 2030 },
  }));
  const store = new S.Store();
  assert.equal(store.state.settings.calendarYear, 2030, 'kept the stored value');
  assert.equal(store.state.settings.defaultLinger, 'atDue', 'filled in the missing one');
});

test('sweep retires an expired note into the archive', () => {
  const store = freshStore();
  store.addTemporary({ title: 'Gone', due: at(2026, 7, 10, 9, 0) });
  const report = store.sweep(at(2026, 7, 18, 9, 0));
  assert.equal(store.state.temporary.length, 0);
  assert.equal(store.state.archive.length, 1);
  assert.equal(store.state.archive[0].reason, 'expired');
  assert.deepEqual(report.expired, ['Gone']);
});

test('sweep leaves a note that has not expired yet', () => {
  const store = freshStore();
  store.addTemporary({ title: 'Soon', due: at(2026, 7, 20, 9, 0) });
  store.sweep(at(2026, 7, 18, 9, 0));
  assert.equal(store.state.temporary.length, 1);
});

test('a completed note is archived as done, and not announced', () => {
  const store = freshStore();
  const note = store.addTemporary({ title: 'Done thing', due: at(2026, 7, 10, 9, 0) });
  store.setDone(note.id, true);
  const report = store.sweep(at(2026, 7, 18, 9, 0));
  assert.equal(store.state.archive[0].reason, 'completed');
  assert.deepEqual(report.expired, [], 'nothing to announce');
});

test('a note expiring today is not trimmed away in the same sweep', () => {
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

test('permanent notes are never swept', () => {
  const store = freshStore();
  store.addPermanent({ title: 'Forever', recurrence: { kind: 'daily' }, startDate: at(2020, 0, 1) });
  store.sweep(at(2030, 0, 1));
  assert.equal(store.state.permanent.length, 1);
});

test('grouping puts an overdue note in past due and a future one in later', () => {
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

test('attention count is overdue plus today, ignoring done', () => {
  const store = freshStore();
  store.state.now = at(2026, 7, 18, 12, 0);
  store.addTemporary({ title: 'Late', due: at(2026, 7, 17, 9, 0), linger: 'oneWeek' });
  store.addTemporary({ title: 'Today', due: at(2026, 7, 18, 20, 0) });
  const done = store.addTemporary({ title: 'Done', due: at(2026, 7, 18, 21, 0) });
  store.setDone(done.id, true);
  store.addTemporary({ title: 'Next week', due: at(2026, 7, 28, 9, 0) });
  assert.equal(store.attentionCount, 2);
});

test('deleting a note archives it, and restoring brings it back', () => {
  const store = freshStore();
  const note = store.addTemporary({ title: 'Oops', due: at(2026, 8, 20, 9, 0) });
  store.deleteTemporary(note.id);
  assert.equal(store.state.temporary.length, 0);
  assert.equal(store.state.archive.length, 1);
  store.restore(store.state.archive[0]);
  assert.equal(store.state.temporary.length, 1);
  assert.equal(store.state.archive.length, 0);
});

test('a restored note gets a deadline in the future', () => {
  const store = freshStore();
  const note = store.addTemporary({ title: 'Old', due: at(2020, 0, 1, 9, 0) });
  store.deleteTemporary(note.id);
  store.restore(store.state.archive[0]);
  assert.ok(store.state.temporary[0].due > Date.now(), 'would otherwise expire instantly');
});

test('export round-trips through JSON', () => {
  const store = freshStore();
  store.addTemporary({ title: 'Rent', due: at(2026, 7, 20, 18, 0) });
  store.addPermanent({ title: 'Walk', recurrence: { kind: 'daily' }, startDate: at(2026, 7, 1) });
  const text = store.exportJSON();
  const fresh = freshStore();
  assert.equal(fresh.importJSON(text, true), true);
  assert.equal(fresh.state.temporary.length, 1);
  assert.equal(fresh.state.permanent.length, 1);
});

test('importing junk is refused rather than clearing anything', () => {
  const store = freshStore();
  store.addTemporary({ title: 'Keep me', due: at(2026, 7, 20, 18, 0) });
  assert.equal(store.importJSON('not json at all', true), false);
  assert.equal(store.state.temporary.length, 1);
});

// ---------------------------------------------------------------------------
// Calendar export
// ---------------------------------------------------------------------------

test('ICS text uses CRLF and folds long lines', () => {
  const note = M.makeTemporary({ title: 'x'.repeat(300), due: at(2026, 7, 20, 18, 0) });
  const { text } = I.buildICS({ temporary: [note], permanent: [] });
  assert.ok(!/[^\r]\n/.test(text), 'every LF is preceded by CR');
  for (const line of text.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, 'line within 75 octets');
  }
});

test('ICS escapes the characters RFC 5545 reserves', () => {
  // String.raw throughout: a plain literal silently drops the backslash in
  // '\;', which is the exact trap that produced a malformed file first time.
  const note = M.makeTemporary({ title: String.raw`a;b,c\d`, due: at(2026, 7, 20, 18, 0) });
  const { text } = I.buildICS({ temporary: [note], permanent: [] });
  const summary = text.split('\r\n').find((l) => l.startsWith('SUMMARY'));
  assert.equal(summary, String.raw`SUMMARY:a\;b\,c\\d`);
});

test('each reminder becomes its own VALARM with the right trigger', () => {
  const note = M.makeTemporary({
    title: 'Rent', due: at(2026, 7, 20, 18, 0), reminders: [1440, 60, 0],
  });
  const { text } = I.buildICS({ temporary: [note], permanent: [] });
  const triggers = text.split('\r\n').filter((l) => l.startsWith('TRIGGER:'));
  assert.deepEqual(triggers, ['TRIGGER:-P1D', 'TRIGGER:-PT1H', 'TRIGGER:-PT0S']);
});

test('a recurring note becomes one event with an RRULE', () => {
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

test('a recurring event anchors on a day the pattern actually lands on', () => {
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

test('an all-day note uses DATE values, not times', () => {
  const note = M.makeTemporary({ title: 'Birthday', due: at(2026, 7, 20, 9, 0), isAllDay: true });
  const { text } = I.buildICS({ temporary: [note], permanent: [] });
  assert.ok(text.includes('DTSTART;VALUE=DATE:20260820'));
  assert.ok(text.includes('DTEND;VALUE=DATE:20260821'));
});

test('every RRULE kind produces a rule', () => {
  const kinds = ['daily', 'weekdays', 'weekends', 'everyNDays', 'dayOfMonth'];
  for (const kind of kinds) {
    const rule = I.rruleFor({ kind, weekdays: [1], interval: 3, dayOfMonth: 15 });
    assert.ok(rule && rule.startsWith('FREQ='), `${kind} -> ${rule}`);
  }
  assert.equal(I.rruleFor({ kind: 'selectedDays', weekdays: [] }), null, 'no days, no rule');
});

test('export offers a note once, then not again until it changes', () => {
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

test('export skips notes that are done or already past', () => {
  const store = freshStore();
  const past = store.addTemporary({ title: 'Past', due: Date.now() - M.DAY, linger: 'oneWeek' });
  const done = store.addTemporary({ title: 'Done', due: Date.now() + M.DAY });
  store.setDone(done.id, true);
  store.addTemporary({ title: 'Future', due: Date.now() + M.DAY });
  const batch = I.exportable(store.state, true);
  assert.deepEqual(batch.temporary.map((n) => n.title), ['Future']);
});

// ---------------------------------------------------------------------------
// Silent notes
// ---------------------------------------------------------------------------

test('a note with no reminders produces no reminder timetable entries', () => {
  const store = freshStore();
  store.addTemporary({
    title: 'Silent', due: at(2026, 7, 20, 18, 0), reminders: [], notifyOnExpiry: false,
  });
  const timetable = N.reminderTimetable(store.state, at(2026, 7, 18), 10);
  assert.equal(timetable.length, 0);
});

test('turning the expiry alert off removes the only entry a reminderless note had', () => {
  const store = freshStore();
  store.addTemporary({
    title: 'Expiring', due: at(2026, 7, 20, 18, 0), linger: 'oneDay',
    reminders: [], notifyOnExpiry: true,
  });
  assert.equal(N.reminderTimetable(store.state, at(2026, 7, 18), 10).length, 1);

  store.updateTemporary({ id: store.state.temporary[0].id, notifyOnExpiry: false });
  assert.equal(N.reminderTimetable(store.state, at(2026, 7, 18), 10).length, 0);
});

test('a silent permanent note never enters the timetable', () => {
  const store = freshStore();
  store.addPermanent({
    title: 'Quiet walk', recurrence: { kind: 'daily' },
    startDate: at(2026, 7, 1), reminders: [],
  });
  assert.equal(N.reminderTimetable(store.state, at(2026, 7, 18), 10).length, 0);
});

test('a silent note still exports to the calendar, just without an alarm', () => {
  const note = M.makeTemporary({ title: 'Silent', due: at(2026, 7, 20, 18, 0), reminders: [] });
  const { text, count } = I.buildICS({ temporary: [note], permanent: [] });
  assert.equal(count, 1, 'still an event');
  assert.ok(text.includes('SUMMARY:Silent'));
  assert.ok(!text.includes('BEGIN:VALARM'), 'but no alarm');
});

test('a silent note still appears on the schedule', () => {
  const note = M.makeTemporary({ title: 'Silent', due: at(2026, 7, 20, 18, 0), reminders: [] });
  const state = stateWith([note]);
  assert.equal(E.entriesOn(state, at(2026, 7, 20)).length, 1);
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
for (const failure of failures) console.log(`\n  FAIL  ${failure}`);
process.exit(failed ? 1 : 0);
