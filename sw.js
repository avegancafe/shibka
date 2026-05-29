// Shibka service worker — makes the game installable and fully playable offline.
//
// Strategy:
//   • install  → precache the whole app shell (so first offline load works)
//   • navigate → network-first (online users always get the latest HTML),
//                falling back to the cached shell when offline
//   • assets   → stale-while-revalidate (instant from cache, refreshed in the
//                background), so updates land within one reload
//
// Bump VERSION whenever you want to force every client to drop old caches.
const VERSION = "v8";
const CACHE = "shibka-" + VERSION;

// Relative URLs so this works both at the domain root (localhost) and under a
// subpath (e.g. GitHub Pages /shibka/). They resolve against the SW's scope.
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/dogs.js",
  "./js/game.js",
  "./vendor/matter.min.js",
  "./manifest.webmanifest",
  "./assets/favicon.png",
  "./assets/favicon-32.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-512-maskable.png",
  "./assets/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin requests alone

  // HTML / navigations: network-first, fall back to the cached shell offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html", { ignoreSearch: true }))
    );
    return;
  }

  // Everything else: stale-while-revalidate.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
