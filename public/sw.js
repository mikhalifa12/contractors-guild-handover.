/**
 * Contractors Guild service worker.
 *
 * Strategy:
 * - navigation requests (page loads): network-first, fall back to the cached
 *   offline page when the PC/server is unreachable — so a contractor on a
 *   building site with no Wi-Fi still gets a friendly screen instead of a
 *   browser dinosaur.
 * - icons/manifest: stale-while-revalidate.
 * - everything else: network-only (forms and live data must never come from a
 *   stale cache — this app edits money records).
 *
 * Bump CACHE_VERSION when you change the offline page or icons.
 */

const CACHE_VERSION = 'cg-pwa-v1';
const OFFLINE_URL = '/offline';
const PRECACHE = [
  OFFLINE_URL,
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;

  // App shell icons and the manifest: stale-while-revalidate.
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      })
    );
    return;
  }

  // Page navigations: try the network, fall back to the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = (await cache.match(request)) ?? (await cache.match(OFFLINE_URL));
        return (
          cached ??
          new Response('You are offline. Reconnect to the workshop Wi-Fi and try again.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        );
      })
    );
  }
});
