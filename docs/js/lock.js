// lock.js — whether the app is locked right now, and the screen that gates it.
//
// This is a screen lock, not encryption. Notes in storage are not scrambled
// by the PIN; the PIN only gates whether the app draws them to the screen.
// That is still meaningfully useful against someone picking up an unlocked
// phone, but it does not protect against someone with direct access to the
// device's files — say so plainly in the UI rather than imply otherwise.

import { hashPin, verifyPin } from './crypto.js';
import { h, mount, icon, openSheet, confirmSheet, optionSlider, toast } from './ui.js';

const SESSION_KEY = 'myschedule.lockSession.v1';

export const REMEMBER_OPTIONS = [0, 15, 60, 240, 1440, 10080];

export function rememberLabel(minutes) {
  if (minutes === 0) return 'Every time';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${minutes / 60} hr`;
  if (minutes < 10080) return `${minutes / 1440} day`;
  return `${minutes / 10080} wk`;
}

/** Escalating cool-off after repeated wrong PINs. Deterministic and testable. */
export function lockoutSeconds(failedAttempts) {
  if (failedAttempts < 5) return 0;
  if (failedAttempts < 8) return 30;
  if (failedAttempts < 12) return 120;
  return 300;
}

/** Is the app locked right now, given settings and the current session? */
export function isLocked(settings, session, now = Date.now()) {
  if (!settings.pinEnabled || !settings.pinHash || !settings.pinSalt) return false;
  if (session && session.unlockedUntil && now < session.unlockedUntil) return false;
  return true;
}

export function rememberUntil(now, minutes) {
  return minutes > 0 ? now + minutes * 60000 : now;
}

// ---------------------------------------------------------------------------
// Session — deliberately separate from Store. This is per-device unlock
// state, not app data: it must not travel in a backup export, must not be
// reset by "erase everything", and has no business being importable.
// ---------------------------------------------------------------------------

export function loadSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
    return {
      unlockedUntil: typeof raw.unlockedUntil === 'number' ? raw.unlockedUntil : 0,
      failedAttempts: typeof raw.failedAttempts === 'number' ? raw.failedAttempts : 0,
      lockedUntil: typeof raw.lockedUntil === 'number' ? raw.lockedUntil : 0,
    };
  } catch (error) {
    return { unlockedUntil: 0, failedAttempts: 0, lockedUntil: 0 };
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    /* a full disk here just means more frequent PIN prompts, not data loss */
  }
}

// ---------------------------------------------------------------------------
// The lock screen
// ---------------------------------------------------------------------------

const PIN_LENGTH = 4;

/**
 * Renders the lock screen into `container`. Calls `onUnlock()` once, the
 * moment a correct PIN lands, and never again — the caller owns what happens
 * after that.
 */
export function renderLockScreen(container, store, onUnlock) {
  const session = loadSession();
  let digits = [];
  let checking = false;

  const dots = h('div.pin-dots');
  const message = h('div.pin-message', { text: 'Enter your PIN' });
  const pad = h('div.pin-pad');
  const forgot = h('button.pin-forgot', { type: 'button' }, 'Forgot PIN?');

  let countdownTimer = null;

  function paintDots() {
    mount(dots, ...Array.from({ length: PIN_LENGTH }, (_, index) =>
      h(`i${index < digits.length ? '.filled' : ''}`)));
  }

  function setKeysEnabled(enabled) {
    for (const key of pad.querySelectorAll('button')) key.disabled = !enabled;
  }

  function startCountdown(seconds) {
    setKeysEnabled(false);
    let remaining = seconds;
    message.textContent = `Too many tries — wait ${remaining}s`;
    message.classList.add('warn');
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        message.textContent = 'Enter your PIN';
        message.classList.remove('warn');
        setKeysEnabled(true);
      } else {
        message.textContent = `Too many tries — wait ${remaining}s`;
      }
    }, 1000);
  }

  async function submit() {
    if (checking) return;
    checking = true;
    setKeysEnabled(false);

    const pin = digits.join('');
    const settings = store.state.settings;
    const correct = await verifyPin(pin, settings.pinSalt, settings.pinHash);

    if (correct) {
      session.failedAttempts = 0;
      session.lockedUntil = 0;
      session.unlockedUntil = rememberUntil(Date.now(), settings.pinRememberMinutes);
      saveSession(session);
      onUnlock();
      return;
    }

    session.failedAttempts += 1;
    saveSession(session);
    digits = [];
    paintDots();
    checking = false;

    const wait = lockoutSeconds(session.failedAttempts);
    if (wait > 0) {
      session.lockedUntil = Date.now() + wait * 1000;
      saveSession(session);
      startCountdown(wait);
    } else {
      message.textContent = 'Incorrect PIN';
      message.classList.add('warn');
      setKeysEnabled(true);
      setTimeout(() => {
        if (!countdownTimer) {
          message.textContent = 'Enter your PIN';
          message.classList.remove('warn');
        }
      }, 1400);
    }
  }

  function press(digit) {
    if (checking || digits.length >= PIN_LENGTH) return;
    digits.push(digit);
    paintDots();
    if (digits.length === PIN_LENGTH) submit();
  }

  function backspace() {
    if (checking || !digits.length) return;
    digits.pop();
    paintDots();
  }

  const LAYOUT = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  for (const key of LAYOUT) {
    if (key === '') {
      pad.appendChild(h('span'));
    } else if (key === '⌫') {
      pad.appendChild(h('button.pin-key.pin-key-del', {
        type: 'button', 'aria-label': 'Delete', onclick: backspace,
      }, icon('undo', 18)));
    } else {
      pad.appendChild(h('button.pin-key', { type: 'button', onclick: () => press(key) }, key));
    }
  }

  forgot.onclick = () => {
    confirmSheet({
      title: 'Remove the PIN lock?',
      message: "Your notes are not affected — they were never encrypted by the PIN, only hidden behind this screen. This just takes the screen down so you can set a new one, or leave it off.",
      confirmLabel: 'Remove the lock',
      onConfirm: () => {
        store.set('pinEnabled', false);
        store.set('pinHash', null);
        store.set('pinSalt', null);
        session.unlockedUntil = Date.now();
        saveSession(session);
        onUnlock();
      },
    });
  };

  paintDots();

  // If a cool-off is already in progress (the app was closed mid-countdown),
  // resume it rather than granting a fresh set of attempts for free.
  const remaining = Math.ceil((session.lockedUntil - Date.now()) / 1000);
  if (remaining > 0) startCountdown(remaining);

  mount(container,
    h('div.lock-screen',
      h('div.lock-bg'),
      h('div.lock-inner',
        h('div.lock-mark', icon('leaf', 40)),
        h('h1', 'Locked'),
        dots,
        message,
        pad,
        forgot,
      )),
  );
}

// ---------------------------------------------------------------------------
// Setting or changing the PIN, from Settings
// ---------------------------------------------------------------------------

export function openSetPinSheet(app, { onDone } = {}) {
  const store = app.store;

  openSheet((sheet) => {
    let stage = 'enter';
    let first = '';
    let digits = [];
    let checking = false;

    const dots = h('div.pin-dots');
    const message = h('div.pin-message', { text: 'Choose a 4-digit PIN' });
    const pad = h('div.pin-pad');

    function paintDots() {
      mount(dots, ...Array.from({ length: PIN_LENGTH }, (_, index) =>
        h(`i${index < digits.length ? '.filled' : ''}`)));
    }

    async function submit() {
      const pin = digits.join('');

      if (stage === 'enter') {
        first = pin;
        stage = 'confirm';
        digits = [];
        message.textContent = 'Enter it again to confirm';
        message.classList.remove('warn');
        paintDots();
        return;
      }

      if (pin !== first) {
        digits = [];
        stage = 'enter';
        first = '';
        message.textContent = "Didn't match — choose a 4-digit PIN";
        message.classList.add('warn');
        paintDots();
        return;
      }

      checking = true;
      for (const key of pad.querySelectorAll('button')) key.disabled = true;
      const { salt, hash } = await hashPin(pin);
      store.set('pinEnabled', true);
      store.set('pinSalt', salt);
      store.set('pinHash', hash);
      sheet.close();
      toast('PIN set');
      if (onDone) onDone();
    }

    function press(digit) {
      if (checking || digits.length >= PIN_LENGTH) return;
      digits.push(digit);
      paintDots();
      if (digits.length === PIN_LENGTH) submit();
    }

    function backspace() {
      if (checking || !digits.length) return;
      digits.pop();
      paintDots();
    }

    const LAYOUT = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    for (const key of LAYOUT) {
      if (key === '') pad.appendChild(h('span'));
      else if (key === '⌫') {
        pad.appendChild(h('button.pin-key.pin-key-del', {
          type: 'button', 'aria-label': 'Delete', onclick: backspace,
        }, icon('undo', 18)));
      } else {
        pad.appendChild(h('button.pin-key', { type: 'button', onclick: () => press(key) }, key));
      }
    }

    paintDots();

    mount(sheet.head,
      h('button', { type: 'button', onclick: sheet.close }, 'Cancel'),
      h('div.mid', h('strong', 'Set a PIN')),
      h('span', { style: { width: '54px' } }));
    mount(sheet.body, h('div.lock-setup', dots, message, pad));
  });
}

export function rememberSlider(store) {
  return optionSlider({
    options: REMEMBER_OPTIONS,
    value: store.state.settings.pinRememberMinutes,
    format: rememberLabel,
    label: 'Stay unlocked for',
    onInput: () => {},
    onCommit: (minutes) => store.set('pinRememberMinutes', minutes),
  });
}
