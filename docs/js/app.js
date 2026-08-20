// app.js — entry point, routing, and the launch sequence.

import { Store } from './store.js';
import { Reminders, isInstalled, permission } from './notify.js';
import { h, mount, icon, toast } from './ui.js';
import { startOfDay } from './model.js';
import { isLocked, loadSession, renderLockScreen } from './lock.js';
import {
  welcomeScreen, scheduleScreen, temporaryScreen, permanentScreen,
  dailyScreen, dailyGreeting,
} from './screens.js';
import { settingsScreen, calendarLink, openHowItWorks } from './settings.js';

const TABS = [
  { key: 'schedule', label: 'Schedule', icon: 'calendar' },
  { key: 'temporary', label: 'Temporary', icon: 'hourglass' },
  { key: 'permanent', label: 'Permanent', icon: 'leaf' },
  { key: 'daily', label: 'Daily', icon: 'sunrise' },
  { key: 'settings', label: 'Settings', icon: 'gear' },
];

const HIDE_INSTALL_KEY = 'myschedule.hideInstallHint';

/** Is a text field focused right now? Re-rendering would close the keyboard. */
function isTyping() {
  const active = document.activeElement;
  if (!active) return false;
  return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;
}

class App {
  constructor(root) {
    this.root = root;
    this.store = new Store();
    this.reminders = new Reminders(this.store);
    this.view = { mode: 'month', month: null, focus: null };
    this.tab = 'schedule';
    this.showingWelcome = this.store.state.settings.showWelcomeOnLaunch;
    this.missed = [];
    this.greetedOn = null;
    this.dismissedInstall = localStorage.getItem(HIDE_INSTALL_KEY) === '1';

    if (!this.showingWelcome && this.store.state.settings.startTab !== 'ask') {
      this.tab = this.store.state.settings.startTab;
    }

    this.screenHost = h('div', { style: { display: 'contents' } });
    this.bannerHost = h('div');
    this.tabHost = h('div');
    // A container of its own, mounted once alongside the others below and
    // never replaced — see the note on start().
    this.lockHost = h('div');

    // Mounted exactly once. Everything that follows updates the *contents*
    // of one of these five containers, never this.root itself again — the
    // lock screen included. Replacing this.root's children wholesale a
    // second time (which an earlier version of this code did, to show the
    // lock screen) orphans screenHost/tabHost/bannerHost: render() keeps
    // writing into them believing they are live, but nothing they contain
    // is reachable from the document anymore, so unlocking appeared to do
    // nothing at all.
    mount(this.root,
      h('div.backdrop', { html: RIDGES }),
      this.bannerHost,
      this.screenHost,
      this.tabHost,
      this.lockHost,
    );

    this.applyTheme();
    this.store.subscribe(() => this.render());
  }

  // --- launch -------------------------------------------------------------

  /**
   * The single entry point after construction. Gated behind the lock screen
   * when App Lock is on: nothing below this — sweep, reminders, the welcome
   * screen, any note content — runs or renders until a correct PIN lands.
   * That is deliberate. A CSS overlay on top of already-rendered notes would
   * still leave the real data sitting in the DOM underneath it; not calling
   * this method at all means there is nothing there to find.
   */
  start() {
    if (isLocked(this.store.state.settings, loadSession())) {
      renderLockScreen(this.lockHost, this.store, () => {
        mount(this.lockHost); // empty it; boot() takes over from here
        this.boot();
      });
      return;
    }
    this.boot();
  }

  boot() {
    this.store.state.now = Date.now();
    this.missed = this.reminders.catchUp();
    this.store.sweep();
    this.armReminders();
    this.render();
    // With the welcome screen switched off there is no door to walk through,
    // so the greeting belongs here instead.
    if (!this.showingWelcome) this.maybeGreet();

    // Keep relative labels honest and roll the day over.
    this.clock = setInterval(() => {
      const before = this.store.state.now;
      this.store.state.now = Date.now();
      if (new Date(before).getMinutes() === new Date().getMinutes()) return;
      // Never rebuild the screen out from under someone mid-sentence; the
      // minute labels can wait until they stop typing.
      if (isTyping()) return;
      this.render();
    }, 20000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      this.store.state.now = Date.now();
      this.missed = this.reminders.catchUp();
      this.store.sweep();
      this.armReminders();
      this.render();
      // Coming back after midnight counts as opening the app on a new day.
      if (!this.showingWelcome) this.maybeGreet();
    });

    window.addEventListener('pagehide', () => this.store.saveNow());
  }

  armReminders() {
    if (permission() === 'granted') this.reminders.arm();
  }

  applyTheme() {
    const theme = this.store.state.settings.theme;
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }

  // --- navigation ---------------------------------------------------------

  enter(tab) {
    this.tab = tab;
    this.showingWelcome = false;
    this.render();
    // The reminder meets you on the far side of the welcome screen.
    this.maybeGreet();
  }

  /** Show whatever was left for this morning, once. */
  maybeGreet() {
    const now = this.store.state.now || Date.now();
    const today = startOfDay(now);
    if (this.greetedOn === today) return;

    const pending = this.store.pendingDaily(now);
    if (!pending.length) return;

    this.greetedOn = today;
    dailyGreeting(this, pending, () => this.render());
  }

  // --- hooks called by the wizards ---------------------------------------

  afterAdd() {
    this.armReminders();
    this.render();
    if (!this.store.state.settings.remindToExport) return;
    // The moment the note is created is the moment the offer makes sense.
    setTimeout(() => this.offerCalendar(), 400);
  }

  afterEdit() {
    this.armReminders();
    this.render();
  }

  offerCalendar() {
    const link = calendarLink(this, { onlyNew: true, cls: '.soft', label: 'Send' });
    if (!link) return; // nothing pending right after adding a note is not expected, but guard anyway
    link.style.padding = '8px 13px';
    link.style.fontSize = '13px';

    const bar = h('div.banner.moss',
      icon('cal2', 16),
      h('div.grow',
        h('strong.small', 'Get a real reminder'),
        h('div.tiny.muted', 'Send it to your iPhone Calendar and the alert fires even when this app is closed.')),
      link,
      h('button.x', { type: 'button', 'aria-label': 'Dismiss', onclick: () => bar.remove() }, icon('x', 13)));

    link.addEventListener('click', () => bar.remove());
    this.bannerHost.appendChild(bar);
    setTimeout(() => bar.remove(), 14000);
  }

  // --- rendering ----------------------------------------------------------

  render() {
    this.renderBanners();

    if (this.showingWelcome) {
      mount(this.screenHost, welcomeScreen(this));
      mount(this.tabHost);
      return;
    }

    let screen;
    if (this.tab === 'daily') screen = dailyScreen(this);
    else if (this.tab === 'temporary') screen = temporaryScreen(this);
    else if (this.tab === 'permanent') screen = permanentScreen(this);
    else if (this.tab === 'settings') screen = settingsScreen(this);
    else screen = scheduleScreen(this);

    mount(this.screenHost, screen);
    mount(this.tabHost, this.tabBar());
  }

  renderBanners() {
    const banners = [];

    const sweep = this.store.lastSweep;
    if (sweep && sweep.expired.length) {
      const names = sweep.expired.slice(0, 3).join(', ');
      const extra = sweep.expired.length > 3 ? ` and ${sweep.expired.length - 3} more` : '';
      banners.push(this.banner('gold', 'wind',
        sweep.expired.length === 1 ? 'A note has expired' : `${sweep.expired.length} notes have expired`,
        `${names}${extra} came off your schedule. They're in Settings › Recently cleared.`,
        () => this.store.dismissSweep()));
    }

    if (this.missed.length) {
      const names = this.missed.slice(0, 3).map((m) => m.title).join(', ');
      banners.push(this.banner('moss', 'bell',
        this.missed.length === 1 ? 'A reminder came due' : `${this.missed.length} reminders came due`,
        `${names} — while the app was closed. Send your notes to Calendar so the phone catches these itself.`,
        () => { this.missed = []; this.render(); }));
    }

    if (!isInstalled() && !this.dismissedInstall) {
      banners.push(this.banner('moss', 'phone', 'Add MySchedule to your Home Screen',
        'Tap the Share button in Safari, then "Add to Home Screen". It then opens full screen, works offline, and keeps your notes safer.',
        () => {
          this.dismissedInstall = true;
          try { localStorage.setItem(HIDE_INSTALL_KEY, '1'); } catch (error) { /* ignore */ }
          this.render();
        }));
    }

    mount(this.bannerHost, ...banners);
  }

  banner(tone, iconName, title, message, onDismiss) {
    return h(`div.banner.${tone}`,
      icon(iconName, 16),
      h('div.grow',
        h('strong.small', { text: title }),
        h('div.tiny.muted', { text: message })),
      h('button.x', { type: 'button', 'aria-label': 'Dismiss', onclick: onDismiss }, icon('x', 13)));
  }

  tabBar() {
    const bar = h('div.tabbar', { role: 'tablist' });
    for (const tab of TABS) {
      const selected = this.tab === tab.key;
      const button = h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': selected ? 'true' : 'false',
        onclick: () => { this.tab = tab.key; this.render(); },
      }, icon(tab.icon, 22), h('span', { text: tab.label }));

      if (tab.key === 'temporary' && this.store.attentionCount > 0) {
        button.appendChild(h('span.dot', { text: String(this.store.attentionCount) }));
      }
      bar.appendChild(button);
    }
    return bar;
  }
}

// Two soft ridgelines behind everything, drawn once as inline SVG.
const RIDGES = `
<svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 18 Q 14 11 26 17 T 52 15 T 78 19 T 100 14 L100 40 L0 40 Z"
        fill="var(--moss)" opacity="0.10"/>
  <path d="M0 26 Q 18 20 32 26 T 62 24 T 88 28 T 100 24 L100 40 L0 40 Z"
        fill="var(--moss)" opacity="0.13"/>
  <path d="M0 34 Q 22 30 40 34 T 74 33 T 100 35 L100 40 L0 40 Z"
        fill="var(--bark)" opacity="0.09"/>
</svg>`;

// ---------------------------------------------------------------------------

const app = new App(document.getElementById('app'));
app.start();
window.myschedule = app;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is a bonus */ });
  });
}
