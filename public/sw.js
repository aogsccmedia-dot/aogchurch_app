// Service worker: makes the site installable and fast, and gives a friendly offline page.
// - Pages: network first, fall back to the cached copy, then /offline.
// - CSS/JS: network first (so a new release is picked up straight away), cached copy when offline.
// - Photos/logos: cache first.
// - /api and /admin are never cached.
const VERSION = "scc-v49";
const SHELL = ["/", "/offline", "/js/site.js", "/js/auth.js", "/js/icons.js", "/js/install.js",
  "/assets/logo-64.png", "/assets/logo-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const timedFetch = (req, ms) => Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error("slow")), ms))]);
const put = async (req, res) => { if (res && res.ok && res.type === "basic") (await caches.open(VERSION)).put(req, res.clone()); return res; };

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;

  // App pages open instantly from the last copy, and refresh in the background for next time.
  const APP = /^\/(me|devotions|assistant|vote|store|settings|welcome-pack|go|pamphlet|messages|poster)(\.html)?\/?$/;
  if (req.mode === "navigate" && APP.test(url.pathname)) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((res) => put(req, res)).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return net.then((res) => res || caches.match("/offline")).then((res) => res || Response.error());
    }));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(timedFetch(req, 4000).then((res) => put(req, res)).catch(async () =>
      (await caches.match(req, { ignoreSearch: true })) || (await caches.match("/offline")) || Response.error()));
    return;
  }
  // Videos stream in pieces (Range requests): leave them to the browser so playback works everywhere, iPhone included.
  if (/\.(mp4|webm|mov|m4v)$/i.test(url.pathname) || req.headers.has("range")) return;
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))));
    return;
  }
  if (url.pathname.startsWith("/css/") || url.pathname.startsWith("/js/")) {
    // Versioned files (?v=<hash>) never change: serve from cache instantly.
    if (url.searchParams.has("v")) { e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res)))); return; }
    // Everything else: network first, but don't keep people waiting on a slow connection.
    e.respondWith(timedFetch(req, 2500).then((res) => put(req, res)).catch(async () => (await caches.match(req)) || fetch(req)));
  }
});

// ---- Phone notifications: pushes carry no data; ask the server what to show (e.g. today's verse).
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let m = { title: "AOG Sandton City Church", body: "Something new for you in the church app.", url: "/me", tag: "scc" };
    try { const r = await fetch("/api/push/today", { credentials: "include" }); if (r.ok) m = { ...m, ...(await r.json()) }; } catch { /* offline: show the default */ }
    await self.registration.showNotification(m.title, { body: m.body, icon: "/assets/logo-192.png", badge: "/assets/logo-64.png", tag: m.tag, renotify: false, data: { url: m.url } });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/me", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if (new URL(w.url).origin === self.location.origin) { await w.focus(); return w.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  })());
});
