# MySchedule

A personal scheduling app for iPhone. Two kinds of note feed one unified
schedule; nothing is edited on the schedule directly.

It installs to your Home Screen from Safari, runs entirely offline, and keeps
everything on the phone — no account, no server, nothing uploaded. **No Mac
required.**

---

## Put it on your iPhone

Three steps, once. You need a browser on any computer for step 1, and the
iPhone for step 3.

### 1. Switch on hosting (one setting, on GitHub)

Open **[Settings → Pages](../../settings/pages)** for this repository and set:

| Field | Value |
|---|---|
| Source | **Deploy from a branch** |
| Branch | `claude/myschedule-iphone-app-0qasc7` (or `main`, if you've merged) |
| Folder | **`/docs`** |

Press **Save**. GitHub builds it in about a minute.

### 2. Get the address

The same page then shows your URL. It will be:

```
https://<your-github-username>.github.io/claude-doc/
```

### 3. Install it (on the iPhone)

1. Open that URL **in Safari** — it has to be Safari, not Chrome, because only
   Safari can install to the Home Screen.
2. Tap the **Share** button (the square with the arrow).
3. Scroll down and tap **Add to Home Screen**, then **Add**.

Done. MySchedule is now an icon on your Home Screen. It opens full screen with
no browser bars, works with no signal, and keeps your notes even when Safari is
closed.

> **Install it properly, don't just bookmark it.** iOS treats a Home Screen app
> better than a browser tab: it is the only way to get notifications at all, and
> its storage is far less likely to be cleared.

---

## How reminders actually work

This is the one place where being a web app costs you something, so it is worth
being plain about it.

**Apple gives web apps no way to raise a notification while they are closed.**
There is no API for it — not in Safari, not in any browser on iOS. Any web app
that seems to manage it is talking to a server that pushes the message.

MySchedule handles this in three tiers instead:

### Calendar — the one that always works

The app turns your notes into calendar events carrying alarms and hands them to
the iPhone's own Calendar. Those alerts are **native**: they fire on time,
offline, whether or not MySchedule is running, forever.

- Settings → **Send to Calendar**, then pick **Calendar** in the share sheet and
  **Add All**.
- Recurring notes go across as a *single repeating event*, so one send covers
  every future occurrence — a weekday note is one event, not 260.
- Each reminder you chose becomes its own alarm on the event. Choose "1 day
  before" and "1 hour before" and you get both.
- Only new and edited notes are offered, so you never import a duplicate.

The app nudges you to do this each time you add a note. It takes two taps.

### Live alerts — while the app is open

Once installed to the Home Screen, MySchedule can raise real notifications on
its own. iOS suspends its timers shortly after you leave the app, so treat this
as covering the session you're in, not the night ahead.

### Catch-up — so nothing passes silently

Every time you open the app it works out which reminders came due while it was
closed and tells you, in a banner. Belt and braces for anything the first two
tiers missed.

---

## The idea

**Temporary notes** have a deadline. Type one, press return, and the app asks
three questions: *which day*, *what time*, and *how long it should linger before
clearing itself*. When its expiry moment passes it comes off the schedule on its
own, and the app tells you what went.

**Permanent notes** are standing arrangements. Type one, press return, and the
app asks three different questions: *which days it appears*, *what time of day*,
and *how long it holds its place*. It then repeats forever. Nothing removes it
but you.

**Options are set on sliders, not rows of buttons.** Which day, what time, how
long it lingers, how often it repeats, which day of the month, how long it
holds — each one is a single track you slide, with the choice read out above it.
The exact date and time pickers are still there underneath for anything
off-grid.

**Every note is asked whether it should notify you at all.** Answer no and the
note is silent: it still sits on your schedule and still goes to Calendar, it
just never buzzes. Answer yes and the nudge options open up — as many lead times
as you like, each becoming its own alert, plus a last word when a temporary note
expires.

**Daily reminders** are a word left for tomorrow-morning-you. Write one tonight
— any time up to 11:59pm — and the next time you open the app on that day it
greets you on its own screen, straight after the welcome, once. Sleep through it
and it waits rather than disappearing. They have no clock time and never sit on
the calendar; they simply meet you at the door.

**The schedule** is a view, not a store. Every day is assembled from the two
notes sections each time you look at it, so it can never fall out of step with
what you actually wrote.

---

## What's in it

**Welcome screen** — a nature backdrop with soft ridgelines, opening onto four
doors: temporary notes, permanent notes, daily reminders, or the schedule. Can be turned off, or
set to open straight to one section.

**Schedule** — a real calendar for the configured year (2026 by default), month
grid and agenda, coloured dots marking the days that have something on them. The
range widens by itself if you place a note outside it. Tapping anything opens
the note behind it.

**Temporary notes** — grouped into past due / today / tomorrow / this week /
later / done, each showing its countdown, its reminders (or that it is silent),
and when it will clear.

**Permanent notes** — six recurrence patterns (every day, weekdays, weekends,
chosen days, every N days, a day of the month), each with a start date, a time
of day and a duration. Pause one to hide it without losing it.

**Daily** — everything waiting for a morning, plus what has already been said.
Tap any of them to change the morning or take it back.

**Recently cleared** — expired and removed notes land here rather than
vanishing. Bring any of them back with one tap. Kept 30 days by default.

**Also** — light and dark themes that follow the phone, seven colour tags, a
backup file you can send yourself, week-starts-on-Monday, and a plain-language
"How it works" page inside the app.

---

## If you ever get a Mac

There is also a complete **native SwiftUI version** in `MySchedule/` and
`MySchedule.xcodeproj`. Same model, same design, and it can schedule real
notifications by itself with no calendar detour. It is a couple of revisions
behind: its option pickers are still chips rather than sliders, and it has no
daily reminders section. It needs a Mac with Xcode 15+
to build — see the section below on the repository layout. Nothing about the web
app depends on it; keep it or ignore it.

---

## Repository layout

```
docs/                     the web app — this is what GitHub Pages serves
  index.html              the shell
  manifest.webmanifest    Home Screen install metadata
  sw.js                   service worker: offline support
  css/app.css             the whole theme, light and dark
  js/
    model.js              notes, recurrence, expiry, formatting
    engine.js             notes -> days. The heart of the app
    store.js              state and localStorage persistence
    ics.js                the calendar bridge
    notify.js             reminder timetable, live alerts, catch-up
    ui.js                 DOM helpers, icons, sheets, the leaf mark
    wizard.js             the two three-step flows
    screens.js            welcome, schedule, both note lists
    settings.js           settings, archive, calendar export
    app.js                entry point and routing

MySchedule/               the native SwiftUI version (needs a Mac)
MySchedule.xcodeproj/

test/
  run.mjs                 65 logic tests — recurrence, expiry, sweep, ICS
  browser.mjs             70 checks driving the real app in a real browser

Tools/                    generators and checkers for the native version
```

### Why the engine matters

`engine.js` is the only place where "what did I write down" becomes "what is on
my schedule". Entries are derived on demand and never stored, which is what
makes the promise above true rather than aspirational: the schedule cannot drift
from the notes because it has no state of its own.

---

## Working on it

```sh
npm install          # playwright, for the browser tests
npm run serve        # http://localhost:8080
npm test             # logic tests, then the browser suite
npm run shots        # browser suite + screenshots of every screen
```

`test/run.mjs` covers the parts worth being sure about: recurrence across
daylight-saving boundaries, the last-day-of-a-short-month fallback, expiry and
lingering, the sweep, lossy loading of a corrupt record, silent notes staying
silent everywhere, a daily reminder written at 11:59pm waiting until the next
morning, and the generated calendar file down to its line endings and escaping.

`test/browser.mjs` drives the actual app in Chromium at iPhone dimensions —
walking both wizards end to end, saving a note as silent and re-opening it to
confirm the answer survives the round trip, leaving a daily reminder and
re-opening the app to be greeted by it exactly once, checking persistence across
a reload, dark mode, that typing into a field never costs it focus (a
re-render detaches the element and iOS closes the keyboard), and that it still
works with the network switched off. It fails on any console error.

---

## Where your notes live

In this phone's own storage (`localStorage`), under the key
`myschedule.state.v1`, with the previous good copy kept alongside as a backup.
Reads are deliberately forgiving: a note that fails to parse is skipped rather
than taking the rest of the file with it, and a missing setting falls back to
its default instead of resetting everything.

Nothing is uploaded and there is no account. Use **Settings → Back up my notes**
now and then and send the file to yourself — it is the only copy that survives
losing the phone.
