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
/**
 * Verified stickers next to a person's name: black for the main admin, blue for admins, gold for verified members
 * (and for everyone else on the team, like youth leaders). Nobody else gets one.
 */
export function badgeKind(me) {
  if (!me?.user) return null;
  if (me.admin_account || me.admin_role === "super") return "super";
  if (me.admin_role === "staff") return "admin";
  if (me.admin_role || me.member_verified || me.member?.status === "member") return "member";
  return null;
}
const BADGE = {
  super: ["#3a3a3a", "#000000", "Main admin"], admin: ["#5aa2ff", "#1d5fe0", "Church admin"], member: ["#ffe08a", "#c8963e", "Verified member"],
};
let badgeN = 0;
export function badgeHtml(me, size = 18) {
  const k = badgeKind(me); if (!k) return "";
  const [a, b, label] = BADGE[k], id = `vb${++badgeN}`;
  return `<span class="vbadge vb-${k}" title="${label}" role="img" aria-label="${label}"><svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><path fill="url(#${id})" d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m8.6 12.2 2.3 2.3 4.6-4.8" fill="none" stroke="${k === "member" ? "#5a3a08" : "#fff"}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}

export function moreTabs(me) {
  const role = roleName(me);
  return [
    ["/messages", "messageCircle", "Messages"],
    ["/go", "globe", "Go Ye (evangelism)"],
    ["/poster", "palette", "Poster maker"],
    ["/freecreator", "monitor", "FreeCreator (presentation & live)"],
    ["/discipleship", "bookOpen", "Discipleship classes"],
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
  ["calls", "smartphone", "Call Office", "calls"],
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
  // Once, a friendly offer of the daily verse on their phone (after the welcome has gone).
  if (!window.__pushOffer) { window.__pushOffer = 1; setTimeout(() => import("./push.js").then((m) => m.offerOnce()).catch(() => {}), 4500); }
}

// ---- Signed in: the portal navigation replaces the website's own (header on computers, bottom bar on phones).
// A small summary of who's signed in is cached so the portal bar is drawn instantly on the next page, without a jump.
const KEY = "scc-me";
export function cacheMe(me) {
  try {
    if (!me?.user) { localStorage.removeItem(KEY); localStorage.removeItem("scc-hello"); return; }
    const u = me.user;
    localStorage.setItem(KEY, JSON.stringify({ user: { id: u.id, email: u.email, given_name: u.given_name, name: u.name, picture: u.picture }, admin_role: me.admin_role || null,
      admin_account: !!me.admin_account, is_admin: !!me.is_admin, member: !!me.member, member_verified: me.member_verified ?? me.member?.status === "member", admin_perms: me.admin_perms || null }));
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
  if (av) av.innerHTML = faceInner(me.user) + badgeHtml(me, 15).replace('class="vbadge', 'class="vbadge vb-corner');
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
const onAdmin = () => location.pathname.startsWith("/admin");
function barHtml(me) {
  const more = inMore(me);
  // In the admin portal the bar is the only navigation: Dashboard (or Home), all your Tools, Ask SCC and More.
  if (onAdmin()) {
    const tab = location.hash.slice(1).split(":")[0] || "overview";
    const dash = me.admin_account ? `<a href="/admin/#overview"${tab === "overview" ? ' class="on" aria-current="page"' : ""}>${icon("gauge")}<span>Dashboard</span></a>` : link("/me", "home", "Home");
    // One menu for everything (tools + your own pages + sign out), like members' "More".
    return dash + link("/assistant", "sparkles", "Ask SCC") + link("/devotions", "bookOpen", "Devotions")
      + `<button type="button" class="${tab !== "overview" || !me.admin_account ? "on" : ""}" data-admin-tools aria-haspopup="dialog">${icon("grid")}<span>Menu</span></button>`;
  }
  return mainTabs(me).map(([h, i, l]) => link(h, i, l)).join("")
    + `<button type="button" class="${more ? "on" : ""}" data-app-more aria-haspopup="dialog" aria-expanded="false">${icon("menu")}<span>More</span></button>`;
}

let sheetMe = null;
function renderBottom(me) {
  sheetMe = me;
  let el = document.querySelector("[data-app-bottom]");
  if (!el) { el = document.createElement("nav"); el.className = "app-bottom"; el.dataset.appBottom = ""; el.setAttribute("aria-label", "Your portal"); document.body.append(el); }
  const html = barHtml(me);
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; for (const [h, n] of Object.entries(badges)) setBadge(h, n); }
  if (!document.querySelector(".app-fade")) { const f = document.createElement("div"); f.className = "app-fade"; f.setAttribute("aria-hidden", "true"); el.before(f); }
  document.body.classList.add("has-bottom");
}

function openSheet() {
  const me = sheetMe; if (!me?.user) return;
  closeSheet();
  const u = me.user, role = roleName(me) || "Member";
  const el = document.createElement("div");
  el.className = "app-sheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "More");
  el.innerHTML = `<div class="sheet-card"><header class="sheet-me"><span class="avatar">${faceInner(u)}</span><div><b>${esc(u.name || u.email)}${badgeHtml(sheetMe || {}, 16)}</b><span>${esc(role)}</span></div>
      <button type="button" class="sheet-x" data-sheet-close aria-label="Close">${icon("x")}</button></header>
    ${toolsFor(me).length && !onAdmin() ? `<p class="sheet-group">Your tools</p><nav class="sheet-links tools">${toolsFor(me).map(([h, i, l]) => link(h, i, l)).join("")}<button type="button" class="sheet-ask" data-ask-access>${icon("plus")}<span>Ask for more access</span></button></nav><p class="sheet-group">More</p>` : ""}
    <nav class="sheet-links">${[...(onAdmin() ? [["/devotions", "bookOpen", "Devotions"]] : []), ...moreTabs(me)].map(([h, i, l]) => link(h, i, l)).join("")}</nav>
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
document.addEventListener("click", (e) => { if (e.target.closest?.("[data-app-search]")) { e.preventDefault(); closeSheet(); import("./search.js").then((m) => m.openSearch()); } });
document.addEventListener("keydown", (e) => { if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) && document.documentElement.classList.contains("signed-in") && !e.target.closest?.("input, textarea, [contenteditable]")) { e.preventDefault(); import("./search.js").then((m) => m.openSearch()); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSheet(); document.querySelector(".ask-dialog")?.remove(); } });

// ---- Ask the main admin for more access: one small form, right where you are.
document.addEventListener("click", (e) => { if (e.target.closest?.("[data-ask-access]")) { e.preventDefault(); closeSheet(); openAccessDialog(); } });
export async function openAccessDialog() {
  document.querySelector(".ask-dialog")?.remove();
  const el = document.createElement("div");
  el.className = "app-sheet ask-dialog open"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Ask for more access");
  el.innerHTML = `<form class="sheet-card"><header class="sheet-me"><span class="ask-ico">${icon("shield")}</span><div><b>Ask for more access</b><span>The main admin gets it straight away</span></div>
    <button type="button" class="sheet-x" data-x aria-label="Close">${icon("x")}</button></header><div class="ask-body"><p class="muted-text">Loading…</p></div></form>`;
  document.body.append(el);
  const close = () => el.remove();
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-x]")) close(); });
  const body = el.querySelector(".ask-body");
  let r, who;
  try { [r, who] = await Promise.all([fetch("/api/admin/access-requests").then((x) => x.json()), fetch("/api/admin/whoami").then((x) => x.json())]); }
  catch { body.innerHTML = `<p class="muted-text">Couldn't load right now. Please try again.</p>`; return; }
  const have = new Set(who?.perms || []), pending = (r.requests || []).find((x) => x.status === "pending");
  const opts = (r.options || []).filter((o) => !have.has(o.key));
  if (pending) { body.innerHTML = `<p class="ask-wait">${icon("hourglass")} Your request is with the main admin. You'll get an email when it's answered.</p>`; return; }
  if (!opts.length) { body.innerHTML = `<p class="muted-text">You already have everything. 🙌</p>`; return; }
  body.innerHTML = `<p class="muted-text">Tap what you'd like to help with:</p><div class="ask-chips">${opts.map((o) => `<label class="ask-chip"><input type="checkbox" name="wants" value="${esc(o.key)}"><span>${esc(o.label)}</span></label>`).join("")}</div>
    <textarea class="input" name="note" rows="2" maxlength="600" placeholder="Why? (optional)"></textarea><button class="btn btn-gold sheet-out" type="submit">${icon("send")} Send request</button>`;
  el.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, wants = [...f.querySelectorAll("[name=wants]:checked")].map((x) => x.value);
    if (!wants.length) { f.querySelector(".ask-chips").classList.add("shake"); setTimeout(() => f.querySelector(".ask-chips")?.classList.remove("shake"), 500); return; }
    const btn = f.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Sending…";
    const res = await fetch("/api/admin/access-requests", { method: "POST", headers: { "content-type": "application/json", "x-scc-admin": "1" }, body: JSON.stringify({ wants, note: f.note.value }) }).then((x) => x.json()).catch(() => ({}));
    body.innerHTML = res.ok ? `<p class="ask-wait done">${icon("check")} Sent! The main admin has it now, and you'll get an email with the answer.</p>` : `<p class="muted-text">${esc(res.error || "Couldn't send. Please try again.")}</p>`;
    if (res.ok) setTimeout(close, 2200);
  });
}

/** A small count on a bottom-bar button (e.g. access requests waiting for the main admin). */
export function setBadge(href, n) {
  badges[href] = n;
  document.querySelectorAll(`.app-bottom a[href="${href}"]`).forEach((a) => { a.querySelector(".nb")?.remove(); if (n > 0) a.insertAdjacentHTML("beforeend", `<i class="nb">${n > 9 ? "9+" : n}</i>`); });
}
const badges = {};
addEventListener("pageshow", closeSheet);
addEventListener("hashchange", () => { closeSheet(); if (sheetMe) renderBottom(sheetMe); });

// Blazing-fast tabs: the bottom-bar pages are opened ahead of time in the background, the rest are fetched,
// and anything you press (or hover) starts loading before you let go.
let prefetched = false;
function prefetchTabs(me) {
  if (prefetched) return; prefetched = true;
  const main = mainTabs(me).map(([h]) => h).filter((h) => !isOn(h));
  const rest = [...moreTabs(me), ...toolsFor(me)].map(([h]) => h.split("#")[0]).filter((h, i, a) => !isOn(h) && a.indexOf(h) === i && !main.includes(h));
  if (HTMLScriptElement.supports?.("speculationrules")) {
    const s = document.createElement("script"); s.type = "speculationrules";
    s.textContent = JSON.stringify({ prerender: [{ urls: main, eagerness: "immediate" }, { urls: rest, eagerness: "moderate" }], prefetch: [{ urls: rest, eagerness: "eager" }] });
    document.head.append(s);
  } else {
    const go = () => [...main, ...rest].forEach((u) => { const l = document.createElement("link"); l.rel = "prefetch"; l.href = u; document.head.append(l); });
    (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(go);
  }
}
const warmed = new Set();
document.addEventListener("pointerdown", (e) => {
  const a = e.target.closest?.(".app-bottom a, .sheet-links a, .tool-tile");
  if (!a || warmed.has(a.href)) return; warmed.add(a.href);
  const l = document.createElement("link"); l.rel = "prefetch"; l.href = a.href; document.head.append(l);
}, { passive: true });

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
  // The hand-drawn "Welcome" writes itself (inspired by a video), then their name and portal. Tap to skip.
  import("./welcome-art.js").then(({ WELCOME_SVG }) => {
    const el = document.createElement("div");
    el.className = "welcome-screen hello-write"; el.setAttribute("role", "status"); el.setAttribute("aria-label", `Welcome back${first ? ", " + first : ""}`);
    el.innerHTML = `<div class="welcome-blobs" aria-hidden="true"><i></i><i></i><i></i></div><div class="welcome-inner">${WELCOME_SVG}
      <h2 class="welcome-title">Welcome back${first ? `, ${esc(first)}` : ""}${badgeHtml(me, 26)}</h2><p class="welcome-line">${role ? `${esc(role)} portal` : "Your church family"}</p></div>`;
    document.documentElement.append(el);
    requestAnimationFrame(() => el.classList.add("play"));
    const done = () => { el.classList.add("out"); setTimeout(() => el.remove(), 460); };
    el.addEventListener("click", done);
    setTimeout(done, matchMedia("(prefers-reduced-motion: reduce)").matches ? 900 : 4300);
  }).catch(() => {});
}
