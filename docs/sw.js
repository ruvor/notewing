// Notewing service worker: the app shell works offline. GitHub API requests are never cached here
// (notes are cached in IndexedDB by the app itself).
// The version and the asset list are filled in by vite.config.ts at build time. Language
// modes for code blocks are loaded on demand and cached when first used.

const CACHE = "notewing-ae5f4345388f";
const ASSETS = [
 "./",
 "./assets/index-CEnv2iKi.js",
 "./assets/dist-0xJLjynH.js",
 "./assets/index-4GShnOmr.css",
 "./manifest.webmanifest",
 "./icons/icon.svg",
 "./icons/icon-192.png",
 "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("notewing-") && k !== CACHE).map((k) => caches.delete(k)))),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    event.respondWith(caches.match("./", { cacheName: CACHE }).then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(
    caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.includes("/assets/")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
