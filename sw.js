// Service worker: makes the app installable and lets it open offline.
// Network-first: when you're online you always get the newest files from GitHub
// (so updates show up on the next reload); the saved copy is only used offline.
// Live price/hiscore requests are never cached.
const CACHE = "osrs-toolkit-v7";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "logic.js", "data.js", "guides-data.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  // cache: "reload" skips the browser's own HTTP cache, so we never save a stale file
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return; // live data: network only
  event.respondWith(
    fetch(req, { cache: "no-cache" }) // ask GitHub if the file changed (cheap when it hasn't)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })) // offline: use the saved copy
  );
});
