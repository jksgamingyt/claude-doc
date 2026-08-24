// sw.js — offline support.
//
// The app is small and entirely static, so the whole shell is precached on
// install and served cache-first. A background fetch refreshes each file for
// next time, which means a new version is picked up on the second launch after
// a deploy rather than needing a hard reload.

const VERSION = 'myschedule-v10';

// The calendar hand-off lives in its own cache, deliberately outside VERSION
// so a deploy never wipes a feed the user is about to open. See the note on
// the fetch handler below for why this exists at all.
const FEED_CACHE = 'myschedule-calendar-feed';
const FEED_PATH = 'calendar/MySchedule.ics';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/model.js',
  './js/engine.js',
  './js/store.js',
  './js/ics.js',
  './js/crypto.js',
  './js/lock.js',
  './js/notify.js',
  './js/ui.js',
  './js/wizard.js',
  './js/screens.js',
  './js/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== VERSION && key !== FEED_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The calendar hand-off.
  //
  // iOS opens its "Add All to Calendar" screen when Safari *navigates* to a
  // resource served as text/calendar. It will not do it for a data: URI
  // (WebKit blocks top-level data: navigation outright — that was the bug:
  // the tap did nothing while the app cheerfully marked the notes as sent),
  // and a blob: URL is not a navigable document either.
  //
  // With no server to serve a real .ics from, the service worker is the
  // server: the page writes the generated file into FEED_CACHE, and this
  // responds to a normal same-origin URL with real text/calendar headers.
  // From Safari's side that is indistinguishable from a hosted file.
  if (url.pathname.endsWith(`/${FEED_PATH}`)) {
    event.respondWith(
      caches.open(FEED_CACHE)
        .then((cache) => cache.match(url.href))
        .then((hit) => hit || new Response(
          'No calendar file has been prepared yet. Open MySchedule and tap "Add to Calendar" again.',
          { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
        ))
        .catch(() => new Response('Calendar hand-off failed.', { status: 500 })),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      // Cache first so the app opens instantly and works with no signal.
      return cached || network;
    }),
  );
});

// The page asks, before it points a link at the calendar route, whether the
// worker actually serving it knows that route at all. Right after an update
// the *previous* version is still in control, and it does not — a link
// pointing there would hand Safari a 404, which is indistinguishable to the
// user from the silent failure this whole route exists to fix. An old worker
// simply never answers this, which is the correct answer.
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'capabilities') return;
  const port = event.ports && event.ports[0];
  if (port) port.postMessage({ version: VERSION, calendarFeed: true });
});

// Tapping a notification should bring the app forward rather than open a tab.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow('./') : undefined;
    }),
  );
});
