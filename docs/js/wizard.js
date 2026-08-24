// wizard.js — the two three-step flows.
//
// Type a note, press return, and the app asks the questions it needs. Temporary
// notes are asked which day, what time, and how long they linger. Permanent
// notes are asked which days, what time of day, and how long they hold their
// place. Nothing is saved until the last step.

import {
  TAGS, TAG_KEYS, LINGERS, LINGER_KEYS, RECURRENCE_KINDS,
  NUDGE_OPTIONS, nudgeLabel, splitReminders, joinNudges,
  leadShort, leadLong, expiryFor, defaultRecurrence, recurrenceSummary,
  formatFull, formatMinutes, formatMonthDay, formatDayHeadline, formatDuration,
  countdown, dayName, startOfDay, addDays, weekdayNarrow, minutesOfDay,
  ALL_DAY_MINUTES, MINUTE,
} from './model.js';
import { nextOccurrence } from './engine.js';
import {
  h, mount, icon, chip, fieldBlock, summaryCard, toggleRow, optionSlider,
  continuousSlider, openSheet, toast,
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

const DAY_OFFSETS = DAY_SHORTCUTS.map((item) => item.days);

const dayOffsetLabel = (days) => (DAY_SHORTCUTS.find((item) => item.days === days) || {}).label || '';

const TIME_SHORTCUTS = [7 * 60, 9 * 60, 12 * 60, 15 * 60, 18 * 60, 21 * 60];
const TIME_STEP = 5;

const DURATIONS = [15, 30, 60, 90, 120, 180, 240, ALL_DAY_MINUTES];
const DURATION_STEP = 5;

/** Shared by every "time of day" slider: any minute, not just the shortcuts. */
function timeOfDaySlider({ value, tone, onInput, onCommit }) {
  return continuousSlider({
    min: 0,
    max: 24 * 60 - TIME_STEP,
    step: TIME_STEP,
    stops: TIME_SHORTCUTS,
    value,
    format: formatMinutes,
    label: 'Time of day',
    tone,
    onInput,
    onCommit,
  });
}

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
      // Same reason as the daily sheet: refresh() re-mounts the body and
      // takes this field out of the document with it, closing the keyboard.
      // Only the Next button reads the title, so update just that.
      oninput: (event) => {
        draft.title = event.target.value;
        nextBtn.disabled = !canAdvance();
      },
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

    // Built once and never rebuilt. Re-mounting a container that holds a
    // focused input detaches it from the document, which closes the keyboard
    // on iOS; the only dependable guarantee is that this element never gets
    // re-created. Only the step below it is re-rendered.
    const noteCard = h('div.card.raised', { style: { marginBottom: '18px' } },
      h('div.tiny.faint', { text: subtitle, style: { letterSpacing: '0.08em', marginBottom: '7px' } }),
      titleInput);
    const stepHost = h('div');

    mount(sheet.body, noteCard, stepHost);

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

      mount(stepHost, steps[step].render(draft, refresh));
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

/** Two slots, each on its own track. Off sits at the left-hand end of both. */
function nudgeSliders(draft, refresh, tone) {
  const chosen = joinNudges(draft.nudgeA, draft.nudgeB);
  let summary;
  if (!chosen.length) {
    summary = 'Nothing picked yet — slide one off Off, or say "No, stay silent" above.';
  } else if (chosen.length === 1) {
    summary = `You'll be nudged ${nudgeLabel(chosen[0]).toLowerCase()}.`;
  } else {
    summary = `You'll be nudged ${nudgeLabel(chosen[0]).toLowerCase()}, then ${nudgeLabel(chosen[1]).toLowerCase()}.`;
  }

  return h('div.slider-stack',
    optionSlider({
      options: NUDGE_OPTIONS,
      value: draft.nudgeA,
      format: nudgeLabel,
      label: 'Nudge me',
      tone,
      onInput: (value) => { draft.nudgeA = value; },
      onCommit: refresh,
    }),
    optionSlider({
      options: NUDGE_OPTIONS,
      value: draft.nudgeB,
      format: nudgeLabel,
      label: 'And again',
      tone,
      onInput: (value) => { draft.nudgeB = value; },
      onCommit: refresh,
    }),
    h('div.small.muted', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start' } },
      icon(chosen.length ? 'bell' : 'bellOff', 13), summary),
  );
}

/**
 * The first question about notifications is whether there should be any at all.
 * Everything else stays hidden until the answer is yes, so a note you never
 * want to hear from takes one tap rather than deselecting a row of chips.
 */
function notificationGate(draft, refresh, tone, extras) {
  const question = h('div.card', { style: { marginBottom: '14px' } },
    h('h3', { style: { fontSize: '15px', fontWeight: 700, marginBottom: '3px' },
      text: 'Should this note notify you?' }),
    h('p.help', { style: { marginBottom: '11px' },
      text: 'Say no and it still appears on your schedule — it just never buzzes.' }),
    h('div.chips',
      chip('Yes, notify me', draft.notify,
        () => { draft.notify = true; refresh(); }, { tone, iconName: 'bell' }),
      chip('No, stay silent', !draft.notify,
        () => { draft.notify = false; refresh(); }, { tone, iconName: 'bellOff' })));

  if (!draft.notify) {
    return h('div', question,
      h(`div.summary${tone ? '.' + tone : ''}`,
        icon('bellOff', 16),
        h('div',
          h('strong', 'Silent'),
          h('div.small.muted', 'No alerts of any kind for this one.'))));
  }

  return h('div', question,
    fieldBlock('When should it reach you?', 'Two nudges, each set on its own track.',
      nudgeSliders(draft, refresh, tone)),
    ...(extras || []));
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
  // Land on a real slider stop, so the thumb and the value agree from the start.
  const target = hour < 20 ? Math.min(21 * 60, (hour + 2) * 60) : 9 * 60;
  const defaultMinutes = TIME_SHORTCUTS.find((m) => m >= target) || TIME_SHORTCUTS[TIME_SHORTCUTS.length - 1];

  const draft = editing
    ? {
      id: editing.id,
      title: editing.title,
      details: editing.details,
      day: startOfDay(editing.due),
      dayStop: 0,
      minutes: minutesOfDay(editing.due),
      isAllDay: editing.isAllDay,
      linger: editing.linger,
      reminders: editing.reminders.slice(),
      notifyOnExpiry: editing.notifyOnExpiry,
      ...splitReminders(editing.reminders),
      // A note with no reminders and no expiry alert was answered "no".
      notify: editing.reminders.length > 0 || editing.notifyOnExpiry,
      tag: editing.tag,
      createdAt: editing.createdAt,
      isDone: editing.isDone,
      doneAt: editing.doneAt,
    }
    : {
      title: seed || '',
      details: '',
      day: defaultDay,
      dayStop: hour < 20 ? 0 : 1,
      minutes: defaultMinutes,
      isAllDay: false,
      linger: settings.defaultLinger,
      reminders: settings.defaultTemporaryReminders.slice(),
      notifyOnExpiry: settings.notifyOnExpiry,
      ...splitReminders(settings.defaultTemporaryReminders),
      notify: true,
      tag: 'clay',
    };

  const dueOf = (d) => d.day + (d.isAllDay ? 9 * 60 : d.minutes) * MINUTE;

  const steps = [
    {
      render(d, refresh) {
        const shortcuts = optionSlider({
          options: DAY_OFFSETS,
          value: d.dayStop,
          format: dayOffsetLabel,
          label: 'How far off?',
          tone: 'clay',
          onInput: (days) => {
            d.dayStop = days;
            d.day = addDays(startOfDay(Date.now()), days);
          },
          onCommit: refresh,
        });

        return h('div',
          fieldBlock('Which day is this due?', 'Slide to a shortcut, or set an exact date below.',
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
        const shortcuts = timeOfDaySlider({
          value: d.minutes,
          tone: 'clay',
          onInput: (minutes) => { d.minutes = minutes; },
          onCommit: refresh,
        });

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
        const lingerChips = optionSlider({
          options: LINGER_KEYS,
          value: d.linger,
          format: (key) => LINGERS[key].short,
          label: 'Clears',
          tone: 'clay',
          onInput: (key) => { d.linger = key; },
          onCommit: refresh,
        });

        const expiry = expiryFor(dueOf(d), d.linger);
        const expiryText = d.linger === 'atDue'
          ? "Clears the moment it's due."
          : `Clears ${formatFull(expiry)}.`;

        return h('div',
          fieldBlock('When should it disappear?',
            'Once this passes, the note leaves your schedule on its own. Nothing is lost — it moves to Recently cleared.',
            lingerChips),
          notificationGate(d, refresh, 'clay', [
            h('div.settings-group', { style: { marginTop: '2px' } },
              toggleRow('Tell me when it expires',
                'One last alert as the note comes off your schedule.',
                d.notifyOnExpiry,
                (value) => { d.notifyOnExpiry = value; refresh(); })),
          ]),
          fieldBlock('Colour', null, tagPicker(d, refresh)),
          fieldBlock('Anything else?', 'Optional. Shows under the note on your schedule.', detailsField(d)),
          summaryCard('check', `Due ${formatFull(dueOf(d))}`,
            `${expiryText} ${d.notify && (joinNudges(d.nudgeA, d.nudgeB).length || d.notifyOnExpiry) ? 'Alerts on.' : 'Silent.'}`, 'clay'),
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
        reminders: d.notify ? joinNudges(d.nudgeA, d.nudgeB) : [],
        notifyOnExpiry: d.notify ? d.notifyOnExpiry : false,
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
      ...splitReminders(editing.reminders),
      notify: editing.reminders.length > 0,
      tag: editing.tag,
      isMuted: editing.isMuted,
      createdAt: editing.createdAt,
    }
    : {
      title: seed || '',
      details: '',
      recurrence: defaultRecurrence(),
      startDate: startOfDay(Date.now()),
      minutes: 9 * 60,
      durationMinutes: 60,
      ...splitReminders(settings.defaultPermanentReminders),
      notify: settings.defaultPermanentReminders.length > 0,
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
        const kinds = optionSlider({
          options: Object.keys(RECURRENCE_KINDS),
          value: d.recurrence.kind,
          format: (key) => RECURRENCE_KINDS[key].label,
          label: 'Pattern',
          onInput: (key) => { d.recurrence.kind = key; },
          onCommit: refresh,
        });

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
            optionSlider({
              options: Array.from({ length: 30 }, (_, index) => index + 1),
              value: d.recurrence.interval,
              format: (n) => (n === 1 ? 'Every day' : `Every ${n} days`),
              label: 'Interval',
              onInput: (n) => { d.recurrence.interval = n; },
              onCommit: refresh,
            }));
        } else if (d.recurrence.kind === 'dayOfMonth') {
          const nums = optionSlider({
            options: Array.from({ length: 31 }, (_, index) => index + 1),
            value: d.recurrence.dayOfMonth,
            format: (n) => `Day ${n}`,
            label: 'Day of the month',
            onInput: (n) => { d.recurrence.dayOfMonth = n; },
            onCommit: refresh,
          });
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
        const shortcuts = timeOfDaySlider({
          value: d.minutes,
          onInput: (minutes) => { d.minutes = minutes; },
          onCommit: refresh,
        });

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
        const durations = continuousSlider({
          min: DURATIONS[0],
          max: ALL_DAY_MINUTES,
          step: DURATION_STEP,
          stops: DURATIONS,
          value: d.durationMinutes,
          format: formatDuration,
          label: 'Holds for',
          onInput: (minutes) => { d.durationMinutes = minutes; },
          onCommit: refresh,
        });

        return h('div',
          fieldBlock('How long should it stay on the schedule?',
            'This is the block it occupies each time it appears — not how long the note lives. Permanent notes never expire.',
            durations),
          notificationGate(d, refresh, '', []),
          fieldBlock('Colour', null, tagPicker(d, refresh)),
          fieldBlock('Anything else?', 'Optional. Shows under the note on your schedule.', detailsField(d)),
          summaryCard('leaf',
            `${recurrenceSummary(d.recurrence)} at ${formatMinutes(d.minutes)}`,
            `Holds ${formatDuration(d.durationMinutes)} · ${d.notify && joinNudges(d.nudgeA, d.nudgeB).length ? 'will alert you' : 'silent'} · never expires`),
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
        reminders: d.notify ? joinNudges(d.nudgeA, d.nudgeB) : [],
        tag: d.tag,
        isMuted: d.isMuted,
        createdAt: d.createdAt,
      });
    },
  });
}
