// screens.js — welcome, schedule, and the two notes sections.

import {
  TAGS, LINGERS, DAILY_OFFSETS, dailyOffsetLabel,
  startOfDay, addDays, addMonths, startOfMonth, sameDay, sameMonth,
  formatMonth, formatMonthYear, formatMonthDay, formatWeekday, formatDayHeadline,
  formatFull, formatTime, formatDuration, formatMinutes, countdown, dayName,
  recurrenceSummary, leadShort, leadLong,
} from './model.js';
import {
  entriesOn, markerFor, agenda, upcoming, gridDays, weekdayHeadings,
  monthsBetween, calendarBounds, nextOccurrence, rangeLabel,
} from './engine.js';
import { GROUP_LABELS } from './store.js';
import {
  h, mount, icon, pill, chip, emptyState, openSheet, confirmSheet, toast, leafMark,
  optionSlider, fieldBlock,
} from './ui.js';
import {
  openTemporaryWizard, openPermanentWizard, toDateValue, fromDateValue,
} from './wizard.js';

const AGENDA_HORIZON_DAYS = 180;

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------

export function welcomeScreen(app) {
  const store = app.store;
  const state = store.state;
  const now = state.now;

  let doorsOpen = false;
  const root = h('div.screen');

  function greeting() {
    const hour = new Date(now).getHours();
    if (hour < 5) return "Still up. Let's keep it light.";
    if (hour < 9) return "Early. The day's still folded up.";
    if (hour < 12) return 'Good morning.';
    if (hour < 17) return 'Good afternoon.';
    if (hour < 21) return 'Good evening.';
    return 'Winding down.';
  }

  function statusPill() {
    const count = store.attentionCount;
    if (count > 0) {
      return pill(count === 1 ? '1 thing needs you today' : `${count} things need you today`, 'clay', 'bell');
    }
    const next = upcoming(state, 7, 1)[0];
    if (next) return pill(`Next: ${next.title} · ${dayName(next.start, now)}`, 'moss', 'arrowRight');
    return pill('Nothing pressing', 'moss', 'leaf');
  }

  function door(title, subtitle, iconName, tone, count, noun, target) {
    return h('button.door', { type: 'button', onclick: () => app.enter(target) },
      h('div.glyph', { style: { background: `color-mix(in srgb, var(--${tone}) 16%, transparent)`, color: `var(--${tone})` } },
        icon(iconName, 20)),
      h('div.grow',
        h('strong', { text: title }),
        h('div.small.muted', { text: subtitle })),
      h('div.count',
        h('b', { text: String(count), style: { color: count > 0 ? `var(--${tone})` : 'var(--ink-3)' } }),
        h('span.tiny.faint', { text: noun })),
    );
  }

  function render() {
    mount(root, h('div.welcome',
      h('div.mark', leafMark(92)),
      h('h1', 'MySchedule'),
      h('div.greet', { text: greeting() }),
      h('div.date', { text: formatDayHeadline(now) }),
      statusPill(),

      doorsOpen
        ? h('div.doors',
          door('Temporary notes', 'Deadlines that clear themselves out', 'hourglass', 'clay',
            store.activeTemporary.filter((n) => !n.isDone).length, 'waiting', 'temporary'),
          door('Permanent notes', 'Standing arrangements that never lapse', 'leaf', 'moss',
            state.permanent.filter((n) => !n.isMuted).length, 'standing', 'permanent'),
          door('Daily reminders', 'A word left for tomorrow morning', 'sunrise', 'gold',
            store.upcomingDaily.length, 'waiting', 'daily'),
          door('The schedule', "Everything you've written, laid out by day", 'calendar', 'sky',
            entriesOn(state, now).length, 'today', 'schedule'))
        : h('div', { style: { width: '100%', maxWidth: '340px' } },
          h('button.btn.wide', {
            type: 'button',
            onclick: () => {
              if (state.settings.startTab === 'ask') { doorsOpen = true; render(); }
              else app.enter(state.settings.startTab);
            },
          }, 'Step in', icon('arrowRight', 15)),
          h('div.small.faint', { style: { marginTop: '12px' }, text: 'Then choose where to begin' })),

      h('div', { style: { display: 'flex', gap: '16px' } },
        doorsOpen && h('button.small.faint', { type: 'button', onclick: () => { doorsOpen = false; render(); } }, 'Back'),
        h('button.small.faint', { type: 'button', onclick: () => app.enter('settings') }, 'Settings')),
    ));
  }

  render();
  return root;
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export function scheduleScreen(app) {
  const store = app.store;
  const state = store.state;
  const root = h('div.screen');

  const bounds = calendarBounds(state);
  const months = monthsBetween(bounds.start, bounds.end);
  const today = startOfDay(state.now);

  if (app.view.month == null) {
    const match = months.find((m) => sameMonth(m, app.view.focus || today));
    app.view.month = match != null ? match : (months[0] || startOfMonth(today));
  }
  if (app.view.focus == null) app.view.focus = today;

  function monthIndex() {
    return months.findIndex((m) => sameMonth(m, app.view.month));
  }

  function stepMonth(delta) {
    const index = monthIndex();
    const target = index + delta;
    if (target < 0 || target >= months.length) return;
    app.view.month = months[target];
    // Move the selected day with the month, so the panel below never shows a
    // day you can no longer see.
    if (!sameMonth(app.view.focus, app.view.month)) {
      app.view.focus = sameMonth(app.view.month, state.now) ? today : app.view.month;
    }
    render();
  }

  function monthBar() {
    const index = monthIndex();
    return h('div.monthbar',
      h('button.iconbtn', {
        type: 'button', 'aria-label': 'Previous month',
        disabled: index <= 0, onclick: () => stepMonth(-1),
      }, icon('left', 14)),
      h('div', { style: { minWidth: '110px' } },
        h('div.name', { text: formatMonth(app.view.month) }),
        h('div.year', { text: String(new Date(app.view.month).getFullYear()) })),
      h('button.iconbtn', {
        type: 'button', 'aria-label': 'Next month',
        disabled: index < 0 || index >= months.length - 1, onclick: () => stepMonth(1),
      }, icon('right', 14)),
      h('button.btn.soft', {
        type: 'button',
        style: { marginLeft: 'auto', padding: '9px 15px', fontSize: '13px' },
        onclick: () => {
          const match = months.find((m) => sameMonth(m, state.now));
          if (match != null) app.view.month = match;
          app.view.focus = today;
          render();
        },
      }, 'Today'),
    );
  }

  function modeRow() {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: `0 var(--gutter) 12px` } },
      chip('Month', app.view.mode !== 'agenda', () => { app.view.mode = 'month'; render(); }),
      chip('Agenda', app.view.mode === 'agenda', () => { app.view.mode = 'agenda'; render(); }),
      h('div.legend',
        h('span', h('i', { style: { background: 'var(--clay)' } }), 'Temporary'),
        h('span', h('i', { style: { background: 'var(--moss)' } }), 'Permanent')),
    );
  }

  function monthGrid() {
    const days = gridDays(app.view.month, state.settings.weekStartsOnMonday);
    const monthNumber = new Date(app.view.month).getMonth();

    const head = h('div.weekhead');
    for (const label of weekdayHeadings(state.settings.weekStartsOnMonday)) {
      head.appendChild(h('div', { text: label }));
    }

    const grid = h('div.grid');
    for (const day of days) {
      const marker = markerFor(state, day);
      const inMonth = new Date(day).getMonth() === monthNumber;
      const classes = [
        'day',
        inMonth ? '' : 'outside',
        sameDay(day, state.now) ? 'today' : '',
        sameDay(day, app.view.focus) ? 'selected' : '',
        marker.overdue > 0 ? 'has-overdue' : '',
      ].filter(Boolean).join('.');

      const dots = h('div.dots');
      for (const tag of marker.tags.slice(0, 3)) {
        dots.appendChild(h('i', { style: { background: `var(--tag-${tag})` } }));
      }
      if (marker.tags.length > 3) dots.appendChild(h('span.tiny.faint', '+'));

      grid.appendChild(h(`button.${classes}`, {
        type: 'button',
        'aria-label': formatDayHeadline(day),
        onclick: () => { app.view.focus = day; render(); },
      },
      h('div.num', { text: String(new Date(day).getDate()) }),
      dots));
    }

    return h('div', head, grid);
  }

  function dayPanel() {
    const entries = entriesOn(state, app.view.focus);
    const isToday = sameDay(app.view.focus, state.now);

    const head = h('div.dayhead',
      h('div.big', { class: isToday ? 'big today' : 'big', text: String(new Date(app.view.focus).getDate()) }),
      h('div',
        h('div', { style: { fontWeight: 600 }, text: formatWeekday(app.view.focus) }),
        h('div.tiny.faint', { text: formatMonthYear(app.view.focus) })),
      isToday && pill('Today', 'moss'),
      h('div.tiny.faint', { style: { marginLeft: 'auto' }, text: entries.length ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : '' }),
    );

    const list = h('div');
    if (!entries.length) {
      list.appendChild(h('div.empty', { style: { padding: '30px 10px' } },
        h('p.small.faint', 'Nothing on this day.'),
        h('p.tiny.faint', 'Write a note and it will land here on its own.')));
    } else {
      for (const entry of entries) list.appendChild(entryRow(app, entry));
    }

    return h('div.daypanel', h('div.scroll', head, list));
  }

  function agendaView() {
    const from = Math.max(today, startOfDay(app.view.focus));
    const end = Math.min(addDays(from, AGENDA_HORIZON_DAYS), bounds.end);
    const groups = agenda(state, from, Math.max(from, end));

    const list = h('div.scroll');
    if (!groups.length) {
      list.appendChild(emptyState('spark', 'The road ahead is clear',
        `Nothing is scheduled between now and ${formatMonthDay(end)}.`));
    } else {
      for (const group of groups) {
        list.appendChild(h('div', { style: { marginBottom: '18px' } },
          h('div.dayhead',
            h('div.big', { class: sameDay(group.day, state.now) ? 'big today' : 'big', text: String(new Date(group.day).getDate()) }),
            h('div',
              h('div', { style: { fontWeight: 600 }, text: formatWeekday(group.day) }),
              h('div.tiny.faint', { text: formatMonthYear(group.day) })),
            sameDay(group.day, state.now) && pill('Today', 'moss')),
          ...group.entries.map((entry) => entryRow(app, entry))));
      }
      list.appendChild(h('p.tiny.faint', { style: { textAlign: 'center', paddingTop: '6px' },
        text: `Showing the next ${AGENDA_HORIZON_DAYS} days. Switch to Month to look further out.` }));
    }
    return list;
  }

  function render() {
    const empty = !state.temporary.length && !state.permanent.length;
    mount(root,
      h('div.topbar', h('h1', 'Schedule')),
      monthBar(),
      modeRow(),
      empty
        ? h('div.scroll', emptyState('leaf', 'Your schedule is empty',
          'This screen is never edited directly. Write something in Temporary or Permanent notes and it appears here on the right day, automatically.'))
        : (app.view.mode === 'agenda' ? agendaView() : h('div', { style: { display: 'contents' } }, monthGrid(), dayPanel())),
    );
  }

  render();
  return root;
}

// ---------------------------------------------------------------------------
// A row on the schedule
// ---------------------------------------------------------------------------

function entryRow(app, entry) {
  const classes = ['note', entry.isOverdue ? 'overdue' : '', entry.isDone ? 'done' : ''].filter(Boolean).join('.');

  const meta = h('div.meta');
  if (entry.recurrenceSummary) meta.appendChild(h('span.tiny.faint', icon('repeat', 11), ' ', entry.recurrenceSummary));
  if (!entry.isAllDay) meta.appendChild(h('span.tiny.faint', icon('clock', 11), ' ', rangeLabel(entry)));
  if (entry.expiresAt) meta.appendChild(h('span.tiny.faint', icon('wind', 11), ' ', `Clears ${dayName(entry.expiresAt, app.store.state.now)}`));

  return h(`button.${classes}`, { type: 'button', onclick: () => openInspector(app, entry) },
    h('div.rail', { style: { background: `var(--tag-${entry.tag})` } }),
    h('div.grow',
      h('div.meta',
        h('span.small', { style: { fontWeight: 600, color: entry.isOverdue ? 'var(--clay)' : 'var(--ink-2)' },
          text: entry.isAllDay ? 'All day' : formatTime(entry.start) }),
        entry.isOverdue && pill('Past due', 'clay')),
      h('div.title', { text: entry.title }),
      entry.details && h('div.small.muted', { text: entry.details }),
      meta),
  );
}

// ---------------------------------------------------------------------------
// Inspector — tapping anything opens the note behind it
// ---------------------------------------------------------------------------

export function openInspector(app, entry) {
  const store = app.store;
  const isTemporary = entry.kind === 'temporary';
  const note = isTemporary
    ? store.state.temporary.find((n) => n.id === entry.noteId)
    : store.state.permanent.find((n) => n.id === entry.noteId);

  openSheet((sheet) => {
    mount(sheet.head,
      h('span', { style: { width: '54px' } }),
      h('div.mid', h('strong', { text: isTemporary ? 'Temporary' : 'Permanent' })),
      h('button.primary', { type: 'button', onclick: sheet.close }, 'Done'));

    if (!note) {
      mount(sheet.body, h('p.muted', 'This note is no longer in your list. It may have expired while the app was closed.'));
      return;
    }

    const facts = h('div.settings-group');
    const fact = (iconName, label, value) => h('div.pad', { style: { display: 'flex', gap: '11px', alignItems: 'flex-start' } },
      h('span', { style: { color: 'var(--ink-3)', flex: 'none' } }, icon(iconName, 14)),
      h('span.small.faint', { style: { width: '76px', flex: 'none' }, text: label }),
      h('span.small', { text: value }));

    facts.appendChild(fact('calendar', 'On', formatDayHeadline(entry.day)));
    facts.appendChild(fact('clock', 'Time', rangeLabel(entry)));

    if (isTemporary) {
      facts.appendChild(fact('wind', 'Clears',
        note.linger === 'atDue' ? "The moment it's due" : formatFull(note.expiresAt)));
    } else {
      facts.appendChild(fact('repeat', 'Repeats', recurrenceSummary(note.recurrence)));
      facts.appendChild(fact('hourglass', 'Holds', formatDuration(note.durationMinutes)));
    }
    facts.appendChild(fact(note.reminders.length ? 'bell' : 'bellOff', 'Reminders',
      note.reminders.length ? note.reminders.map(leadLong).join(', ') : 'None'));

    mount(sheet.body,
      h('div.card.raised', { style: { marginBottom: '16px' } },
        h('div.meta', { style: { marginBottom: '8px' } },
          h('i', { style: { width: '10px', height: '10px', borderRadius: '50%', background: `var(--tag-${note.tag})`, display: 'block' } }),
          h('span.tiny', { style: { letterSpacing: '0.1em', color: isTemporary ? 'var(--clay)' : 'var(--moss)', fontWeight: 700 },
            text: isTemporary ? 'TEMPORARY' : 'PERMANENT' }),
          entry.isOverdue && pill('Past due', 'clay')),
        h('h2', { style: { fontSize: '22px', fontWeight: 700 }, text: note.title }),
        note.details && h('p.muted', { style: { marginTop: '8px' }, text: note.details })),
      facts);

    const actions = [];
    if (isTemporary) {
      actions.push(h('button.btn.wide', {
        type: 'button',
        onclick: () => { store.setDone(note.id, !note.isDone); sheet.close(); },
      }, icon(note.isDone ? 'undo' : 'check', 15), note.isDone ? 'Mark as not done' : 'Mark as done'));
    }
    actions.push(h('button.btn.soft.wide', {
      type: 'button',
      onclick: () => {
        sheet.close();
        if (isTemporary) {
          openTemporaryWizard({
            editing: note, settings: store.state.settings,
            onSave: (fields) => { store.updateTemporary(fields); app.afterEdit(); },
          });
        } else {
          openPermanentWizard({
            editing: note, settings: store.state.settings,
            onSave: (fields) => { store.updatePermanent(fields); app.afterEdit(); },
          });
        }
      },
    }, 'Edit this note'));

    if (!isTemporary) {
      actions.push(h('button.btn.soft.wide', {
        type: 'button',
        onclick: () => { store.setMuted(note.id, !note.isMuted); sheet.close(); },
      }, icon(note.isMuted ? 'play' : 'pause', 14), note.isMuted ? 'Resume this note' : 'Pause this note'));
      actions.push(h('p.tiny.faint', { style: { textAlign: 'center' },
        text: 'Permanent notes never expire. Pausing hides one without removing it.' }));
    }

    actions.push(h('button.btn.danger', {
      type: 'button',
      onclick: () => {
        sheet.close();
        confirmSheet({
          title: isTemporary ? 'Remove this note?' : 'Remove this standing note?',
          message: isTemporary
            ? 'It moves to Recently cleared, where you can bring it back.'
            : "Permanent notes don't expire, so this is the only way one comes off your schedule. A copy stays in Recently cleared.",
          confirmLabel: isTemporary ? 'Remove' : 'Remove permanently',
          onConfirm: () => {
            if (isTemporary) store.deleteTemporary(note.id);
            else store.deletePermanent(note.id);
          },
        });
      },
    }, icon('trash', 14), 'Remove'));

    mount(sheet.foot, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px', width: '100%' } }, ...actions));
  });
}

// ---------------------------------------------------------------------------
// Temporary notes
// ---------------------------------------------------------------------------

export function temporaryScreen(app) {
  const store = app.store;
  const state = store.state;
  const root = h('div.screen');
  const groups = store.groupedTemporary();

  const body = h('div.scroll');

  if (!store.activeTemporary.length) {
    body.appendChild(emptyState('hourglass', 'Nothing on the clock',
      "Write a note below and press return. You'll be asked which day it's due, what time, and how long it should linger before clearing itself."));
  } else {
    const count = (name) => (groups.find((g) => g.group === name)?.notes.length) || 0;
    body.appendChild(h('div.stats', { style: { marginTop: '4px' } },
      h('div.stat', h('b', { style: { color: count('overdue') ? 'var(--clay)' : 'var(--ink-3)' }, text: String(count('overdue')) }), h('span', 'past due')),
      h('div.stat', h('b', { style: { color: count('today') ? 'var(--gold)' : 'var(--ink-3)' }, text: String(count('today')) }), h('span', 'today')),
      h('div.stat', h('b', { style: { color: 'var(--moss)' }, text: String(store.activeTemporary.filter((n) => !n.isDone).length) }), h('span', 'open'))));

    for (const group of groups) {
      const tone = group.group === 'overdue' ? '.clay' : (group.group === 'done' ? '.moss' : '');
      body.appendChild(h(`div.section-label${tone}`, { text: GROUP_LABELS[group.group] }));
      for (const note of group.notes) body.appendChild(temporaryRow(app, note));
    }
  }

  mount(root,
    h('div.topbar', h('h1', 'Temporary')),
    body,
    composer(app, {
      tone: 'clay',
      iconName: 'hourglass',
      placeholder: 'Something with a deadline…',
      hint: 'Return opens the date, time and expiry questions.',
      onSubmit: (text) => openTemporaryWizard({
        seed: text,
        settings: state.settings,
        onSave: (fields) => { store.addTemporary(fields); app.afterAdd(); },
      }),
    }),
  );

  return root;
}

function temporaryRow(app, note) {
  const store = app.store;
  const now = store.state.now;
  const overdue = !note.isDone && note.due < now;
  const classes = ['note', overdue ? 'overdue' : '', note.isDone ? 'done' : ''].filter(Boolean).join('.');

  const check = h('button.check', {
    type: 'button',
    'aria-pressed': note.isDone ? 'true' : 'false',
    'aria-label': note.isDone ? 'Mark as not done' : 'Mark as done',
    onclick: (event) => { event.stopPropagation(); store.setDone(note.id, !note.isDone); },
  }, icon('check', 14));

  return h(`div.${classes}`,
    h('div.rail', { style: { background: `var(--tag-${note.tag})` } }),
    h('button.grow', {
      type: 'button',
      style: { textAlign: 'left', background: 'none' },
      onclick: () => openInspector(app, {
        kind: 'temporary', noteId: note.id, title: note.title, details: note.details,
        day: startOfDay(note.due), start: note.due, end: note.expiresAt,
        isAllDay: note.isAllDay, tag: note.tag, isDone: note.isDone, isOverdue: overdue,
        recurrenceSummary: null, expiresAt: note.expiresAt,
      }),
    },
    h('div.title', { text: note.title }),
    note.details && h('div.small.muted', { text: note.details }),
    h('div.meta',
      pill(`${dayName(note.due, now)} · ${note.isAllDay ? 'all day' : formatTime(note.due)}`,
        overdue ? 'clay' : 'moss', note.isAllDay ? 'sunrise' : 'clock'),
      !note.isDone && h('span.tiny', { style: { color: overdue ? 'var(--clay)' : 'var(--ink-3)' }, text: countdown(note.due, now) })),
    h('div.meta',
      h('span.tiny.faint', icon(note.reminders.length ? 'bell' : 'bellOff', 11), ' ',
        note.reminders.length ? note.reminders.map(leadShort).join(' · ') : 'No reminders'),
      h('span.tiny.faint', icon('wind', 11), ' ', `Clears ${dayName(note.expiresAt, now)}`))),
    check,
  );
}

// ---------------------------------------------------------------------------
// Permanent notes
// ---------------------------------------------------------------------------

export function permanentScreen(app) {
  const store = app.store;
  const state = store.state;
  const root = h('div.screen');
  const body = h('div.scroll');

  if (!state.permanent.length) {
    body.appendChild(emptyState('leaf', 'No standing notes yet',
      "Write one below and press return. You'll be asked which days it appears, what time of day, and how long it holds its place. After that it simply stays."));
  } else {
    body.appendChild(h('div.summary', { style: { marginTop: '4px' } },
      icon('infinity', 16),
      h('div',
        h('strong', 'These never lapse'),
        h('div.small.muted', 'A permanent note keeps its place until you remove it by hand. Pause one to hide it without losing it.'))));

    body.appendChild(h('div.section-label', { text: `${state.permanent.length} standing` }));
    for (const note of store.sortedPermanent) body.appendChild(permanentRow(app, note));
  }

  mount(root,
    h('div.topbar', h('h1', 'Permanent')),
    body,
    composer(app, {
      tone: '',
      iconName: 'leaf',
      placeholder: 'Something that comes round again…',
      hint: 'Return asks which days, what time, and how long it holds.',
      onSubmit: (text) => openPermanentWizard({
        seed: text,
        settings: state.settings,
        onSave: (fields) => { store.addPermanent(fields); app.afterAdd(); },
      }),
    }),
  );

  return root;
}

function permanentRow(app, note) {
  const store = app.store;
  const now = store.state.now;
  const next = nextOccurrence(note, now);
  const classes = ['note', note.isMuted ? 'muted-note' : ''].filter(Boolean).join('.');

  return h(`button.${classes}`, {
    type: 'button',
    onclick: () => openInspector(app, {
      kind: 'permanent', noteId: note.id, title: note.title, details: note.details,
      day: next != null ? startOfDay(next) : note.startDate,
      start: next != null ? next : note.startDate,
      end: (next != null ? next : note.startDate) + note.durationMinutes * 60000,
      isAllDay: note.durationMinutes >= 1440, tag: note.tag, isDone: false, isOverdue: false,
      recurrenceSummary: recurrenceSummary(note.recurrence), expiresAt: null,
    }),
  },
  h('div.rail', { style: { background: `var(--tag-${note.tag})` } }),
  h('div.grow',
    h('div.meta',
      h('span.title', { text: note.title }),
      note.isMuted && pill('Paused', 'grey', 'pause')),
    note.details && h('div.small.muted', { text: note.details }),
    h('div.meta',
      pill(recurrenceSummary(note.recurrence), 'moss', 'repeat'),
      h('span.tiny.faint', { text: note.durationMinutes >= 1440 ? 'All day' : `${formatMinutes(note.startMinutes)} · ${formatDuration(note.durationMinutes)}` })),
    h('div.meta',
      h('span.tiny.faint', icon(note.reminders.length ? 'bell' : 'bellOff', 11), ' ',
        note.reminders.length ? note.reminders.map(leadShort).join(' · ') : 'Silent'),
      next != null && h('span.tiny.faint', icon('arrowRight', 11), ' ', `Next ${dayName(next, now)}`))),
  );
}

// ---------------------------------------------------------------------------
// Daily reminders — a note you leave tonight for tomorrow-morning-you
// ---------------------------------------------------------------------------

export function dailyScreen(app) {
  const store = app.store;
  const state = store.state;
  const root = h('div.screen');
  const body = h('div.scroll');

  const upcoming = store.upcomingDaily;
  const delivered = store.deliveredDaily;

  if (!upcoming.length && !delivered.length) {
    body.appendChild(emptyState('sunrise', 'Nothing waiting for the morning',
      'Write something below before you turn in. The next time you open the app on that day, it greets you straight after the welcome screen — once, then it stands down.'));
  } else {
    body.appendChild(h('div.summary', { style: { marginTop: '4px' } },
      icon('sunrise', 16),
      h('div',
        h('strong', 'Left for the morning'),
        h('div.small.muted', 'Each one greets you once, the first time you open the app on its day. Sleep through it and it still waits.'))));

    if (upcoming.length) {
      body.appendChild(h('div.section-label', { text: `${upcoming.length} waiting` }));
      for (const reminder of upcoming) body.appendChild(dailyRow(app, reminder, false));
    }

    if (delivered.length) {
      body.appendChild(h('div.section-label.moss', { text: 'Already said' }));
      for (const reminder of delivered) body.appendChild(dailyRow(app, reminder, true));
    }
  }

  mount(root,
    h('div.topbar', h('h1', 'Daily')),
    body,
    composer(app, {
      tone: '',
      iconName: 'sunrise',
      placeholder: 'Something for tomorrow morning…',
      hint: 'Return asks which morning it should greet you.',
      onSubmit: (text) => openDailySheet(app, { seed: text }),
    }),
  );

  return root;
}

function dailyRow(app, reminder, delivered) {
  const now = app.store.state.now;
  const today = startOfDay(now);
  const late = !reminder.seenAt && reminder.forDate < today;

  return h(`button.note${delivered ? '.done' : ''}`, {
    type: 'button',
    onclick: () => openDailySheet(app, { editing: reminder }),
  },
  h('div.rail', { style: { background: delivered ? 'var(--tag-bark)' : 'var(--tag-gold)' } }),
  h('div.grow',
    h('div.title', { text: reminder.text }),
    h('div.meta',
      delivered
        ? pill(`Said ${dayName(reminder.seenAt, now)}`, 'grey', 'check')
        : pill(dayName(reminder.forDate, now), late ? 'clay' : 'moss', 'sunrise'),
      late && h('span.tiny', { style: { color: 'var(--clay)' }, text: 'still waiting' }),
      h('span.tiny.faint', { text: `written ${dayName(reminder.createdAt, now).toLowerCase()}` }))),
  );
}

/** One question: which morning. */
export function openDailySheet(app, { seed, editing }) {
  const store = app.store;
  const today = startOfDay(store.state.now || Date.now());

  const draft = editing
    ? {
      id: editing.id,
      text: editing.text,
      forDate: editing.forDate,
      offset: Math.max(0, Math.round((editing.forDate - today) / 86400000)),
      createdAt: editing.createdAt,
      seenAt: editing.seenAt,
    }
    : { text: seed || '', forDate: addDays(today, 1), offset: 1 };

  openSheet((sheet) => {
    const textInput = h('input.textinput', {
      value: draft.text,
      placeholder: 'What should tomorrow-you know?',
      'aria-label': 'Reminder',
      oninput: (event) => {
        draft.text = event.target.value;
        save.disabled = !draft.text.trim();
      },
    });

    const save = h('button.btn', { type: 'button' }, editing ? 'Save' : 'Leave it for the morning');

    // The field lives in a card that is built once and never rebuilt. Anything
    // that re-mounts a container holding a focused input detaches it from the
    // document, and iOS closes the keyboard the moment that happens — so the
    // only safe guarantee is that this element is never re-created at all.
    const header = h('div.card.raised', { style: { marginBottom: '18px' } },
      h('div.tiny.faint', { style: { letterSpacing: '0.08em', marginBottom: '7px' },
        text: 'DAILY · GREETS YOU ONCE' }),
      textInput);

    // Everything that does change on re-render lives in here instead.
    const options = h('div');

    mount(sheet.body, header, options);

    function render() {
      mount(sheet.head,
        h('button', { type: 'button', onclick: sheet.close }, 'Cancel'),
        h('div.mid', h('strong', { text: editing ? 'Edit reminder' : 'Daily reminder' })),
        h('span', { style: { width: '54px' } }));

      const nearestOffset = DAILY_OFFSETS.includes(draft.offset) ? draft.offset : 1;

      mount(options,
        fieldBlock('Which morning?', 'Set it tonight and it meets you when you open the app.',
          optionSlider({
            options: DAILY_OFFSETS,
            value: nearestOffset,
            format: dailyOffsetLabel,
            label: 'Greet me',
            onInput: (days) => {
              draft.offset = days;
              draft.forDate = addDays(today, days);
            },
            onCommit: render,
          }),
          h('div', { style: { marginTop: '12px' } },
            h('input', {
              type: 'date',
              value: toDateValue(draft.forDate),
              'aria-label': 'Exact morning',
              onchange: (event) => {
                const parsed = fromDateValue(event.target.value);
                if (parsed != null) {
                  draft.forDate = parsed;
                  draft.offset = Math.round((draft.forDate - today) / 86400000);
                  render();
                }
              },
            }))),

        h('div.summary',
          icon('sunrise', 16),
          h('div',
            h('strong', { text: `Greets you on ${formatDayHeadline(draft.forDate)}` }),
            h('div.small.muted', {
              text: draft.forDate <= today
                ? 'That is today — it will show the next time you open the app.'
                : 'Straight after the welcome screen, once.',
            }))),
      );

      save.disabled = !draft.text.trim();
      save.onclick = () => {
        if (!draft.text.trim()) return;
        const fields = {
          id: draft.id,
          text: draft.text.trim(),
          forDate: draft.forDate,
          createdAt: draft.createdAt,
          seenAt: draft.seenAt,
        };
        if (editing) store.updateDaily(fields);
        else store.addDaily(fields);
        sheet.close();
        app.render();
      };

      mount(sheet.foot,
        editing && h('button.btn.soft', {
          type: 'button',
          onclick: () => {
            sheet.close();
            confirmSheet({
              title: 'Remove this reminder?',
              message: 'It will not greet you.',
              onConfirm: () => { store.deleteDaily(editing.id); app.render(); },
            });
          },
        }, icon('trash', 14)),
        save);
    }

    render();
  });
}

/**
 * The morning greeting. Shown once, after the welcome screen, on the day a
 * reminder was left for.
 */
export function dailyGreeting(app, reminders, onDone) {
  const now = app.store.state.now || Date.now();
  const today = startOfDay(now);
  const hour = new Date(now).getHours();
  const opening = hour < 12 ? 'Good morning.' : (hour < 18 ? 'Before the day gets away.' : 'A word from last night.');

  const overlay = h('div.greeting',
    h('div.greeting-bg', { html: GREETING_RIDGES }),
    h('div.greeting-inner',
      h('div.mark', leafMark(58)),
      h('div.date', { text: formatDayHeadline(now) }),
      h('h1', { text: opening }),
      h('p.muted', { text: reminders.length === 1
        ? 'You left yourself a note.'
        : `You left yourself ${reminders.length} notes.` }),

      h('div.greeting-list',
        ...reminders.map((reminder) => h('div.card.raised.greeting-card',
          h('div.rail', { style: { background: 'var(--tag-gold)' } }),
          h('div.grow',
            h('div', { text: reminder.text }),
            reminder.forDate < today && h('div.tiny.faint', { style: { marginTop: '5px' },
              text: `Left for ${dayName(reminder.forDate, now)} — it waited for you.` }))))),

      h('button.btn.wide', {
        type: 'button',
        onclick: () => {
          app.store.markDailySeen(reminders.map((r) => r.id));
          overlay.remove();
          if (onDone) onDone();
        },
      }, 'Begin the day', icon('arrowRight', 15)),
    ),
  );

  document.body.appendChild(overlay);
  return overlay;
}

const GREETING_RIDGES = `
<svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 20 Q 16 12 30 19 T 58 17 T 84 21 T 100 16 L100 40 L0 40 Z"
        fill="var(--moss)" opacity="0.12"/>
  <path d="M0 28 Q 20 22 36 28 T 68 26 T 100 27 L100 40 L0 40 Z"
        fill="var(--moss)" opacity="0.15"/>
</svg>`;

// ---------------------------------------------------------------------------
// Compose bar
// ---------------------------------------------------------------------------

function composer(app, { tone, iconName, placeholder, hint, onSubmit }) {
  const input = h('input', {
    type: 'text',
    placeholder,
    'aria-label': placeholder,
    enterkeyhint: 'next',
    autocapitalize: 'sentences',
    autocomplete: 'off',
  });

  const send = h('button.send', { type: 'button', 'aria-label': 'Continue', disabled: true }, icon('send', 27));
  const hintEl = h('div.hint', { text: hint, style: { display: 'none' } });

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    send.disabled = true;
    hintEl.style.display = 'none';
    input.blur();
    onSubmit(text);
  }

  input.addEventListener('input', () => {
    send.disabled = !input.value.trim();
    hintEl.style.display = input.value.trim() ? 'block' : 'none';
  });
  input.addEventListener('focus', () => { hintEl.style.display = 'block'; });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submit(); }
  });
  send.addEventListener('click', submit);

  const form = h(`div.composer${tone ? '.' + tone : ''}`,
    h('div.field', h('span', { style: { color: tone ? `var(--${tone})` : 'var(--moss)', display: 'flex' } }, icon(iconName, 16)), input, send),
    hintEl);

  return form;
}
