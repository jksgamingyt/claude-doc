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

- Settings → **Add [N] to Calendar** opens Safari's own calendar-import
  screen. No share sheet is involved — iOS never lists Calendar as an app
  there, because Calendar has no share extension. It imports files that are
  *opened*, not files that are shared.
- Recurring notes go across as a *single repeating event*, so one send covers
  every future occurrence — a weekday note is one event, not 260.
- Each reminder you chose becomes its own alarm on the event. Choose "1 day
  before" and "1 hour before" and you get both.
- Only new and edited notes are offered, so you never import a duplicate.
- Afterwards the app **asks whether they actually arrived**, and only then
  records them as sent. It cannot see your Calendar, so it does not pretend
  to. **Nothing arrived? Send everything again** is always available.

#### How the file gets served without a server

Safari shows its import screen when it *navigates to a resource served as
`text/calendar`*. Getting there without a backend took a few wrong turns,
kept here because each one failed in a way worth remembering:

| Approach | Result |
| --- | --- |
| `navigator.share({ files })` | Share sheet has no Calendar target. Wrong door. |
| `blob:` URL, new tab | Blob URLs don't resolve in a fresh browsing context. |
| `blob:` URL, same tab | Races the document's own navigation teardown. |
| `data:text/calendar` URI | **Shipped, and broke.** WebKit blocks top-level `data:` navigation, so the tap silently did nothing — while the app marked the notes as sent anyway. |

The fix makes **the service worker the server**. The page writes the generated
`.ics` into a cache; `sw.js` answers a normal same-origin URL
(`calendar/MySchedule.ics`) out of that cache with real `text/calendar`
headers. Safari cannot tell it apart from a hosted file.

Before pointing a link there, the page asks the controlling worker whether it
serves that route — a worker from a *previous* deploy does not, and would hand
Safari a 404. If the answer is anything but yes, the link degrades to saving a
real file you can open from Files. The one thing it will never do again is
quietly nothing.

The app nudges you to do this each time you add a note. It's one tap.

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

**The two sliders that are actual clock times — what time of day, how long it
holds — are a real continuum, not six fixed stops.** Drag between two presets
(3pm and 6pm, say) and it lands exactly on 4pm rather than snapping to
whichever is nearer; a small "Custom" readout confirms the exact value right
over the thumb while you're setting it. Letting go doesn't slam the screen to
match — the readout holds for a couple of seconds after you stop moving, then
fades out as the rest of the screen catches up, so there's always a beat to
see exactly what got set.

**A temporary note can repeat across several days instead of just one.**
Answer "Yes, repeat it" on the **Clears** step and the seven fixed lingers
(on time, +1 hour, end of day, +1 week, and so on) are replaced by a start
date — already fixed, from the day you chose earlier — and an end date you
pick. It then appears on the schedule every day in between, at the exact time
of day you gave it (4pm stays 4pm on every one of those days — never
midnight), and clears for good the day after. No scroller for this one: two
plain date fields, because a calendar picker is the natural way to answer
"until when," not a count of days to drag through.

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

**Goals** are a third, separate thing — not a note, and not on the schedule.
Type one, press return, and the app asks a single question: *by when*. No time
of day, no reminders, no recurrence, nothing sent to Calendar. Just what you
want to accomplish or change, and a date to work toward, sorted into **Past
due**, **In progress**, and **Achieved** — check one off when you get there.
Nothing else in the app reads from this list; it exists purely for you to look
at.

**The schedule** is a view, not a store. Every day is assembled from the two
notes sections each time you look at it, so it can never fall out of step with
what you actually wrote.

---

## What's in it

**Welcome screen** — a nature backdrop with soft ridgelines, opening onto five
doors: temporary notes, permanent notes, daily reminders, goals, or the
schedule. Can be turned off, or set to open straight to one section.

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

**Goals** — grouped into past due / in progress / achieved, each showing its
target date and how far off it is. Tap the checkmark to mark one achieved,
tap the goal itself to change the date or the wording, or remove it outright.

**Recently cleared** — expired and removed notes land here rather than
vanishing. Bring any of them back with one tap. Kept 30 days by default.

**App Lock** — an optional 4-digit PIN before the app opens, with a "stay
unlocked for" setting so you are not re-prompted every time (see *Security*
below for what this does and does not protect against).

**Also** — light and dark themes that follow the phone, seven colour tags, a
backup file you can send yourself, week-starts-on-Monday, and a plain-language
"How it works" page inside the app.

---

## Security

There was a request in this project's history for a login system — email,
password, "remember me" — so the same schedule could be reached from more than
one device. That was deliberately not built, for a reason worth stating
plainly: **a real login needs a server**, and a server means a database of
everyone's notes to defend, credentials to store safely, and a service that
has to stay up. None of that exists here on purpose. What ships instead:

**No account means no account to attack.** There is no login, no server, no
database — nothing remote that could be breached, phished, or leaked. Every
copy of MySchedule holds only its own notes, in that browser's own storage,
under that origin, and the browser's same-origin policy is what keeps other
websites from reading it — not something this app adds on top.

**App Lock** is what "remember me" became, mapped onto a device that has no
concept of a login session: a 4-digit PIN gates the app itself, and a "stay
unlocked for" setting decides how often you are asked again on that device.
It is a **screen lock, not encryption** — the PIN is never stored (only a
salted hash, via PBKDF2 with a strong iteration count, both computed by the
browser's own Web Crypto, not a hand-rolled algorithm), but the notes
underneath it are plain storage. This stops someone flicking through a phone
they picked up; it does not stop someone with direct access to the device's
files. Five wrong PINs trigger an escalating cool-off, but a 4-digit PIN
still has only 10,000 possible values — say so plainly rather than oversell
it. "Forgot PIN?" removes the lock without touching any notes, since the PIN
never encrypted them to begin with.

**Content-Security-Policy** is set in `index.html`, `script-src`/`style-src`/
`connect-src` all pinned to `'self'`. Nothing here loads a CDN, calls a
third-party API, or sends data anywhere — so the strict policy costs nothing
and closes off a class of bug (an injected script, a stray call to some other
host) even if one existed. `frame-ancestors` is deliberately omitted: it is a
response-header-only directive and GitHub Pages does not allow custom headers,
so setting it via `<meta>` would silently do nothing — shipping a no-op
directive is worse than being honest about not having it.

**Moving between devices stays manual, by choice**, not as a placeholder for
something better. Three ways, in Settings → Your data:

- **Copy for iCloud** puts the whole backup on the clipboard as text. Paste it
  into a Note, a Reminder, or a message to yourself — anything that already
  syncs across your devices via iCloud does the carrying, for free, with
  nothing new to set up. On the other device, **Restore from a backup** →
  **Paste from clipboard** pulls it straight back in (falling back to a
  manual paste into the box if Safari declines the programmatic read, which
  it sometimes does — the app never breaks on that, it just asks you to paste
  by hand instead).
- **Back up my notes** hands you a `.json` file through iOS's share sheet,
  where **AirDrop to another iPhone is instant** — faster than any login
  would be, and nothing leaves Apple's own transport.
- **Restore from a backup** takes either of the above back in, merges rather
  than duplicates, and never partially applies a file that doesn't parse.

None of this is sync in the "just works in the background" sense — that
needs a server, which is the whole thing not being built here. It is two
taps whenever you actually want the same notes somewhere else, riding
entirely on infrastructure you already have.

A password was typed into this project's chat history while asking for a
login. It was not stored anywhere in the app or the repository — there is no
login, so there was nowhere for it to go — but the chat transcript itself is
not a safe place for a real password to live. If that password is real and
used anywhere else, change it there.

## If you ever get a Mac

There is also a complete **native SwiftUI version** in `MySchedule/` and
`MySchedule.xcodeproj`. Same model, same design, and it can schedule real
notifications by itself with no calendar detour. It is a couple of revisions
behind: its option pickers are still chips rather than sliders, and it has
neither a daily reminders section nor a goals section. It needs a Mac with Xcode 15+
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
    screens.js            welcome, schedule, notes, daily reminders, goals
    settings.js           settings, archive, calendar export
    app.js                entry point and routing

MySchedule/               the native SwiftUI version (needs a Mac)
MySchedule.xcodeproj/

test/
  run.mjs                 105 logic tests — recurrence, expiry, sweep, ICS, goals
  browser.mjs             177 checks driving the real app in a real browser

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
lingering, a repeat range appearing on every day it spans (not just the first
and last) at its actual due time rather than midnight — overdue-ness judged
per occurrence, not from the first day alone — and clamping to a sensible end
date, the sweep, lossy loading of a corrupt record, silent notes staying
silent everywhere, a daily reminder written at 11:59pm waiting until the next
morning, goals grouping into past due / in progress / achieved and staying
out of both the schedule and the calendar export, and the generated calendar
file down to its line endings, escaping, and — for a repeating note — an
RRULE whose UNTIL matches DTSTART's value type exactly, floating local time
or bare date, never a stray UTC "Z".

`test/browser.mjs` drives the actual app in Chromium at iPhone dimensions —
walking both wizards end to end, saving a note as silent and re-opening it to
confirm the answer survives the round trip, turning on a repeat range and
confirming both the wizard and the schedule itself treat it as spanning every
day in between, leaving a daily reminder and re-opening the app to be greeted
by it exactly once, setting a goal and marking it achieved and back, checking
persistence across a reload, dark mode, that a focused text field is never
removed from the
document when the screen around it re-renders (iOS closes the keyboard the
instant that happens, and does not reopen it), that the calendar bridge really is
served by the service worker as `text/calendar` over an ordinary URL (the
response headers are checked, not just the link), that tapping it does *not*
record the notes as sent — the app cannot see your Calendar, and claiming
otherwise was a real shipped bug — and that with the route unavailable the
link degrades to a genuine file download rather than to nothing. It also
checks that it still works with the network switched off, and fails on any
console error.

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
