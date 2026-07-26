const CACHE_NAME = "suijun-voice-book-v157";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css?v=157",
  "./js/app.js?v=157",
  "./js/calculation.js?v=157",
  "./js/voice.js?v=157",
  "./js/storage.js?v=157",
  "./js/export.js?v=157",
  "./js/rules.js?v=157",
  "./js/point-names.js?v=157",
  "./js/analytics.js?v=157",
  "./manifest.json?v=157",
  "./assets/share-qr.png",
  "./icons/icon-192.png?v=157",
  "./icons/icon-512.png?v=157",
  "./icons/icon-master.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
