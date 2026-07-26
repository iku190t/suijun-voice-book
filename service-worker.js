const CACHE_NAME = "suijun-voice-book-v166";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css?v=166",
  "./js/app.js?v=166",
  "./js/calculation.js?v=166",
  "./js/voice.js?v=166",
  "./js/storage.js?v=166",
  "./js/export.js?v=166",
  "./js/rules.js?v=166",
  "./js/point-names.js?v=166",
  "./js/analytics.js?v=166",
  "./manifest.json?v=166",
  "./assets/share-qr.png",
  "./icons/icon-192.png?v=166",
  "./icons/icon-512.png?v=166",
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
