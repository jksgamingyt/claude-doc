// settings.js — preferences, the calendar bridge, the archive, and an honest
// account of what a web app can and cannot do on an iPhone.

import {
  LINGERS, LINGER_KEYS, TAGS,
  NUDGE_OPTIONS, nudgeLabel, splitReminders, joinNudges,
  leadShort, leadLong, formatFull, formatMonthDay, dayName,
} from './model.js';
import { buildICS, exportable } from './ics.js';
import { DEFAULT_SETTINGS } from './store.js';
import {
  permission, requestPermission, notificationsSupported, isInstalled,
} from './notify.js';
import { openSetPinSheet, rememberSlider } from './lock.js';
import {
  h, mount, icon, pill, chip, toggleRow, selectRow, optionSlider, emptyState,
  openSheet, confirmSheet, toast, offerFile,
} from './ui.js';

// ---------------------------------------------------------------------------
// The calendar bridge
// ---------------------------------------------------------------------------

export async function sendToCalendar(app, { onlyNew = true, silent = false } = {}) {
  const store = app.store;
  const batch = exportable(store.state, onlyNew);
  const total = batch.temporary.length + batch.permanent.length;

  if (!total) {
    if (!silent) toast(onlyNew ? 'Everything is already in your calendar' : 'Nothing to send yet');
    return 0;
  }

  const { text } = buildICS({ ...batch, name: 'MySchedule' });
  const stamp = new Date().toISOString().slice(0, 10);
  const result = await offerFile(
    `MySchedule-${stamp}.ics`,
    text,
    'text/calendar',
    'Add to Calendar',
  );

  if (result === 'cancelled') return 0;

  store.markExported(batch.temporary, batch.permanent);
  toast(result === 'shared'
    ? `${total} sent — choose Calendar to add them`
    : `${total} downloaded — open the file to add them`);
  return total;
}

export function calendarCard(app) {
  const batch = exportable(app.store.state, true);
  const pending = batch.temporary.length + batch.permanent.length;

  return h('div.card.raised',
    h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '12px' } },
      h('span', { style: { color: 'var(--moss)', flex: 'none' } }, icon('cal2', 20)),
      h('div',
        h('strong', { style: { fontSize: '16px' }, text: 'Real reminders, via Calendar' }),
        h('p.small.muted', { style: { marginTop: '4px' },
          text: 'iOS gives no web app the ability to alert you while it is closed. Sending your notes to the iPhone Calendar does: the alarms fire on time, offline, whether or not this app is running.' }))),
    h('button.btn.wide', { type: 'button', onclick: () => sendToCalendar(app, { onlyNew: true }) },
      icon('share', 15),
      pending ? `Send ${pending} to Calendar` : 'Everything is up to date'),
    h('p.tiny.faint', { style: { marginTop: '9px', textAlign: 'center' },
      text: pending
        ? 'Tap, then choose Calendar in the share sheet and Add All.'
        : 'New and edited notes will appear here to send.' }),
    pending === 0 && h('button.btn.soft.wide', {
      type: 'button', style: { marginTop: '10px' },
      onclick: () => sendToCalendar(app, { onlyNew: false }),
    }, 'Send everything again'),
  );
}

// ---------------------------------------------------------------------------
// Settings screen
// ---------------------------------------------------------------------------

export function settingsScreen(app) {
  const store = app.store;
  const state = store.state;
  const root = h('div.screen');

  function set(key, value) {
    store.set(key, value);
    app.render();
  }

  function reminderChips(key, tone) {
    const slots = splitReminders(state.settings[key]);
    const commit = () => set(key, joinNudges(slots.nudgeA, slots.nudgeB));

    return h('div.slider-stack',
      optionSlider({
        options: NUDGE_OPTIONS,
        value: slots.nudgeA,
        format: nudgeLabel,
        label: 'Nudge me',
        tone,
        onInput: (value) => { slots.nudgeA = value; },
        onCommit: commit,
      }),
      optionSlider({
        options: NUDGE_OPTIONS,
        value: slots.nudgeB,
        format: nudgeLabel,
        label: 'And again',
        tone,
        onInput: (value) => { slots.nudgeB = value; },
        onCommit: commit,
      }));
  }

  // --- notifications
  const perm = permission();
  const installed = isInstalled();
  const notifyRows = h('div.settings-group');

  notifyRows.appendChild(h('div.pad',
    h('div', { style: { display: 'flex', gap: '11px', alignItems: 'flex-start' } },
      h('span', { style: { color: perm === 'granted' ? 'var(--moss)' : 'var(--ink-3)', flex: 'none' } },
        icon(perm === 'granted' ? 'bell' : 'bellOff', 17)),
      h('div',
        h('strong', { text: perm === 'granted' ? 'Live alerts are on' : 'Live alerts are off' }),
        h('p.small.muted', { style: { marginTop: '3px' }, text: liveAlertsExplanation(perm, installed) })))));

  if (notificationsSupported() && perm !== 'granted' && installed) {
    notifyRows.appendChild(h('div.pad',
      h('button.btn.soft.wide', {
        type: 'button',
        onclick: async () => {
          await requestPermission();
          app.armReminders();
          app.render();
        },
      }, 'Allow live alerts')));
  }

  if (perm === 'granted') {
    notifyRows.appendChild(h('div.pad',
      h('button.btn.soft.wide', {
        type: 'button',
        onclick: () => { app.reminders.test(); toast('Sent a test notification'); },
      }, 'Send a test notification')));
  }

  // --- defaults
  const defaults = h('div.settings-group');
  defaults.appendChild(h('div.pad',
    h('div.small', { style: { fontWeight: 600, marginBottom: '9px' }, text: 'New temporary notes' }),
    reminderChips('defaultTemporaryReminders', 'clay')));
  defaults.appendChild(h('div.pad',
    h('div.small', { style: { fontWeight: 600, marginBottom: '9px' }, text: 'New permanent notes' }),
    reminderChips('defaultPermanentReminders', '')));
  defaults.appendChild(selectRow('Clears by default', state.settings.defaultLinger,
    LINGER_KEYS.map((key) => [key, LINGERS[key].label]),
    (value) => set('defaultLinger', value)));
  defaults.appendChild(toggleRow('Alert when a note expires', null, state.settings.notifyOnExpiry,
    (value) => set('notifyOnExpiry', value)));

  // --- schedule
  const schedule = h('div.settings-group');
  schedule.appendChild(selectRow('Calendar year', String(state.settings.calendarYear),
    [2025, 2026, 2027, 2028, 2029, 2030].map((y) => [String(y), String(y)]),
    (value) => set('calendarYear', Number(value))));
  schedule.appendChild(toggleRow('Weeks start on Monday', null, state.settings.weekStartsOnMonday,
    (value) => set('weekStartsOnMonday', value)));
  schedule.appendChild(toggleRow('Keep finished notes visible', null, state.settings.showCompletedOnSchedule,
    (value) => set('showCompletedOnSchedule', value)));
  schedule.appendChild(toggleRow('Show permanent notes', null, state.settings.showPermanentOnSchedule,
    (value) => set('showPermanentOnSchedule', value)));

  // --- look and feel
  const look = h('div.settings-group');
  look.appendChild(selectRow('Theme', state.settings.theme,
    [['system', 'Match phone'], ['light', 'Daylight'], ['dark', 'Nightfall']],
    (value) => { set('theme', value); app.applyTheme(); }));
  look.appendChild(toggleRow('Welcome screen on launch', null, state.settings.showWelcomeOnLaunch,
    (value) => set('showWelcomeOnLaunch', value)));
  look.appendChild(selectRow('Open to', state.settings.startTab,
    [['ask', 'Let me choose'], ['schedule', 'Schedule'], ['temporary', 'Temporary notes'],
      ['permanent', 'Permanent notes'], ['daily', 'Daily reminders']],
    (value) => set('startTab', value)));
  look.appendChild(toggleRow('Offer Calendar after adding a note', null, state.settings.remindToExport,
    (value) => set('remindToExport', value)));

  // --- app lock
  const lock = h('div.settings-group');

  lock.appendChild(h('div.pad',
    h('div', { style: { display: 'flex', gap: '11px', alignItems: 'flex-start' } },
      h('span', { style: { color: state.settings.pinEnabled ? 'var(--moss)' : 'var(--ink-3)', flex: 'none' } },
        icon('lock', 17)),
      h('div',
        h('strong', { text: state.settings.pinEnabled ? 'App Lock is on' : 'App Lock is off' }),
        h('p.small.muted', { style: { marginTop: '3px' },
          text: 'A 4-digit PIN before the app opens. A screen lock, not encryption — it hides your notes from a glance, not from someone with the device itself.' })))));

  if (state.settings.pinEnabled) {
    lock.appendChild(h('div.pad', rememberSlider(store)));
    lock.appendChild(h('div.pad',
      h('button.btn.soft.wide', { type: 'button', onclick: () => openSetPinSheet(app, { onDone: () => app.render() }) },
        'Change PIN')));
    lock.appendChild(h('div.pad',
      h('button.btn.danger', {
        type: 'button', style: { width: '100%' },
        onclick: () => confirmSheet({
          title: 'Turn off App Lock?',
          message: 'The app will open straight to the welcome screen again.',
          confirmLabel: 'Turn it off',
          onConfirm: () => {
            set('pinEnabled', false);
            set('pinHash', null);
            set('pinSalt', null);
          },
        }),
      }, 'Turn off App Lock')));
  } else {
    lock.appendChild(h('div.pad',
      h('button.btn.wide', { type: 'button', onclick: () => openSetPinSheet(app, { onDone: () => app.render() }) },
        icon('lock', 15), 'Turn on App Lock')));
  }

  // --- data
  const data = h('div.settings-group');
  data.appendChild(h('button.rowlink', {
    type: 'button', onclick: () => openArchive(app),
  }, h('span', 'Recently cleared'), h('span.faint', String(state.archive.length))));
  data.appendChild(h('div.pad', optionSlider({
    options: [7, 30, 90, 0],
    value: state.settings.archiveRetentionDays,
    format: (days) => (days === 0 ? 'Forever' : `${days} days`),
    label: 'Keep cleared notes for',
    onInput: (days) => { state.settings.archiveRetentionDays = days; },
    onCommit: (days) => set('archiveRetentionDays', days),
  })));
  data.appendChild(h('div.pad',
    h('button.btn.soft.wide', {
      type: 'button',
      onclick: async () => {
        const stamp = new Date().toISOString().slice(0, 10);
        await offerFile(`MySchedule-backup-${stamp}.json`, store.exportJSON(), 'application/json', 'MySchedule backup');
        toast('Backup created');
      },
    }, icon('download', 15), 'Back up my notes')));
  data.appendChild(h('div.pad',
    h('button.btn.soft.wide', { type: 'button', onclick: () => openImport(app) }, 'Restore from a backup')));
  data.appendChild(h('div.pad',
    h('button.btn.danger', {
      type: 'button', style: { width: '100%' },
      onclick: () => confirmSheet({
        title: 'Erase everything?',
        message: 'Every note, both kinds, plus the archive. This cannot be undone.',
        confirmLabel: 'Erase all notes',
        onConfirm: () => { store.eraseEverything(); app.render(); toast('Everything erased'); },
      }),
    }, icon('trash', 14), 'Erase everything')));

  // --- about
  const about = h('div.settings-group');
  about.appendChild(h('button.rowlink', { type: 'button', onclick: () => openHowItWorks(app) },
    h('span', 'How MySchedule works'), icon('right', 14)));
  about.appendChild(h('div.pad',
    h('div.small.faint', { text: `${state.temporary.length} temporary · ${state.permanent.length} permanent` }),
    state.lastSweepAt && h('div.tiny.faint', { style: { marginTop: '4px' }, text: `Last tidy-up ${formatFull(state.lastSweepAt)}` })));

  const body = h('div.scroll',
    h('div.section-label', { style: { marginTop: '4px' }, text: 'Reminders that actually fire' }),
    calendarCard(app),
    h('div.section-label', { text: 'Live alerts (while the app is open)' }), notifyRows,
    h('div.section-label', { text: 'Default reminders' }), defaults,
    h('div.section-label', { text: 'App Lock' }), lock,
    h('div.section-label', { text: 'Schedule' }), schedule,
    h('div.section-label', { text: 'Look and feel' }), look,
    h('div.section-label', { text: 'Your data' }), data,
    h('div.section-label', { text: 'About' }), about,
    store.storageError && h('p.small', { style: { color: 'var(--clay)', marginTop: '14px' }, text: store.storageError }),
  );

  mount(root, h('div.topbar', h('h1', 'Settings')), body);
  return root;
}

function liveAlertsExplanation(perm, installed) {
  if (!notificationsSupported()) {
    return 'This browser gives web apps no notification API at all. Use the Calendar route above.';
  }
  if (!installed) {
    return 'iOS only offers notifications to web apps added to the Home Screen. Add MySchedule to your Home Screen first.';
  }
  if (perm === 'denied') return 'Turned off in iOS Settings › Notifications › MySchedule.';
  if (perm === 'granted') return 'Reminders arrive while the app is open. Anything due while it is closed still needs Calendar.';
  return 'Permission has not been asked for yet.';
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

export function openArchive(app) {
  const store = app.store;

  openSheet((sheet) => {
    function render() {
      mount(sheet.head,
        h('span', { style: { width: '54px' } }),
        h('div.mid', h('strong', 'Recently cleared')),
        h('button.primary', { type: 'button', onclick: sheet.close }, 'Done'));

      const items = store.sortedArchive;
      if (!items.length) {
        mount(sheet.body, emptyState('wind', 'Nothing cleared yet',
          'Temporary notes land here when their time runs out, and anything you remove by hand keeps them company.'));
        mount(sheet.foot);
        return;
      }

      const list = h('div');
      for (const item of items) {
        const tone = item.reason === 'expired' ? 'gold' : (item.reason === 'completed' ? 'moss' : 'bark');
        list.appendChild(h('div.note',
          h('span', { style: { color: `var(--${tone})`, flex: 'none' } },
            icon(item.reason === 'completed' ? 'check' : (item.reason === 'expired' ? 'wind' : 'trash'), 15)),
          h('div.grow',
            h('div.title', { text: item.title }),
            item.details && h('div.small.muted', { text: item.details }),
            h('div.meta',
              pill(item.reason === 'completed' ? 'Done' : (item.reason === 'expired' ? 'Expired' : 'Removed'), 'grey'),
              h('span.tiny.faint', { text: `${item.kind} · ${formatFull(item.archivedAt)}` }))),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', flex: 'none' } },
            h('button.iconbtn', {
              type: 'button', 'aria-label': 'Bring back',
              onclick: () => { store.restore(item); render(); app.render(); toast('Brought back'); },
            }, icon('undo', 14)),
            h('button.iconbtn', {
              type: 'button', 'aria-label': 'Delete for good',
              onclick: () => { store.forget(item); render(); app.render(); },
            }, icon('trash', 14)))));
      }

      mount(sheet.body,
        h('p.tiny.faint', { style: { marginBottom: '12px' },
          text: store.state.settings.archiveRetentionDays
            ? `Kept for ${store.state.settings.archiveRetentionDays} days. Tap the arrow to bring one back.`
            : 'Kept indefinitely. Tap the arrow to bring one back.' }),
        list);

      mount(sheet.foot, h('button.btn.danger', {
        type: 'button', style: { width: '100%' },
        onclick: () => confirmSheet({
          title: 'Empty Recently cleared?',
          message: 'These notes will be gone for good.',
          confirmLabel: 'Empty it',
          onConfirm: () => { store.clearArchive(); render(); app.render(); },
        }),
      }, 'Empty this list'));
    }

    render();
  });
}

// ---------------------------------------------------------------------------
// Restore from backup
// ---------------------------------------------------------------------------

function openImport(app) {
  openSheet((sheet) => {
    const area = h('textarea.textarea', {
      placeholder: 'Paste the contents of a MySchedule backup file here…',
      style: { minHeight: '190px' },
    });

    const file = h('input', {
      type: 'file', accept: '.json,application/json',
      onchange: async (event) => {
        const chosen = event.target.files && event.target.files[0];
        if (!chosen) return;
        area.value = await chosen.text();
      },
    });

    mount(sheet.head,
      h('button', { type: 'button', onclick: sheet.close }, 'Cancel'),
      h('div.mid', h('strong', 'Restore a backup')),
      h('span', { style: { width: '54px' } }));

    mount(sheet.body,
      h('p.small.muted', { style: { marginBottom: '12px' },
        text: 'Choose a backup file, or paste its contents. Merging keeps what you already have and adds anything missing.' }),
      file,
      h('div', { style: { height: '12px' } }),
      area);

    const run = (replace) => {
      if (!app.store.importJSON(area.value, replace)) {
        toast("That doesn't look like a MySchedule backup");
        return;
      }
      sheet.close();
      app.render();
      toast(replace ? 'Replaced everything' : 'Merged in');
    };

    mount(sheet.foot,
      h('button.btn.soft', { type: 'button', onclick: () => run(false) }, 'Merge'),
      h('button.btn', { type: 'button', onclick: () => run(true) }, 'Replace all'));
  });
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

export function openHowItWorks(app) {
  const card = (iconName, tone, title, text) => h('div.card', { style: { marginBottom: '13px' } },
    h('div', { style: { display: 'flex', gap: '13px', alignItems: 'flex-start' } },
      h('div', { style: {
        width: '38px', height: '38px', borderRadius: '11px', flex: 'none',
        display: 'grid', placeItems: 'center', color: `var(--${tone})`,
        background: `color-mix(in srgb, var(--${tone}) 15%, transparent)`,
      } }, icon(iconName, 17)),
      h('div',
        h('strong', { text: title }),
        h('p.small.muted', { style: { marginTop: '5px' }, text }))));

  openSheet((sheet) => {
    mount(sheet.head,
      h('span', { style: { width: '54px' } }),
      h('div.mid', h('strong', 'How it works')),
      h('button.primary', { type: 'button', onclick: sheet.close }, 'Done'));

    mount(sheet.body,
      h('div.card.raised', { style: { marginBottom: '16px' } },
        h('h2', { style: { fontSize: '20px', fontWeight: 700 }, text: 'Two kinds of note, one schedule' }),
        h('p.muted', { style: { marginTop: '7px' },
          text: 'You never edit the schedule directly. You write notes, answer three short questions, and the schedule keeps itself in order.' })),

      card('hourglass', 'clay', 'Temporary notes',
        'Give one a day and a time and it takes a place on your schedule. When its expiry moment passes it comes off on its own, and you are told what went.'),
      card('leaf', 'moss', 'Permanent notes',
        'Give one a rhythm — every day, weekdays, certain days, once a month — a time of day, and how long it holds its place. It then repeats forever. Nothing removes it but you.'),
      card('calendar', 'sky', 'The schedule',
        'Nothing is created here. Every day is assembled from the two notes sections each time you look at it, which is why the schedule can never fall out of step with what you wrote.'),
      card('cal2', 'moss', 'Why reminders go through Calendar',
        'Apple gives web apps no way to raise a notification while they are closed — there is no API for it, on any browser, on any iPhone. Sending your notes to the Calendar app sidesteps that entirely: those alarms are native, and they fire on time whether or not this app is running. Recurring notes go across as a single repeating event, so one send covers every future occurrence.'),
      card('wind', 'gold', 'What happens while the app is closed',
        'Nothing runs. The tidying up — moving an expired note off the schedule — happens the next time you open it, which is why a note occasionally clears itself the moment you launch, with a note saying what went.'),
      card('lock', 'bark', 'Where your notes live',
        'In this phone’s own storage. There is no account and no server; nothing you write leaves the device. Back up from Settings now and then, and keep the app on your Home Screen — iOS is more careful with storage for installed apps than for browser tabs.'),

      h('p.tiny.faint', { style: { textAlign: 'center', marginTop: '10px' }, text: 'Built for one person, on one phone.' }),
    );

    mount(sheet.foot,
      h('button.btn.wide', { type: 'button', onclick: () => { sheet.close(); sendToCalendar(app, { onlyNew: true }); } },
        icon('share', 15), 'Send my notes to Calendar'));
  });
}
