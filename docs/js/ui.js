// ui.js — the small vocabulary every screen is built from.
//
// No framework. `h` builds elements, screens rebuild themselves wholesale on
// state change, and the few elements that must keep focus (the compose field)
// live outside the region that gets rebuilt.

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

/**
 * h('div.card', { onclick }, child, child)
 * The tag accepts CSS-ish shorthand: 'button.chip.clay', 'span#total'.
 */
export function h(spec, props, ...children) {
  const [tagPart, ...classParts] = String(spec).split('.');
  const [tag, id] = tagPart.split('#');
  const el = document.createElement(tag || 'div');

  if (id) el.id = id;
  if (classParts.length) el.className = classParts.join(' ');

  if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') {
        el.className = el.className ? `${el.className} ${value}` : value;
      } else if (key === 'html') {
        el.innerHTML = value;
      } else if (key === 'text') {
        el.textContent = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value);
      } else if (key === 'value') {
        el.value = value;
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  } else if (props != null) {
    children.unshift(props);
  }

  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

// ---------------------------------------------------------------------------
// Icons — a stroked 24x24 set, drawn rather than imported
// ---------------------------------------------------------------------------

const PATHS = {
  calendar: 'M4 6a2 2 0 012-2h12a2 2 0 012 2v13a2 2 0 01-2 2H6a2 2 0 01-2-2zM4 9h16M9 3v4M15 3v4',
  hourglass: 'M7 3h10M7 21h10M8 3c0 4 4 5 4 9s-4 5-4 9M16 3c0 4-4 5-4 9s4 5 4 9',
  leaf: 'M20 4c0 9-5 14-13 15C6 11 11 5 20 4zM7 19c2-4 5-7 9-9',
  gear: 'M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 007.5 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 14V14a2 2 0 010-4h.1A1.6 1.6 0 004.6 7.5l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0010 4.6V4a2 2 0 014 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1A1.6 1.6 0 0021 10h.1a2 2 0 010 4H21a1.6 1.6 0 00-1.6 1z',
  check: 'M5 12.5l4.5 4.5L19 7',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  up: 'M12 19V5M5 12l7-7 7 7',
  send: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16V8M8.5 11.5L12 8l3.5 3.5',
  bell: 'M18 9a6 6 0 10-12 0c0 6-2 8-2 8h16s-2-2-2-8M13.7 20a2 2 0 01-3.4 0',
  bellOff: 'M18 9a6 6 0 00-9.3-5M5.8 6.3A6 6 0 006 9c0 6-2 8-2 8h13M13.7 20a2 2 0 01-3.4 0M3 3l18 18',
  wind: 'M4 8h9a3 3 0 10-3-3M3 13h13a3 3 0 11-3 3M3 18h7',
  repeat: 'M17 2l3 3-3 3M20 5H8a4 4 0 00-4 4v1M7 22l-3-3 3-3M4 19h12a4 4 0 004-4v-1',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3.2 2',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  sunrise: 'M12 3.5v5M9.5 6L12 3.5 14.5 6M3 20h18M7 16a5 5 0 0110 0',
  moon: 'M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z',
  x: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13',
  play: 'M7 4l12 8-12 8z',
  pause: 'M9 4v16M15 4v16',
  undo: 'M4 9h11a5 5 0 010 10h-3M4 9l4-4M4 9l4 4',
  share: 'M12 15V3M8 7l4-4 4 4M4 13v6a2 2 0 002 2h12a2 2 0 002-2v-6',
  download: 'M12 3v12M8 11l4 4 4-4M4 19h16',
  infinity: 'M7 15a3 3 0 110-6c3 0 5 6 8 6a3 3 0 100-6c-3 0-5 6-8 6z',
  book: 'M4 4h6a3 3 0 013 3v13a2.5 2.5 0 00-2.5-2.5H4zM20 4h-6a3 3 0 00-3 3v13a2.5 2.5 0 012.5-2.5H20z',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z',
  alert: 'M12 9v5M12 17.5v.5M10.3 4.3L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z',
  arrowRight: 'M4 12h15M13 6l6 6-6 6',
  hill: 'M2 19l6-9 4 5 3-4 7 8z',
  case: 'M4 8h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1zM9 8V5a1 1 0 011-1h4a1 1 0 011 1v3',
  week: 'M4 6h16M4 12h16M4 18h10',
  plus: 'M12 5v14M5 12h14',
  cal2: 'M4 7a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2zM4 10h16M8 3v4M16 3v4M9 15h2',
  phone: 'M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2zM11 18h2',
  lock: 'M6 11h12a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1v-8a1 1 0 011-1zM8 11V7a4 4 0 018 0v4',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM12 13a1 1 0 100-2 1 1 0 000 2z',
};

const FILLED = new Set(['play']);

export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PATHS[name] || PATHS.leaf);
  if (FILLED.has(name)) {
    path.setAttribute('fill', 'currentColor');
  } else {
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.appendChild(path);
  return svg;
}

// ---------------------------------------------------------------------------
// The leaf mark
// ---------------------------------------------------------------------------

let markSeq = 0;

/**
 * The app's leaf, drawn as a lens between two circles — the same construction
 * as the app icon, but transparent so it sits on the backdrop rather than on a
 * square of its own.
 */
export function leafMark(size = 92) {
  const width = size * 0.56;
  const height = size * 0.94;
  const cx = size / 2;
  const cy = size / 2;
  const halfHeight = height / 2;
  const halfWidth = width / 2;
  // Radius of the two circles whose overlap is a lens of exactly this size.
  const radius = (halfHeight * halfHeight + halfWidth * halfWidth) / (2 * halfWidth);
  const top = cy - halfHeight;
  const bottom = cy + halfHeight;

  const veins = [0.32, 0.5, 0.68].map((t) => {
    const y = top + height * t;
    const y2 = y + height * 0.1;
    return `<path d="M${cx} ${y} L${cx - width * 0.32} ${y2}"/>`
         + `<path d="M${cx} ${y} L${cx + width * 0.32} ${y2}"/>`;
  }).join('');

  markSeq += 1;
  const gradient = `leaf-grad-${markSeq}`;

  const svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <linearGradient id="${gradient}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="var(--fern)"/>
      <stop offset="1" stop-color="var(--moss)"/>
    </linearGradient>
  </defs>
  <g transform="rotate(-16 ${cx} ${cy})">
    <path d="M${cx} ${top} A${radius} ${radius} 0 0 1 ${cx} ${bottom} A${radius} ${radius} 0 0 1 ${cx} ${top} Z"
          fill="url(#${gradient})"/>
    <g fill="none" stroke="var(--canvas)" stroke-linecap="round">
      <path d="M${cx} ${top + height * 0.05} L${cx} ${bottom - height * 0.05}"
            stroke-width="${Math.max(1, size * 0.022)}" opacity="0.5"/>
      <g stroke-width="${Math.max(0.8, size * 0.014)}" opacity="0.34">${veins}</g>
    </g>
  </g>
</svg>`;

  return h('span', { html: svg, style: { display: 'inline-flex', lineHeight: '0' } });
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export function pill(text, kind = '', iconName = null) {
  return h(`span.pill${kind ? '.' + kind : ''}`, iconName && icon(iconName, 11), text);
}

export function chip(label, selected, onClick, { tone = '', iconName = null } = {}) {
  return h(
    `button.chip${tone ? '.' + tone : ''}`,
    { type: 'button', 'aria-pressed': selected ? 'true' : 'false', onclick: onClick },
    iconName && icon(iconName, 13),
    label,
  );
}

/**
 * A one-of-N chooser on a track instead of a row of buttons.
 *
 * The value updates live while dragging but the surrounding screen is only
 * rebuilt on release — rebuilding mid-drag would tear the slider out from under
 * the finger holding it.
 *
 *   options   the values, in the order they sit on the track
 *   value     the currently selected one
 *   format    value -> the text shown above the track
 *   onInput   called on every movement; update your draft here
 *   onCommit  called once on release; refresh the screen here
 */
export function optionSlider({
  options,
  value,
  format,
  onInput,
  onCommit,
  tone = '',
  label = '',
  ariaLabel,
  showTicks = true,
}) {
  const startIndex = Math.max(0, options.findIndex((option) => option === value));

  const readout = h('span.slider-value', { text: format(options[startIndex], startIndex) });
  const input = h('input.slider', {
    type: 'range',
    min: '0',
    max: String(Math.max(0, options.length - 1)),
    step: '1',
    value: String(startIndex),
    'aria-label': ariaLabel || label || 'Choose an option',
    'aria-valuetext': format(options[startIndex], startIndex),
  });

  function paint(index) {
    const span = Math.max(1, options.length - 1);
    input.style.setProperty('--fill', `${(index / span) * 100}%`);
  }

  input.addEventListener('input', () => {
    const index = Number(input.value);
    const text = format(options[index], index);
    readout.textContent = text;
    input.setAttribute('aria-valuetext', text);
    paint(index);
    if (onInput) onInput(options[index], index);
  });

  input.addEventListener('change', () => {
    if (onCommit) onCommit(options[Number(input.value)], Number(input.value));
  });

  paint(startIndex);

  // Ticks only help while they stay countable.
  const ticks = showTicks && options.length <= 9
    ? h('div.slider-ticks', ...options.map(() => h('i')))
    : null;

  return h(`div.slider-field${tone ? '.' + tone : ''}`,
    h('div.slider-head',
      label && h('span.slider-label', { text: label }),
      readout),
    input,
    ticks,
    h('div.slider-ends',
      h('span', { text: format(options[0], 0) }),
      h('span', { text: format(options[options.length - 1], options.length - 1) })),
  );
}

/**
 * A slider over a continuous range with a handful of labelled stops on it —
 * for values that are genuinely points on a scale (a time of day, a
 * duration) rather than a short list of named choices.
 *
 * Landing exactly on a stop behaves like optionSlider always has: letting go
 * commits straight away. Anywhere else is a custom, off-grid value: the
 * slider is free to rest there (dragging between 3pm and 6pm can land on
 * 4pm, not just snap to whichever preset is nearer). While that's happening
 * a small "Custom" readout pops up over the thumb naming the exact value —
 * a momentary confirmation, the same idea as the volume HUD on a phone, not
 * a permanent label — and letting go does NOT immediately rebuild the
 * screen around it or snatch the readout away. The value itself still
 * updates live via onInput, same as always; only the surrounding screen's
 * catch-up (onCommit) waits, `commitDelayMs` after the last movement, and
 * the readout fades out at that same moment. A still-settling drag never
 * gets cut off mid-adjustment, and there's always a beat to actually see
 * what was just set before it goes away.
 *
 * The bubble only ever appears in response to an actual interaction in this
 * render — never on first paint, even editing a note whose time is already
 * off-grid. It is a "you just changed this" confirmation, not a permanent
 * marker; the plain readout above the track already names the exact value
 * at all times, custom or not.
 *
 * If the step this slider lives on gets torn down (Back/Next/close) before
 * that delay is up, the pending commit is dropped rather than fired blind —
 * see the document.contains(input) guard below. Without it, a slow-motion
 * refresh() lands on whatever the wizard has moved on to since, which is
 * exactly the class of stray re-render that has cost this app its keyboard
 * before.
 */
export function continuousSlider({
  min,
  max,
  step = 1,
  stops = [],
  value,
  format,
  formatCustom = format,
  onInput,
  onCommit,
  tone = '',
  label = '',
  ariaLabel,
  commitDelayMs = 2000,
}) {
  const isStop = (v) => stops.includes(v);

  const readout = h('span.slider-value', { text: format(value) });
  const input = h('input.slider', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    'aria-label': ariaLabel || label || 'Choose a value',
    'aria-valuetext': format(value),
  });
  const bubble = h('div.slider-custom', { 'aria-hidden': 'true' });
  const track = h('div.slider-track', bubble, input);

  function paint(v) {
    const fraction = (v - min) / Math.max(1, max - min);
    input.style.setProperty('--fill', `${fraction * 100}%`);
    return fraction;
  }

  function setReadoutText(v) {
    const text = isStop(v) ? format(v) : formatCustom(v);
    readout.textContent = text;
    input.setAttribute('aria-valuetext', text);
  }

  /**
   * The bubble is centred on the thumb by default, but its width varies with
   * the text ("2:10 AM" vs "11:59 PM" vs "45m") and the thumb can sit right
   * at either end of the track — centred-with-no-clamp runs the bubble off
   * the edge of the card there. Measuring its real rendered width (already
   * available even while opacity: 0, since the box still lays out) and
   * clamping in pixels is the only way to keep it on-screen at every value,
   * not just the ones a fixed CSS rule happens to cover.
   */
  function positionBubble(fraction) {
    const trackWidth = track.offsetWidth;
    const bubbleWidth = bubble.offsetWidth;
    if (!trackWidth || !bubbleWidth) {
      bubble.style.left = `${fraction * 100}%`;
      bubble.style.transform = 'translateX(-50%)';
      return;
    }
    const half = bubbleWidth / 2;
    const centerPx = Math.min(trackWidth - half, Math.max(half, fraction * trackWidth));
    bubble.style.left = `${centerPx}px`;
    bubble.style.transform = 'translateX(-50%)';
  }

  // The bubble sits right beside the numeric readout at this width, so the
  // two would otherwise overlap for any value near the right-hand end of the
  // track. The bubble already says the same thing more prominently, right at
  // the thumb, so the readout dims out of its way rather than the two
  // fighting for the same space.
  function showBubble(v, fraction) {
    bubble.textContent = `Custom · ${formatCustom(v)}`;
    bubble.classList.add('visible');
    readout.classList.add('dim');
    positionBubble(fraction); // after the text, not before — width depends on it
  }

  function hideBubble() {
    bubble.classList.remove('visible');
    readout.classList.remove('dim');
  }

  let commitTimer = null;
  function clearTimer() {
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
  }
  function scheduleSettle(v) {
    clearTimer();
    commitTimer = setTimeout(() => {
      commitTimer = null;
      hideBubble();
      if (!document.contains(input)) return; // this step has moved on; nothing to catch up
      if (onCommit) onCommit(v);
    }, commitDelayMs);
  }

  input.addEventListener('input', () => {
    const v = Number(input.value);
    setReadoutText(v);
    const fraction = paint(v);
    if (onInput) onInput(v);
    if (isStop(v)) { clearTimer(); hideBubble(); } else { showBubble(v, fraction); scheduleSettle(v); }
  });

  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (isStop(v)) {
      clearTimer();
      hideBubble();
      if (onCommit) onCommit(v);
    } else {
      // A release can land here without a preceding `input` in some
      // browsers (a single tap that both drags and lets go) — make sure the
      // bubble is showing and the grace period is running rather than
      // assuming either already is.
      showBubble(v, (v - min) / Math.max(1, max - min));
      scheduleSettle(v);
    }
  });

  paint(value);
  setReadoutText(value);

  const ticks = stops.length
    ? h('div.slider-ticks-abs', ...stops.map((stop) => h('i', {
      style: { left: `${((stop - min) / Math.max(1, max - min)) * 100}%` },
    })))
    : null;
  if (ticks) track.appendChild(ticks);

  return h(`div.slider-field${tone ? '.' + tone : ''}`,
    h('div.slider-head',
      label && h('span.slider-label', { text: label }),
      readout),
    track,
    h('div.slider-ends',
      h('span', { text: format(min) }),
      h('span', { text: format(max) })),
  );
}

export function toggleRow(label, help, value, onChange) {
  return h('div.toggle-row',
    h('div',
      h('div', { text: label }),
      help && h('div.tiny.faint', { text: help })),
    h('button.switch', {
      type: 'button',
      role: 'switch',
      'aria-checked': value ? 'true' : 'false',
      'aria-pressed': value ? 'true' : 'false',
      'aria-label': label,
      onclick: () => onChange(!value),
    }),
  );
}

export function selectRow(label, value, options, onChange) {
  const select = h('select', {
    onchange: (event) => onChange(event.target.value),
    'aria-label': label,
  });
  for (const [key, text] of options) {
    select.appendChild(h('option', { value: key, selected: String(key) === String(value) }, text));
  }
  return h('div.toggle-row', h('div', { text: label }), select);
}

export function emptyState(iconName, title, message, actionLabel, onAction) {
  return h('div.empty',
    h('div.halo', icon(iconName, 28)),
    h('h2', { text: title }),
    h('p', { text: message }),
    actionLabel && h('button.btn.soft', { type: 'button', onclick: onAction }, actionLabel),
  );
}

export function fieldBlock(title, help, ...content) {
  return h('div.field-block',
    h('h3', { text: title }),
    help && h('p.help', { text: help }),
    ...content,
  );
}

export function summaryCard(iconName, headline, detail, tone = '') {
  return h(`div.summary${tone ? '.' + tone : ''}`,
    icon(iconName, 16),
    h('div',
      h('strong', { text: headline }),
      h('div.small.muted', { text: detail })),
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer = null;

export function toast(message, ms = 2600) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  if (toastTimer) clearTimeout(toastTimer);

  const el = h('div.toast', { role: 'status' }, message);
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), ms);
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

/**
 * Opens a modal sheet. `build` receives a controller with `close()` and the
 * head/body/foot elements to fill.
 */
export function openSheet(build) {
  const backdrop = h('div.sheet-backdrop');
  const head = h('div.sheet-head');
  const body = h('div.sheet-body');
  const foot = h('div.sheet-foot');
  const sheet = h('div.sheet', { role: 'dialog', 'aria-modal': 'true' }, head, body, foot);

  const controller = {
    head,
    body,
    foot,
    close() {
      backdrop.remove();
      sheet.remove();
      document.removeEventListener('keydown', onKey);
    },
  };

  function onKey(event) {
    if (event.key === 'Escape') controller.close();
  }

  backdrop.addEventListener('click', () => controller.close());
  document.addEventListener('keydown', onKey);

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);

  build(controller);
  return controller;
}

/** A yes/no confirmation, styled like the rest of the app. */
export function confirmSheet({ title, message, confirmLabel = 'Remove', danger = true, onConfirm }) {
  openSheet((sheet) => {
    sheet.head.appendChild(h('button', { type: 'button', onclick: sheet.close }, 'Cancel'));
    sheet.head.appendChild(h('div.mid', h('strong', { text: title })));
    sheet.head.appendChild(h('span', { style: { width: '54px' } }));

    sheet.body.appendChild(h('p.muted', { text: message }));

    sheet.foot.appendChild(h('button.btn.soft', { type: 'button', onclick: sheet.close }, 'Keep it'));
    sheet.foot.appendChild(h(`button.btn${danger ? '.clay' : ''}`, {
      type: 'button',
      onclick: () => { sheet.close(); onConfirm(); },
    }, confirmLabel));
  });
}

// ---------------------------------------------------------------------------
// Sharing a generated file — the reliable path on iOS
// ---------------------------------------------------------------------------

/**
 * Hands the user a file. iOS standalone web apps handle `navigator.share` with
 * a File far more reliably than an <a download>, so that is tried first; the
 * link is the fallback for everything else.
 */
export async function offerFile(filename, text, mime, shareTitle) {
  const file = new File([text], filename, { type: mime });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: shareTitle });
      return 'shared';
    } catch (error) {
      if (error && error.name === 'AbortError') return 'cancelled';
      // fall through to the download path
    }
  }

  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 4000);
  return 'downloaded';
}
