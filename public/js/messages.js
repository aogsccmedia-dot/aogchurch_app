// Messages: talk to a church leader. Snappy: your message shows the moment you send it, new messages and
// "…is typing" arrive live (one waiting request that answers as soon as something changes), and "Seen" shows when they've read it.
import { api, esc, toast } from "./site.js";
import { getMe, whenSignedIn } from "./auth.js";
import { icon } from "./icons.js";
import { faceInner } from "./faces.js";
import { badgeHtml } from "./portal.js";

// Verified stickers: black main admin, blue admins, gold leaders and verified members.
const BADGE_ME = { super: { admin_account: true }, pastor: { pastor: true }, admin: { admin_role: "staff" }, member: { member_verified: true } };
const badge = (k, size = 16) => (k && BADGE_ME[k] ? badgeHtml({ user: {}, ...BADGE_ME[k] }, size) : "");

const $ = (id) => document.getElementById(id);
const TZ = "Africa/Johannesburg";
const when = (iso) => { const d = new Date(iso), now = new Date(); const same = d.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat("en-ZA", same ? { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ } : { day: "numeric", month: "short", timeZone: TZ }).format(d); };
let current = null, last = null, poll = null, live = 0, typingShown = false, seenAt = "", sendTyping = 0;

async function list() {
  const d = await api("/api/chat");
  $("msg-threads").innerHTML = d.threads.length ? d.threads.map((t) => `<button type="button" class="msg-row${t.unread ? " unread" : ""}" data-c="${esc(t.id)}">
      <span class="avatar">${faceInner({ id: t.with.id, name: t.with.name, picture: t.with.picture })}</span>
      <span class="msg-who"><b>${esc(t.with.name)}${badge(t.with.badge, 15)}</b><small>${esc(t.with.role)}</small><span class="msg-prev">${t.from_me ? "You: " : ""}${esc(t.preview || "Say hello 👋")}</span></span>
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
  clearInterval(poll); listen();
}
/** One waiting request at a time: it answers the moment there's a new message, typing changes or they've seen yours. */
async function listen() {
  const me = ++live;
  while (me === live && current) {
    if (document.hidden) { await new Promise((r) => document.addEventListener("visibilitychange", r, { once: true })); continue; }
    try {
      const id = current;
      const d = await api(`/api/chat/${encodeURIComponent(id)}/live?since=${encodeURIComponent(last || "")}&typing=${typingShown ? 1 : 0}&seen=${encodeURIComponent(seenAt)}`);
      if (me !== live || id !== current) return;
      addMessages(d.messages);
      setTyping(d.typing);
      if ((d.seen_at || "") !== seenAt) { seenAt = d.seen_at || ""; drawSeen(); }
    } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
}
function addMessages(list) {
  const box = $("msg-scroll"), have = new Set([...box.querySelectorAll("[data-id]")].map((x) => x.dataset.id));
  let fresh = (list || []).filter((m) => !have.has(m.id));
  // My own message came back on the live feed before the send finished: just mark that bubble as sent.
  fresh = fresh.filter((m) => {
    if (!m.mine) return true;
    const pending = [...box.querySelectorAll(".msg-b.mine.sending")].find((x) => x.querySelector("p").textContent === m.body.replace(/\n/g, ""));
    if (!pending) return true;
    pending.dataset.id = m.id; pending.dataset.at = m.created_at; pending.classList.remove("sending"); pending.querySelector("small").textContent = when(m.created_at);
    return false;
  });
  if (fresh.length) {
    box.querySelector(".msg-hint")?.remove();
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
    box.insertAdjacentHTML("beforeend", fresh.map(bubble).join(""));
    if (fresh.some((m) => !m.mine)) setTyping(false);
    keepTypingLast(); drawSeen();
    if (near || fresh.some((m) => m.mine)) box.scrollTop = box.scrollHeight;
  }
  if (list?.length) last = list.at(-1).created_at > (last || "") ? list.at(-1).created_at : last;
}
function setTyping(on) {
  typingShown = !!on;
  const box = $("msg-scroll"); let el = box.querySelector(".msg-typing");
  if (on && !el) { box.insertAdjacentHTML("beforeend", `<div class="msg-b msg-typing" aria-label="Typing"><span class="dots"><i></i><i></i><i></i></span></div>`); if (box.scrollHeight - box.scrollTop - box.clientHeight < 200) box.scrollTop = box.scrollHeight; }
  if (!on && el) el.remove();
  $("msg-role").textContent = on ? "typing…" : $("msg-role").dataset.role || "";
  $("msg-role").classList.toggle("is-typing", !!on);
}
function keepTypingLast() { const box = $("msg-scroll"), el = box.querySelector(".msg-typing"); if (el) box.append(el); }
/** "Seen" under your last message once they've opened the conversation after it. */
function drawSeen() {
  const box = $("msg-scroll");
  box.querySelectorAll(".msg-seen").forEach((x) => x.remove());
  const mine = [...box.querySelectorAll(".msg-b.mine:not(.sending):not(.failed)")].at(-1);
  if (mine && seenAt && mine.dataset.at && seenAt >= mine.dataset.at) mine.insertAdjacentHTML("afterend", `<p class="msg-seen">Seen ${when(seenAt)}</p>`);
}
function bubble(m) {
  return `<div class="msg-b ${m.mine ? "mine" : ""}" data-id="${esc(m.id)}" data-at="${esc(m.created_at)}"><p>${esc(m.body).replace(/\n/g, "<br>")}</p><small>${when(m.created_at)}</small></div>`;
}
async function load(full) {
  const d = await api(`/api/chat/${encodeURIComponent(current)}${!full && last ? `?since=${encodeURIComponent(last)}` : ""}`);
  if (full) {
    $("msg-face").innerHTML = faceInner({ id: d.with.id, name: d.with.name, picture: d.with.picture });
    $("msg-name").innerHTML = `${esc(d.with.name)}${badge(d.with.badge, 18)}`; $("msg-role").textContent = d.with.role; $("msg-role").dataset.role = d.with.role;
    seenAt = d.seen_at || ""; typingShown = false;
    $("msg-scroll").innerHTML = d.messages.length ? d.messages.map(bubble).join("") : `<p class="msg-hint">Say hello to ${esc(d.with.name.split(" ")[0])}. They'll get an email and can reply here.</p>`;
  } else {
    const box = $("msg-scroll"), have = new Set([...box.querySelectorAll("[data-id]")].map((x) => x.dataset.id));
    const fresh = d.messages.filter((m) => !have.has(m.id));
    if (fresh.length) { box.querySelector(".msg-hint")?.remove(); box.insertAdjacentHTML("beforeend", fresh.map(bubble).join("")); }
  }
  if (d.messages.length) last = d.messages.at(-1).created_at;
  drawSeen();
  const sc = $("msg-scroll"); sc.scrollTop = sc.scrollHeight;
}
function back() {
  if (current) typingPing(false);
  current = null; clearInterval(poll); live++;
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
    el.querySelector(".pick-list").innerHTML = leaders.length ? leaders.map((l) => `<button type="button" class="pick-leader" data-to="${esc(l.id)}"><span class="avatar">${faceInner(l)}</span><span><b>${esc(l.name)}${badge(l.badge, 15)}</b><small>${esc(l.role)}</small></span>${icon("arrowRight")}</button>`).join("")
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
function typingPing(on) {
  if (!current) return;
  if (on && Date.now() - sendTyping < 3000) return;
  sendTyping = on ? Date.now() : 0;
  api(`/api/chat/${encodeURIComponent(current)}/typing`, { method: "POST", body: { on } }).catch(() => {});
}
let idle = 0;
inp.addEventListener("input", () => {
  inp.style.height = "auto"; inp.style.height = Math.min(140, inp.scrollHeight) + "px";
  if (inp.value.trim()) { typingPing(true); clearTimeout(idle); idle = setTimeout(() => typingPing(false), 5000); }
  else { clearTimeout(idle); typingPing(false); }
});
inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer: fine)").matches) { e.preventDefault(); $("msg-form").requestSubmit(); } });
// Sending: the bubble appears instantly (with a small clock), then turns into a sent message. If it fails, tap to retry.
async function deliver(el, body) {
  const thread = current;
  el.classList.add("sending"); el.classList.remove("failed"); el.querySelector("small").textContent = "Sending…";
  try {
    const r = await api(`/api/chat/${encodeURIComponent(thread)}`, { method: "POST", body: { body } });
    if ($("msg-scroll").querySelector(`[data-id="${CSS.escape(r.message.id)}"]`)) { el.remove(); return; }   // the live feed got it first
    el.dataset.id = r.message.id; el.dataset.at = r.message.created_at; el.classList.remove("sending");
    el.querySelector("small").textContent = when(r.message.created_at);
    if (r.message.created_at > (last || "")) last = r.message.created_at;
    drawSeen();
  } catch (err) {
    el.classList.remove("sending"); el.classList.add("failed"); el.querySelector("small").textContent = "Not sent · tap to try again";
    el.onclick = () => { el.onclick = null; deliver(el, body); };
    if (!/connection|network|fetch/i.test(err.message)) toast(err.message);
  }
}
$("msg-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const body = inp.value.trim(); if (!body || !current) return;
  inp.value = ""; inp.style.height = "auto"; inp.focus({ preventScroll: true });
  clearTimeout(idle); sendTyping = 0;
  const box = $("msg-scroll"); box.querySelector(".msg-hint")?.remove();
  box.insertAdjacentHTML("beforeend", bubble({ id: `tmp-${Date.now()}`, body, created_at: new Date().toISOString(), mine: true }));
  const el = box.querySelector(".msg-b.mine:last-of-type") || [...box.querySelectorAll(".msg-b.mine")].at(-1);
  keepTypingLast(); box.scrollTop = box.scrollHeight;
  deliver(el, body);
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
