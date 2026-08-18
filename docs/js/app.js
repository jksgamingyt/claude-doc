// app.js — entry point, routing, and the launch sequence.

import { Store } from './store.js';
import { Reminders, isInstalled, permission } from './notify.js';
import { h, mount, icon, toast } from './ui.js';
import {
  welcomeScreen, scheduleScreen, temporaryScreen, permanentScreen,
} from './screens.js';
import { settingsScreen, sendToCalendar, openHowItWorks } from './settings.js';

const TABS = [
  { key: 'schedule', label: 'Schedule', icon: 'calendar' },
  { key: 'temporary', label: 'Temporary', icon: 'hourglass' },
  { key: 'permanent', label: 'Permanent', icon: 'leaf' },
  { key: 'settings', label: 'Settings', icon: 'gear' },
];

const HIDE_INSTALL_KEY = 'myschedule.hideInstallHint';

class App {
  constructor(root) {
    this.root = root;
    this.store = new Store();
    this.reminders = new Reminders(this.store);
    this.view = { mode: 'month', month: null, focus: null };
    this.tab = 'schedule';
    this.showingWelcome = this.store.state.settings.showWelcomeOnLaunch;
    this.missed = [];
    this.dismissedInstall = localStorage.getItem(HIDE_INSTALL_KEY) === '1';

    if (!this.showingWelcome && this.store.state.settings.startTab !== 'ask') {
      this.tab = this.store.state.settings.startTab;
    }

    this.screenHost = h('div', { style: { display: 'contents' } });
    this.bannerHost = h('div');
    this.tabHost = h('div');

    mount(this.root,
      h('div.backdrop', { html: RIDGES }),
      this.bannerHost,
      this.screenHost,
      this.tabHost,
    );

    this.applyTheme();
    this.store.subscribe(() => this.render());
  }

  // --- launch -------------------------------------------------------------

  start() {
    this.store.state.now = Date.now();
    this.missed = this.reminders.catchUp();
    this.store.sweep();
    this.armReminders();
    this.render();

    // Keep relative labels honest and roll the day over.
    this.clock = setInterval(() => {
      const before = this.store.state.now;
      this.store.state.now = Date.now();
      if (new Date(before).getMinutes() !== new Date().getMinutes()) this.render();
    }, 20000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      this.store.state.now = Date.now();
      this.missed = this.reminders.catchUp();
      this.store.sweep();
      this.armReminders();
      this.render();
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
    const bar = h('div.banner.moss',
      icon('cal2', 16),
      h('div.grow',
        h('strong.small', 'Get a real reminder'),
        h('div.tiny.muted', 'Send it to your iPhone Calendar and the alert fires even when this app is closed.')),
      h('button.btn.soft', {
        type: 'button', style: { padding: '8px 13px', fontSize: '13px' },
        onclick: () => { bar.remove(); sendToCalendar(this, { onlyNew: true }); },
      }, 'Send'),
      h('button.x', { type: 'button', 'aria-label': 'Dismiss', onclick: () => bar.remove() }, icon('x', 13)));

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
    if (this.tab === 'temporary') screen = temporaryScreen(this);
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
