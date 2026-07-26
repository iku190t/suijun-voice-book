const CACHE_NAME = "suijun-voice-book-v102";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css?v=102",
  "./js/app.js?v=102",
  "./js/calculation.js?v=102",
  "./js/voice.js?v=102",
  "./js/storage.js?v=102",
  "./js/export.js?v=102",
  "./js/rules.js?v=102",
  "./js/point-names.js?v=102",
  "./js/analytics.js?v=102",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
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
