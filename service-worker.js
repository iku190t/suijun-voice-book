const CACHE_NAME = "suijun-voice-book-v110";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css?v=110",
  "./js/app.js?v=110",
  "./js/calculation.js?v=110",
  "./js/voice.js?v=110",
  "./js/storage.js?v=110",
  "./js/export.js?v=110",
  "./js/rules.js?v=110",
  "./js/point-names.js?v=110",
  "./js/analytics.js?v=110",
  "./manifest.json",
  "./assets/share-qr.png",
  "./icons/icon-192.png?v=110",
  "./icons/icon-512.png?v=110",
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
