// Minimal app-shell service worker. index.html is a single self-contained
// file (no separate CSS/JS bundles), so the shell to cache is just this
// handful of files. Google Sheets / Apps Script requests are cross-origin
// and deliberately left untouched below — caching those would mean stale
// inventory/pricing data getting served while "offline", which is worse
// than the app's existing fallback-data handling for a failed sheet fetch.
//
// v2: the app shell itself (index.html / navigation requests) switched from
// stale-while-revalidate to network-first. Stale-while-revalidate always
// serves the OLD cached index.html on every load and only refreshes the
// cache "for next time" in the background — so a rep with a connection
// still saw yesterday's code until a second reload, which is a bad trap
// for an app under active development (a bug fix landing on the server
// wouldn't actually reach anyone until they happened to reload twice).
// Network-first tries the real network on every load and only falls back
// to the cached copy when there's genuinely no connection, matching what
// "often-offline sales users" actually need: freshest code when online,
// still-usable app when not. Static assets (icons/manifest) don't affect
// app logic, so they keep the instant-from-cache/refresh-in-background
// behavior — no correctness risk in them lagging a version behind.
const CACHE_NAME = 'myfitness-orders-shell-v2';
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Navigations and index.html itself: network-first, cache only as an
  // offline fallback, so app code updates reach an online rep immediately
  // instead of waiting on a second reload.
  const isAppShellDoc = req.mode === 'navigate' || req.url.endsWith('/index.html') || req.url.endsWith('/');
  if (isAppShellDoc){
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(req)))
    );
    return;
  }

  // Everything else same-origin (icons, manifest): stale-while-revalidate —
  // instant from cache, refreshed in the background for next time.
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
