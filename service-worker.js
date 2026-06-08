// Kill switch — the oracle no longer uses a service worker.
//
// Older versions of index.html registered a cache-first service worker, which
// served stale pages after every deploy (it returned the cached index.html and
// only refreshed the cache in the background). The current index.html does NOT
// register any service worker, so new visitors never get one — but browsers
// that loaded an old version still have the cache-first SW stuck, serving stale
// code (this is why fixes don't appear without a manual DevTools unregister).
//
// This file replaces that SW with a self-destruct: on activation it purges all
// caches, unregisters itself, and reloads open windows. The byte change trips
// the browser's SW update check on the next navigation, so every already-
// registered client self-heals to fresh network content automatically — no
// DevTools, no manual "refresh cache" link. Safe to delete this file once
// traffic from old clients has drained (a few weeks).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {}
      await self.clients.claim();
      try {
        await self.registration.unregister();
      } catch (e) {}
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => {
        try { c.navigate(c.url); } catch (e) {}
      });
    })()
  );
});

// Always hit the network; only fall back to the (being-deleted) cache when
// offline. Never serve a stale page from cache.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
