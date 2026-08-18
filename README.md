# MySchedule

A personal scheduling app for iPhone. Two kinds of note feed one unified
schedule; nothing is edited on the schedule directly.

Built as a native SwiftUI app — no account, no server, no network. Everything
lives in one JSON file on the phone.

---

## The idea

There are exactly two ways to put something on your schedule.

**Temporary notes** have a deadline. You type one, press return, and the app
asks three questions: *which day*, *what time*, and *how long it should linger
before clearing itself*. Reminders arrive ahead of the deadline, then at the
deadline. When its expiry moment passes, the note announces itself one last
time and comes off the schedule.

**Permanent notes** are standing arrangements. You type one, press return, and
the app asks three different questions: *which days it appears*, *what time of
day*, and *how long it holds its place*. It then repeats forever. Nothing
removes it but you.

**The schedule** is a view, not a store. Every day is assembled from the two
notes sections each time you look at it, so it can never fall out of step with
what you actually wrote.

---

## Building and installing it on your iPhone

You need a Mac with Xcode. There is no way around this — iOS will not install
an app that has not been signed and built on a Mac.

1. Clone this repository onto the Mac.
2. Open `MySchedule.xcodeproj`.
3. Select the **MySchedule** target → **Signing & Capabilities**.
   - Tick **Automatically manage signing**.
   - Pick your Apple ID under **Team**. A free Apple ID works; add one in
     Xcode → Settings → Accounts if you have not already.
   - If Xcode complains the bundle identifier is taken, change
     **Bundle Identifier** to something of your own, e.g.
     `com.yourname.myschedule`.
4. Plug in the iPhone, pick it from the device menu at the top of the window,
   and press ⌘R.
5. The first time, the phone will refuse to open the app until you trust the
   certificate: **Settings → General → VPN & Device Management → Developer App
   → Trust**.

### About the seven-day limit

An app signed with a *free* Apple ID stops launching after **7 days**. Rebuild
it from Xcode (⌘R) to reset the clock — your notes are untouched by this, they
live in the app's own storage. A paid Apple Developer account ($99/year) raises
the limit to a year.

### Requirements

| | |
|---|---|
| Deployment target | iOS 17.0 |
| Xcode | 15 or later (16+ recommended) |
| Devices | iPhone (portrait) and iPad |
| Frameworks | SwiftUI, UserNotifications — nothing third-party |

The project file itself is in the Xcode 14 format, but the code uses iOS 17
APIs (the two-parameter `onChange`, `.topBarTrailing` toolbar placement), so
Xcode 15 is the real floor. Anything that can deploy to an iPhone 17 is well
past it.

---

## What's in it

**Welcome screen.** A nature backdrop with drifting motes and a tap-to-enter
button, which then opens onto three doors: temporary notes, permanent notes, or
the schedule. Can be turned off, or set to open straight to one section.

**Schedule.** A real calendar for the configured year — 2026 by default —
day by day, with a month grid and an agenda view. Coloured dots mark the days
that have something on them. The browsable range widens by itself if you place
a note outside it. Tapping anything opens the note behind it.

**Temporary notes.** Grouped into past due / today / tomorrow / this week /
later / done. Swipe right to mark done, left to remove. Each note shows its
countdown, its reminders, and when it will clear.

**Permanent notes.** Six recurrence patterns — every day, weekdays, weekends,
chosen days, every N days, a day of the month — each with a start date, a time
of day, and a duration. Pause one to hide it from the schedule without losing
it.

**Notifications.** Per-note lead times, stackable (a day ahead *and* an hour
ahead, say), plus an alert at the due moment and one as the note expires.
Actions on the notification itself: *Mark done* and *Remind me in an hour*.
Quiet hours push overnight alerts to the morning.

**Recently cleared.** Expired and removed notes land here rather than
vanishing. Swipe right to bring one back. Kept for 30 days by default.

**Also:** light and dark themes, haptics, a backup file you can share to
yourself, week-starts-on-Monday, and per-note colour tags.

---

## Two honest limitations

**iOS allows 64 pending local notifications per app.** MySchedule schedules the
nearest ones first — always reserving room for deadlines over standing notes —
and rebuilds the whole set every time the app opens. Daily and weekly permanent
notes are scheduled as *repeating* triggers so they cost one slot each instead
of one per occurrence.

**An offline app cannot run while it is closed.** Notifications are handed to
iOS in advance, so they arrive on time regardless. But the tidying up they
announce — moving an expired note off the schedule — happens the next time you
open the app. That is why a note sometimes clears itself the instant you
launch, and why a banner appears saying what was cleared. The alert was already
delivered; the housekeeping was waiting for you.

---

## Project layout

```
MySchedule/
  MyScheduleApp.swift        entry point + the minimal UIApplicationDelegate
  Models/
    Notes.swift              TemporaryNote, PermanentNote, Recurrence, tags, leads
    AppSettings.swift        every preference, with tolerant decoding
    ScheduleEntry.swift      the day-resolved thing the schedule draws
    Formatting.swift         shared date formatters
  Store/
    ScheduleStore.swift      the single source of truth
    ScheduleEngine.swift     notes -> days. The heart of the app
    Persistence.swift        one JSON file, atomic writes, lossy reads
  Notifications/
    NotificationPlan.swift   works out *what* to schedule — pure, no side effects
    NotificationManager.swift hands the plan to iOS
  Theme/
    Theme.swift              palette, type scale, metrics, haptics, motion
    NatureBackground.swift   ridgelines, low sun, drifting motes, the leaf
    Components.swift         cards, chips, the flow layout, empty states
  Views/                     one file per screen, plus the two wizards
```

### Why the engine matters

`ScheduleEngine` is the only place where "what did I write down" becomes "what
is on my schedule". Entries are derived on demand and never stored, which is
what makes the promise in the first section true rather than aspirational: the
schedule cannot drift from the notes because it has no state of its own.

---

## Tools

Helper scripts, none of them needed to build the app:

| Script | What it does |
|---|---|
| `Tools/generate_xcodeproj.py` | Regenerates `MySchedule.xcodeproj` from whatever is in `MySchedule/`. Run it after adding or removing a source file. |
| `Tools/check_pbxproj.py` | Validates the generated project file. |
| `Tools/parsecheck.py` | Parses every file with the tree-sitter Swift grammar and reports real syntax errors. |
| `Tools/callcheck.py` | A small type-checker for this project's own symbols: every `OurType(...)` call matched against its initialisers (modelling defaults, optionals, property wrappers and trailing closures), every `OurType.member` reference, and ViewBuilder's ten-child limit. |
| `Tools/swiftcheck.py` | Balanced braces, stray tabs, unterminated strings. |
| `Tools/symbolcheck.py` | Duplicate type names, `View` structs with a stored `body`. |
| `Tools/make_icon.py` | Draws the app icon. Pure Python, no image libraries. |

`parsecheck` and `callcheck` need a Swift grammar:

```sh
python3 -m pip install tree-sitter tree-sitter-language-pack
```

Then:

```sh
python3 Tools/generate_xcodeproj.py
python3 Tools/parsecheck.py MySchedule
python3 Tools/callcheck.py MySchedule
python3 Tools/swiftcheck.py MySchedule
python3 Tools/symbolcheck.py MySchedule
python3 Tools/check_pbxproj.py
```

These exist because the app was written on a machine with no Swift toolchain.
They are not a substitute for the compiler — they know nothing about SwiftUI or
Foundation — but they cover the place where mistakes actually accumulate, which
is this project's own call sites. Xcode remains the final word.

---

## Where your data lives

`Application Support/MySchedule/myschedule.json`, inside the app's own
container. Writes are atomic and the previous good copy is kept alongside as
`myschedule.backup.json`. Reads are deliberately forgiving: a note that fails
to decode is skipped rather than taking the rest of the file with it, and a
missing settings key falls back to its default instead of resetting everything.

Settings → Your data → **Create a backup file** writes a shareable copy.
