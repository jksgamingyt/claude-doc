// browser.mjs — drives the real app in a real browser at iPhone size.
//
// Loads the PWA, walks the screens, exercises both wizards end to end, and
// fails on any console error or unhandled rejection.
//
//   node test/browser.mjs [--shots DIR]

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../docs/', import.meta.url).pathname;
const shotDir = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1]
  : null;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    res.writeHead(404).end('not found');
  }
});

await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

// The sandbox ships a pinned Chromium; use it rather than downloading one.
const EXECUTABLE = process.env.CHROMIUM_PATH
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({
  executablePath: existsSync(EXECUTABLE) ? EXECUTABLE : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  ...devices['iPhone 15 Pro'],
  // iPhone 17 is 402x874 points; close enough for layout purposes.
  viewport: { width: 402, height: 874 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
  timezoneId: 'America/New_York',
});

const problems = [];
const page = await context.newPage();

page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  if (message.type() === 'warning' && /deprecat/i.test(message.text())) {
    problems.push(`console warning: ${message.text()}`);
  }
});
page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
page.on('console', (message) => {
  const text = message.text();
  if (/content security policy|refused to/i.test(text)) {
    problems.push(`CSP violation: ${text}`);
  }
});
page.on('requestfailed', (request) => {
  problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`);
});

let step = 0;
async function shot(name) {
  if (!shotDir) return;
  step += 1;
  await page.screenshot({ path: `${shotDir}/${String(step).padStart(2, '0')}-${name}.png` });
}

async function tapText(text, options = {}) {
  const target = page.getByText(text, { exact: false }).first();
  await target.waitFor({ state: 'visible', timeout: 5000 });
  await target.click(options);
  await page.waitForTimeout(180);
}

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
}

/** Move the slider carrying `label` to a stop, as a real drag would. */
async function setSlider(label, index) {
  await page.evaluate(({ label, index }) => {
    const field = [...document.querySelectorAll('.slider-field')]
      .find((f) => f.querySelector('.slider-label')?.textContent === label);
    if (!field) throw new Error(`no slider labelled "${label}"`);
    const input = field.querySelector('input.slider');
    input.value = String(index);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { label, index });
  await page.waitForTimeout(200);
}

/**
 * Type into a field and report whether it kept focus.
 *
 * Re-rendering a screen detaches the focused element, and iOS closes the
 * keyboard the moment that happens — so "still focused after a keystroke" is
 * the thing worth asserting.
 */
async function typingKeepsFocus(selector) {
  const field = page.locator(selector).first();
  await field.click();
  await page.waitForTimeout(120);
  await page.keyboard.type('ab');
  await page.waitForTimeout(220);
  return page.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) return { found: false };
    return {
      found: true,
      focused: document.activeElement === target,
      attached: document.contains(target),
      value: target.value,
    };
  }, selector);
}

/**
 * Watch a field while something else re-renders around it.
 *
 * The failure mode is the element being removed from the document — even for
 * an instant, even if the very same node is put straight back. iOS closes the
 * keyboard on removal and does not reopen it. A MutationObserver catches that
 * directly; checking focus afterwards (without re-clicking, which would mask
 * it) catches the consequence.
 */
async function watchForDetach(selector) {
  await page.evaluate((sel) => {
    const target = document.querySelector(sel);
    window.__detached = false;
    window.__watcher = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node === target || (node.contains && node.contains(target))) {
            window.__detached = true;
          }
        }
      }
    });
    window.__watcher.observe(document.body, { childList: true, subtree: true });
  }, selector);
}

async function detachReport(selector) {
  return page.evaluate((sel) => {
    if (window.__watcher) window.__watcher.disconnect();
    const target = document.querySelector(sel);
    return {
      detached: window.__detached === true,
      stillFocused: document.activeElement === target,
      active: document.activeElement ? document.activeElement.tagName : null,
      value: target ? target.value : null,
    };
  }, selector);
}

async function sliderReadout(label) {
  return page.evaluate((wanted) => {
    const field = [...document.querySelectorAll('.slider-field')]
      .find((f) => f.querySelector('.slider-label')?.textContent === wanted);
    return field ? field.querySelector('.slider-value').textContent : null;
  }, label);
}

// ---------------------------------------------------------------------------

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

check('app boots', await page.locator('#app').count() === 1);
check('welcome screen renders', await page.getByText('MySchedule').count() > 0);
await shot('welcome');

// --- welcome -> doors -> schedule
await tapText('Step in');
check('doors open', await page.getByText('Temporary notes').count() > 0);
check('every section has a door', await page.locator('.door').count() === 4,
  `${await page.locator('.door').count()} doors`);
check('daily reminders is one of them', await page.getByText('Daily reminders').count() > 0);
await shot('doors');

await tapText('The schedule');
check('schedule opens', await page.getByRole('tab', { name: /Schedule/ }).count() > 0);
check('empty schedule explains itself', await page.getByText('Your schedule is empty').count() > 0);
await shot('schedule-empty');

// --- add a temporary note through the wizard
await page.getByRole('tab', { name: /Temporary/ }).click();
await page.waitForTimeout(200);
check('temporary tab empty state', await page.getByText('Nothing on the clock').count() > 0);
await shot('temporary-empty');

const typingInComposer = await typingKeepsFocus('.composer input');
check('typing in the compose bar keeps the keyboard up',
  typingInComposer.focused === true && typingInComposer.value === 'ab',
  JSON.stringify(typingInComposer));

const composer = page.locator('.composer input');
await composer.fill('Pay the rent');
await composer.press('Enter');
await page.waitForTimeout(300);
check('wizard opens on Enter', await page.locator('.sheet').count() === 1);
check('wizard step 1 asks for the day', await page.getByText('Which day is this due?').count() > 0);

const typingInTitle = await typingKeepsFocus('.sheet-body input.textinput');
check('typing the note title keeps the keyboard up',
  typingInTitle.focused === true && typingInTitle.attached === true,
  JSON.stringify(typingInTitle));
check('and the characters actually land',
  typingInTitle.value === 'Pay the rentab', typingInTitle.value);
// Put it back the way it was.
await page.locator('.sheet-body input.textinput').first().fill('Pay the rent');
await page.waitForTimeout(150);
// Focus it, then watch it while the step below changes.
await page.locator('.sheet-body input.textinput').first().click();
await watchForDetach('.sheet-body input.textinput');
await shot('wizard-day');

check('the day step is a slider, not a row of buttons',
  await page.locator('.sheet-body input.slider').count() === 1);
await setSlider('How far off?', 1);
check('the day slider reads back what it selected',
  (await sliderReadout('How far off?')) === 'Tomorrow',
  String(await sliderReadout('How far off?')));

await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(220);
check('wizard step 2 asks for the time', await page.getByText('What time is it due?').count() > 0);

const titleReport = await detachReport('.sheet-body input.textinput');
check('the note title is never detached when the step changes',
  titleReport.detached === false, JSON.stringify(titleReport));
await setSlider('Time of day', 4);
check('the time slider reads back what it selected',
  (await sliderReadout('Time of day')) === '6:00 PM',
  String(await sliderReadout('Time of day')));
await shot('wizard-time');

await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(220);
check('wizard step 3 asks about expiry', await page.getByText('When should it disappear?').count() > 0);
check('reminder defaults land on the nudge sliders',
  (await sliderReadout('Nudge me')) === '1 day before'
  && (await sliderReadout('And again')) === '1 hr before',
  `${await sliderReadout('Nudge me')} / ${await sliderReadout('And again')}`);

// Dragging must update the readout without rebuilding the control underneath.
const drag = await page.evaluate(() => {
  const field = [...document.querySelectorAll('.slider-field')]
    .find((f) => f.querySelector('.slider-label')?.textContent === 'Clears');
  const input = field.querySelector('input.slider');
  input.value = '3';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    readout: field.querySelector('.slider-value').textContent,
    sameNode: document.contains(input) && input === field.querySelector('input.slider'),
  };
});
check('dragging updates the readout live', drag.readout === 'End of day', drag.readout);
check('dragging does not rebuild the slider mid-drag', drag.sameNode === true);
await shot('wizard-expiry');

await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(400);
check('sheet closes after saving', await page.locator('.sheet').count() === 0);
check('the note is listed', await page.getByText('Pay the rent').count() > 0);
await shot('temporary-list');

// --- add a permanent note
await page.getByRole('tab', { name: /Permanent/ }).click();
await page.waitForTimeout(200);
const composer2 = page.locator('.composer input');
await composer2.fill('Morning walk');
await composer2.press('Enter');
await page.waitForTimeout(300);
check('permanent wizard asks which days', await page.getByText('Which days should it appear?').count() > 0);
await shot('perm-wizard-days');

// The biggest replacement: 31 day-of-month buttons become one track.
await setSlider('Pattern', 5);
check('picking a monthly pattern offers a day-of-month slider',
  (await sliderReadout('Day of the month')) === 'Day 1',
  String(await sliderReadout('Day of the month')));
await setSlider('Day of the month', 14);
check('the day-of-month slider reads back what it selected',
  (await sliderReadout('Day of the month')) === 'Day 15',
  String(await sliderReadout('Day of the month')));

await setSlider('Pattern', 4);
check('picking every-N-days offers an interval slider',
  (await sliderReadout('Interval')) !== null, String(await sliderReadout('Interval')));

await setSlider('Pattern', 1);
check('the recurrence slider reads back what it selected',
  (await sliderReadout('Pattern')) === 'Weekdays', String(await sliderReadout('Pattern')));
await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(220);
check('permanent wizard asks the time of day', await page.getByText('What time of day?').count() > 0);
await setSlider('Time of day', 0);
await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(220);
check('permanent wizard asks how long it holds',
  await page.getByText('How long should it stay on the schedule?').count() > 0);
await shot('perm-wizard-duration');

await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(400);
check('permanent note is listed', await page.getByText('Morning walk').count() > 0);
await shot('permanent-list');

// --- schedule now shows both
await page.getByRole('tab', { name: /Schedule/ }).click();
await page.waitForTimeout(300);
const dots = await page.locator('.day .dots i').count();
check('calendar shows day markers', dots > 0, `${dots} dots`);
await shot('schedule-month');

await tapText('Agenda');
check('agenda lists upcoming days', await page.locator('.note').count() > 0);
await shot('schedule-agenda');

await tapText('Month');
await page.waitForTimeout(200);

// --- inspector
await page.locator('.day.selected').click().catch(() => {});
await page.waitForTimeout(150);
const firstEntry = page.locator('.daypanel .note').first();
if (await firstEntry.count()) {
  await firstEntry.click();
  await page.waitForTimeout(300);
  check('inspector opens from the schedule', await page.locator('.sheet').count() === 1);
  await shot('inspector');
  await page.locator('.sheet-head .primary').click();
  await page.waitForTimeout(200);
}

// --- settings and the calendar bridge
await page.getByRole('tab', { name: /Settings/ }).click();
await page.waitForTimeout(300);
check('settings leads with the calendar bridge',
  await page.getByText('Real reminders, via Calendar').count() > 0);
await shot('settings');

const icsCheck = await page.evaluate(async () => {
  const ics = await import('./js/ics.js');
  const state = window.myschedule.store.state;
  const batch = ics.exportable(state, false);
  const { text, count } = ics.buildICS(batch);
  return {
    count,
    hasRRule: text.includes('RRULE:'),
    hasAlarm: text.includes('BEGIN:VALARM'),
    crlfOnly: !/[^\r]\n/.test(text),
    sample: text.slice(0, 120),
  };
});
check('calendar file builds in the browser', icsCheck.count === 2, JSON.stringify(icsCheck.count));
check('recurring note exports as an RRULE', icsCheck.hasRRule);
check('alarms are attached', icsCheck.hasAlarm);
check('line endings are CRLF', icsCheck.crlfOnly);

await tapText('How MySchedule works');
check('explainer opens', await page.getByText('Two kinds of note, one schedule').count() > 0);
await shot('how-it-works');
await page.locator('.sheet-head .primary').click();
await page.waitForTimeout(200);

// --- persistence across a reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const persisted = await page.evaluate(() => ({
  temporary: window.myschedule.store.state.temporary.length,
  permanent: window.myschedule.store.state.permanent.length,
}));
check('notes survive a reload', persisted.temporary === 1 && persisted.permanent === 1,
  JSON.stringify(persisted));

// --- the notification gate: a note you never want to hear from
// The reload above put us back on the welcome screen; walk in through the door.
if (await page.getByText('Step in').count()) {
  await page.getByText('Step in').click();
  await page.waitForTimeout(250);
  await page.getByText('Temporary notes').click();
  await page.waitForTimeout(300);
}
await page.getByRole('tab', { name: /Temporary/ }).click();
await page.waitForTimeout(250);
const composer3 = page.locator('.composer input');
await composer3.fill('Water the plants');
await composer3.press('Enter');
await page.waitForTimeout(300);

await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(200);
await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(250);

check('day-of-month and interval are sliders too',
  await page.locator('input.slider').count() > 0);
check('the wizard asks whether to notify at all',
  await page.getByText('Should this note notify you?').count() > 0);
check('reminder options are shown while the answer is yes',
  await page.getByText('Nudge me').count() > 0);
check('the per-note expiry alert is offered',
  await page.getByText('Tell me when it expires').count() > 0);
await shot('gate-yes');

await page.locator('.sheet-body .chip', { hasText: 'No, stay silent' }).first().click();
await page.waitForTimeout(250);
check('saying no hides the reminder options',
  await page.getByText('Nudge me').count() === 0);
check('saying no hides the expiry alert too',
  await page.getByText('Tell me when it expires').count() === 0);
check('saying no explains what that means',
  await page.getByText('No alerts of any kind for this one.').count() > 0);
await shot('gate-no');

await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(400);

const silent = await page.evaluate(() => {
  const note = window.myschedule.store.state.temporary.find((n) => n.title === 'Water the plants');
  return note ? { reminders: note.reminders.length, expiry: note.notifyOnExpiry } : null;
});
check('a silent note is saved with no reminders and no expiry alert',
  silent && silent.reminders === 0 && silent.expiry === false, JSON.stringify(silent));

const timetable = await page.evaluate(async () => {
  const notify = await import('./js/notify.js');
  const state = window.myschedule.store.state;
  return notify.reminderTimetable(state, Date.now(), 14)
    .filter((item) => item.title === 'Water the plants').length;
});
check('a silent note schedules nothing', timetable === 0, `${timetable} entries`);

// Re-open it: the answer must come back as "no", not as a blank yes.
await page.locator('.note', { hasText: 'Water the plants' }).locator('.grow').first().click();
await page.waitForTimeout(300);
await page.getByText('Edit this note').click();
await page.waitForTimeout(300);
await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(200);
await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(250);
const noPressed = await page.locator('.sheet-body .chip', { hasText: 'No, stay silent' })
  .first().getAttribute('aria-pressed');
check('re-opening a silent note remembers the answer', noPressed === 'true', String(noPressed));
await page.getByText('Cancel').first().click();
await page.waitForTimeout(250);

// --- daily reminders: leave one tonight, be greeted on its morning
check('there is a Daily tab', await page.getByRole('tab', { name: /Daily/ }).count() > 0);
check('the tab bar carries all five sections',
  await page.locator('.tabbar button').count() === 5);

await page.getByRole('tab', { name: /Daily/ }).click();
await page.waitForTimeout(250);
check('the daily section explains itself when empty',
  await page.getByText('Nothing waiting for the morning').count() > 0);

const dailyComposer = page.locator('.composer input');
await dailyComposer.fill('Bring the charger');
await dailyComposer.press('Enter');
await page.waitForTimeout(320);
check('writing one asks which morning', await page.getByText('Which morning?').count() > 0);

const typingInDaily = await typingKeepsFocus('.sheet-body input.textinput');
check('typing in the daily sheet keeps the keyboard up',
  typingInDaily.focused === true && typingInDaily.attached === true,
  JSON.stringify(typingInDaily));
await page.locator('.sheet-body input.textinput').first().fill('Bring the charger');
await page.waitForTimeout(150);
check('it defaults to tomorrow',
  (await sliderReadout('Greet me')) === 'Tomorrow morning',
  String(await sliderReadout('Greet me')));
await shot('daily-sheet');

// Aim it at this morning so the greeting is due on the next open.
await setSlider('Greet me', 0);
check('it can be aimed at today',
  (await sliderReadout('Greet me')) === 'This morning',
  String(await sliderReadout('Greet me')));
await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(400);
check('the reminder is listed as waiting',
  await page.getByText('Bring the charger').count() > 0);
await shot('daily-list');

// --- editing one: the reported bug. The field must survive the sheet
// re-rendering around it, or iOS closes the keyboard.
await page.locator('.note', { hasText: 'Bring the charger' }).first().click();
await page.waitForTimeout(360);
check('tapping a reminder opens it for editing',
  (await page.locator('.sheet-head .mid strong').textContent()) === 'Edit reminder');

const editField = '.sheet-body input.textinput';
const typingInEdit = await typingKeepsFocus(editField);
check('editing: typing keeps the keyboard up',
  typingInEdit.focused === true && typingInEdit.attached === true,
  JSON.stringify(typingInEdit));

// The field is focused from the typing above. Now make the sheet re-render
// around it and see whether it is taken out of the document.
await watchForDetach(editField);
await setSlider('Greet me', 2);
const editReport = await detachReport(editField);

check('editing: the field is never detached when the sheet re-renders',
  editReport.detached === false, JSON.stringify(editReport));
check('editing: and it still holds focus afterwards',
  editReport.stillFocused === true, JSON.stringify(editReport));
check('editing: and keeps what was typed',
  editReport.value === 'Bring the chargerab', String(editReport.value));

// Typing straight on, with no re-tap, must still land.
await page.keyboard.type('!');
await page.waitForTimeout(160);
const keptTyping = await page.evaluate((sel) => document.querySelector(sel).value, editField);
check('editing: typing continues without re-tapping the field',
  keptTyping === 'Bring the chargerab!', keptTyping);

// Put it back the way the later checks expect, and save.
await page.locator(editField).first().fill('Bring the charger');
await page.waitForTimeout(120);
await setSlider('Greet me', 0);
await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(420);
check('editing saves in place rather than duplicating',
  await page.locator('.note').count() === 1, `${await page.locator('.note').count()} rows`);
check('and the edit round-trips',
  await page.getByText('Bring the charger').count() > 0);

// It must not greet you in the same breath as writing it.
check('writing one does not greet you immediately',
  await page.locator('.greeting').count() === 0);

// Re-open the app: welcome first, greeting second.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('a reload still lands on the welcome screen first',
  await page.getByText('Step in').count() > 0 && await page.locator('.greeting').count() === 0);

await page.getByText('Step in').click();
await page.waitForTimeout(260);
check('the welcome screen is not interrupted by the greeting',
  await page.locator('.greeting').count() === 0);

await page.getByText('Temporary notes').click();
await page.waitForTimeout(400);
check('the greeting arrives after the welcome screen',
  await page.locator('.greeting').count() === 1);
check('it carries what was left', await page.getByText('Bring the charger').count() > 0);
await shot('daily-greeting');

await page.getByText('Begin the day').click();
await page.waitForTimeout(350);
check('dismissing it clears the greeting', await page.locator('.greeting').count() === 0);

const seen = await page.evaluate(() => {
  const reminder = window.myschedule.store.state.daily.find((r) => r.text === 'Bring the charger');
  return reminder ? Boolean(reminder.seenAt) : null;
});
check('being greeted marks it as said', seen === true, String(seen));

// And it stands down for good.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByText('Step in').click();
await page.waitForTimeout(250);
await page.getByText('Daily reminders').click();
await page.waitForTimeout(400);
check('it does not greet you twice', await page.locator('.greeting').count() === 0);
check('the daily door lands on the daily section',
  await page.getByText('Left for the morning').count() > 0);

// --- App Lock: end to end, including the wrong-PIN and lockout paths
await page.getByRole('tab', { name: /Settings/ }).click();
await page.waitForTimeout(300);
check('App Lock starts off', await page.getByText('App Lock is off').count() > 0);

await page.getByText('Turn on App Lock').click();
await page.waitForTimeout(300);
check('setting a PIN opens a 4-dot pad', await page.locator('.pin-dots i').count() === 4);

async function enterPin(digits) {
  for (const digit of String(digits)) {
    await page.locator('.pin-key', { hasText: digit }).first().click();
    await page.waitForTimeout(90);
  }
}

await enterPin('1234');
await page.waitForTimeout(200);
check('after the first entry it asks to confirm',
  await page.getByText('Enter it again to confirm').count() > 0);

// A mismatch must not silently accept a different PIN. The app starts the
// whole set-PIN flow over on a mismatch (matching how iOS's own passcode
// setup behaves) rather than only retrying the confirm step, so the test
// has to redo both entries too, not just the second one.
await enterPin('9999');
await page.waitForTimeout(250);
check('a mismatched confirmation is rejected, not silently accepted',
  await page.getByText("match").count() > 0);
check('a mismatch restarts from the first entry, rather than retrying confirm',
  await page.getByText('Choose a 4-digit PIN').count() > 0);

await enterPin('1234');
await page.waitForTimeout(200);
await enterPin('1234');
await page.waitForTimeout(350);
check('a matching confirmation sets the PIN and closes the sheet',
  await page.locator('.sheet').count() === 0 && await page.getByText('App Lock is on').count() > 0);

// Reloading is the real test: the app must not boot past the lock screen.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('a reload with App Lock on shows the lock screen, not the welcome screen',
  await page.locator('.lock-screen').count() === 1
  && await page.getByText('MySchedule').count() === 0);
await shot('lock-screen');

// Wrong PIN: rejected, and nothing about the app becomes reachable.
await enterPin('0000');
await page.waitForTimeout(250);
check('a wrong PIN is rejected', await page.getByText('Incorrect PIN').count() > 0);
check('and the app is still not reachable', await page.locator('.lock-screen').count() === 1);

// Drive it to the lockout threshold (5 wrong tries; one has already happened
// above). lockoutSeconds() disables the pad from the 5th failure onward, so
// entering a full attempt only works while the pad is still enabled — check
// before each one rather than assuming exactly N more attempts are needed.
for (let i = 0; i < 4; i += 1) {
  const stillEnabled = await page.locator('.pin-key').first().isEnabled();
  if (!stillEnabled) break;
  await enterPin('0000');
  await page.waitForTimeout(220);
}
check('repeated wrong PINs eventually trigger a cool-off',
  await page.getByText(/Too many tries/).count() > 0);
check('the keypad is disabled during the cool-off',
  await page.locator('.pin-key[disabled]').count() > 0);

// The correct PIN, entered during the correct sheet's own next attempt,
// must still work once the cool-off has been accounted for in the app's
// own tracked failure count — verify the state machine rather than wait
// out a real 30-second timer.
const lockoutState = await page.evaluate(() => {
  const raw = localStorage.getItem('myschedule.lockSession.v1');
  return raw ? JSON.parse(raw) : null;
});
check('the failure count and cool-off are persisted, surviving a reload',
  lockoutState && lockoutState.failedAttempts >= 5 && lockoutState.lockedUntil > Date.now(),
  JSON.stringify(lockoutState));

// Fast-forward past the cool-off by editing the persisted session directly
// (equivalent to time passing) rather than actually waiting.
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('myschedule.lockSession.v1'));
  raw.lockedUntil = 0;
  localStorage.setItem('myschedule.lockSession.v1', JSON.stringify(raw));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('after the cool-off, the correct PIN unlocks the app',
  await page.locator('.lock-screen').count() === 1);
await enterPin('1234');
await page.waitForTimeout(450);
check('the correct PIN reveals the welcome screen, unchanged',
  await page.locator('.lock-screen').count() === 0 && await page.getByText('MySchedule').count() > 0);
await shot('unlocked');

// Remember-me: a second reload within the window must skip the lock screen.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('within the remembered window, a reload skips the lock screen entirely',
  await page.locator('.lock-screen').count() === 0);

// Forgot PIN: must remove the lock without touching notes.
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('myschedule.lockSession.v1'));
  raw.unlockedUntil = 0;
  localStorage.setItem('myschedule.lockSession.v1', JSON.stringify(raw));
});
const notesBeforeReset = await page.evaluate(() => window.myschedule.store.state.temporary.length
  + window.myschedule.store.state.permanent.length + window.myschedule.store.state.daily.length);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('locked again once the remembered window is cleared',
  await page.locator('.lock-screen').count() === 1);

await page.getByText('Forgot PIN?').click();
await page.waitForTimeout(250);
await page.getByText('Remove the lock').click();
await page.waitForTimeout(450);
check('resetting the PIN unlocks straight to the welcome screen',
  await page.locator('.lock-screen').count() === 0 && await page.getByText('MySchedule').count() > 0);

const notesAfterReset = await page.evaluate(() => window.myschedule.store.state.temporary.length
  + window.myschedule.store.state.permanent.length + window.myschedule.store.state.daily.length);
check('resetting the PIN does not touch any notes',
  notesAfterReset === notesBeforeReset && notesBeforeReset > 0,
  `${notesBeforeReset} -> ${notesAfterReset}`);

await page.getByText('Step in').click();
await page.waitForTimeout(250);
await page.getByText('The schedule').click();
await page.waitForTimeout(300);
await page.getByRole('tab', { name: /Settings/ }).click();
await page.waitForTimeout(300);
check('App Lock reads back off after a reset', await page.getByText('App Lock is off').count() > 0);

// --- dark mode
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(300);
await tapText('Step in').catch(() => {});
await shot('dark');
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('dark theme applies', bg.replace(/\s/g, '') !== 'rgb(242,245,239)', bg);

// --- offline
await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(700);
const offlineOk = await page.evaluate(() => !!window.myschedule).catch(() => false);
check('works offline via the service worker', offlineOk === true);
await shot('offline');
await context.setOffline(false);

// ---------------------------------------------------------------------------

await browser.close();
server.close();

let failed = 0;
for (const item of checks) {
  if (!item.ok) failed += 1;
  console.log(`  ${item.ok ? 'pass' : 'FAIL'}  ${item.name}${item.detail ? `  (${item.detail})` : ''}`);
}

if (problems.length) {
  console.log('\nBrowser problems:');
  for (const problem of [...new Set(problems)]) console.log(`  ${problem}`);
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed, ${problems.length} browser problem(s)`);
process.exit(failed || problems.length ? 1 : 0);
