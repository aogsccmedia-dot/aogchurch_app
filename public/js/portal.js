// One portal for everyone who signs in: Home (tickets, what's coming up, what to know), Devotions, Ask SCC, Vote, Store, Settings; people the main admin has
// given a role also see their Admin (or Youth leader) tab, on the same sign-in, with no switching and no codes.
// After signing in, a short black welcome greets them by name and role.
import { icon } from "./icons.js";
import { faceInner } from "./faces.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const roleName = (me) => me?.admin_role === "super" ? "Main admin" : me?.admin_role === "youth" ? "Youth leader" : me?.admin_role ? "Admin" : null;

// The bottom bar: four big buttons that always fit, on any screen. Everything else sits under "More".
export function mainTabs(me) {
  return [
    me.admin_account ? ["/admin/", "layoutDashboard", "Admin"] : ["/me", "home", "Home"],
    ["/assistant", "sparkles", "Ask SCC"],
    ["/devotions", "bookOpen", "Devotions"],
  ];
}
export function moreTabs(me) {
  const role = roleName(me);
  return [
    ["/vote", "vote", "Vote"],
    ["/store", "landmark", "Store"],
    ["/settings", "settings", "Settings"],
    ["/help", "messageCircle", "How to use the app"],
  ].filter(Boolean);
}
// Extra tools for people the main admin has given a role: they simply appear in their portal (Home and More),
// limited to what they're allowed to do. No separate "admin" area to switch to; the main admin can take them away any time.
const TOOLS = [
  ["approvals", "check", "Approvals", "events|youth_tickets"],
  ["fridays", "calendar", "Fridays", "fridays"],
  ["scan", "scan", "Door scanner", "scan"],
  ["events", "ticket", "Events & forms", "events"],
  ["services", "clock", "Weekly services", "services"],
  ["votes", "vote", "Voting", "votes"],
  ["members", "users", "Members", "members"],
  ["people", "userCheck", "My people", "members|people"],
  ["prayers", "handHeart", "Prayer requests", "prayer"],
  ["report", "layoutDashboard", "Reports", "reports"],
];
export function toolsFor(me) {
  if (!me?.user || me.admin_account || !me.admin_role || me.admin_role === "super") return [];
  const perms = me.admin_perms || [];
  return TOOLS.filter(([, , , need]) => need.split("|").some((p) => perms.includes(p))).map(([t, i, l]) => [`/admin/#${t}`, i, l]);
}
export const tabsFor = (me) => [...mainTabs(me), ...moreTabs(me)];

/** Every signed-in page (the tools pages too) gets the same bottom bar; `el` is an old top-tabs slot, now hidden. */
export function renderTabs(el, me, active) {
  if (!me?.user) return;
  sheetMe = me;
  if (el) el.hidden = true;
  renderBottom(me);
}

// ---- Signed in: the portal navigation replaces the website's own (header on computers, bottom bar on phones).
// A small summary of who's signed in is cached so the portal bar is drawn instantly on the next page, without a jump.
const KEY = "scc-me";
export function cacheMe(me) {
  try {
    if (!me?.user) { localStorage.removeItem(KEY); localStorage.removeItem("scc-hello"); return; }
    const u = me.user;
    localStorage.setItem(KEY, JSON.stringify({ user: { id: u.id, email: u.email, given_name: u.given_name, name: u.name, picture: u.picture }, admin_role: me.admin_role || null,
      admin_account: !!me.admin_account, is_admin: !!me.is_admin, member: !!me.member, admin_perms: me.admin_perms || null }));
  } catch { /* storage blocked */ }
}
export function cachedMe() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }

const here = () => location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
const isOn = (href) => {
  if (href.includes("#")) { const [path, hash] = href.split("#"); return here() === path.replace(/\/$/, "") && location.hash.slice(1).split(":")[0] === hash; }
  const h = href.replace(/\/$/, ""); const p = here(); return h === p || (h === "/admin" && p.startsWith("/admin"));
};
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
  const role = roleName(me), r = document.querySelector("[data-app-role]");
  if (r) { r.textContent = role || "Member"; r.dataset.kind = me.admin_role || "member"; }
  const av = document.querySelector("[data-app-avatar]");
  if (av) av.innerHTML = faceInner(me.user);
  const brand = document.querySelector(".app-brand"); if (brand) brand.href = me.admin_account ? "/admin/" : "/me";
  renderBottom(me);
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

const inMore = (me) => moreTabs(me).some(([h]) => isOn(h)) || toolsFor(me).some(([h]) => isOn(h));
function barHtml(me) {
  const more = inMore(me);
  return mainTabs(me).map(([h, i, l]) => link(h, i, l)).join("")
    + `<button type="button" class="${more ? "on" : ""}" data-app-more aria-haspopup="dialog" aria-expanded="false">${icon("menu")}<span>More</span></button>`;
}

let sheetMe = null;
function renderBottom(me) {
  sheetMe = me;
  let el = document.querySelector("[data-app-bottom]");
  if (!el) { el = document.createElement("nav"); el.className = "app-bottom"; el.dataset.appBottom = ""; el.setAttribute("aria-label", "Your portal"); document.body.append(el); }
  const html = barHtml(me);
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  document.body.classList.add("has-bottom");
}

function openSheet() {
  const me = sheetMe; if (!me?.user) return;
  closeSheet();
  const u = me.user, role = roleName(me) || "Member";
  const el = document.createElement("div");
  el.className = "app-sheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "More");
  el.innerHTML = `<div class="sheet-card"><header class="sheet-me"><span class="avatar">${faceInner(u)}</span><div><b>${esc(u.name || u.email)}</b><span>${esc(role)}</span></div>
      <button type="button" class="sheet-x" data-sheet-close aria-label="Close">${icon("x")}</button></header>
    ${toolsFor(me).length ? `<p class="sheet-group">Your tools</p><nav class="sheet-links tools">${toolsFor(me).map(([h, i, l]) => link(h, i, l)).join("")}</nav><p class="sheet-group">More</p>` : ""}
    <nav class="sheet-links">${moreTabs(me).map(([h, i, l]) => link(h, i, l)).join("")}</nav>
    <button type="button" class="btn sheet-out" data-app-signout>${icon("logOut")} Sign out</button></div>`;
  document.body.append(el);
  document.querySelector("[data-app-more]")?.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => el.classList.add("open"));
  el.querySelector(".sheet-links a, .sheet-x")?.focus({ preventScroll: true });
}
function closeSheet() {
  document.querySelectorAll(".app-sheet").forEach((s) => s.remove());
  document.querySelectorAll("[data-app-more]").forEach((b) => b.setAttribute("aria-expanded", "false"));
}
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest?.("[data-app-more]")) { e.preventDefault(); return document.querySelector(".app-sheet") ? closeSheet() : openSheet(); }
  if (t.closest?.("[data-sheet-close]") || t.classList?.contains("app-sheet")) return closeSheet();
  // The admin portal signs out with its own button.
  if (t.closest?.(".app-sheet [data-app-signout]") && document.getElementById("logout")) { e.preventDefault(); closeSheet(); document.getElementById("logout").click(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
addEventListener("pageshow", closeSheet);
addEventListener("hashchange", () => { closeSheet(); if (sheetMe) renderBottom(sheetMe); });

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
  const a = e.target.closest?.(".app-bottom a, .portal-tabs a, .sheet-links a");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  if (!a.closest(".sheet-links")) a.parentElement.querySelectorAll("a, button").forEach((x) => x.classList.toggle("on", x === a));
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
