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

// ---------------------------------------------------------------------------

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

check('app boots', await page.locator('#app').count() === 1);
check('welcome screen renders', await page.getByText('MySchedule').count() > 0);
await shot('welcome');

// --- welcome -> doors -> schedule
await tapText('Step in');
check('doors open', await page.getByText('Temporary notes').count() > 0);
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

const composer = page.locator('.composer input');
await composer.fill('Pay the rent');
await composer.press('Enter');
await page.waitForTimeout(300);
check('wizard opens on Enter', await page.locator('.sheet').count() === 1);
check('wizard step 1 asks for the day', await page.getByText('Which day is this due?').count() > 0);
await shot('wizard-day');

await tapText('Tomorrow');
await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(220);
check('wizard step 2 asks for the time', await page.getByText('What time is it due?').count() > 0);
await shot('wizard-time');

await page.locator('.sheet-body .chip', { hasText: '6:00 PM' }).first().click();
await page.waitForTimeout(150);
await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(220);
check('wizard step 3 asks about expiry', await page.getByText('When should it disappear?').count() > 0);
check('reminder defaults are preselected',
  await page.locator('.sheet-body .chip[aria-pressed="true"]').count() >= 2);
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

await tapText('Weekdays');
await page.locator('.sheet-foot .btn:not(.soft)').click();
await page.waitForTimeout(220);
check('permanent wizard asks the time of day', await page.getByText('What time of day?').count() > 0);
await page.locator('.sheet-body .chip', { hasText: '7:00 AM' }).first().click();
await page.waitForTimeout(150);
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

// --- dark mode
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(300);
await tapText('Step in').catch(() => {});
await shot('dark-welcome');
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
