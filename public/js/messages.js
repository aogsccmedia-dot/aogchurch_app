// Messages: talk to a church leader. List of conversations, one conversation at a time, new message picker.
import { api, esc, toast } from "./site.js";
import { getMe, whenSignedIn } from "./auth.js";
import { icon } from "./icons.js";
import { faceInner } from "./faces.js";

const $ = (id) => document.getElementById(id);
const TZ = "Africa/Johannesburg";
const when = (iso) => { const d = new Date(iso), now = new Date(); const same = d.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat("en-ZA", same ? { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ } : { day: "numeric", month: "short", timeZone: TZ }).format(d); };
let current = null, last = null, poll = null;

async function list() {
  const d = await api("/api/chat");
  $("msg-threads").innerHTML = d.threads.length ? d.threads.map((t) => `<button type="button" class="msg-row${t.unread ? " unread" : ""}" data-c="${esc(t.id)}">
      <span class="avatar">${faceInner({ id: t.with.id, name: t.with.name, picture: t.with.picture })}</span>
      <span class="msg-who"><b>${esc(t.with.name)}</b><small>${esc(t.with.role)}</small><span class="msg-prev">${t.from_me ? "You: " : ""}${esc(t.preview || "Say hello 👋")}</span></span>
      <span class="msg-meta"><small>${when(t.last_at)}</small>${t.unread ? `<i>${t.unread}</i>` : ""}</span></button>`).join("")
    : `<div class="msg-empty">${icon("messageCircle")}<b>No messages yet</b><p class="muted-text">Tap “New message” to write to a pastor or leader.</p></div>`;
}

async function open(id, push = true) {
  current = id; last = null;
  $("msg-list-view").hidden = true; $("msg-thread-view").hidden = false;
  document.body.classList.add("in-thread");
  if (push) history.pushState({ c: id }, "", `/messages?c=${encodeURIComponent(id)}`);
  $("msg-scroll").innerHTML = `<p class="muted-text">Loading…</p>`;
  await load(true);
  $("msg-in").focus({ preventScroll: true });
  clearInterval(poll); poll = setInterval(() => { if (!document.hidden && current) load(false).catch(() => {}); }, 5000);
}
function bubble(m) {
  return `<div class="msg-b ${m.mine ? "mine" : ""}" data-id="${esc(m.id)}"><p>${esc(m.body).replace(/\n/g, "<br>")}</p><small>${when(m.created_at)}</small></div>`;
}
async function load(full) {
  const d = await api(`/api/chat/${encodeURIComponent(current)}${!full && last ? `?since=${encodeURIComponent(last)}` : ""}`);
  if (full) {
    $("msg-face").innerHTML = faceInner({ id: d.with.id, name: d.with.name, picture: d.with.picture });
    $("msg-name").textContent = d.with.name; $("msg-role").textContent = d.with.role;
    $("msg-scroll").innerHTML = d.messages.length ? d.messages.map(bubble).join("") : `<p class="msg-hint">Say hello to ${esc(d.with.name.split(" ")[0])}. They'll get an email and can reply here.</p>`;
  } else {
    const box = $("msg-scroll"), have = new Set([...box.querySelectorAll("[data-id]")].map((x) => x.dataset.id));
    const fresh = d.messages.filter((m) => !have.has(m.id));
    if (fresh.length) { box.querySelector(".msg-hint")?.remove(); box.insertAdjacentHTML("beforeend", fresh.map(bubble).join("")); }
  }
  if (d.messages.length) last = d.messages.at(-1).created_at;
  const sc = $("msg-scroll"); sc.scrollTop = sc.scrollHeight;
}
function back() {
  current = null; clearInterval(poll);
  $("msg-thread-view").hidden = true; $("msg-list-view").hidden = false; document.body.classList.remove("in-thread");
  list().catch(() => {});
}

// New message: pick a leader
async function pick() {
  document.querySelector(".msg-pick")?.remove();
  const el = document.createElement("div");
  el.className = "app-sheet msg-pick open"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "New message");
  el.innerHTML = `<div class="sheet-card"><header class="sheet-me"><div><b>New message</b><span>Choose a leader</span></div><button type="button" class="sheet-x" data-x aria-label="Close">${icon("x")}</button></header>
    <label class="ts-search">${icon("search")}<input type="search" placeholder="Search by name or ministry…" aria-label="Search leaders"></label><div class="pick-list"><p class="muted-text">Loading…</p></div></div>`;
  document.body.append(el);
  const close = () => el.remove();
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-x]")) close(); });
  const draw = async (q = "") => {
    const { leaders } = await api(`/api/chat/leaders?q=${encodeURIComponent(q)}`);
    el.querySelector(".pick-list").innerHTML = leaders.length ? leaders.map((l) => `<button type="button" class="pick-leader" data-to="${esc(l.id)}"><span class="avatar">${faceInner(l)}</span><span><b>${esc(l.name)}</b><small>${esc(l.role)}</small></span>${icon("arrowRight")}</button>`).join("")
      : `<p class="muted-text">No leader by that name.</p>`;
  };
  let t; el.querySelector("input").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => draw(e.target.value), 200); });
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-to]"); if (!b) return;
    try { const r = await api("/api/chat/start", { method: "POST", body: { to: b.dataset.to } }); close(); open(r.id); } catch (err) { toast(err.message); }
  });
  draw();
}
export const startWith = async (to) => { const r = await api("/api/chat/start", { method: "POST", body: { to } }); open(r.id); };

$("msg-new").addEventListener("click", pick);
$("msg-back").addEventListener("click", () => history.length > 1 && history.state?.c ? history.back() : (history.replaceState(null, "", "/messages"), back()));
$("msg-threads").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (b) open(b.dataset.c); });
addEventListener("popstate", () => { const c = new URLSearchParams(location.search).get("c"); if (c) open(c, false); else back(); });
const inp = $("msg-in");
inp.addEventListener("input", () => { inp.style.height = "auto"; inp.style.height = Math.min(140, inp.scrollHeight) + "px"; });
inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer: fine)").matches) { e.preventDefault(); $("msg-form").requestSubmit(); } });
$("msg-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = inp.value.trim(); if (!body || !current) return;
  inp.value = ""; inp.style.height = "auto";
  try {
    const r = await api(`/api/chat/${encodeURIComponent(current)}`, { method: "POST", body: { body } });
    const box = $("msg-scroll"); box.querySelector(".msg-hint")?.remove();
    box.insertAdjacentHTML("beforeend", bubble(r.message)); last = r.message.created_at; box.scrollTop = box.scrollHeight;
  } catch (err) { inp.value = body; toast(err.message); }
});

async function start() {
  const me = await getMe();
  if (!me.user) { location.href = "/me"; return; }
  const c = new URLSearchParams(location.search).get("c"), to = new URLSearchParams(location.search).get("to");
  await list();
  if (to) startWith(to).catch((e) => toast(e.message));
  else if (c) open(c, false);
}
whenSignedIn(() => start());
start().catch((e) => { $("msg-threads").innerHTML = `<p class="muted-text">${esc(e.message)}</p>`; });
