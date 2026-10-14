// One portal for everyone who signs in: Home (tickets, what's coming up, what to know), Devotions, Ask SCC, Vote, Store, Settings; people the main admin has
// given a role also see their Admin (or Youth leader) tab, on the same sign-in, with no switching and no codes.
// After signing in, a short black welcome greets them by name and role.
import { icon } from "./icons.js";
import { faceInner } from "./faces.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const roleName = (me) => me?.admin_role === "super" ? "Main admin" : me?.admin_role === "youth" ? "Youth leader" : me?.admin_role ? "Admin" : null;

export function tabsFor(me) {
  const role = roleName(me);
  return [
    !me.admin_account && ["/me", "home", "Home"],
    ["/devotions", "bookOpen", "Devotions"],
    ["/assistant", "sparkles", "Ask SCC"],
    ["/vote", "vote", "Vote"],
    ["/store", "landmark", "Store"],
    role && ["/admin/", "layoutDashboard", me.admin_role === "youth" ? "Leader" : "Admin"],
    ["/settings", "settings", "Settings"],
  ].filter(Boolean);
}

/** Draw the portal tabs into `el` (a <nav>). `active` is the path of the current page. */
export function renderTabs(el, me, active) {
  if (!el || !me?.user) return;
  el.innerHTML = tabsFor(me).map(([href, ico, label]) => `<a href="${href}" class="${href.replace(/\/$/, "") === active.replace(/\/$/, "") ? "on" : ""}"${href.replace(/\/$/, "") === active.replace(/\/$/, "") ? ' aria-current="page"' : ""}>${icon(ico)}<span>${esc(label)}</span></a>`).join("");
  el.hidden = false;
}

// ---- Signed in: the portal navigation replaces the website's own (header on computers, bottom bar on phones).
// A small summary of who's signed in is cached so the portal bar is drawn instantly on the next page, without a jump.
const KEY = "scc-me";
export function cacheMe(me) {
  try {
    if (!me?.user) { localStorage.removeItem(KEY); localStorage.removeItem("scc-hello"); return; }
    const u = me.user;
    localStorage.setItem(KEY, JSON.stringify({ user: { id: u.id, email: u.email, given_name: u.given_name, name: u.name, picture: u.picture }, admin_role: me.admin_role || null,
      admin_account: !!me.admin_account, is_admin: !!me.is_admin, member: !!me.member }));
  } catch { /* storage blocked */ }
}
export function cachedMe() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }

const here = () => location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
const isOn = (href) => { const h = href.replace(/\/$/, ""); const p = here(); return h === p || (h === "/admin" && p.startsWith("/admin")); };
const link = (href, ico, label) => `<a href="${href}"${isOn(href) ? ' class="on" aria-current="page"' : ""}>${icon(ico)}<span>${esc(label)}</span></a>`;

/** Swap the website menus for the portal: header nav (computers) and bottom bar (phones). Safe to call again. */
export function renderPortalNav(me) {
  const root = document.documentElement;
  const nav = document.querySelector(".site-header .main-nav"), bar = document.querySelector(".tabbar");
  if (!me?.user) {
    root.classList.remove("signed-in");
    for (const el of [nav, bar]) if (el?.dataset.site) { el.innerHTML = el.dataset.site; delete el.dataset.site; el.classList.remove("portal-nav"); }
    return;
  }
  root.classList.add("signed-in");
  // The app bar: one top navigation for everyone who's signed in (no side menu).
  const tabsEl = document.querySelector("[data-app-tabs]");
  if (tabsEl) {
    const html = tabsFor(me).map(([h, i, l]) => link(h, i, l)).join("");
    if (tabsEl.innerHTML !== html) tabsEl.innerHTML = html;
    const on = tabsEl.querySelector(".on"); if (on) tabsEl.scrollLeft = on.offsetLeft - (tabsEl.clientWidth - on.offsetWidth) / 2;
    const role = roleName(me), r = document.querySelector("[data-app-role]");
    if (r) { r.textContent = role || "Member"; r.dataset.kind = me.admin_role || "member"; }
    const av = document.querySelector("[data-app-avatar]"), u = me.user;
    if (av) av.innerHTML = faceInner(u);
    wireTabScroll(tabsEl);
    const brand = document.querySelector(".app-brand"); if (brand) brand.href = me.admin_account ? "/admin/" : "/me";
  }
  // The logo takes you Home inside the app (signing out is the way back to the website).
  document.querySelectorAll(".site-header .brand, .menu .brand").forEach((b) => { b.href = me.admin_account ? "/admin/" : "/me"; });
  prefetchTabs(me);
  const tabs = tabsFor(me).map(([h, i, l]) => link(h, i, l)).join("");
  for (const el of [nav, bar]) {
    if (!el) continue;
    if (!el.dataset.site) el.dataset.site = el.innerHTML;
    el.innerHTML = tabs; el.classList.add("portal-nav");
    el.style.setProperty("--n", String(tabsFor(me).length));
  }
}

// The tab row can be swiped sideways on small screens: soft edges and arrows show there's more.
function wireTabScroll(el) {
  if (el.dataset.wired) return update(); el.dataset.wired = "1";
  function update() {
    const w = el.parentElement, max = el.scrollWidth - el.clientWidth;
    w.classList.toggle("more-left", el.scrollLeft > 4);
    w.classList.toggle("more-right", el.scrollLeft < max - 4);
  }
  const wrap = document.createElement("div"); wrap.className = "app-tabs-wrap";
  el.parentNode.insertBefore(wrap, el); wrap.append(el);
  const mk = (dir) => { const b = document.createElement("button"); b.type = "button"; b.className = `tabs-arrow ${dir}`; b.setAttribute("aria-label", dir === "left" ? "More tabs on the left" : "More tabs on the right");
    b.innerHTML = icon(dir === "left" ? "arrowLeft" : "arrowRight"); b.addEventListener("click", () => el.scrollBy({ left: (dir === "left" ? -1 : 1) * el.clientWidth * .7, behavior: "smooth" })); return b; };
  wrap.prepend(mk("left")); wrap.append(mk("right"));
  el.addEventListener("scroll", update, { passive: true }); addEventListener("resize", update);
  update();
}

// Blazing-fast tabs: fetch the portal pages in the background so each tap opens instantly.
let prefetched = false;
function prefetchTabs(me) {
  if (prefetched) return; prefetched = true;
  const urls = tabsFor(me).map(([h]) => h).filter((h) => !isOn(h) && h !== "/admin/");
  if (HTMLScriptElement.supports?.("speculationrules")) {
    const s = document.createElement("script"); s.type = "speculationrules";
    s.textContent = JSON.stringify({ prefetch: [{ urls, eagerness: "eager" }], prerender: [{ urls: urls.slice(0, 3), eagerness: "moderate" }] });
    document.head.append(s);
  } else {
    const go = () => urls.forEach((u) => { const l = document.createElement("link"); l.rel = "prefetch"; l.href = u; document.head.append(l); });
    (window.requestIdleCallback || ((f) => setTimeout(f, 800)))(go);
  }
}

// A tapped tab (or any portal link) shows as chosen straight away, while the next page loads.
document.addEventListener("click", (e) => {
  const a = e.target.closest?.(".portal-nav a, .portal-tabs a");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  a.parentElement.querySelectorAll("a").forEach((x) => x.classList.toggle("on", x === a));
  a.classList.add("going");
});

/** The black welcome, once per sign-in session: "Welcome back, Thandi · Youth leader portal". Tap to skip. */
export function helloOnce(me, { skip = false } = {}) {
  if (!me?.user) return;
  // Pages opened ahead of time in the background wait until they're actually shown.
  if (document.prerendering) { document.addEventListener("prerenderingchange", () => helloOnce(me, { skip }), { once: true }); return; }
  // Once per sign-in, across every page and tab (cleared when they sign out).
  const id = String(me.user.id || me.user.email);
  try { if (localStorage.getItem("scc-hello") === id) return; localStorage.setItem("scc-hello", id); } catch { return; }
  if (skip) return;
  const first = (me.user.given_name || me.user.name || "").split(" ")[0];
  const role = roleName(me);
  const el = document.createElement("div");
  el.className = "hello-black"; el.setAttribute("role", "status");
  el.innerHTML = `<div class="hb-in"><img src="/assets/logo-192.png" alt="" width="64" height="64"><p class="hb-hi">Welcome back${first ? `, <b>${esc(first)}</b>` : ""}</p>
    <p class="hb-role">${role ? `${esc(role)} portal` : "Your church family"}</p><i class="hb-line"></i></div>`;
  document.documentElement.append(el);
  const done = () => { el.classList.add("out"); setTimeout(() => el.remove(), 420); };
  el.addEventListener("click", done);
  setTimeout(done, matchMedia("(prefers-reduced-motion: reduce)").matches ? 700 : 1500);
}
