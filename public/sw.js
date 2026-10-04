/*
 * Family Planner service worker (O-41, docs/architecture/OFFLINE_SYNC.md).
 *
 * It does one thing: when a page navigation fails because there is no
 * network, it shows the pre-cached offline page (/offline.html) instead of the
 * browser's own error page.
 *
 * What it caches: only PRECACHE_URLS below (the static offline page, its one
 * illustration and the favicon). Never API responses, never app HTML, never
 * anything that depends on who is signed in.
 *
 * What it intercepts: same-origin GET navigations (network first, offline page
 * on a network error) and GET requests for the PRECACHE_URLS (network first,
 * cache on a network error). Every other request is left alone, so the
 * browser handles it exactly as if there were no service worker.
 *
 * Change anything in PRECACHE_URLS or offline.html? Bump CACHE_VERSION so
 * installed copies refresh. Retiring the worker: see OFFLINE_SYNC.md.
 *
 * Plain script (no imports, no build step). The module.exports block at the
 * bottom exists only for src/lib/__tests__/service-worker-script.test.ts; a
 * real service worker has no `module`, so it is skipped there.
 */

const CACHE_VERSION = 'v1'
const CACHE_PREFIX = 'fp-offline-'
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION
const OFFLINE_URL = '/offline.html'
const PRECACHE_URLS = [OFFLINE_URL, '/brand/illustrations/houses-banner.webp', '/favicon.svg']

async function precache() {
  const cache = await caches.open(CACHE_NAME)
  // cache: 'reload' skips the HTTP cache so a new version never stores a stale file.
  await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })))
}

async function removeOldCaches() {
  const names = await caches.keys()
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name))
  )
}

/** Which requests this worker answers. Anything else returns 'ignore'. */
function routeFor(request, origin) {
  if (request.method !== 'GET') return 'ignore'
  let url
  try {
    url = new URL(request.url)
  } catch {
    return 'ignore'
  }
  if (url.origin !== origin) return 'ignore'
  if (request.mode === 'navigate') return 'navigate'
  if (PRECACHE_URLS.includes(url.pathname) && !url.search) return 'precached'
  return 'ignore'
}

/** Network first; the offline page only when the network itself fails. */
async function handleNavigation(event) {
  try {
    const preloaded = await event.preloadResponse
    if (preloaded) return preloaded
    return await fetch(event.request)
  } catch (error) {
    // fetch() rejects only on a network failure. A 404 or 500 from the
    // server is a response and is passed through unchanged above.
    const offline = await caches.match(OFFLINE_URL, { cacheName: CACHE_NAME })
    if (offline) return offline
    throw error
  }
}

/** The offline page's own files: fresh from the network, the cache when offline. */
async function handlePrecached(request) {
  try {
    return await fetch(request)
  } catch (error) {
    const cached = await caches.match(new URL(request.url).pathname, { cacheName: CACHE_NAME })
    if (cached) return cached
    throw error
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await removeOldCaches()
      // Lets the navigation request start while the worker boots.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable()
      }
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const route = routeFor(event.request, self.location.origin)
  if (route === 'navigate') event.respondWith(handleNavigation(event))
  else if (route === 'precached') event.respondWith(handlePrecached(event.request))
})

if (typeof module === 'object' && module && module.exports) {
  module.exports = { CACHE_NAME, CACHE_PREFIX, OFFLINE_URL, PRECACHE_URLS, routeFor }
}
