// sw.js — offline support.
//
// The app is small and entirely static, so the whole shell is precached on
// install and served cache-first. A background fetch refreshes each file for
// next time, which means a new version is picked up on the second launch after
// a deploy rather than needing a hard reload.

const VERSION = 'myschedule-v8';

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
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

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
