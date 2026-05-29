// Shibka service worker — installable + always-fresh, with offline fallback.
//
// Philosophy: the installed app should behave like a *live* copy of the latest
// deploy. So this is NETWORK-FIRST for everything — every online request goes
// to the network and returns the newest file, while the cache is kept only as
// an offline fallback (the last build you successfully loaded). There is no
// stale-asset window: asset fetches use `no-cache` so they revalidate past any
// CDN max-age, and the worker itself auto-updates (see the registration in
// index.html: updateViaCache "none" + update() + skipWaiting + a reload on
// controllerchange).
//
// VERSION only controls the *offline snapshot* cache name; bump it if you change
// the ASSETS list or want to force-evict old caches. Day-to-day content updates
// flow automatically without touching it.
const VERSION = "v9";
const CACHE = "shibka-" + VERSION;

// Relative URLs so this works at the domain root (localhost) and under a
// subpath (GitHub Pages /shibka/). They resolve against the worker's scope.
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
    caches
      .open(CACHE)
      // `reload` bypasses the HTTP cache so the precached snapshot is fresh.
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin alone

  const isNav = req.mode === "navigate";

  // Network-first. Navigations fetch the request as-is (browsers don't reuse the
  // HTTP cache for documents); other assets revalidate with `no-cache` so we
  // never serve a stale CSS/JS while online.
  const fromNetwork = isNav ? fetch(req) : fetch(req, { cache: "no-cache" });

  e.respondWith(
    fromNetwork
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          if (isNav) return caches.match("./index.html", { ignoreSearch: true });
          return Response.error();
        })
      )
  );
});
