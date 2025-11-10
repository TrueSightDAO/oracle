const CACHE_VERSION = "iching-oracle-v20251110";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./assets/favicon.svg",
  "./assets/truesight-logo.png",
  "./scripts/hexagram_texts.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function fromCache(request) {
  return caches.match(request).then((response) => response || fetch(request));
}

function updateCache(request, response) {
  if (!response || response.status !== 200) {
    return;
  }
  const cacheRequest =
    typeof request === "string" ? new Request(request) : request;
  const copy = response.clone();
  caches.open(CACHE_VERSION).then((cache) => cache.put(cacheRequest, copy));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      caches
        .match("./index.html")
        .then((cached) =>
          cached ||
          fetch(request)
            .then((networkResponse) => {
              updateCache("./index.html", networkResponse.clone());
              return networkResponse;
            })
            .catch(() => cached)
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          updateCache(request, response);
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

