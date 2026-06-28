/*
 * Dash Dots offline service worker.
 *
 * Purpose: let the OFFLINE modes (VS Bot / Hotseat) open instantly without
 * waking the online matchmaking server. The Render web service that hosts
 * this game spins down on the free tier, so a cold start is slow. By caching
 * the app shell + built assets, the page loads straight from cache and never
 * needs the server for a quick offline game.
 *
 * Online play is unaffected: matchmaking runs over a WebSocket (ws://wss://),
 * and service workers do not intercept WebSocket traffic. The server is only
 * contacted when you actually queue for an online match, so it still wakes on
 * demand exactly when it's needed.
 *
 * PRECACHE_URLS and CACHE_VERSION below are rewritten at build time by
 * scripts/inject-sw-precache.mjs with the real content-hashed asset list, so
 * EVERYTHING the app needs is cached on install (while the server is awake).
 * That makes later offline loads self-consistent and fully independent of the
 * browser HTTP cache and the server. The values here are a safe dev default.
 *
 * Strategy: cache-first for navigations + same-origin static assets. Because
 * Vite content-hashes filenames, a new deploy produces new names, a new
 * CACHE_VERSION, and a fresh precache on the next online visit; the old cache
 * is dropped on activate.
 */

const CACHE_VERSION = 'dash-dots-dev';
const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
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

function isCacheable(request, url) {
  if (request.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  // Always serve navigations from the shell so the page opens offline.
  if (request.mode === 'navigate') return true;
  // Static build output: scripts, styles, images, fonts, manifest, workers.
  return ['script', 'style', 'image', 'font', 'manifest', 'worker'].includes(request.destination);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // Only cache successful same-origin responses (type 'basic').
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    // Offline and not cached: fall back to the app shell for navigations.
    if (request.mode === 'navigate') {
      const fallback = await cache.match('/index.html');
      if (fallback) return fallback;
    }
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (!isCacheable(request, url)) return;
  event.respondWith(cacheFirst(request));
});
