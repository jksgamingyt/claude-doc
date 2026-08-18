// wizard.js — the two three-step flows.
//
// Type a note, press return, and the app asks the questions it needs. Temporary
// notes are asked which day, what time, and how long they linger. Permanent
// notes are asked which days, what time of day, and how long they hold their
// place. Nothing is saved until the last step.

import {
  TAGS, TAG_KEYS, REMINDER_PRESETS, LINGERS, LINGER_KEYS, RECURRENCE_KINDS,
  leadShort, leadLong, expiryFor, defaultRecurrence, recurrenceSummary,
  formatFull, formatMinutes, formatMonthDay, formatDayHeadline, formatDuration,
  countdown, dayName, startOfDay, addDays, weekdayNarrow, minutesOfDay,
  ALL_DAY_MINUTES, MINUTE,
} from './model.js';
import { nextOccurrence } from './engine.js';
import {
  h, mount, icon, chip, fieldBlock, summaryCard, openSheet, toast,
} from './ui.js';

// ---------------------------------------------------------------------------
// Native input helpers
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

export function toDateValue(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateValue(value) {
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

export function toTimeValue(minutes) {
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}

export function fromTimeValue(value) {
  const [hh, mm] = String(value).split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

const DAY_SHORTCUTS = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
  { label: 'In a month', days: 30 },
];

const TIME_SHORTCUTS = [7 * 60, 9 * 60, 12 * 60, 15 * 60, 18 * 60, 21 * 60];

const DURATIONS = [15, 30, 60, 90, 120, 180, 240, ALL_DAY_MINUTES];

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

function runWizard({ title, subtitle, tone, steps, draft, onFinish, finishLabel }) {
  openSheet((sheet) => {
    let step = 0;

    const titleInput = h('input.textinput', {
      value: draft.title,
      placeholder: 'Your note',
      'aria-label': 'Note',
      oninput: (event) => { draft.title = event.target.value; refresh(); },
    });

    const stepDots = h(`div.steps${tone ? '.' + tone : ''}`);
    const backBtn = h('button.btn.soft', { type: 'button', onclick: () => go(step - 1) }, 'Back');
    const nextBtn = h(`button.btn${tone ? '.' + tone : ''}`, { type: 'button' });

    function canAdvance() {
      if (!draft.title.trim()) return false;
      const guard = steps[step].guard;
      return guard ? guard(draft) : true;
    }

    function go(next) {
      step = Math.max(0, Math.min(steps.length - 1, next));
      refresh();
    }

    function refresh() {
      mount(stepDots, ...steps.map((_, index) => h(`i${index <= step ? '.on' : ''}`,
        { class: index === step ? 'current' : '' })));

      backBtn.classList.toggle('hidden', step === 0);

      const last = step === steps.length - 1;
      mount(nextBtn, last ? finishLabel : 'Next', icon(last ? 'check' : 'right', 14));
      nextBtn.disabled = !canAdvance();
      nextBtn.onclick = () => {
        if (!canAdvance()) return;
        if (last) {
          onFinish(draft);
          sheet.close();
        } else {
          go(step + 1);
        }
      };

      mount(sheet.body,
        h('div.card.raised', { style: { marginBottom: '18px' } },
          h('div.tiny.faint', { text: subtitle, style: { letterSpacing: '0.08em', marginBottom: '7px' } }),
          titleInput),
        steps[step].render(draft, refresh),
      );
    }

    mount(sheet.head,
      h('button', { type: 'button', onclick: sheet.close }, 'Cancel'),
      h('div.mid', h('strong', { text: title }), stepDots),
      h('span', { style: { width: '54px' } }),
    );
    mount(sheet.foot, backBtn, nextBtn);
    refresh();
  });
}

function reminderPicker(draft, refresh, tone, emptyMessage) {
  const chips = h('div.chips');
  for (const minutes of REMINDER_PRESETS) {
    const on = draft.reminders.includes(minutes);
    chips.appendChild(chip(leadShort(minutes), on, () => {
      draft.reminders = on
        ? draft.reminders.filter((m) => m !== minutes)
        : [...draft.reminders, minutes].sort((a, b) => b - a);
      refresh();
    }, { tone }));
  }

  const sorted = draft.reminders.slice().sort((a, b) => b - a);
  const words = sorted.map((m) => leadLong(m).toLowerCase());
  let summary;
  if (!sorted.length) summary = emptyMessage;
  else if (words.length === 1) summary = `You'll be nudged ${words[0]}.`;
  else summary = `You'll be nudged ${words.slice(0, -1).join(', ')}, then ${words[words.length - 1]}.`;

  return h('div',
    chips,
    h('div.small.muted', { style: { marginTop: '10px', display: 'flex', gap: '6px' } },
      icon(sorted.length ? 'bell' : 'bellOff', 13), summary),
  );
}

function tagPicker(draft, refresh) {
  const row = h('div.swatches');
  for (const key of TAG_KEYS) {
    row.appendChild(h('button.swatch', {
      type: 'button',
      'aria-pressed': draft.tag === key ? 'true' : 'false',
      'aria-label': TAGS[key].name,
      style: { color: `var(--tag-${key})` },
      onclick: () => { draft.tag = key; refresh(); },
    }, h('i', { style: { background: `var(--tag-${key})` } })));
  }
  return row;
}

function detailsField(draft) {
  return h('textarea.textarea', {
    placeholder: 'Details (optional)',
    'aria-label': 'Details',
    oninput: (event) => { draft.details = event.target.value; },
  }, draft.details);
}

// ---------------------------------------------------------------------------
// Temporary
// ---------------------------------------------------------------------------

export function openTemporaryWizard({ seed, editing, settings, onSave }) {
  const now = Date.now();
  const hour = new Date(now).getHours();
  const defaultDay = hour < 20 ? startOfDay(now) : addDays(startOfDay(now), 1);
  const defaultMinutes = hour < 20 ? Math.min(21 * 60, (hour + 2) * 60) : 9 * 60;

  const draft = editing
    ? {
      id: editing.id,
      title: editing.title,
      details: editing.details,
      day: startOfDay(editing.due),
      minutes: minutesOfDay(editing.due),
      isAllDay: editing.isAllDay,
      linger: editing.linger,
      reminders: editing.reminders.slice(),
      notifyOnExpiry: editing.notifyOnExpiry,
      tag: editing.tag,
      createdAt: editing.createdAt,
      isDone: editing.isDone,
      doneAt: editing.doneAt,
    }
    : {
      title: seed || '',
      details: '',
      day: defaultDay,
      minutes: defaultMinutes,
      isAllDay: false,
      linger: settings.defaultLinger,
      reminders: settings.defaultTemporaryReminders.slice(),
      notifyOnExpiry: settings.notifyOnExpiry,
      tag: 'clay',
    };

  const dueOf = (d) => d.day + (d.isAllDay ? 9 * 60 : d.minutes) * MINUTE;

  const steps = [
    {
      render(d, refresh) {
        const shortcuts = h('div.chips');
        for (const item of DAY_SHORTCUTS) {
          const target = addDays(startOfDay(Date.now()), item.days);
          shortcuts.appendChild(chip(item.label, d.day === target, () => {
            d.day = target;
            refresh();
          }, { tone: 'clay' }));
        }

        return h('div',
          fieldBlock('Which day is this due?', 'Pick a shortcut or choose a date.',
            shortcuts,
            h('div', { style: { marginTop: '12px' } },
              h('input', {
                type: 'date',
                value: toDateValue(d.day),
                'aria-label': 'Due date',
                onchange: (event) => {
                  const parsed = fromDateValue(event.target.value);
                  if (parsed != null) { d.day = parsed; refresh(); }
                },
              }))),
          summaryCard('calendar', formatDayHeadline(d.day),
            countdown(d.day, startOfDay(Date.now())), 'clay'),
        );
      },
    },
    {
      render(d, refresh) {
        const shortcuts = h('div.chips');
        for (const minutes of TIME_SHORTCUTS) {
          shortcuts.appendChild(chip(formatMinutes(minutes), !d.isAllDay && d.minutes === minutes, () => {
            d.minutes = minutes;
            d.isAllDay = false;
            refresh();
          }, { tone: 'clay' }));
        }

        return h('div',
          fieldBlock('What time is it due?',
            'All-day notes sit at the top of the day instead of at a clock time.',
            h('div.chips',
              chip('All day', d.isAllDay, () => { d.isAllDay = !d.isAllDay; refresh(); }, { tone: 'clay', iconName: 'sunrise' })),
            !d.isAllDay && h('div', { style: { marginTop: '12px' } },
              shortcuts,
              h('div', { style: { marginTop: '12px' } },
                h('input', {
                  type: 'time',
                  value: toTimeValue(d.minutes),
                  'aria-label': 'Due time',
                  onchange: (event) => {
                    const parsed = fromTimeValue(event.target.value);
                    if (parsed != null) { d.minutes = parsed; refresh(); }
                  },
                })))),
          summaryCard('clock',
            d.isAllDay ? `All day on ${formatMonthDay(d.day)}` : formatFull(dueOf(d)),
            `Due ${countdown(dueOf(d))}`, 'clay'),
        );
      },
    },
    {
      render(d, refresh) {
        const lingerChips = h('div.chips');
        for (const key of LINGER_KEYS) {
          lingerChips.appendChild(chip(LINGERS[key].short, d.linger === key, () => {
            d.linger = key;
            refresh();
          }, { tone: 'clay' }));
        }

        const expiry = expiryFor(dueOf(d), d.linger);
        const expiryText = d.linger === 'atDue'
          ? "Clears the moment it's due."
          : `Clears ${formatFull(expiry)}.`;

        return h('div',
          fieldBlock('When should it disappear?',
            'Once this passes, the note leaves your schedule on its own. Nothing is lost — it moves to Recently cleared.',
            lingerChips),
          fieldBlock('Reminders', 'Nudges ahead of the deadline. Stack as many as you like.',
            reminderPicker(d, refresh, 'clay', 'No reminders. It will still appear on your schedule.')),
          fieldBlock('Colour', null, tagPicker(d, refresh)),
          fieldBlock('Anything else?', 'Optional. Shows under the note on your schedule.', detailsField(d)),
          summaryCard('check', `Due ${formatFull(dueOf(d))}`, expiryText, 'clay'),
        );
      },
    },
  ];

  runWizard({
    title: editing ? 'Edit note' : 'New temporary note',
    subtitle: 'TEMPORARY · CLEARS ITSELF',
    tone: 'clay',
    finishLabel: editing ? 'Save changes' : 'Add to schedule',
    steps,
    draft,
    onFinish(d) {
      onSave({
        id: d.id,
        title: d.title.trim(),
        details: (d.details || '').trim(),
        due: dueOf(d),
        isAllDay: d.isAllDay,
        linger: d.linger,
        reminders: d.reminders,
        notifyOnExpiry: d.notifyOnExpiry,
        tag: d.tag,
        createdAt: d.createdAt,
        isDone: d.isDone,
        doneAt: d.doneAt,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Permanent
// ---------------------------------------------------------------------------

export function openPermanentWizard({ seed, editing, settings, onSave }) {
  const draft = editing
    ? {
      id: editing.id,
      title: editing.title,
      details: editing.details,
      recurrence: JSON.parse(JSON.stringify(editing.recurrence)),
      startDate: editing.startDate,
      minutes: editing.startMinutes,
      durationMinutes: editing.durationMinutes,
      reminders: editing.reminders.slice(),
      tag: editing.tag,
      isMuted: editing.isMuted,
      createdAt: editing.createdAt,
    }
    : {
      title: seed || '',
      details: '',
      recurrence: defaultRecurrence(),
      startDate: startOfDay(Date.now()),
      minutes: 8 * 60,
      durationMinutes: 60,
      reminders: settings.defaultPermanentReminders.slice(),
      tag: 'moss',
      isMuted: false,
    };

  const probe = (d) => ({
    recurrence: d.recurrence,
    startDate: d.startDate,
    startMinutes: d.minutes,
    durationMinutes: d.durationMinutes,
  });

  const steps = [
    {
      guard: (d) => d.recurrence.kind !== 'selectedDays' || d.recurrence.weekdays.length > 0,
      render(d, refresh) {
        const kinds = h('div.chips');
        for (const [key, meta] of Object.entries(RECURRENCE_KINDS)) {
          kinds.appendChild(chip(meta.label, d.recurrence.kind === key, () => {
            d.recurrence.kind = key;
            refresh();
          }, { iconName: meta.icon }));
        }

        let extra = null;
        if (d.recurrence.kind === 'selectedDays') {
          const order = settings.weekStartsOnMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
          const days = h('div.chips');
          for (const weekday of order) {
            const on = d.recurrence.weekdays.includes(weekday);
            days.appendChild(chip(weekdayNarrow(weekday), on, () => {
              d.recurrence.weekdays = on
                ? d.recurrence.weekdays.filter((w) => w !== weekday)
                : [...d.recurrence.weekdays, weekday].sort((a, b) => a - b);
              refresh();
            }));
          }
          extra = fieldBlock('Pick the days', null, days);
        } else if (d.recurrence.kind === 'everyNDays') {
          extra = fieldBlock('How often?', 'Counted from the start date below.',
            h('input', {
              type: 'number', min: '1', max: '60',
              value: String(d.recurrence.interval),
              'aria-label': 'Interval in days',
              oninput: (event) => {
                d.recurrence.interval = Math.max(1, Math.min(60, Number(event.target.value) || 1));
              },
              onchange: refresh,
            }));
        } else if (d.recurrence.kind === 'dayOfMonth') {
          const nums = h('div.daynums');
          for (let n = 1; n <= 31; n += 1) {
            nums.appendChild(h('button', {
              type: 'button',
              'aria-pressed': d.recurrence.dayOfMonth === n ? 'true' : 'false',
              onclick: () => { d.recurrence.dayOfMonth = n; refresh(); },
            }, String(n)));
          }
          extra = fieldBlock('Which day of the month?', 'Short months fall back to their last day.', nums);
        }

        const next = nextOccurrence(probe(d), Date.now());

        return h('div',
          fieldBlock('Which days should it appear?', 'This is the rhythm the note keeps. It repeats forever.', kinds),
          extra,
          fieldBlock('Starting from', 'The note will not appear before this date.',
            h('input', {
              type: 'date',
              value: toDateValue(d.startDate),
              'aria-label': 'Start date',
              onchange: (event) => {
                const parsed = fromDateValue(event.target.value);
                if (parsed != null) { d.startDate = parsed; refresh(); }
              },
            })),
          summaryCard('repeat', recurrenceSummary(d.recurrence),
            next ? `Next on ${dayName(next)}, ${formatMonthDay(next)}` : 'No upcoming day matches this pattern yet.'),
        );
      },
    },
    {
      render(d, refresh) {
        const shortcuts = h('div.chips');
        for (const minutes of TIME_SHORTCUTS) {
          shortcuts.appendChild(chip(formatMinutes(minutes), d.minutes === minutes, () => {
            d.minutes = minutes;
            refresh();
          }));
        }

        return h('div',
          fieldBlock('What time of day?', 'Where the note sits on each day it appears.',
            shortcuts,
            h('div', { style: { marginTop: '12px' } },
              h('input', {
                type: 'time',
                value: toTimeValue(d.minutes),
                'aria-label': 'Time of day',
                onchange: (event) => {
                  const parsed = fromTimeValue(event.target.value);
                  if (parsed != null) { d.minutes = parsed; refresh(); }
                },
              }))),
          summaryCard('clock', `Appears at ${formatMinutes(d.minutes)}`, recurrenceSummary(d.recurrence)),
        );
      },
    },
    {
      render(d, refresh) {
        const durations = h('div.chips');
        for (const minutes of DURATIONS) {
          durations.appendChild(chip(formatDuration(minutes), d.durationMinutes === minutes, () => {
            d.durationMinutes = minutes;
            refresh();
          }));
        }

        return h('div',
          fieldBlock('How long should it stay on the schedule?',
            'This is the block it occupies each time it appears — not how long the note lives. Permanent notes never expire.',
            durations),
          fieldBlock('Reminders', 'Leave this empty and the note simply sits on your schedule without buzzing.',
            reminderPicker(d, refresh, '', 'Silent. It appears on the schedule, nothing more.')),
          fieldBlock('Colour', null, tagPicker(d, refresh)),
          fieldBlock('Anything else?', 'Optional. Shows under the note on your schedule.', detailsField(d)),
          summaryCard('leaf',
            `${recurrenceSummary(d.recurrence)} at ${formatMinutes(d.minutes)}`,
            `Holds ${formatDuration(d.durationMinutes)} · never expires`),
        );
      },
    },
  ];

  runWizard({
    title: editing ? 'Edit standing note' : 'New permanent note',
    subtitle: 'PERMANENT · STAYS UNTIL YOU REMOVE IT',
    tone: '',
    finishLabel: editing ? 'Save changes' : 'Add to schedule',
    steps,
    draft,
    onFinish(d) {
      onSave({
        id: d.id,
        title: d.title.trim(),
        details: (d.details || '').trim(),
        recurrence: d.recurrence,
        startDate: d.startDate,
        startMinutes: d.minutes,
        durationMinutes: d.durationMinutes,
        reminders: d.reminders,
        tag: d.tag,
        isMuted: d.isMuted,
        createdAt: d.createdAt,
      });
    },
  });
}
