const CACHE_NAME = "suijun-voice-book-v170";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css?v=170",
  "./js/app.js?v=170",
  "./js/calculation.js?v=170",
  "./js/voice.js?v=170",
  "./js/storage.js?v=170",
  "./js/export.js?v=170",
  "./js/rules.js?v=170",
  "./js/point-names.js?v=170",
  "./js/analytics.js?v=170",
  "./manifest.json?v=170",
  "./assets/share-qr.png",
  "./icons/icon-192.png?v=170",
  "./icons/icon-512.png?v=170",
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
