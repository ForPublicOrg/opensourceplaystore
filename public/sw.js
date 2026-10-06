/* Service worker: what lets the site run as an installed app.

   It never makes browsing staler than the site is without it:
   - Pages always come from the network first. The last few dozen pages you
     opened are kept, and served only when there is no connection, so a page
     you have seen still opens offline. Any other page gets /offline/ instead
     of the browser's error screen.
   - Scripts and the font carry a hash of their contents in the URL (?v=…,
     see build.js), so a kept copy can never be out of date: those are
     served from storage first.
   - Everything else from this site (the search index, the manifest, the
     icons) comes from the network first, with the last copy as a fallback.
   - Other sites (GitHub, F-Droid, the download counter) are never touched.

   build.js fills in VERSION with a hash of the offline page, so a change to
   the page shell (styles, scripts) also stores a fresh copy of that page.

   To take the worker away, publish a sw.js that only calls
   self.registration.unregister(): browsers fetch this file on each visit. */
'use strict';

const VERSION = '__VERSION__';
const OFFLINE = '/offline/';
const SHELL = `osps-shell-${VERSION}`;
const PAGES = 'osps-pages';
const FILES = 'osps-files';
const MAX_PAGES = 50;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.add(new Request(OFFLINE, { cache: 'reload' })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    /* Starts the page request while the worker boots, not after. */
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    const keep = [SHELL, PAGES, FILES];
    for (const key of await caches.keys()) {
      if (key.startsWith('osps-') && !keep.includes(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const url = new URL(request.url);
  /* Vercel's analytics lives under /_vercel/ and is left alone. */
  if (url.origin !== self.location.origin || url.pathname.startsWith('/_vercel/')) return;
  if (request.mode === 'navigate') event.respondWith(page(event));
  else if (url.searchParams.has('v')) event.respondWith(hashed(event));
  else event.respondWith(latest(event));
});

const usable = (response) => response.ok && response.type === 'basic';

async function page(event) {
  try {
    const response = (await event.preloadResponse) || (await fetch(event.request));
    if (usable(response)) {
      const copy = response.clone();
      event.waitUntil(keepPage(event.request, copy));
    }
    return response;
  } catch (err) {
    /* No network: the last copy of this page, else of the same page with
       another ?query (a search, the Search tab's ?focus=search), else the
       offline page. */
    const cache = await caches.open(PAGES);
    return (await cache.match(event.request, { ignoreVary: true }))
      || (await cache.match(event.request, { ignoreSearch: true, ignoreVary: true }))
      || (await caches.match(OFFLINE))
      || Response.error();
  }
}

async function keepPage(request, response) {
  const cache = await caches.open(PAGES);
  await cache.put(request, response);
  /* Oldest first; put() moves a page you open again to the end. */
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_PAGES)).map((key) => cache.delete(key)));
}

async function hashed(event) {
  const { request } = event;
  const cache = await caches.open(FILES);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (usable(response)) {
    const copy = response.clone();
    event.waitUntil((async () => {
      /* One copy per file: drop the versions this one replaces. */
      const path = new URL(request.url).pathname;
      for (const key of await cache.keys()) {
        if (new URL(key.url).pathname === path) await cache.delete(key);
      }
      await cache.put(request, copy);
    })());
  }
  return response;
}

async function latest(event) {
  const { request } = event;
  try {
    const response = await fetch(request);
    if (usable(response)) {
      const copy = response.clone();
      event.waitUntil(caches.open(FILES).then((cache) => cache.put(request, copy)));
    }
    return response;
  } catch (err) {
    const hit = await caches.match(request, { ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}
