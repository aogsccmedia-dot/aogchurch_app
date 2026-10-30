import { busy } from "./otp.js";
import { dressScene, mountSignIn } from "./signin.js";
import { AVAILABILITY, LABELS, MINISTRIES } from "./options.js";
import { FIELD_TYPES, renderField } from "./forms.js";
import { icon } from "./icons.js";
import { initInsights } from "./admin-insights.js";
import { watchReports } from "./report-fit.js";
import { initMore } from "./admin-more.js";
import { initExtra } from "./admin-extra.js";
import { initClasses } from "./admin-classes.js";
import { arrivedBySwitch, switchReady } from "./switcher.js";
import { badgeHtml, cacheMe, helloOnce, renderTabs, setBadge, moreTabs } from "./portal.js";
import { faceInner } from "./faces.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TZ = "Africa/Johannesburg";
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }) : "—";
const age = (dob) => { if (!dob) return ""; const d = new Date(dob), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
const ministryLabel = (s) => MINISTRIES.find((m) => m.slug === s)?.label || s;
const parseList = (s) => { try { return JSON.parse(s || "[]"); } catch { return []; } };
const toLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const fromLocal = (v) => (v ? new Date(v).toISOString() : "");

let me = null, perms = null, meAll = null;   // perms: youth leaders only (null = full admin)
const allowed = (tab) => { const b = document.querySelector(`#nav [data-tab="${tab}"]`); if (!perms) return true; if (!b) return false; return !!b.dataset.perm && (b.dataset.perm === "*" || b.dataset.perm.split("|").some((p) => perms.includes(p))); };


// ---- Instant feedback: the button you pressed shows a spinner the moment a save starts,
// and can't be pressed twice while it's working. Works for every action without extra code.
let pressed = null, pressedAt = 0;
const remember = (el) => { pressed = el; pressedAt = Date.now(); };
document.addEventListener("pointerdown", (e) => remember(e.target.closest?.("button, .btn")), true);
document.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") remember(document.activeElement?.closest?.("button, .btn")); }, true);
document.addEventListener("submit", (e) => remember(e.submitter || e.target.querySelector('[type="submit"]')), true);
function pressedBusy() {
  const b = Date.now() - pressedAt < 1500 ? pressed : null;
  pressed = null;
  if (!b || b.getAttribute("aria-busy") === "true") return () => {};
  b.setAttribute("aria-busy", "true");
  return () => b.removeAttribute("aria-busy");
}

async function api(path, { method = "GET", body, form } = {}) {
  const done = method === "GET" ? () => {} : pressedBusy();
  try { return await apiRaw(path, { method, body, form }); } finally { done(); }
}
async function apiRaw(path, { method = "GET", body, form } = {}) {
  const opts = { method, headers: { "x-scc-admin": "1" }, credentials: "same-origin" };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
  let res;
  try { res = await fetch(path, opts); }
  catch { throw new Error("No connection. Please check your internet and try again."); }
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (res.status === 401 && !path.startsWith("/api/auth/")) { showLogin({ resume: true }); throw new Error("Please sign in again to carry on."); }
  if (!res.ok || data.ok === false) throw Object.assign(new Error(data.error || `Error ${res.status}`), { details: data.details });
  if (method !== "GET" && FIGURES.test(path)) figuresChanged();
  return data;
}

// Reports update themselves: when a service record, Friday, ledger entry or event money changes, every open report,
// dashboard and chart reloads its numbers (also in the admin's other open tabs and windows).
const FIGURES = /^\/api\/admin\/(sessions|fridays|ledger|services|events\/[^/]+\/income)/;
let figuresTimer = 0;
const figuresBus = (() => { try { return new BroadcastChannel("scc-figures"); } catch { return null; } })();
function refreshFigures() {
  clearTimeout(figuresTimer);
  figuresTimer = setTimeout(() => {
    const t = document.body.dataset.view;
    if (!me || !t || !loaders[t] || document.querySelector("dialog[open]")) return;
    Promise.resolve().then(() => loaders[t]()).catch(() => {});
  }, 600);
}
function figuresChanged() { figuresBus?.postMessage("changed"); refreshFigures(); }
figuresBus?.addEventListener("message", refreshFigures);
// Coming back to the tab after a while: fetch the latest numbers.
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 60_000) refreshFigures(); });
function toast(msg) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.append(t); }
  t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2800);
}
const safe = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// ================================================================ sign in (email + password or Google; no codes)
let gsi = null;
function adminGoogle(el, cid) {
  if (!cid) return false;
  gsi ??= new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "https://accounts.google.com/gsi/client"; sc.async = true; sc.onload = ok; sc.onerror = no; document.head.append(sc); })
    .then(() => google.accounts.id.initialize({ client_id: cid, ux_mode: "popup", itp_support: true, callback: async (resp) => {
      const done = busy("Signing you in…");
      try { await api("/api/auth/google", { method: "POST", body: { credential: resp.credential } }); await afterLogin(); }
      catch (e) { const er = $("#admin-card .si-err"); if (er) { er.textContent = e.message; er.hidden = false; } else toast(e.message); }
      finally { done(); }
    } }));
  return gsi.then(() => { google.accounts.id.renderButton(el, { type: "icon", theme: "outline", size: "large", shape: "circle" }); return true; }).catch(() => false);
}
async function afterLogin() {
  const me2 = await fetch("/api/auth/me", { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
  if (!me2.is_admin) throw new Error("That account isn't on the church team. Ask the main church admin to add you under Team & roles.");
  cacheMe(me2);
  $("#login-view").hidden = true; boot();
}
async function showLogin() {
  if (!$("#login-view").hidden) return;   // already showing
  $("#app-view").hidden = true; $("#login-view").hidden = false;
  document.body.dataset.view = "login";
  const meInfo = await fetch("/api/auth/me").then((r) => r.json()).catch(() => ({}));
  if (new URLSearchParams(location.search).has("switch") || arrivedBySwitch("admin")) history.replaceState(null, "", location.pathname + location.hash);
  const note = meInfo.user?.email && !meInfo.is_admin
    ? `Signed in as ${esc(meInfo.user.email)}, which isn't on the church team. Sign in with a team account, or <a href="/me">go to your Home</a>.`
    : "For the church team. Sign in to open the dashboard.";
  mountSignIn($("#admin-card"), { note, google: (el) => adminGoogle(el, meInfo.google_client_id), onDone: afterLogin });
  dressScene($("#login-view"));
  switchReady();
}

$("#logout").addEventListener("click", async () => { cacheMe(null); await api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.href = "/"; });

async function boot() {
  const r = await fetch("/api/auth/me").then((x) => x.json()).catch(() => ({}));
  if (!r.is_admin) return showLogin();
  me = r.user;
  $("#login-view").hidden = true; $("#app-view").hidden = false;
  $("#who").textContent = me.email;
  const role = r.admin_role || "super";
  document.body.dataset.role = role;
  perms = role === "super" ? null : (r.admin_perms || []);
  $("#role-chip").textContent = role === "super" ? "Main admin" : role === "youth" ? "Youth leader" : "Admin";
  // Youth leaders only see what the main admin has switched on for them.
  $$("#nav [data-tab]").forEach((b) => { b.hidden = !allowed(b.dataset.tab); });
  $$("#nav .nav-group").forEach((g) => { let n = g.nextElementSibling, any = false; while (n && !n.classList.contains("nav-group")) { if (!n.hidden) any = true; n = n.nextElementSibling; } g.hidden = !any; });
  if (perms) {
    const quick = [["fridays", "calendar", "Fridays"], ["scan", "scan", "Scan"], ["report", "layoutDashboard", "Reports"], ["events", "ticket", "Events"], ["members", "users", "Members"]].filter(([t]) => allowed(t)).slice(0, 3);
    $(".m-bar").innerHTML = quick.map(([t, ico, l]) => `<button data-go-tab="${t}" class="${t === "scan" ? "m-scan" : ""}">${icon(ico)}<span>${l}</span></button>`).join("");
    $$(".m-bar [data-go-tab]").forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.goTab; }));
  }
  meAll = r; dressSide(r, role); drawRecent();
  $("#to-profile").hidden = true; $("#m-switch").hidden = true;   // one portal: no switching
  // People with a role are in their own portal here, just looking at their tools: same bar, logo goes Home.
  if (perms) {
    $$(".brand").forEach((b) => { b.href = "/me"; b.removeAttribute("target"); const t = b.querySelector("span"); if (t) t.textContent = "SCC · Your tools"; });
    $("#m-menu").textContent = "Tools";
  }
  renderTabs($("#portal-tabs"), r, "/admin/"); cacheMe(r);
  // Shortcuts only for what this person can open.
  $$('[data-go="events-new"]').forEach((b) => { b.hidden = !!perms && !perms.includes("events"); });
  $$('[data-go="letters-new"]').forEach((b) => { b.hidden = !!perms; });
  helloOnce(r);
  if (new URLSearchParams(location.search).has("switch")) history.replaceState(null, "", location.pathname + location.hash);
  const hour = Number(new Intl.DateTimeFormat("en-ZA", { hour: "numeric", hour12: false, timeZone: TZ }).format(new Date()));
  $("#greeting").textContent = `${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}${me.given_name ? ", " + me.given_name : ""}`;
  insights.loadMeta().catch(() => {});   // ministry groups for the event editor
  openTab(location.hash.slice(1) || (perms ? firstAllowed() : "overview"));
  switchReady();
}

/** Update the sidebar counters quietly after an action (no page reload). */
async function refreshBadges() {
  const r = await api("/api/admin/stats").catch(() => null); if (!r?.stats) return;
  const st = { ...r.stats, prayer_total: (r.stats.new_prayers || 0) + (r.stats.wall_pending || 0) };
  $$("[data-count]").forEach((b) => { b.textContent = st[b.dataset.count] || ""; });
}

// ================================================================ look: icon tiles, the user card and the Go Ye card
const NAVI = { overview: "layoutDashboard", approvals: "ticketCheck", fridays: "calendar", scan: "scan", events: "ticket", services: "clock", programme: "calendarPlus",
  votes: "vote", members: "users", people: "userCheck", calls: "smartphone", prayers: "handHeart", messages: "inbox", complaints: "alert", analytics: "chartColumn",
  insights: "trendingUp", report: "fileText", letters: "mail", subscribers: "megaphone", templates: "palette", emails: "send", settings: "settings", team: "shield",
  code: "code" };
function dressSide(r, role) {
  $$("#nav button[data-tab]").forEach((b) => {
    if (b.dataset.dressed) return; b.dataset.dressed = "1";
    const badge = b.querySelector(".badge, .admin-only-dot");
    const label = [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    [...b.childNodes].filter((n) => n.nodeType === 3).forEach((n) => n.remove());
    b.insertAdjacentHTML("afterbegin", `<span class="nt-ico">${icon(NAVI[b.dataset.tab] || "sparkle")}</span><span class="nt-l">${esc(label)}</span>`);
    if (badge) b.append(badge);
    if (b.dataset.tab === "overview") { b.classList.add("nt-dash"); b.querySelector(".nt-l").textContent = "Dashboard"; }
  });
  const u = r.user || {};
  $("#su-face").innerHTML = faceInner(u);
  $("#su-name").innerHTML = `${esc(u.given_name || u.name || u.email || "Admin")}${badgeHtml({ ...r, user: u }, 16)}`;
  $("#su-role").textContent = role === "super" ? "Main admin" : role === "youth" ? "Youth leader" : "Admin";
  $("#su-bell").onclick = () => { location.hash = "overview"; setTimeout(() => $("#attention")?.scrollIntoView({ behavior: "smooth", block: "center" }), 250); };
  if (!allowed("calls")) { const pr = $("#side-promo"); pr.href = "/go-ye"; pr.target = "_blank"; pr.querySelector(".sp-btn").firstChild.textContent = "Open Go Ye "; }
  if (!allowed("report")) $("#ov-export").hidden = true;
  if (perms && !perms.includes("events")) $$('.ov-black[data-go="events-new"]').forEach((b) => { b.hidden = true; });
}
$$("[data-icon-before]").forEach((el) => { el.innerHTML = icon(el.dataset.iconBefore); });
document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-go-tab]"); if (b && !b.closest(".m-bar")) location.hash = b.dataset.goTab; });
$("#ov-search").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  location.hash = allowed("members") ? "members" : "people";
  setTimeout(() => { const i = $("#m-q"); if (i) { i.value = q; i.dispatchEvent(new Event("input", { bubbles: true })); } }, 300);
});

// ---- Tools: one launcher (bottom bar "Tools" on phones; recent tiles in the sidebar on computers)
const RKEY = "scc-admin-recent";
const recent = () => { try { return JSON.parse(localStorage.getItem(RKEY) || "[]"); } catch { return []; } };
function rememberTool(tab) {
  if (!tab || tab === "overview" || !$(`#nav [data-tab="${tab}"]`)) return;
  try { localStorage.setItem(RKEY, JSON.stringify([tab, ...recent().filter((t) => t !== tab)].slice(0, 8))); } catch { /* storage blocked */ }
  drawRecent();
}
const toolBtn = (b) => ({ tab: b.dataset.tab, label: b.querySelector(".nt-l")?.textContent || b.textContent.trim(), badge: b.querySelector(".badge")?.textContent || "" });
const visibleTools = () => $$("#nav button[data-tab]").filter((b) => !b.hidden && b.dataset.tab !== "overview").map(toolBtn);
const tile = (t, cls = "") => `<button type="button" class="tl ${cls}" data-go-tab="${esc(t.tab)}"><span class="tl-ico">${icon(NAVI[t.tab] || "sparkle")}</span><span class="tl-l">${esc(t.label)}</span>${t.badge ? `<i class="tl-b">${esc(t.badge)}</i>` : ""}</button>`;
function drawRecent() {
  const all = new Map(visibleTools().map((t) => [t.tab, t]));
  const list = [...recent().filter((t) => all.has(t)), ...["approvals", "members", "calls", "events", "fridays", "scan"].filter((t) => all.has(t))].filter((t, i, a) => a.indexOf(t) === i).slice(0, 4).map((t) => all.get(t));
  const box = $("#side-recent"); if (!box) return;
  const dash = $('#nav button[data-tab="overview"]'); if (dash && box.previousElementSibling !== dash) dash.after(box);
  box.innerHTML = list.length ? `<p class="nav-group">Recent</p><div class="sr-grid">${list.map((t) => tile(t)).join("")}</div>` : "";
}
function openTools() {
  document.querySelector(".tools-sheet")?.remove();
  const groups = []; let cur = null;
  for (const el of $$("#nav > *")) {
    if (el.matches(".nav-group")) { cur = { label: el.textContent, items: [] }; groups.push(cur); continue; }
    if (el.matches("button[data-tab]") && !el.hidden && el.dataset.tab !== "overview" && cur) cur.items.push(toolBtn(el));
  }
  const all = new Map(visibleTools().map((t) => [t.tab, t])), rec = recent().filter((t) => all.has(t)).slice(0, 4).map((t) => all.get(t));
  const sh = document.createElement("div");
  sh.className = "tools-sheet"; sh.setAttribute("role", "dialog"); sh.setAttribute("aria-modal", "true"); sh.setAttribute("aria-label", "Menu");
  sh.innerHTML = `<div class="ts-card"><div class="ts-grab" aria-hidden="true"></div>
    <header class="ts-head"><h2>Menu</h2><button type="button" class="ts-x" data-ts-close aria-label="Close">${icon("x")}</button></header>
    <label class="ts-search">${icon("search")}<input type="search" placeholder="Find a tool…" aria-label="Find a tool" autocomplete="off"></label>
    <div class="ts-body">${rec.length ? `<section class="ts-sec" data-sec><p class="ts-label">Recent</p><div class="ts-grid ts-rec">${rec.map((t) => tile(t, "big")).join("")}</div></section>` : ""}
      ${groups.filter((g) => g.items.length).map((g) => `<section class="ts-sec" data-sec><p class="ts-label">${esc(g.label)}</p><div class="ts-grid">${g.items.map((t) => tile(t)).join("")}</div></section>`).join("")}
      <p class="ts-none" hidden>No tool by that name.</p>
      ${perms ? `<button type="button" class="ts-ask" data-ask-access>${icon("plus")} Ask for more access</button>` : ""}
      <section class="ts-sec ts-you" data-sec><p class="ts-label">You</p><div class="ts-links">
        ${[["/me", "home", "My home"], ...moreTabs(meAll || {})].filter(([h]) => !(meAll?.admin_account && h === "/me")).map(([h, i, l]) => `<a href="${h}">${icon(i)}<span>${esc(l)}</span></a>`).join("")}
        <button type="button" data-ts-signout>${icon("logOut")}<span>Sign out</span></button></div></section></div></div>`;
  document.body.append(sh);
  requestAnimationFrame(() => sh.classList.add("open"));
  const close = () => { sh.classList.remove("open"); setTimeout(() => sh.remove(), 200); };
  sh.addEventListener("click", (e) => {
    if (e.target.closest("[data-ts-signout]")) { close(); $("#logout").click(); return; }
    if (e.target === sh || e.target.closest("[data-ts-close], [data-go-tab], [data-ask-access]")) close();
  });
  const q = sh.querySelector("input");
  q.addEventListener("input", () => {
    const v = q.value.trim().toLowerCase();
    sh.querySelectorAll(".ts-sec").forEach((sec) => { let any = false; sec.querySelectorAll(".tl").forEach((t) => { const hit = !v || t.textContent.toLowerCase().includes(v); t.hidden = !hit; any ||= hit; }); sec.hidden = !any || (v && sec.querySelector(".ts-rec")); });
    sh.querySelector(".ts-none").hidden = !!sh.querySelector(".ts-sec:not([hidden])");
  });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { const first = sh.querySelector(".ts-sec:not([hidden]) .tl:not([hidden])"); if (first) first.click(); } });
  addEventListener("keydown", function esc1(e) { if (e.key === "Escape") { close(); removeEventListener("keydown", esc1); } });
  if (matchMedia("(min-width: 861px)").matches) q.focus();
}
document.addEventListener("click", (e) => { if (e.target.closest?.("[data-admin-tools]")) { e.preventDefault(); openTools(); } });

// ---- Overview pieces in the new look
let attAll = [], attKind = null, attFilter = "all";
function drawAttention(list, KIND) {
  attAll = list; attKind = KIND;
  const counts = list.reduce((m, a) => (m[a.kind] = (m[a.kind] || 0) + 1, m), {});
  $("#att-count").textContent = list.length;
  $("#su-dot").hidden = !list.length;
  const pills = [["all", "All", list.length], ["complaint", "Complaints", counts.complaint || 0], ["prayer", "Prayer", counts.prayer || 0], ["wall", "Prayer Wall", counts.wall || 0], ["message", "Messages", counts.message || 0]].filter(([k, , n]) => k === "all" || n);
  if (!pills.some(([k]) => k === attFilter)) attFilter = "all";
  $("#att-pills").innerHTML = pills.map(([k, l, n]) => `<button type="button" data-att="${k}" class="${k === attFilter ? "on" : ""}">${l} <b>${n}</b></button>`).join("");
  const rows = list.filter((a) => attFilter === "all" || a.kind === attFilter);
  $("#attention").innerHTML = rows.length ? rows.map((a) => `<div class="att-row">
      <span class="ar-type"><i class="dot ${esc(a.kind)}"></i>${esc(KIND[a.kind][0])}</span>
      <b class="ar-what">${esc(a.title || "")}</b>
      <span class="ar-who">${esc(a.who || "")}${a.flag ? " · pastors only" : ""}</span>
      <span class="ar-when">${fmtDate(a.created_at)}</span>
      <span class="ar-act"><a class="ar-more" href="#${KIND[a.kind][1]}">See more</a><a class="ar-dots" href="#${KIND[a.kind][1]}" aria-label="Open">${icon("moreHorizontal")}</a></span></div>`).join("")
    : `<div class="att-empty">${icon("check")} All caught up. Nothing waiting. 🙏</div>`;
}
$("#att-pills").addEventListener("click", (e) => { const b = e.target.closest("[data-att]"); if (!b) return; attFilter = b.dataset.att; drawAttention(attAll, attKind); });

function drawFamily(st) {
  $("#ov-members").textContent = Number(st.members || 0).toLocaleString("en-ZA").replace(/,/g, " ");
  $("#ov-members-chg").innerHTML = st.this_week ? `+${st.this_week} this week ${icon("arrowUpRight")}` : "steady";
  const cols = [["Members", st.members], ["Accounts", st.accounts], ["Letter", st.subscribers], ["Follow-up", st.new_members]];
  const max = Math.max(1, ...cols.map(([, v]) => v || 0));
  $("#ov-stack").innerHTML = `<div class="st-cols">${cols.map(([l, v], i) => { const h = Math.max(18, Math.round(((v || 0) / max) * 150)); const seg = Math.max(2, Math.min(5, Math.round(h / 32)));
    return `<div class="st-col"><span class="st-val">${v || 0}</span><div class="st-bar c${i}" style="height:${h}px">${Array.from({ length: seg }, (_, j) => `<i style="flex:${j === seg - 1 ? 2 : 1}"></i>`).join("")}</div><span class="st-l">${l}</span></div>`; }).join("")}</div>`;
}

async function drawVisits() {
  const box = $("#ov-visits"), card = $("#ov-visits-card");
  let rows = [], title = "Visits this month", unit = "views";
  if (!perms) {
    const a = await api("/api/admin/analytics?days=30");
    const byDay = new Map(a.daily.map((d) => [d.day, d.views]));
    for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() + 2 * 3600_000 - i * 86400_000).toISOString().slice(0, 10); rows.push({ k: d, v: byDay.get(d) || 0 }); }
  } else if (allowed("fridays")) {
    const f = await api("/api/admin/fridays");
    rows = f.fridays.filter((x) => x.status === "captured").slice(0, 16).reverse().map((x) => ({ k: x.date, v: x.attendance || 0 }));
    title = "Friday attendance"; unit = "people";
    if (!rows.length) { box.innerHTML = `<p class="muted">Capture a Friday and it shows here.</p>`; $("#ov-chart-title").textContent = title; return; }
  } else { card.hidden = true; return; }
  $("#ov-chart-title").textContent = title;
  const max = Math.max(1, ...rows.map((r) => r.v)), hi = rows.reduce((b, r, i) => r.v >= rows[b].v ? i : b, 0);
  const lab = (d) => new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
  box.innerHTML = `<div class="vb"><div class="vb-grid"><span>100%</span><span>50%</span><span>0</span></div>${rows.map((r, i) => `<div class="vb-col${i === hi ? " hi" : ""}" title="${lab(r.k)}: ${r.v} ${unit}"><i style="height:${Math.max(4, (r.v / max) * 100)}%"></i>${i === hi ? `<em class="${i > rows.length - 5 ? "end" : i < 4 ? "start" : ""}">${lab(r.k)} · ${r.v}</em>` : ""}</div>`).join("")}</div>`;
}

// ================================================================ tabs
const loaders = {};
const detailRoutes = {};   // "#insight:<id>" style deep links
const firstAllowed = () => $$("#nav [data-tab]").find((b) => !b.hidden)?.dataset.tab || "fridays";
function openTab(tab) {
  let [base, arg] = tab.split(":");
  rememberTool(base);
  if (perms && !allowed(base === "event" || base === "events-new" ? "events" : base)) { base = firstAllowed(); arg = undefined; tab = base; }
  if (arg && detailRoutes[base]) return detailRoutes[base](arg);
  if (base === "events-new") return editEvent(null);
  if (base === "letters-new") return editLetter(null);
  if (base === "event" && arg) return editEvent(arg);
  if (base === "letter" && arg) return editLetter(arg);
  if (!loaders[base]) tab = "overview";
  const t = loaders[base] ? base : "overview";
  $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  $$("[data-go-tab]").forEach((b) => b.classList.toggle("active", b.dataset.goTab === t));
  document.body.dataset.view = t;
  $$("[data-view]").forEach((v) => { v.hidden = v.dataset.view !== t; });
  history.replaceState(null, "", "#" + t);
  Promise.resolve().then(() => loaders[t]()).catch((e) => {
    toast(e.message);
    const sec = $(`[data-view="${t}"]`);
    if (sec && !sec.querySelector(".load-error")) sec.insertAdjacentHTML("beforeend", `<div class="empty load-error">This page didn't load. <button class="btn btn-sm" type="button" onclick="location.reload()">Try again</button></div>`);
  });
}
// Safety net: a script error never leaves a blank screen.
let lastCrash = 0;
const crash = (msg) => { if (Date.now() - lastCrash < 4000) return; lastCrash = Date.now(); console.error(msg); toast("Something went wrong there. If the page looks stuck, pull down to refresh."); if ($("#app-view").hidden && $("#login-view").hidden) $("#login-view").hidden = false; };
addEventListener("error", (e) => crash(e.message));
addEventListener("unhandledrejection", (e) => crash(e.reason?.message || String(e.reason)));
function showView(view, hash, navTab) {
  document.body.dataset.view = view;
  $$("[data-view]").forEach((v) => { v.hidden = v.dataset.view !== view; });
  $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === navTab));
  history.replaceState(null, "", "#" + hash);
  scrollTo(0, 0);
}
$("#nav").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) openTab(b.dataset.tab); });
document.addEventListener("click", (e) => { const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); openTab(g.dataset.go); } });

// ================================================================ overview
const EMAIL_SETUP = `<b>Emails to members aren't being delivered yet.</b> Cloudflare only lets this site email your own verified addresses until the domain is switched on for sending.
  <ol class="setup-steps"><li>Open <a href="https://dash.cloudflare.com/?to=/:account/email-service/sending" target="_blank" rel="noopener">Cloudflare → Email Service → Email Sending</a>.</li>
  <li>Choose <b>Onboard domain</b> → <b>aogsccyouth.com</b> and accept the DNS records it adds (they're added automatically).</li>
  <li>Wait until the domain shows <b>Verified</b> (usually a few minutes), then come back to <a href="#emails">Email log</a> and press <b>Resend failed emails</b>.</li></ol>`;
loaders.overview = async () => {
  const { stats, interests, next_letter, email_enabled, google_enabled, email_health, attention = [], access = [] } = await api("/api/admin/stats");
  $("#access-card").hidden = !access.length;
  $("#access-list").innerHTML = access.map((x) => `<div class="item team-row" data-req="${esc(x.id)}"><div><b>${esc(x.name || x.email)}</b> <span class="pill">${x.current_role === "youth_leader" ? "Youth leader" : "Admin"}</span>
      <div class="meta">Asks for: <b>${esc(x.wants.join(", "))}</b> · ${fmtDate(x.created_at)}</div>${x.note ? `<div class="meta">“${esc(x.note)}”</div>` : ""}</div>
      <div class="team-actions"><button class="btn btn-sm btn-gold" data-req-yes>${icon("check")} Approve</button><button class="btn btn-sm" data-req-no>Decline</button></div></div>`).join("");
  setBadge("/admin/", access.length);
  const KIND = { complaint: ["Complaint", "complaints", "new"], prayer: ["Prayer request", "prayers", "pending"], wall: ["Prayer Wall: approve", "prayers", "pending"], message: ["Message", "messages", ""] };
  drawAttention(attention, KIND);
  const notes = [];
  if (email_enabled && email_health?.needs_setup) notes.push(EMAIL_SETUP);
  if (!email_enabled) notes.push("<b>Email sending is off.</b> Onboard aogsccyouth.com in Cloudflare → Email Service so confirmations, codes and letters are delivered.");
  if (!google_enabled) notes.push("<b>Google sign-in is off.</b> Add the Google client ID to switch on one-tap joining.");
  $("#setup-notes").innerHTML = notes.length ? `<div class="setup">${notes.map((n) => `<span>${n}</span>`).join("")}</div>` : "";
  const cards = [["pending_payments", "Payments to approve"], ["open_complaints", "Open complaints"], ["members", "Members"], ["new_members", "Awaiting follow-up"], ["this_week", "Joined this week"], ["subscribers", "Letter subscribers"],
    ["upcoming_events", "Upcoming events"], ["registrations_week", "Registrations this week"], ["new_prayers", "New prayer requests"]];
  $("#stats").innerHTML = cards.map(([k, l]) => `<div class="stat"><b>${stats[k]}</b><span>${l}</span></div>`).join("");
  stats.prayer_total = (stats.new_prayers || 0) + (stats.wall_pending || 0);
  drawFamily(stats);
  drawVisits().catch(() => { $("#ov-visits-card").hidden = true; });
  $$("[data-count]").forEach((b) => { b.textContent = stats[b.dataset.count] || ""; });
  const max = Math.max(1, ...interests.map((i) => i.n));
  $("#interest-bars").innerHTML = interests.length ? interests.map((i) => `<div class="bar"><span>${esc(ministryLabel(i.slug))}</span><span class="track"><i style="width:${(i.n / max) * 100}%"></i></span><b>${i.n}</b></div>`).join("") : `<p class="muted">No sign-ups yet.</p>`;
  $("#next-letter").innerHTML = next_letter
    ? `<p><b style="font-weight:450">${esc(next_letter.subject)}</b></p><p class="muted">${next_letter.status === "sending" ? "Sending now…" : "Scheduled for " + fmtDate(next_letter.scheduled_for)}</p><button class="btn btn-sm" data-go="letter:${esc(next_letter.id)}">Open</button>`
    : `<p class="muted">Nothing scheduled for this Sunday yet.</p><button class="btn btn-sm btn-gold" data-go="letters-new">Write this week's letter</button>`;
  if (perms && !perms.includes("members")) { $("#latest").innerHTML = `<p class="muted">Members are looked after by admins with Members access.</p>`; return; }
  const { members } = await api("/api/admin/members?limit=5");
  $("#latest").innerHTML = members.length ? `<table class="table m-table"><tbody>${members.map(memberRow).join("")}</tbody></table>` : `<p class="muted">No sign-ups yet. Share the Join link!</p>`;
};

// ================================================================ members
let mPage = 1;
const memberRow = (m) => `<tr data-member="${esc(m.id)}" class="m-row">
  <td class="c-name"><b style="font-weight:450">${esc(m.first_name)} ${esc(m.last_name)}</b>${m.preferred_name ? ` <span class="sub">(${esc(m.preferred_name)})</span>` : ""}<div class="sub nowrap">${esc(m.ref_code)}</div></td>
  <td class="c-type">${esc(LABELS.membership_type[m.membership_type]?.split(" —")[0] || m.membership_type)}</td>
  <td class="c-contact">${esc(m.phone)}<div class="sub">${esc(m.email)}</div></td><td class="c-age" data-age="${age(m.date_of_birth) ? "1" : ""}">${age(m.date_of_birth)}</td>
  <td class="c-status"><span class="pill ${esc(m.status)}">${esc(m.status)}</span></td><td class="sub c-date">${fmtDate(m.created_at)}</td></tr>`;
loaders.members = async () => {
  const q = $("#m-q").value.trim(), status = $("#m-status").value;
  const p = new URLSearchParams({ page: String(mPage), limit: "25" }); if (q) p.set("q", q); if (status) p.set("status", status);
  const { members, total, limit } = await api("/api/admin/members?" + p);
  $("#m-table tbody").innerHTML = members.length ? members.map(memberRow).join("") : `<tr><td colspan="6" class="sub" style="text-align:center;padding:30px">No members found.</td></tr>`;
  const pages = Math.max(1, Math.ceil(total / limit));
  $("#m-pager").innerHTML = `<span>${total} total</span><button class="btn btn-sm" data-pg="-1" ${mPage <= 1 ? "disabled" : ""}>←</button><span>${mPage} / ${pages}</span><button class="btn btn-sm" data-pg="1" ${mPage >= pages ? "disabled" : ""}>→</button>`;
};
let qTimer;
$("#m-q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { mPage = 1; safe(loaders.members)(); }, 300); });
$("#m-status").addEventListener("change", () => { mPage = 1; safe(loaders.members)(); });
$("#m-pager").addEventListener("click", (e) => { const b = e.target.closest("[data-pg]"); if (b) { mPage += Number(b.dataset.pg); safe(loaders.members)(); } });
document.addEventListener("click", (e) => { const tr = e.target.closest("tr[data-member]"); if (tr) safe(openMember)(tr.dataset.member); });

async function openMember(id) {
  const { member: m, attachments } = await api(`/api/admin/members/${id}`);
  const yn = (v) => (v ? "Yes" : "No");
  const L = (g, v) => (LABELS[g] && LABELS[g][v]) || v || "—";
  const rows = [
    ["Reference", m.ref_code], ["Joining as", L("membership_type", m.membership_type)], ["Date of birth", `${m.date_of_birth} (age ${age(m.date_of_birth)})`],
    ["Gender", L("gender", m.gender)], ["Mobile", m.phone], ["WhatsApp", m.whatsapp], ["Email", m.email], ["Area", [m.address, m.suburb, m.city].filter(Boolean).join(", ")],
    ["Currently", L("occupation_status", m.occupation_status)], ["Institution", [m.institution, m.grade_or_role].filter(Boolean).join(" · ")],
    ["Saved", L("salvation_status", m.salvation_status) + (m.salvation_year ? ` (${m.salvation_year})` : "")], ["Water baptism", L("yes_no_want", m.water_baptised)],
    ["Holy Spirit baptism", L("yes_no_want", m.spirit_baptised)], ["Previous church", m.previous_church], ["Heard via", L("heard_about", m.heard_about)], ["Invited by", m.invited_by],
    ["Interests", parseList(m.interests).map(ministryLabel).join(", ")], ["Availability", parseList(m.availability).map((s) => AVAILABILITY.find((a) => a[0] === s)?.[1] || s).join(", ")],
    ["Skills", m.skills], ["Emergency contact", `${m.emergency_name} (${m.emergency_relationship}) · ${m.emergency_phone}`],
    ["Guardian", m.guardian_name ? `${m.guardian_name} · ${m.guardian_phone || ""} ${m.guardian_email || ""} · consent: ${yn(m.guardian_consent)}` : ""],
    ["Care notes", m.care_notes], ["Prayer request", m.prayer_request], ["Contact via", [m.comm_whatsapp && "WhatsApp", m.comm_email && "Email", m.comm_sms && "SMS"].filter(Boolean).join(", ")],
    ["Photo consent", yn(m.photo_consent)], ["POPIA consent", yn(m.popia_consent)], ["Signed", m.signature_name], ["Submitted", fmtDate(m.created_at)],
    ["Last confirmed membership", m.last_confirmed_at ? fmtDate(m.last_confirmed_at) : ""], ["Next check-in email", m.next_checkin_at ? fmtDate(m.next_checkin_at) : ""],
    ["Revoked", m.revoked_at ? `${fmtDate(m.revoked_at)}${m.revoke_reason ? ` · “${m.revoke_reason}”` : ""}` : ""],
  ].filter(([, v]) => v);
  const wa = (m.whatsapp || m.phone || "").replace(/\D/g, "");
  $("#member-body").innerHTML = `
    <header class="vh"><div><p class="eyebrow gold">${esc(m.ref_code)}</p><h2>${esc(m.first_name)} ${esc(m.last_name)}</h2></div><button class="icon-btn" data-close aria-label="Close">✕</button></header>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${wa ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(`Hi ${m.preferred_name || m.first_name}! It's Sandton City Church — welcome to the family 💛`)}">WhatsApp</a>` : ""}
      <a class="btn btn-sm" href="mailto:${esc(m.email)}">Email</a><a class="btn btn-sm" href="tel:${esc(m.phone)}">Call</a></div>
    <div class="card form-grid">
      <div class="grid-2"><div class="field"><label>Status</label><select class="input" id="md-status">${["new", "contacted", "welcomed", "member", "inactive", "revoked"].map((s) => `<option ${s === m.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        <div class="field"><label>Leader</label><p class="leader-line">${m.assigned_to ? `${esc(m.assigned_to)}${m.followup_status === "met" ? ` · connected${m.followup_method ? ` by ${esc({ whatsapp: "WhatsApp", call: "phone", email: "email", in_person: "in person" }[m.followup_method] || m.followup_method)}` : ""}` : " · not connected yet"}` : m.status === "member" ? "Assigning…" : "Assigned when they're confirmed as a member"}</p>${m.assigned_to ? `<a class="link-btn" href="#people">Hand over in My people</a>` : ""}<input type="hidden" id="md-assigned" value="${esc(m.assigned_to || "")}"></div></div>
      <div class="field"><label>Leader notes</label><textarea class="input" id="md-notes">${esc(m.admin_notes || "")}</textarea></div>
      <button class="btn btn-gold btn-sm" id="md-save" style="justify-self:start">Save</button></div>
    ${attachments.length ? `<div class="card"><h3>Attachments</h3><div class="files">${attachments.map((a) => `<a href="/api/admin/files/${esc(a.id)}" target="_blank" rel="noopener">${a.content_type.startsWith("image/") && a.content_type !== "image/heic" ? `<img src="/api/admin/files/${esc(a.id)}" alt="">` : `<span class="doc">${esc((a.filename.split(".").pop() || "file").toUpperCase())}</span>`}<span>${esc(a.kind)} · ${(a.size_bytes / 1024).toFixed(0)} KB</span></a>`).join("")}</div></div>` : ""}
    <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    ${document.body.dataset.role === "super" ? `<button class="btn btn-sm" id="md-delete" style="justify-self:start;color:var(--danger)">Delete record (POPIA request)</button>` : `<p class="muted" style="font-size:13px">Only the main admin can delete records.</p>`}`;
  const dlg = $("#member-drawer"); dlg.showModal();
  // Save closes straight away and you're back on the list; the row updates instantly, the server catches up.
  $("#md-save").onclick = () => {
    const body = { status: $("#md-status").value, admin_notes: $("#md-notes").value };
    dlg.close();
    $$(`[data-member="${CSS.escape(id)}"] .c-status`).forEach((td) => { td.innerHTML = `<span class="pill ${esc(body.status)}">${esc(body.status)}</span>`; });
    toast(body.status !== m.status ? `${m.first_name} is now “${body.status}”` : "Saved");
    api(`/api/admin/members/${id}`, { method: "PATCH", body })
      .then(() => { safe(loaders.members)(); refreshBadges(); })
      .catch((e) => { toast(`Couldn't save ${m.first_name}: ${e.message}`); safe(loaders.members)(); });
  };
  if ($("#md-delete")) $("#md-delete").onclick = safe(async () => { if (!confirm(`Permanently delete ${m.first_name} ${m.last_name} and their files?`)) return; await api(`/api/admin/members/${id}`, { method: "DELETE" }); dlg.close(); toast("Deleted"); safe(loaders.members)(); });
}
$$("dialog.drawer").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); }));

// ================================================================ events list
loaders.events = async () => {
  const { events } = await api("/api/admin/events");
  const now = new Date().toISOString();
  $("#ev-list").innerHTML = events.length ? events.map((ev) => {
    const d = new Date(ev.starts_at);
    const thumb = ev.cover_attachment_id || ev.cover_image ? `<img src="${esc(ev.cover_attachment_id ? `/api/media/${ev.cover_attachment_id}` : ev.cover_image)}" alt="">` : `<span class="ph">${new Intl.DateTimeFormat("en-ZA", { day: "2-digit", timeZone: TZ }).format(d)}</span>`;
    return `<article class="item ev-item" data-go="event:${esc(ev.id)}">${thumb}
      <div><b style="font-weight:450">${esc(ev.title)}</b><div class="meta">${fmtDate(ev.starts_at)}${ev.location ? " · " + esc(ev.location) : ""}${ev.price_label ? " · " + esc(ev.price_label) : ""}</div></div>
      <div class="meta-row">${ev.starts_at < now ? '<span class="pill">Past</span>' : ""}${ev.is_published ? '<span class="pill member">Published</span>' : '<span class="pill">Draft</span>'}
        <span class="pill">${ev.confirmed} registered${ev.capacity ? ` / ${ev.capacity}` : ""}</span>${ev.pending ? `<span class="pill pending">${ev.pending} to approve</span>` : ""}${ev.waitlist ? `<span class="pill">${ev.waitlist} waitlist</span>` : ""}</div></article>`;
  }).join("") : `<div class="empty">No events yet. Create your first service or event — each one gets its own registration page.</div>`;
};
$("#new-event").addEventListener("click", () => editEvent(null));

// ================================================================ event builder
let fields = [];
let currentEvent = null;
const ef = $("#event-form");
const OPT = ["select", "radio", "checkbox"];
const newId = () => "q" + Math.random().toString(36).slice(2, 8);

$("#palette").innerHTML = Object.entries(FIELD_TYPES).map(([t, l]) => `<button type="button" data-add="${t}">${esc(l)}</button>`).join("");
$("#palette").addEventListener("click", (e) => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  const t = b.dataset.add;
  fields.push({ id: newId(), type: t, label: t === "statement" ? "Add some helpful information here." : "", required: false, ...(OPT.includes(t) ? { options: ["Option 1", "Option 2"] } : {}) });
  renderFields(); $$(".fb-field").at(-1)?.querySelector("[data-k=label]")?.focus();
});

function renderFields() {
  $("#fb-fields").innerHTML = fields.length ? fields.map((f, i) => `
    <div class="fb-field" draggable="true" data-i="${i}">
      <div class="fb-head"><span class="grip" title="Drag to reorder">⋮⋮</span><span class="type">${esc(FIELD_TYPES[f.type])}</span>
        <div class="tools"><button type="button" data-act="up" title="Move up">↑</button><button type="button" data-act="down" title="Move down">↓</button><button type="button" data-act="copy" title="Duplicate">⧉</button><button type="button" data-act="del" title="Remove">✕</button></div></div>
      ${f.type === "statement" ? `<textarea class="input" data-k="label" placeholder="Text shown on the form">${esc(f.label)}</textarea>` : `<input class="input" data-k="label" value="${esc(f.label)}" placeholder="Your question">`}
      ${f.type !== "statement" ? `<input class="input" data-k="help" value="${esc(f.help || "")}" placeholder="Helper text (optional)">` : ""}
      ${OPT.includes(f.type) ? `<textarea class="input" data-k="options" placeholder="One option per line">${esc((f.options || []).join("\n"))}</textarea>` : ""}
      ${f.type !== "statement" ? `<div class="fb-row"><label class="check"><input type="checkbox" data-k="required" ${f.required ? "checked" : ""}> Required</label>
        <select class="input" data-k="type" style="width:auto">${Object.entries(FIELD_TYPES).filter(([t]) => t !== "statement").map(([t, l]) => `<option value="${t}" ${t === f.type ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>` : ""}
    </div>`).join("") : `<p class="muted">No extra questions yet — add some below (e.g. dietary needs, T-shirt size, which session).</p>`;
  renderPreview();
}
function renderPreview() {
  $("#pv-title").textContent = ef.title.value || "Save your seat";
  $("#pv-phone").hidden = !ef.collect_phone.checked;
  $("#pv-fields").innerHTML = fields.filter((f) => f.label || f.type === "statement").map((f) => renderField({ ...f, label: f.label || "Untitled question", options: f.options?.length ? f.options : ["Option"] })).join("");
}
$("#fb-fields").addEventListener("input", (e) => {
  const el = e.target.closest("[data-k]"); if (!el) return;
  const i = Number(el.closest(".fb-field").dataset.i); const k = el.dataset.k;
  if (k === "options") fields[i].options = el.value.split("\n").map((s) => s.trim()).filter(Boolean);
  else if (k === "required") fields[i].required = el.checked;
  else if (k === "type") { fields[i].type = el.value; if (OPT.includes(el.value) && !fields[i].options?.length) fields[i].options = ["Option 1", "Option 2"]; renderFields(); return; }
  else fields[i][k] = el.value;
  renderPreview();
});
$("#fb-fields").addEventListener("change", (e) => { if (e.target.dataset.k === "required" || e.target.dataset.k === "type") $("#fb-fields").dispatchEvent(new Event("input", { bubbles: true })) ; });
$("#fb-fields").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const i = Number(b.closest(".fb-field").dataset.i);
  const a = b.dataset.act;
  if (a === "del") fields.splice(i, 1);
  if (a === "copy") fields.splice(i + 1, 0, { ...structuredClone(fields[i]), id: newId() });
  if (a === "up" && i > 0) [fields[i - 1], fields[i]] = [fields[i], fields[i - 1]];
  if (a === "down" && i < fields.length - 1) [fields[i + 1], fields[i]] = [fields[i], fields[i + 1]];
  renderFields();
});
let dragI = null;
$("#fb-fields").addEventListener("dragstart", (e) => { dragI = Number(e.target.closest(".fb-field")?.dataset.i); });
$("#fb-fields").addEventListener("dragover", (e) => { const f = e.target.closest(".fb-field"); if (f) { e.preventDefault(); $$(".fb-field").forEach((x) => x.classList.toggle("drag-over", x === f)); } });
$("#fb-fields").addEventListener("drop", (e) => {
  const f = e.target.closest(".fb-field"); if (!f || dragI === null) return; e.preventDefault();
  const to = Number(f.dataset.i); const [m] = fields.splice(dragI, 1); fields.splice(to, 0, m); dragI = null; renderFields();
});
ef.addEventListener("input", (e) => { if (!e.target.closest("#fb-fields")) renderPreview(); });

async function editEvent(id) {
  if (ef.ministry_group.options.length <= 1) await insights.loadMeta().catch(() => {});
  currentEvent = null; fields = []; ef.reset();
  $("#eb-cover").hidden = true;
  if (id) {
    const { event } = await api(`/api/admin/events/${id}`);
    currentEvent = event;
    for (const k of ["title", "slug", "category", "ministry_group", "location", "description", "capacity", "confirmation_message", "ticket_price", "payment_instructions"]) ef[k].value = event[k] ?? "";
    ef.requires_pop.checked = !!event.requires_pop; ef.auto_approve.checked = !!event.auto_approve;
    ef.starts_at.value = toLocal(event.starts_at); ef.ends_at.value = toLocal(event.ends_at); ef.registration_closes_at.value = toLocal(event.registration_closes_at);
    ef.is_published.checked = !!event.is_published; ef.rsvp_enabled.checked = !!event.rsvp_enabled; ef.collect_phone.checked = !!event.collect_phone;
    fields = event.form_schema || [];
    if (event.cover_attachment_id || event.cover_image) { $("#eb-cover").src = event.cover_attachment_id ? `/api/media/${event.cover_attachment_id}` : event.cover_image; $("#eb-cover").hidden = false; }
  } else {
    ef.location.value = "17 Humber Street, Woodmead, Sandton";
  }
  $("#eb-title").textContent = id ? currentEvent.title : "New event";
  $("#eb-delete").hidden = $("#eb-duplicate").hidden = $("#eb-view").hidden = !id;
  if (id) $("#eb-view").href = `/event?e=${encodeURIComponent(currentEvent.slug)}`;
  setEtab("build");
  renderFields();
  showView("event-edit", id ? `event:${id}` : "events-new", "events");
}
function setEtab(t) {
  $$("#eb-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.etab === t));
  $("#eb-build").hidden = t !== "build"; $("#eb-responses").hidden = t !== "responses";
  if (t === "responses") safe(loadResponses)();
}
$("#eb-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-etab]"); if (!b) return; if (b.dataset.etab === "responses" && !currentEvent) return toast("Save the event first"); setEtab(b.dataset.etab); });

ef.addEventListener("submit", safe(async (e) => {
  e.preventDefault();
  const missing = fields.findIndex((f) => !f.label?.trim());
  if (missing >= 0) { toast(`Question ${missing + 1} needs a label`); return; }
  const body = {
    title: ef.title.value, slug: ef.slug.value, category: ef.category.value, ministry_group: ef.ministry_group.value, location: ef.location.value, description: ef.description.value,
    starts_at: fromLocal(ef.starts_at.value), ends_at: fromLocal(ef.ends_at.value), registration_closes_at: fromLocal(ef.registration_closes_at.value),
    capacity: ef.capacity.value, confirmation_message: ef.confirmation_message.value, ticket_price: ef.ticket_price.value,
    requires_pop: ef.requires_pop.checked, auto_approve: ef.auto_approve.checked, payment_instructions: ef.payment_instructions.value,
    is_published: ef.is_published.checked, rsvp_enabled: ef.rsvp_enabled.checked, collect_phone: ef.collect_phone.checked, form_schema: fields,
  };
  if (currentEvent) { await api(`/api/admin/events/${currentEvent.id}`, { method: "PUT", body }); toast("Event saved"); await editEvent(currentEvent.id); }
  else { const r = await api("/api/admin/events", { method: "POST", body }); toast("Event created — add a cover image if you like"); await editEvent(r.id); }
}));
$("#eb-cover-file").addEventListener("change", safe(async (e) => {
  if (!currentEvent) { toast("Save the event first"); e.target.value = ""; return; }
  const fd = new FormData(); fd.append("cover", e.target.files[0]);
  const r = await api(`/api/admin/events/${currentEvent.id}/cover`, { method: "POST", form: fd });
  $("#eb-cover").src = r.cover_url; $("#eb-cover").hidden = false; e.target.value = ""; toast("Cover updated");
}));
$("#eb-delete").addEventListener("click", safe(async () => {
  if (!currentEvent || !confirm(`Delete "${currentEvent.title}" and all its registrations?`)) return;
  await api(`/api/admin/events/${currentEvent.id}`, { method: "DELETE" }); toast("Deleted"); openTab("events");
}));
$("#eb-duplicate").addEventListener("click", safe(async () => {
  const r = await api(`/api/admin/events/${currentEvent.id}/duplicate`, { method: "POST", body: { days: 7 } });
  toast("Duplicated as a draft for next week"); editEvent(r.id);
}));

let responses = [];
async function loadResponses() {
  const { registrations } = await api(`/api/admin/events/${currentEvent.id}/registrations`);
  responses = registrations;
  $("#eb-count").textContent = registrations.filter((r) => r.status === "pending").length || "";
  $("#resp-csv").href = `/api/admin/events/${currentEvent.id}/registrations.csv`;
  drawResponses();
}
const STATUS_LABEL = { pending: "Awaiting approval", confirmed: "Confirmed", waitlist: "Waitlist", rejected: "Declined", cancelled: "Cancelled" };
// Approve / decline: the row updates the instant you tap; the server confirms in the background
// (emails and PDF tickets are sent after it responds). If anything fails, the row goes back and you're told.
async function review(id, status, note = null) {
  const r = responses.find((x) => x.id === id); if (!r || r._busy) return;
  const before = { status: r.status, reviewed_at: r.reviewed_at };
  Object.assign(r, { status, reviewed_at: new Date().toISOString(), _busy: true });
  drawResponses();
  try {
    await api(`/api/admin/registrations/${id}`, { method: "PATCH", body: { status, note } });
    toast(status === "confirmed" ? `${r.name.split(" ")[0]} approved · tickets on their way` : `${r.name.split(" ")[0]} declined · they'll be emailed`);
  } catch (e) { Object.assign(r, before); toast(e.message || "Couldn't save. Please try again."); }
  finally { r._busy = false; drawResponses(); }
}
function drawResponses() {
  const q = $("#resp-q").value.toLowerCase();
  const f = $("#resp-filter").value;
  const list = responses.filter((r) => (!f || r.status === f) && (!q || `${r.name} ${r.email} ${r.phone} ${r.ref_code}`.toLowerCase().includes(q)));
  const by = (st) => responses.filter((r) => r.status === st);
  const people = by("confirmed").reduce((n, r) => n + 1 + r.guests, 0);
  const paid = by("confirmed").reduce((n, r) => n + (r.amount_due || 0), 0);
  const pending = by("pending");
  $("#approve-all").hidden = !pending.length;
  $("#approve-all").textContent = `Approve all pending (${pending.length})`;
  $("#resp-summary").textContent = `${by("confirmed").length} confirmed · ${people} people${paid ? ` · R${paid.toLocaleString("en-ZA")} approved` : ""} · ${pending.length} awaiting approval · ${by("waitlist").length} waitlist · ${by("confirmed").filter((r) => r.checked_in_at).length} checked in`;
  const qs = (currentEvent.form_schema || []).filter((x) => x.type !== "statement");
  $("#resp-table").innerHTML = `<thead><tr><th>Person</th><th>Payment</th><th>Answers</th><th>Status</th><th>Check-in</th></tr></thead><tbody>${list.length ? list.map((r) => `<tr>
    <td><b style="font-weight:450">${esc(r.name)}</b>${r.guests ? ` <span class="sub">+${r.guests}</span>` : ""}<div class="sub">${esc(r.email)}${r.phone ? " · " + esc(r.phone) : ""}</div><div class="sub">${esc(r.ref_code)} · ${fmtDate(r.created_at)}</div></td>
    <td>${r.amount_due ? `<b style="font-weight:450">R${Number(r.amount_due).toLocaleString("en-ZA")}</b>` : '<span class="sub">—</span>'}
      ${r.pop_attachment_id ? `<div><a class="pop-link" href="/api/admin/files/${esc(r.pop_attachment_id)}" target="_blank" rel="noopener">${icon("file")} View proof</a></div>` : ""}
      ${r.status === "pending" ? `<div class="row-actions approve-row"><button class="btn btn-gold btn-approve" data-approve="${esc(r.id)}">${icon("check")} Approve</button><button class="btn btn-decline" data-decline="${esc(r.id)}">Decline</button></div>` : ""}
      ${r._busy ? `<div class="sub saving">Saving…</div>` : ""}
      ${r.status === "confirmed" ? `<div class="row-actions"><button class="btn btn-sm" data-resend="${esc(r.id)}">${icon("ticket")} Resend ${1 + Number(r.guests || 0)} ticket${r.guests ? "s" : ""}</button></div>` : ""}
      ${r.reviewed_at ? `<div class="sub">Reviewed ${fmtDate(r.reviewed_at)}</div>` : ""}</td>
    <td><div class="resp-answers">${qs.map((fld) => { const v = r.answers[fld.id]; const fl = r.files.filter((x) => x.kind === `answer:${fld.id}`);
      return `<span><b>${esc(fld.label)}${/[?:.]$/.test(fld.label) ? "" : ":"}</b> ${fl.length ? fl.map((x) => `<a href="/api/admin/files/${esc(x.id)}" target="_blank" style="color:var(--gold-2)">${esc(x.filename)}</a>`).join(", ") : esc(Array.isArray(v) ? v.join(", ") : v ?? "—")}</span>`; }).join("") || '<span class="sub">—</span>'}</div></td>
    <td><span class="pill ${esc(r.status)}">${esc(STATUS_LABEL[r.status] || r.status)}</span>
      <select class="input" data-reg="${esc(r.id)}" style="min-height:34px;padding:4px 30px 4px 10px;font-size:13px;margin-top:6px" aria-label="Change status">${Object.entries(STATUS_LABEL).map(([k, l]) => `<option value="${k}" ${k === r.status ? "selected" : ""}>${l}</option>`).join("")}</select></td>
    <td>${r.checked_in_at ? `<span class="pill member">In · ${new Date(r.checked_in_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</span>` : `<span class="sub">Not yet</span>`}</td></tr>`).join("") : `<tr><td colspan="5" class="sub" style="text-align:center;padding:30px">No registrations here yet.</td></tr>`}</tbody>`;
}
$("#resp-q").addEventListener("input", drawResponses);
$("#resp-filter").addEventListener("change", drawResponses);
$("#notify-holders").addEventListener("click", () => more.notifyHolders(currentEvent.id, currentEvent.title));
$("#approve-all").addEventListener("click", safe(async () => {
  const n = responses.filter((r) => r.status === "pending").length;
  if (!confirm(`Approve all ${n} pending registration(s)? Each person will be emailed their ticket.`)) return;
  const btn = $("#approve-all"); btn.disabled = true; btn.textContent = "Approving…";
  try {
    const r = await api(`/api/admin/events/${currentEvent.id}/approve-all`, { method: "POST", body: {} });
    toast(`${r.approved} approved · tickets on their way`);
  } finally { btn.disabled = false; await loadResponses(); }
}));
$("#resp-table").addEventListener("click", safe(async (e) => {
  const a = e.target.closest("[data-approve]"), d = e.target.closest("[data-decline]"), rs = e.target.closest("[data-resend]");
  if (rs) { rs.disabled = true; const r = await api(`/api/admin/registrations/${rs.dataset.resend}/resend-tickets`, { method: "POST" }); toast(`Tickets sent to ${r.sent_to}`); rs.disabled = false; }
  if (a) await review(a.dataset.approve, "confirmed");
  if (d) {
    const note = prompt("Optional note to the person (e.g. amount didn't match):", "");
    if (note === null) return;
    await review(d.dataset.decline, "rejected", note);
  }
}));
$("#resp-table").addEventListener("change", safe(async (e) => {
  if (e.target.dataset.reg) {
    const st = e.target.value;
    const note = st === "rejected" ? prompt("Optional note to the person:", "") : null;
    if (st === "rejected" && note === null) { drawResponses(); return; }
    await review(e.target.dataset.reg, st, note);
    return;
  }
  if (e.target.dataset.checkin) { await api(`/api/admin/registrations/${e.target.dataset.checkin}`, { method: "PATCH", body: { checked_in: e.target.checked } }); }
  await loadResponses();
}));

// ================================================================ letters
loaders.letters = async () => {
  const { announcements, next_sunday } = await api("/api/admin/announcements");
  $("#letter-list").innerHTML = announcements.length ? announcements.map((a) => {
    const pct = a.recipients ? Math.round(((a.sent_count + a.failed_count) / a.recipients) * 100) : 0;
    const st = a.status === "scheduled" ? `Scheduled · ${fmtDate(a.scheduled_for)}` : a.status === "sending" ? `Sending · ${a.sent_count}/${a.recipients}` : a.status === "sent" ? `Sent ${fmtDate(a.sent_at)} · ${a.sent_count} delivered` : "Draft";
    return `<article class="item" data-go="letter:${esc(a.id)}" style="cursor:pointer"><header><div><b style="font-weight:450">${esc(a.subject)}</b><div class="meta">${esc(a.heading)}</div></div><span class="pill ${a.status === "sent" ? "member" : a.status === "scheduled" ? "new" : ""}">${esc(st)}</span></header>
      ${a.status === "sending" ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ""}</article>`;
  }).join("") : `<div class="empty">No letters yet. The next one would go out on ${fmtDate(next_sunday)}.</div>`;
};
$("#new-letter").addEventListener("click", () => editLetter(null));

let currentLetter = null;
const lf = $("#letter-form");
function serviceRow(s = {}) {
  const d = document.createElement("div"); d.className = "svc-row";
  d.innerHTML = `<input class="input" data-s="title" placeholder="Sunday Family Service" value="${esc(s.title || "")}"><input class="input" data-s="when" placeholder="Sunday · 09:30" value="${esc(s.when || "")}">
    <input class="input" data-s="location" placeholder="Main auditorium" value="${esc(s.location || "")}"><button type="button" title="Remove">✕</button>`;
  d.querySelector("button").onclick = () => d.remove();
  $("#services").append(d);
}
$("#add-service").addEventListener("click", () => serviceRow());
// Our regular week: new letters start with these (edit or remove as needed).
const WEEKLY = [
  { title: "Prayer", when: "Monday · 18:00 – 20:00", location: "Sandton City Church" },
  { title: "Choir practice", when: "Wednesday · 18:00 – 19:30", location: "Sandton City Church" },
  { title: "Mothers', Fathers' & Daughters' services", when: "Thursday · 18:00 – 20:00", location: "Sandton City Church" },
  { title: "Youth service", when: "Friday · 18:00 – 20:00", location: "Sandton City Church" },
  { title: "Main service", when: "Sunday · 08:45 – 11:00", location: "17 Humber Street, Woodmead" },
];
const letterBody = () => ({
  subject: lf.subject.value, preheader: lf.preheader.value, heading: lf.heading.value, body: lf.body.value,
  scripture_text: lf.scripture_text.value, scripture_ref: lf.scripture_ref.value, include_events: lf.include_events.checked,
  cta_label: lf.cta_label.value, cta_url: lf.cta_url.value,
  services: $$("#services .svc-row").map((r) => ({ title: $("[data-s=title]", r).value, when: $("[data-s=when]", r).value, location: $("[data-s=location]", r).value })).filter((s) => s.title),
});

async function editLetter(id) {
  currentLetter = null; lf.reset(); $("#services").innerHTML = "";
  if (id) {
    const { announcement: a } = await api(`/api/admin/announcements/${id}`);
    currentLetter = a;
    for (const k of ["subject", "preheader", "heading", "body", "scripture_text", "scripture_ref", "cta_label", "cta_url"]) lf[k].value = a[k] ?? "";
    lf.include_events.checked = !!a.include_events;
    a.services.forEach(serviceRow);
  } else {
    lf.subject.value = "This week at Sandton City Church ✨";
    lf.heading.value = "A new week, the same faithful God";
    lf.body.value = "What a joy it was to worship together this morning! Thank you for being part of this family.\n\nHere's what's happening this week — we'd love to see you there. Bring a friend, bring your questions, and come expecting God to move.";
    lf.scripture_text.value = "Those who hope in the Lord will renew their strength. They will soar on wings like eagles.";
    lf.scripture_ref.value = "Isaiah 40:31";
    WEEKLY.forEach(serviceRow);
    serviceRow();
  }
  const locked = currentLetter && !["draft", "scheduled"].includes(currentLetter.status);
  $$("input, textarea, button[type=submit], #le-schedule, #le-test, #add-service", lf).forEach((el) => { if (el.id !== "le-test") el.disabled = !!locked; });
  $("#le-title").textContent = id ? currentLetter.subject : "New letter";
  $("#le-status").textContent = !currentLetter ? "Draft — not saved yet" : currentLetter.status === "scheduled" ? `Scheduled for ${fmtDate(currentLetter.scheduled_for)}` : currentLetter.status === "sent" ? `Sent ${fmtDate(currentLetter.sent_at)} to ${currentLetter.sent_count} people` : currentLetter.status === "sending" ? "Sending now…" : "Draft";
  $("#le-unschedule").hidden = currentLetter?.status !== "scheduled";
  $("#le-delete").hidden = !currentLetter || locked;
  $("#le-preview").srcdoc = id ? "" : `<p style="font:15px sans-serif;padding:24px;color:#5a5046">Save the draft to see the email preview.</p>`;
  if (id) refreshPreview();
  showView("letter-edit", id ? `letter:${id}` : "letters-new", "letters");
}
async function saveLetter() {
  if (currentLetter) { await api(`/api/admin/announcements/${currentLetter.id}`, { method: "PUT", body: letterBody() }); return currentLetter.id; }
  const r = await api("/api/admin/announcements", { method: "POST", body: letterBody() }); return r.id;
}
async function refreshPreview() {
  if (!currentLetter) return;
  const html = await fetch(`/api/admin/announcements/${currentLetter.id}/preview`).then((r) => r.text());
  $("#le-preview").srcdoc = html;
}
lf.addEventListener("submit", safe(async (e) => { e.preventDefault(); const id = await saveLetter(); toast("Draft saved"); await editLetter(id); }));
$("#le-refresh").addEventListener("click", safe(async () => { if (currentLetter && ["draft", "scheduled"].includes(currentLetter.status)) await saveLetter(); else if (!currentLetter) { const id = await saveLetter(); return editLetter(id); } await refreshPreview(); }));
$("#le-test").addEventListener("click", safe(async () => { const id = currentLetter && !["draft", "scheduled"].includes(currentLetter.status) ? currentLetter.id : await saveLetter(); const r = await api(`/api/admin/announcements/${id}/test`, { method: "POST" }); toast(`Test sent to ${r.sent_to}`); if (!currentLetter) editLetter(id); }));
const schedule = (opts, msg) => safe(async () => { const id = await saveLetter(); const r = await api(`/api/admin/announcements/${id}/schedule`, { method: "POST", body: opts() }); toast(msg(r)); editLetter(id); });
$("#le-schedule").addEventListener("click", schedule(() => ({}), (r) => `Scheduled for ${fmtDate(r.scheduled_for)} 🎉`));
$("#le-schedule-custom").addEventListener("click", schedule(() => ({ when: fromLocal($("#le-when").value) }), (r) => `Scheduled for ${fmtDate(r.scheduled_for)}`));
$("#le-now").addEventListener("click", (e) => { if (confirm("Send this letter to every active subscriber right now?")) schedule(() => ({ now: true }), () => "Sending now…")(e); });
$("#le-unschedule").addEventListener("click", safe(async () => { await api(`/api/admin/announcements/${currentLetter.id}/cancel`, { method: "POST" }); toast("Unscheduled"); editLetter(currentLetter.id); }));
$("#le-delete").addEventListener("click", safe(async () => { if (!confirm("Delete this letter?")) return; await api(`/api/admin/announcements/${currentLetter.id}`, { method: "DELETE" }); toast("Deleted"); openTab("letters"); }));

// ================================================================ subscribers
let sPage = 1;
loaders.subscribers = async () => {
  const q = $("#sub-q").value.trim();
  const p = new URLSearchParams({ page: String(sPage), limit: "50" }); if (q) p.set("q", q);
  const { subscribers, total, limit, by_status } = await api("/api/admin/subscribers?" + p);
  $("#sub-counts").textContent = `${by_status.active || 0} active · ${by_status.pending || 0} awaiting confirmation · ${by_status.unsubscribed || 0} unsubscribed`;
  $("#sub-table tbody").innerHTML = subscribers.length ? subscribers.map((s) => `<tr><td>${esc(s.email)}</td><td>${esc(s.name || "")}</td><td><span class="pill ${s.status === "active" ? "member" : s.status === "pending" ? "new" : ""}">${esc(s.status)}</span></td>
    <td class="sub">${esc(s.source || "")}</td><td class="sub">${fmtDate(s.created_at)}</td><td><button class="btn btn-sm" data-unsub="${esc(s.id)}">Remove</button></td></tr>`).join("") : `<tr><td colspan="6" class="sub" style="text-align:center;padding:30px">No subscribers yet.</td></tr>`;
  const pages = Math.max(1, Math.ceil(total / limit));
  $("#sub-pager").innerHTML = `<span>${total} total</span><button class="btn btn-sm" data-spg="-1" ${sPage <= 1 ? "disabled" : ""}>←</button><span>${sPage} / ${pages}</span><button class="btn btn-sm" data-spg="1" ${sPage >= pages ? "disabled" : ""}>→</button>`;
};
$("#sub-q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { sPage = 1; safe(loaders.subscribers)(); }, 300); });
$("#sub-pager").addEventListener("click", (e) => { const b = e.target.closest("[data-spg]"); if (b) { sPage += Number(b.dataset.spg); safe(loaders.subscribers)(); } });
$("#sub-table").addEventListener("click", safe(async (e) => { const b = e.target.closest("[data-unsub]"); if (!b || !confirm("Remove this subscriber?")) return; await api(`/api/admin/subscribers/${b.dataset.unsub}`, { method: "DELETE" }); toast("Removed"); loaders.subscribers(); }));
$("#sub-add").addEventListener("submit", safe(async (e) => { e.preventDefault(); await api("/api/admin/subscribers", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast("Subscriber added"); loaders.subscribers(); }));

// ================================================================ prayer & messages
loaders.prayers = async () => {
  safe(loadWall)();
  const s = $("#p-status").value;
  const { prayers } = await api("/api/admin/prayers?limit=100" + (s ? `&status=${s}` : ""));
  $("#p-list").innerHTML = prayers.length ? prayers.map((p) => `<article class="item">
    <header><div><b style="font-weight:450">${p.is_anonymous ? "Anonymous" : esc(p.name)}</b> ${p.pastors_only ? '<span class="pill">Pastors only</span>' : ""} ${p.wants_contact ? '<span class="pill new">Wants contact</span>' : ""}<div class="meta">${fmtDate(p.created_at)}${p.phone ? " · " + esc(p.phone) : ""}${p.email ? " · " + esc(p.email) : ""}</div></div><span class="pill ${esc(p.status)}">${esc(p.status)}</span></header>
    <p>${esc(p.request)}</p><div class="actions">${["praying", "answered", "archived"].map((st) => `<button class="btn btn-sm" data-prayer="${esc(p.id)}" data-st="${st}">Mark ${st}</button>`).join("")}</div></article>`).join("") : `<div class="empty">No prayer requests here.</div>`;
};
$("#p-status").addEventListener("change", () => safe(loaders.prayers)());
async function loadWall() {
  const { posts } = await api("/api/admin/wall");
  const LBL = { pending: ["Waiting for approval", "new"], approved: ["On the wall", "member"], hidden: ["Hidden", ""] };
  $("#wall-mod").innerHTML = posts.length ? posts.map((w) => `<article class="item" data-wall="${esc(w.id)}">
      <header><div><b style="font-weight:450">${esc(w.display_name || "Someone")}</b> <span class="meta">· ${esc(w.name || "")} ${esc(w.email || "")} · ${fmtDate(w.created_at)}</span></div><span class="pill ${LBL[w.status]?.[1] || ""}">${esc(LBL[w.status]?.[0] || w.status)}</span></header>
      <p style="white-space:pre-wrap">${esc(w.request)}</p>${w.answered ? `<p class="meta">🙌 Answered${w.answered_note ? `: “${esc(w.answered_note)}”` : ""}</p>` : ""}
      <div class="actions"><span class="meta">🙏 ${w.prayed_count} prayed</span>${w.status !== "approved" ? `<button class="btn btn-sm btn-gold" data-st="approved">Approve</button>` : ""}${w.status !== "hidden" ? `<button class="btn btn-sm" data-st="hidden">Hide</button>` : ""}</div></article>`).join("")
    : `<div class="empty">Nothing on the wall yet.</div>`;
}
$("#wall-mod").addEventListener("click", safe(async (e) => {
  const b = e.target.closest("[data-st]"); if (!b) return;
  await api(`/api/admin/wall/${b.closest("[data-wall]").dataset.wall}`, { method: "PATCH", body: { status: b.dataset.st } });
  toast(b.dataset.st === "approved" ? "Approved. It's on the wall 🙏" : "Hidden"); loadWall();
}));
$("#p-list").addEventListener("click", safe(async (e) => { const b = e.target.closest("[data-prayer]"); if (!b) return; await api(`/api/admin/prayers/${b.dataset.prayer}`, { method: "PATCH", body: { status: b.dataset.st } }); toast("Updated"); loaders.prayers(); }));
loaders.messages = async () => {
  const { messages } = await api("/api/admin/messages?limit=100");
  $("#msg-list").innerHTML = messages.length ? messages.map((m) => `<article class="item">
    <header><div><b style="font-weight:450">${esc(m.name)}</b> <span class="meta">· ${esc(m.subject || "No subject")}</span><div class="meta">${fmtDate(m.created_at)} · ${esc(m.email)}${m.phone ? " · " + esc(m.phone) : ""}</div></div><span class="pill ${esc(m.status)}">${esc(m.status)}</span></header>
    <p>${esc(m.message)}</p><div class="actions"><a class="btn btn-sm" href="mailto:${esc(m.email)}?subject=${encodeURIComponent("Re: " + (m.subject || "your message to Sandton City Church"))}">Reply by email</a><button class="btn btn-sm" data-msg="${esc(m.id)}" data-st="replied">Mark replied</button><button class="btn btn-sm" data-msg="${esc(m.id)}" data-st="archived">Archive</button></div></article>`).join("") : `<div class="empty">No messages yet.</div>`;
};
$("#msg-list").addEventListener("click", safe(async (e) => { const b = e.target.closest("[data-msg]"); if (!b) return; await api(`/api/admin/messages/${b.dataset.msg}`, { method: "PATCH", body: { status: b.dataset.st } }); toast("Updated"); loaders.messages(); }));

// ================================================================ door scanner
// Camera-first: opens ready to scan on phones, tablets and laptops. Uses the browser's built-in
// barcode reader where available (Chrome/Android), otherwise the bundled jsQR reader (iPhone/iPad, Firefox).
const scan = { stream: null, track: null, raf: 0, busy: false, last: { code: "", at: 0 }, detector: null, cams: [], camIdx: 0, torch: false, jsqr: null, lastTick: 0 };
// Three plain outcomes at the door. Anything that isn't a clean "checked in" goes to the help desk.
const SCAN_MSG = {
  ok: ["Checked in", "ok", "check"],
  already_used: ["Already scanned", "warn", "alert"],
  void: ["Invalid ticket", "bad", "x"], wrong_event: ["Invalid ticket", "bad", "x"], not_found: ["Invalid ticket", "bad", "x"],
  offline: ["No connection", "idle", "wifiOff"],
};
let audio;
function beep(ok) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const tone = (f, t0, d) => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = f; o.connect(g); g.connect(audio.destination); g.gain.setValueAtTime(.18, audio.currentTime + t0); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + t0 + d); o.start(audio.currentTime + t0); o.stop(audio.currentTime + t0 + d); };
    if (ok) tone(1046, 0, .15); else { tone(220, 0, .18); tone(196, .22, .22); }
  } catch { /* sound is optional */ }
  try { navigator.vibrate?.(ok ? 80 : [120, 80, 120]); } catch { /* ignore */ }
}
const loadJsQR = () => scan.jsqr ??= new Promise((res, rej) => { if (window.jsQR) return res(window.jsQR); const el = document.createElement("script"); el.src = "/js/vendor/jsqr.js"; el.onload = () => res(window.jsQR); el.onerror = rej; document.head.append(el); });
loaders.scan = async () => {
  const { events } = await api("/api/admin/events");
  const soon = Date.now() - 86400_000;
  const list = events.filter((e) => new Date(e.ends_at || e.starts_at).getTime() > soon).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .concat(events.filter((e) => new Date(e.ends_at || e.starts_at).getTime() <= soon));
  const sel = $("#scan-event"), prev = sel.value;
  sel.innerHTML = list.map((e) => `<option value="${esc(e.id)}">${esc(e.title)} · ${fmtDate(e.starts_at)}</option>`).join("") || `<option value="">No events yet</option>`;
  if (prev) sel.value = prev;
  scanCount();
  startScanner().catch(() => {});
};
let scanTotals = { in: 0, total: 0 };
const drawCount = () => { $("#scan-count").textContent = scanTotals.total ? `${scanTotals.in} / ${scanTotals.total} in` : ""; };
async function scanCount() {
  const id = $("#scan-event").value; if (!id) return;
  const r = await api(`/api/admin/events/${id}/tickets`).catch(() => null);
  if (r) { scanTotals = { in: r.checked_in, total: r.total }; drawCount(); }
}
function flash(result, t) {
  const [label, cls, ico] = SCAN_MSG[result] || SCAN_MSG.not_found;
  const el = $("#scan-flash");
  const who = t ? `<span>${esc(t.holder)}</span>` : "";
  const line = cls === "ok" ? (t && t.quantity > 1 ? `<small>Ticket ${t.seq} of ${t.quantity}</small>` : "")
    : cls === "idle" ? `<small>Check the internet and scan again.</small>`
    : `<small class="desk">Please go to the help desk${result === "already_used" ? "" : " so we can assist"}.</small>${result === "wrong_event" && t ? `<small>This ticket is for ${esc(t.event.title)}.</small>` : ""}`;
  el.className = `scan-flash ${cls}`;
  el.innerHTML = `<div class="sf" role="status"><i class="sf-ico">${icon(ico)}</i><b>${label}</b>${who}${line}</div>`;
  el.hidden = false;
  beep(cls === "ok");
  clearTimeout(scan.flashTimer);
  const done = () => { el.hidden = true; scan.busy = false; };
  scan.flashTimer = setTimeout(done, cls === "ok" ? 1200 : cls === "idle" ? 1800 : 2600);
  el.onclick = () => { clearTimeout(scan.flashTimer); done(); };   // tap to move on to the next person
}
const scanId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
async function onCode(raw) {
  const code = String(raw || "").trim();
  if (!code || scan.busy) return;
  // Same QR still in front of the camera: ignore it until it has been out of view for 4 s.
  if (code === scan.last.code && Date.now() - scan.last.at < 4000) { scan.last.at = Date.now(); return; }
  scan.busy = true; scan.last = { code, at: Date.now() };
  // If the last attempt for this code never got an answer, reuse its id: the server may already have let them in.
  const id = scan.pending?.code === code ? scan.pending.id : scanId();
  scan.pending = { code, id };
  const body = { code, event_id: $("#scan-event").value || undefined, scan_id: id };
  let r = null;
  // A weak signal at the door: retry the same scan (same id) so it can never count twice.
  for (let attempt = 0; attempt < 3 && !r; attempt++) {
    try { r = await api("/api/admin/tickets/check-in", { method: "POST", body }); }
    catch (e) {
      if (/connection|network|fetch/i.test(e.message) && attempt < 2) { await new Promise((ok) => setTimeout(ok, 700 * (attempt + 1))); continue; }
      if (/connection|network|fetch/i.test(e.message)) { flash("offline", null); scan.last = { code: "", at: 0 }; return; }
      scan.pending = null; flash("not_found", null); setLast("bad", "Invalid ticket"); return;
    }
  }
  scan.pending = null;
  flash(r.result, r.ticket);
  const [label, cls] = SCAN_MSG[r.result] || SCAN_MSG.not_found;
  if (r.result === "ok" && !r.repeat) { scanTotals.in++; drawCount(); }
  const KIND = { member: "Verified member", not_member: "Not a member yet", visitor: "Visitor", guest: "Guest" };
  setLast(cls, `${label} · ${r.ticket?.holder || ""}${r.kind ? ` · ${KIND[r.kind] || ""}` : ""}`);
}
function setLast(cls, text) {
  const time = new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  $("#scan-last").className = `scan-last ${cls}`;
  $("#scan-last").innerHTML = `<i></i>${esc(text)} <span>${time}</span>`;
}
async function tick(ts) {
  scan.raf = requestAnimationFrame(tick);
  const v = $("#scan-video");
  if (scan.busy || !v.videoWidth || ts - scan.lastTick < 140) return;
  scan.lastTick = ts;
  try {
    if (scan.detector) { const codes = await scan.detector.detect(v); if (codes[0]) onCode(codes[0].rawValue); return; }
    const jsQR = await loadJsQR();
    const c = $("#scan-canvas"), scale = Math.min(1, 720 / v.videoWidth);
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
    if (r?.data) onCode(r.data);
  } catch { /* next frame */ }
}
async function startScanner() {
  if (scan.stream) return;
  if (!navigator.mediaDevices?.getUserMedia) { $("#scan-msg").textContent = "This browser can't use the camera. Please open the admin on a phone, tablet or laptop with a camera."; return; }
  $("#scan-msg").textContent = "Starting camera…"; $("#scan-msg").hidden = false;
  try {
    const want = scan.cams[scan.camIdx]?.deviceId;
    scan.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: want ? { deviceId: { exact: want } } : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) {
    $("#scan-msg").textContent = e && e.name === "NotAllowedError" ? "Camera permission was blocked. Allow camera access for this site in your browser settings, then tap Start scanning." : "Couldn't start the camera. Tap Start scanning to try again.";
    $("#scan-start").hidden = false; return;
  }
  const v = $("#scan-video"); v.srcObject = scan.stream; await v.play().catch(() => {});
  scan.track = scan.stream.getVideoTracks()[0];
  if (!scan.detector && "BarcodeDetector" in window) {
    try { const f = await BarcodeDetector.getSupportedFormats(); if (f.includes("qr_code")) scan.detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch { /* use jsQR */ }
  }
  if (!scan.detector) loadJsQR().catch(() => {});
  try { scan.cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"); } catch { scan.cams = []; }
  $("#scan-switch").hidden = scan.cams.length < 2;
  const caps = scan.track?.getCapabilities?.() || {};
  $("#scan-torch").hidden = !caps.torch;
  $("#scan-msg").hidden = true; $("#scan-start").hidden = true;
  cancelAnimationFrame(scan.raf); scan.raf = requestAnimationFrame(tick);
}
function stopScan() {
  cancelAnimationFrame(scan.raf); scan.stream?.getTracks().forEach((t) => t.stop()); scan.stream = null; scan.track = null; scan.torch = false;
  $("#scan-start").hidden = false; $("#scan-msg").hidden = false; $("#scan-msg").textContent = "Camera paused.";
}
$("#scan-event").addEventListener("change", scanCount);
$("#scan-start").addEventListener("click", () => startScanner());
$("#scan-switch").addEventListener("click", async () => { scan.camIdx = (scan.camIdx + 1) % Math.max(1, scan.cams.length); stopScan(); await startScanner(); });
$("#scan-torch").addEventListener("click", async () => { scan.torch = !scan.torch; try { await scan.track.applyConstraints({ advanced: [{ torch: scan.torch }] }); } catch { /* not supported */ } $("#scan-torch").classList.toggle("on", scan.torch); });
$("#scan-full").addEventListener("click", () => {
  const el = $("#scanner");
  if (document.fullscreenElement) document.exitFullscreen?.();
  else if (el.requestFullscreen) el.requestFullscreen().catch(() => el.classList.toggle("kiosk"));
  else el.classList.toggle("kiosk");
});
addEventListener("hashchange", () => { if (!location.hash.startsWith("#scan")) stopScan(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && scan.stream) stopScan(); });

// ================================================================ church programme
let progEditing = null;
const PF = () => $("#prog-form");
async function loadProgramme() {
  const { items } = await api("/api/admin/programme");
  const aud = $("#prog-aud").value;
  const AUD = { public: ["Everyone", "member"], members: ["Members only", "pending"], leaders: ["Leaders only", ""] };
  const list = items.filter((p) => !aud || p.audience === aud);
  $("#prog-list").innerHTML = list.length ? list.map((p) => `<div class="item prog-admin" data-prog="${esc(p.id)}">
      <div><b style="font-weight:450">${esc(p.title)}</b><div class="meta">${esc(p.when)}${p.venue ? ` · ${esc(p.venue)}` : ""}${p.department ? ` · ${esc(p.department)}` : ""}</div></div>
      <span class="pill ${AUD[p.audience][1]}">${AUD[p.audience][0]}</span>
      <div class="actions"><button class="btn btn-sm" data-edit>Edit</button><button class="btn btn-sm" data-del>Remove</button></div></div>`).join("") : `<div class="empty">Nothing here yet.</div>`;
  $("#prog-list")._items = items;
}
loaders.programme = loadProgramme;
$("#prog-aud").addEventListener("change", () => safe(loadProgramme)());
$("#prog-form").addEventListener("submit", safe(async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(PF()).entries());
  if (progEditing) await api(`/api/admin/programme/${progEditing}`, { method: "PUT", body }); else await api("/api/admin/programme", { method: "POST", body });
  toast(progEditing ? "Updated" : "Added to the church programme"); progEditing = null; PF().reset(); $("#prog-submit").textContent = "Add to programme"; loadProgramme();
}));
$("#prog-list").addEventListener("click", safe(async (e) => {
  const row = e.target.closest("[data-prog]"); if (!row) return;
  const item = $("#prog-list")._items.find((p) => p.id === row.dataset.prog);
  if (e.target.closest("[data-del]")) { if (!confirm(`Remove “${item.title}”?`)) return; await api(`/api/admin/programme/${item.id}`, { method: "DELETE" }); toast("Removed"); loadProgramme(); }
  if (e.target.closest("[data-edit]")) {
    progEditing = item.id;
    for (const k of ["title", "start_date", "end_date", "time_label", "department", "venue", "notes", "audience"]) if (PF()[k]) PF()[k].value = item[k] ?? "";
    $("#prog-submit").textContent = "Save changes"; PF().scrollIntoView({ behavior: "smooth" });
  }
}));

// ================================================================ team & roles (main admin)
let teamPerms = [];
async function loadTeam() {
  const { admins, people, perms: all, youth_default } = await api(`/api/admin/team?q=${encodeURIComponent($("#team-q").value)}`);
  teamPerms = all; loadTeam.def = youth_default;
  const reqs = await api("/api/admin/access-requests").catch(() => ({ requests: [], options: [] }));
  const lab = (k) => (reqs.options.find((o) => o.key === k) || {}).label || (k === "admin" ? "Admin role" : k);
  const pend = (reqs.requests || []).filter((x) => x.status === "pending");
  $("#team-requests-card").hidden = !pend.length;
  $("#team-requests").innerHTML = pend.map((x) => `<div class="item team-row" data-req="${esc(x.id)}"><div><b>${esc(x.name || x.email)}</b> <span class="pill">${x.current_role === "youth_leader" ? "Youth leader" : "Admin"}</span>
      <div class="meta">Asks for: ${esc(x.wants.map(lab).join(", "))} · ${fmtDate(x.created_at)}</div>${x.note ? `<div class="meta">“${esc(x.note)}”</div>` : ""}</div>
      <div class="team-actions"><button class="btn btn-sm btn-gold" data-req-yes>${icon("check")} Approve</button><button class="btn btn-sm" data-req-no>Decline</button></div></div>`).join("");
  $("#team-admins").innerHTML = admins.length ? admins.map((a) => `<div class="item team-row" data-user="${esc(a.user_id)}">
      <span class="avatar sm">${faceInner({ id: a.user_id, ...a })}</span>
      <div><b>${esc(a.name || a.email)}</b><div class="meta">${esc(a.email)}${a.ref_code ? ` · ${esc(a.ref_code)}` : ""} · since ${fmtDate(a.created_at)}</div>
        <input class="input team-title" data-title value="${esc(a.title || "")}" maxlength="60" placeholder="Title members see, e.g. Daughters' Ministry leader" aria-label="Ministry title">
        <div class="perm-row" aria-label="What they can open">${all.filter(([k]) => a.role !== "youth_leader" || k !== "people").map(([k, l]) => `<label class="perm"><input type="checkbox" data-perm="${k}" ${(a.perms || []).includes(k) ? "checked" : ""}>${esc(l)}</label>`).join("")}</div></div>
      <div class="team-actions"><select class="input" data-role aria-label="Role"><option value="admin" ${a.role !== "youth_leader" ? "selected" : ""}>Admin</option><option value="youth_leader" ${a.role === "youth_leader" ? "selected" : ""}>Youth leader</option></select>
        <button class="btn btn-sm" data-revoke="${esc(a.user_id)}">Remove</button></div></div>`).join("") : `<div class="empty">Only you for now.</div>`;
  $("#team-people").innerHTML = people.length ? people.map((p) => `<div class="item team-row">
      <span class="avatar sm">${faceInner({ id: p.user_id, ...p })}</span>
      <div><b>${esc(p.first_name ? `${p.first_name} ${p.last_name}` : p.name || p.email)}</b><div class="meta">${esc(p.email)} · ${p.ref_code ? `Member ${esc(p.ref_code)} (${esc(p.status)})` : "Not a registered member yet"}</div></div>
      ${p.is_admin ? `<span class="pill member">On the team</span>` : p.ref_code ? `<div class="team-actions"><button class="btn btn-sm btn-gold" data-grant="${esc(p.user_id)}" data-role="admin">Make admin</button><button class="btn btn-sm" data-grant="${esc(p.user_id)}" data-role="youth_leader">Make youth leader</button></div>` : `<span class="pill">Needs to join</span>`}</div>`).join("") : `<div class="empty">No one found.</div>`;
}
loaders.team = loadTeam;
let teamT;
$("#team-q").addEventListener("input", () => { clearTimeout(teamT); teamT = setTimeout(() => safe(loadTeam)(), 250); });
$("[data-view=team]").addEventListener("change", safe(async (e) => {
  const row = e.target.closest("[data-user]"); if (!row) return;
  const user = row.dataset.user;
  if (e.target.matches("[data-role]")) {
    const role = e.target.value;
    await api(`/api/admin/team/${user}`, { method: "PATCH", body: { role } });
    toast(role === "youth_leader" ? "Now a youth leader (Fridays, scanner, reports and youth tickets to start). Emailed." : "Now an admin (reports and weekly services to start). Emailed."); loadTeam();
  }
  if (e.target.matches("[data-title]")) {
    await api(`/api/admin/team/${user}`, { method: "PATCH", body: { title: e.target.value } });
    toast("Title saved. Members see it when they message a leader.");
    return;
  }
  if (e.target.matches("[data-perm]")) {
    const list = $$("[data-perm]", row).filter((x) => x.checked).map((x) => x.dataset.perm);
    await api(`/api/admin/team/${user}`, { method: "PATCH", body: { perms: list } });
    toast("Saved. It applies straight away.");
  }
}));
$("#access-list").addEventListener("click", safe(async (e) => {
  const rq = e.target.closest("[data-req]"); if (!rq || !(e.target.closest("[data-req-yes]") || e.target.closest("[data-req-no]"))) return;
  const yes = !!e.target.closest("[data-req-yes]");
  rq.style.opacity = ".5"; rq.querySelectorAll("button").forEach((b) => b.disabled = true);
  try { await api(`/api/admin/access-requests/${rq.dataset.req}`, { method: "PATCH", body: { decision: yes ? "approve" : "decline" } }); toast(yes ? "Approved. It works for them straight away, and they're emailed." : "Declined. They're emailed."); }
  finally { loaders.overview(); refreshBadges(); }
}));
$("[data-view=team]").addEventListener("click", safe(async (e) => {
  const rq = e.target.closest("[data-req]");
  if (rq && (e.target.closest("[data-req-yes]") || e.target.closest("[data-req-no]"))) {
    const yes = !!e.target.closest("[data-req-yes]");
    rq.style.opacity = ".5";
    try { await api(`/api/admin/access-requests/${rq.dataset.req}`, { method: "PATCH", body: { decision: yes ? "approve" : "decline" } }); toast(yes ? "Approved. It works for them straight away, and they're emailed." : "Declined. They're emailed."); }
    finally { loadTeam(); }
    return;
  }
  const g = e.target.closest("[data-grant]"), r = e.target.closest("[data-revoke]");
  if (g) {
    const who = g.closest(".team-row").querySelector("b").textContent, role = g.dataset.role;
    const msg = role === "youth_leader"
      ? `Make ${who} a youth leader?\n\nTo start they can capture Fridays, use the door scanner, see reports and approve tickets for youth events. You can change this at any time.\n\nWe'll email them what they can do.`
      : `Make ${who} an admin?\n\nTo start they can see reports and manage weekly services. Tick anything else for them afterwards. They can be given members to look after.\n\nWe'll email them what they can do.`;
    if (!confirm(msg)) return;
    g.closest(".team-actions").outerHTML = `<span class="pill member">${role === "youth_leader" ? "Youth leader" : "Admin"}</span>`;
    toast(`${who} is now ${role === "youth_leader" ? "a youth leader" : "an admin"}. Welcome email on its way.`);
    api("/api/admin/team", { method: "POST", body: { user_id: g.dataset.grant, role } })
      .then((x) => { if (x.already) toast("They're already on the team"); safe(loadTeam)(); })
      .catch((err) => { toast(`Couldn't add ${who}: ${err.message}`); safe(loadTeam)(); });
  }
  if (r && confirm("Remove this person from the team? They'll keep their normal member profile.")) {
    r.closest(".team-row")?.remove(); toast("Removed from the team");
    api(`/api/admin/team/${r.dataset.revoke}`, { method: "DELETE" }).then(() => safe(loadTeam)()).catch((err) => { toast(err.message); safe(loadTeam)(); });
  }
}));

// ================================================================ complaints
const CMP_LABEL = { received: "New", in_review: "In review", resolved: "Resolved", closed: "Closed" };
const CMP_CAT = { leadership: "Leadership", ministry: "A ministry or team", event: "An event", safeguarding: "Safeguarding / safety", finance: "Finances or payments", privacy: "Privacy / my information", facilities: "Facilities & parking", other: "Something else" };
let cmpFilter = "";
loaders.complaints = async () => {
  const { complaints } = await api(`/api/admin/complaints${cmpFilter ? `?status=${cmpFilter}` : ""}`);
  $$("#cmp-filter button").forEach((b) => b.classList.toggle("on", b.dataset.st === cmpFilter));
  $("#cmp-list").innerHTML = complaints.length ? complaints.map((c) => `<article class="item" data-cmp="${esc(c.id)}">
    <header><div><b style="font-weight:450">${esc(c.subject)}</b> <span class="meta">· ${esc(CMP_CAT[c.category] || c.category)}${c.confidential ? " · <b style='color:var(--danger)'>Confidential: pastors only</b>" : ""}</span>
      <div class="meta">${esc(c.ref_code)} · ${fmtDate(c.created_at)} · ${esc(c.first_name)} ${esc(c.last_name)} (${esc(c.member_ref)}) · ${esc(c.email || "")}${c.phone ? " · " + esc(c.phone) : ""}</div></div>
      <span class="pill ${c.status === "received" ? "new" : c.status === "in_review" ? "pending" : "member"}">${esc(CMP_LABEL[c.status] || c.status)}</span></header>
    <p style="white-space:pre-wrap">${esc(c.details)}</p>
    ${c.desired_outcome ? `<p class="meta"><b>Hoped-for outcome:</b> ${esc(c.desired_outcome)}</p>` : ""}
    <div class="form-grid" style="margin-top:10px">
      <div class="field"><label>Reply to the member (emailed)</label><textarea class="input" data-resp rows="3" placeholder="Thank you for raising this…">${esc(c.response || "")}</textarea></div>
      <div class="actions"><select class="input" data-st style="max-width:200px">${Object.entries(CMP_LABEL).map(([k, l]) => `<option value="${k}" ${k === c.status ? "selected" : ""}>${l}</option>`).join("")}</select>
        <button class="btn btn-sm btn-gold" data-save>Save &amp; email member</button><a class="btn btn-sm" href="mailto:${esc(c.email || "")}?subject=${encodeURIComponent(`Your complaint ${c.ref_code}`)}">Email directly</a></div>
      ${c.responded_at ? `<p class="meta">Last reply ${fmtDate(c.responded_at)}</p>` : ""}
    </div></article>`).join("") : `<div class="empty">No complaints here. 🙏</div>`;
};
$("#cmp-filter").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; cmpFilter = b.dataset.st; safe(loaders.complaints)(); });
$("#cmp-list").addEventListener("click", safe(async (e) => {
  const b = e.target.closest("[data-save]"); if (!b) return;
  const card = b.closest("[data-cmp]");
  await api(`/api/admin/complaints/${card.dataset.cmp}`, { method: "PATCH", body: { status: $("[data-st]", card).value, response: $("[data-resp]", card).value.trim() || null } });
  toast("Saved and emailed to the member"); loaders.complaints();
}));

// ================================================================ settings & email log
const SETTINGS = [
  ["church_name", "Church name"], ["tagline", "Tagline (home page)"], ["address", "Address"], ["map_url", "Google Maps link"],
  ["service_summary", "Service times (shown on site)"], ["contact_email", "Contact email"], ["whatsapp_number", "WhatsApp number (e.g. +27821234567)"],
  ["instagram_url", "Instagram URL"], ["youtube_url", "YouTube URL"], ["facebook_url", "Facebook URL"], ["tiktok_url", "TikTok URL"],
];
loaders.settings = async () => {
  const { settings } = await api("/api/admin/settings");
  $("#settings-form").innerHTML = SETTINGS.map(([k, l]) => `<div class="field"><label>${esc(l)}</label><input class="input" name="${k}" value="${esc(settings[k] || "")}" maxlength="500"></div>`).join("") +
    `<div class="field"><label>Default banking details (paid events)</label><textarea class="input" name="banking_details" maxlength="2000" placeholder="Account name&#10;Bank&#10;Account number&#10;Branch code&#10;Reference to use">${esc(settings.banking_details || "")}</textarea><span class="hint">Shown on paid event pages when the event doesn't have its own banking details.</span></div>` +
    `<button class="btn btn-gold" type="submit" style="justify-self:start">Save settings</button>`;
};
$("#settings-form").addEventListener("submit", safe(async (e) => { e.preventDefault(); await api("/api/admin/settings", { method: "PUT", body: Object.fromEntries(new FormData(e.target)) }); toast("Settings saved"); }));
loaders.emails = async () => {
  const { log, health } = await api("/api/admin/email-log");
  $("#email-health").innerHTML = `<div class="stat"><b>${health.sent}</b><span>Delivered (30 days)</span></div><div class="stat"><b>${health.failed}</b><span>Not delivered</span></div><div class="stat"><b>${health.resendable}</b><span>Ready to resend</span></div>`;
  $("#email-setup").innerHTML = health.needs_setup ? `<div class="setup"><span>${EMAIL_SETUP}</span></div>` : "";
  $("#email-resend").hidden = !health.resendable;
  const reason = (e) => !e ? "" : /RECIPIENT_NOT_ALLOWED/.test(e) ? "Domain not switched on for sending yet" : /SUPPRESSED/.test(e) ? "Address is on the suppression list (bounced or complained)" : /SENDER/.test(e) ? "Sender domain not verified" : e;
  $("#email-table tbody").innerHTML = log.length ? log.map((l) => `<tr><td class="sub">${fmtDate(l.created_at.replace(" ", "T") + (l.created_at.endsWith("Z") ? "" : "Z"))}</td><td>${esc(l.to_email)}</td><td class="sub">${esc(l.template)}</td><td>${esc(l.subject)}${l.error ? `<div class="sub" style="color:var(--danger)">${esc(reason(l.error))}</div>` : ""}</td>
    <td><span class="pill ${l.status === "sent" ? "member" : l.status === "failed" ? "new" : ""}" title="${esc(l.error || "")}">${esc(l.status)}</span></td></tr>`).join("") : `<tr><td colspan="5" class="sub" style="text-align:center;padding:30px">No emails sent yet.</td></tr>`;
};
$("#email-resend").addEventListener("click", safe(async () => {
  const r = await api("/api/admin/email-log/resend", { method: "POST" });
  toast(r.tried ? `Resent ${r.sent} of ${r.tried}${r.failed ? ` · ${r.failed} still failing` : ""}` : "Nothing to resend");
  loaders.emails();
}));

// ---------- email templates gallery ----------
loaders.templates = async () => {
  const { templates } = await api("/api/admin/email-templates");
  const groups = [...new Set(templates.map((t) => t.group))];
  $("#tpl-list").innerHTML = groups.map((g) => `<p class="eyebrow">${esc(g)}</p>` + templates.filter((t) => t.group === g).map((t) =>
    `<button type="button" class="tpl-item" data-key="${esc(t.key)}"><b>${esc(t.subject)}</b><span>${esc(t.when)}</span></button>`).join("")).join("");
  const first = $("#tpl-list .tpl-item"); if (first) showTemplate(first.dataset.key);
};
function showTemplate(key) {
  $$("#tpl-list .tpl-item").forEach((b) => b.toggleAttribute("aria-current", b.dataset.key === key));
  $("#tpl-frame").src = `/api/admin/email-templates/${encodeURIComponent(key)}/preview`;
  $("#tpl-test").dataset.key = key;
}
$("#tpl-list").addEventListener("click", (e) => { const b = e.target.closest(".tpl-item"); if (b) showTemplate(b.dataset.key); });
$("#tpl-test").addEventListener("click", safe(async (e) => {
  const r = await api(`/api/admin/email-templates/${encodeURIComponent(e.currentTarget.dataset.key)}/test`, { method: "POST" });
  toast(`Test sent to ${r.sent_to}`);
}));

addEventListener("hashchange", () => { if (me) openTab(location.hash.slice(1) || (perms ? firstAllowed() : "overview")); });
// Phone/tablet: menu drawer + quick bar
// ---- Menus: one tap anywhere outside closes them and stays on the current screen ----
const setSide = (open) => { document.body.classList.toggle("side-open", open); $("#m-menu").setAttribute("aria-expanded", String(open)); };
$("#m-menu").addEventListener("click", () => setSide(!document.body.classList.contains("side-open")));
$("#nav").addEventListener("click", (e) => { if (e.target.closest("button")) setSide(false); });
function closeMenusFrom(target) {
  let closed = false;
  if (document.body.classList.contains("side-open") && !target.closest("#side, #m-menu")) { setSide(false); closed = true; }
  $$("details[open]").forEach((d) => { if (!d.contains(target) && d.dataset.keepOpen === undefined && !d.classList.contains("card")) { d.open = false; closed = true; } });
  return closed;
}
// Capture phase: the tap that closes a menu is swallowed, so it never presses whatever sits underneath.
let swallowUntil = 0;
document.addEventListener("pointerdown", (e) => { if (closeMenusFrom(e.target)) { swallowUntil = Date.now() + 700; e.preventDefault(); } }, true);
document.addEventListener("click", (e) => {
  if (Date.now() < swallowUntil) { swallowUntil = 0; e.preventDefault(); e.stopPropagation(); return; }
  closeMenusFrom(e.target);   // keyboard / assistive "clicks" without a pointer
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("side-open")) { setSide(false); $("#m-menu").focus(); } });
addEventListener("hashchange", () => setSide(false));
addEventListener("resize", () => { if (innerWidth > 860) setSide(false); });
$$("[data-ico]:not([data-go-tab])").forEach((b) => { b.innerHTML = icon(b.dataset.ico); });
$$("[data-go-tab]").forEach((b) => { if (b.dataset.ico) b.insertAdjacentHTML("afterbegin", icon(b.dataset.ico)); b.addEventListener("click", () => { location.hash = b.dataset.goTab; }); });
// Insights, weekly services and the board report live in their own module.
watchReports(document.querySelector(".main"));
const insights = initInsights({ api, $, $$, esc, toast, safe, loaders, detailRoutes, showView, fmtDate, canManageServices: () => !perms || perms.includes("services") });
const more = initMore({ api, $, $$, esc, toast, safe, loaders, detailRoutes, showView, fmtDate, icon });
initExtra({ api, $, $$, esc, toast, safe, loaders, detailRoutes, showView, fmtDate, icon });
initClasses({ api, $, esc, toast, safe, loaders, icon, fmtDate });
boot();
