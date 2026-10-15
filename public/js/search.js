// Search anything in the app: leaders to message, pages, upcoming events, or ask Ask SCC.
import { icon } from "./icons.js";
import { faceInner } from "./faces.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PAGES = [
  ["/me", "home", "Home", "tickets events services"], ["/assistant", "sparkles", "Ask SCC", "ai chat questions help"], ["/devotions", "bookOpen", "Devotions", "verse bible daily word"],
  ["/messages", "messageCircle", "Messages", "chat leader pastor talk"], ["/go", "globe", "Go Ye: log someone you met", "evangelism outreach"], ["/go-ye", "globe", "Go Ye: the good news", "gospel salvation evangelism"],
  ["/pamphlet", "fileText", "Good News pamphlet", "print share gospel"], ["/discipleship", "bookOpen", "Discipleship classes", "baptism foundations class"],
  ["/welcome-pack", "bookOpen", "Welcome pack", "history azusa bhengu"], ["/vote", "vote", "Vote", "elections voting"], ["/store", "landmark", "Store", "books"],
  ["/settings", "settings", "Settings", "notifications email access"], ["/help", "messageCircle", "How to use the app", "help guide"], ["/events", "calendar", "Services & events", "tickets"],
  ["/prayer", "handHeart", "Prayer", "prayer wall request"], ["/visit", "mapPin", "Visit & contact", "address directions"],
];
let events = null;

export function openSearch() {
  document.querySelector(".search-sheet")?.remove();
  const el = document.createElement("div");
  el.className = "app-sheet search-sheet open"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Search");
  el.innerHTML = `<div class="sheet-card"><label class="ts-search big">${icon("search")}<input type="search" placeholder="Search people, pages, events…" aria-label="Search" autocomplete="off" enterkeyhint="search">
      <button type="button" class="sheet-x" data-x aria-label="Close">${icon("x")}</button></label><div class="srch-body"></div></div>`;
  document.body.append(el);
  const input = el.querySelector("input"), body = el.querySelector(".srch-body");
  const close = () => el.remove();
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-x]")) close(); });
  addEventListener("keydown", function k(e) { if (e.key === "Escape") { close(); removeEventListener("keydown", k); } });
  let t, seq = 0;
  const draw = async () => {
    const q = input.value.trim(), lq = q.toLowerCase(), my = ++seq;
    const pages = PAGES.filter(([, , l, k]) => !lq || `${l} ${k}`.toLowerCase().includes(lq)).slice(0, lq ? 6 : 8);
    const [lead, evs] = await Promise.all([
      fetch(`/api/chat/leaders?q=${encodeURIComponent(q)}`).then((r) => r.ok ? r.json() : { leaders: [] }).catch(() => ({ leaders: [] })),
      events ? Promise.resolve(events) : fetch("/api/events").then((r) => r.json()).then((d) => (events = d.events || [])).catch(() => []),
    ]);
    if (my !== seq) return;
    const people = (lead.leaders || []).slice(0, lq ? 8 : 4);
    const ev = (evs || []).filter((e) => lq && `${e.title} ${e.location || ""}`.toLowerCase().includes(lq)).slice(0, 5);
    body.innerHTML = `${people.length ? `<p class="ts-label">${lq ? "Leaders" : "Message a leader"}</p>${people.map((l) => `<a class="srch-row" href="/messages?to=${encodeURIComponent(l.id)}"><span class="avatar">${faceInner(l)}</span><span><b>${esc(l.name)}</b><small>${esc(l.role)}</small></span><em>Message</em></a>`).join("")}` : ""}
      ${ev.length ? `<p class="ts-label">Events</p>${ev.map((e) => `<a class="srch-row" href="/event?e=${encodeURIComponent(e.slug)}"><span class="srch-ico">${icon("ticket")}</span><span><b>${esc(e.title)}</b><small>${esc(new Date(e.starts_at).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" }))}</small></span></a>`).join("")}` : ""}
      ${pages.length ? `<p class="ts-label">${lq ? "Pages" : "Go to"}</p>${pages.map(([h, i, l]) => `<a class="srch-row" href="${h}"><span class="srch-ico">${icon(i)}</span><span><b>${esc(l)}</b></span></a>`).join("")}` : ""}
      ${q ? `<a class="srch-row ask" href="/assistant?q=${encodeURIComponent(q)}"><span class="srch-ico">${icon("sparkles")}</span><span><b>Ask SCC: “${esc(q)}”</b><small>Get an answer from the church assistant</small></span></a>` : ""}`;
  };
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(draw, 160); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const a = body.querySelector(".srch-row"); if (a) location.href = a.href; } });
  draw(); setTimeout(() => input.focus(), 50);
}
