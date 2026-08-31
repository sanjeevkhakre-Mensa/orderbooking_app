// Minimal app-shell service worker. index.html is a single self-contained
// file (no separate CSS/JS bundles), so the shell to cache is just this
// handful of files. Google Sheets / Apps Script requests are cross-origin
// and deliberately left untouched below — caching those would mean stale
// inventory/pricing data getting served while "offline", which is worse
// than the app's existing fallback-data handling for a failed sheet fetch.
const CACHE_NAME = 'myfitness-orders-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin GET requests only: serve the
// cached shell instantly (so the app still opens with no signal), while a
// background fetch refreshes the cache for next time. Every other request
// (Google Sheets CSV exports, the Apps Script order webhook, anything
// cross-origin) passes straight through to the network, untouched.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => { cache.put(req, res.clone()); return res; })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
