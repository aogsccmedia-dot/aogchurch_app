// Church programme list, grouped by month, with a department filter. Public on Services & events;
// the members-only Sub-Region calendar shows on My profile for signed-in members.
import { api, esc } from "./site.js";
import { openSignIn, whenSignedIn } from "./auth.js";

const MONTH = (iso) => new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso + "T12:00:00Z"));
const DAYNUM = (iso) => new Date(iso + "T12:00:00Z").getUTCDate();
const DOW = (iso) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", timeZone: "UTC" }).format(new Date(iso + "T12:00:00Z"));
const TONE = { Mothers: "lilac", "Mothers Ministry": "lilac", Daughters: "lilac", "Daughters Ministry": "lilac", Youth: "green", "Youth Ministry": "green",
  Men: "sage", "Men's Ministry": "sage", "Children's Ministry": "gold", Church: "gold", Regional: "sage", National: "sage", "Sub-Region": "sage" };

function render(el, items) {
  const scope = el.dataset.programme;
  let list = items.filter((p) => (scope === "members" ? p.audience === "members" : p.audience === "public"));
  const depts = [...new Set(list.map((p) => p.department).filter(Boolean))].sort();
  const state = { dept: "", showAll: false };
  const draw = () => {
    const filtered = list.filter((p) => !state.dept || p.department === state.dept);
    const shown = state.showAll ? filtered : filtered.slice(0, 18);
    const months = new Map();
    for (const p of shown) { const m = MONTH(p.start_date); if (!months.has(m)) months.set(m, []); months.get(m).push(p); }
    el.innerHTML = (depts.length > 1 ? `<div class="prog-filter" role="group" aria-label="Filter by ministry"><button type="button" data-d="" ${!state.dept ? 'aria-pressed="true"' : ""}>All</button>${depts.map((d) => `<button type="button" data-d="${esc(d)}" ${state.dept === d ? 'aria-pressed="true"' : ""}>${esc(d)}</button>`).join("")}</div>` : "") +
      (shown.length ? [...months].map(([m, ps]) => `<section class="prog-month"><h3>${esc(m)}</h3><ul>${ps.map((p) => `<li class="prog-item ${TONE[p.department] || "gold"}">
          <span class="prog-date"><b>${DAYNUM(p.start_date)}</b><small>${esc(DOW(p.start_date))}</small></span>
          <span class="prog-body"><b>${esc(p.title)}</b><small>${esc(p.when)}${p.venue ? ` · ${esc(p.venue)}` : ""}</small></span>
          ${p.department ? `<span class="prog-tag">${esc(p.department)}</span>` : ""}</li>`).join("")}</ul></section>`).join("")
        : `<p class="muted-text">Nothing coming up here right now.</p>`) +
      (filtered.length > shown.length ? `<button class="btn btn-sm" type="button" data-more>Show all ${filtered.length}</button>` : "");
  };
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-d]");
    if (b) { state.dept = b.dataset.d; state.showAll = false; draw(); }
    if (e.target.closest("[data-more]")) { state.showAll = true; draw(); }
  });
  draw();
  return list.length;
}

let isMember = false;
// Services & events: switch between the SCC calendar and the members-only Germiston calendar.
function initTabs() {
  const tabs = document.querySelectorAll("[data-cal]");
  if (!tabs.length) return;
  const show = (which) => {
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.cal === which)));
    document.querySelector('[data-panel="public"]').hidden = which !== "public";
    document.querySelector('[data-panel="members"]').hidden = which !== "members" || !isMember;
    document.querySelector("[data-panel-locked]").hidden = which !== "members" || isMember;
  };
  tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.cal)));
  document.querySelector("[data-cal-signin]")?.addEventListener("click", openSignIn);
  initTabs.show = show;
}
initTabs();

// Weekly services: managed in Admin → Weekly services. Days without a service show as rest days;
// services on the same day and time share a row; the coming week's topic (and poster) appears underneath.
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAYNAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FREQ = { twice_monthly: "Twice a month", monthly: "Monthly" };
function renderWeek(weekly) {
  const lists = document.querySelectorAll(".week-list");
  if (!lists.length || !Array.isArray(weekly) || !weekly.length) return;   // keep the built-in list if anything is off
  const rows = ORDER.map((day) => {
    const svcs = weekly.filter((w) => w.day_num === day);
    if (!svcs.length) return `<li class="wk-row rest"><span class="wk-d">${DAYNAME[day]}</span><span class="wk-s">Rest</span><span class="wk-t">—</span></li>`;
    const byTime = new Map();
    for (const w of svcs) { if (!byTime.has(w.time)) byTime.set(w.time, []); byTime.get(w.time).push(w); }
    return [...byTime].map(([time, ws]) => {
      const freq = [...new Set(ws.map((w) => FREQ[w.frequency]).filter(Boolean))];
      const extra = day === 0 ? "Everyone welcome" : freq.join(" · ");
      const next = ws.filter((w) => w.next);
      const when = (iso) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso + "T12:00:00Z"));
      return `<li class="wk-row${day === 0 ? " main" : ""}"><span class="wk-d">${DAYNAME[day]}</span>
        <span class="wk-s">${ws.map((w) => esc(w.title)).join(" · ")}${extra ? ` <small>${esc(extra)}</small>` : ""}
          ${next.map((w) => `<span class="wk-next">${w.next.poster_url ? `<a href="${esc(w.next.poster_url)}" target="_blank" rel="noopener" class="wk-poster"><img src="${esc(w.next.poster_url)}" alt="Poster: ${esc(w.next.topic)}" loading="lazy"></a>` : ""}
            <span><em>${esc(when(w.next.date))}${ws.length > 1 ? ` · ${esc(w.title)}` : ""}</em>${esc(w.next.topic)}${w.next.speaker ? ` <small>with ${esc(w.next.speaker)}</small>` : ""}</span></span>`).join("")}</span>
        <span class="wk-t">${esc(time || "—")}</span></li>`;
    }).join("");
  }).join("");
  lists.forEach((ol) => { ol.innerHTML = rows; });
}

async function load() {
  const els = document.querySelectorAll("[data-programme]");
  if (!els.length && !document.querySelector(".week-list")) return;
  const d = await api("/api/programme?limit=300").catch(() => null);
  if (d) renderWeek(d.weekly);
  if (!d) { els.forEach((el) => { el.innerHTML = `<p class="muted-text">We couldn't load the calendar right now.</p>`; }); return; }
  isMember = d.member;
  const sel = document.querySelector('[data-cal][aria-selected="true"]');
  if (sel && initTabs.show) initTabs.show(sel.dataset.cal);
  els.forEach((el) => {
    const n = render(el, d.items);
    if (el.dataset.programme === "members") { const box = document.getElementById("members-calendar"); if (box) box.hidden = !(d.member && n); }
  });
}
load();
whenSignedIn(load);
