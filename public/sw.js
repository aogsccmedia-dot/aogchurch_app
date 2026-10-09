// Service worker: makes the site installable and fast, and gives a friendly offline page.
// - Pages: network first, fall back to the cached copy, then /offline.
// - CSS/JS: network first (so a new release is picked up straight away), cached copy when offline.
// - Photos/logos: cache first.
// - /api and /admin are never cached.
const VERSION = "scc-v1";
const SHELL = ["/", "/offline", "/css/base.css", "/css/pages.css", "/js/site.js", "/js/auth.js", "/js/icons.js", "/js/install.js",
  "/assets/logo-64.png", "/assets/logo-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = async (req, res) => { if (res && res.ok && res.type === "basic") (await caches.open(VERSION)).put(req, res.clone()); return res; };

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => put(req, res)).catch(async () =>
      (await caches.match(req, { ignoreSearch: true })) || (await caches.match("/offline")) || Response.error()));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))));
    return;
  }
  if (url.pathname.startsWith("/css/") || url.pathname.startsWith("/js/")) {
    e.respondWith(fetch(req).then((res) => put(req, res)).catch(async () => (await caches.match(req)) || Response.error()));
  }
});
