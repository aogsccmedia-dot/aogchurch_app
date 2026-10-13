// Members' voting: pick a person, then watch the live results race (if the admin has them switched on).
import { api, esc, toast } from "./site.js";
import { getMe, googleButton, whenSignedIn } from "./auth.js";
import { icon } from "./icons.js";

const root = document.getElementById("vote-root");
const TZ = "Africa/Johannesburg";
const params = new URLSearchParams(location.search);
let current = params.get("p"), timer = null, data = null, picked = null;

const face = (p, cls = "") => p.picture ? `<img class="vface ${cls}" src="${esc(p.picture)}" alt="" referrerpolicy="no-referrer" loading="lazy">`
  : `<span class="vface ${cls}" style="--h:${[...(p.name || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}">${esc((p.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase())}</span>`;
const when = (iso) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }).format(new Date(iso));
const left = (iso) => { const ms = Date.parse(iso) - Date.now(); if (ms <= 0) return "closed"; const h = Math.floor(ms / 3600000); return h >= 48 ? `${Math.floor(h / 24)} days left` : h >= 1 ? `${h} h left` : `${Math.max(1, Math.round(ms / 60000))} min left`; };

async function start() {
  const me = await getMe();
  if (!me.user) {
    root.innerHTML = `<section class="vote-card center"><h2>Sign in to vote</h2><p class="muted-text">Voting is for members of AOG Sandton City Church.</p><div class="gbtn" id="v-g"></div><a class="btn" href="/me">Sign in</a></section>`;
    googleButton(document.getElementById("v-g"), { text: "signin_with", width: 300 });
    return;
  }
  let list;
  try { list = await api("/api/votes"); }
  catch (e) {
    root.innerHTML = `<section class="vote-card center"><h2>Voting is for members</h2><p class="muted-text">${esc(e.message)}</p><a class="btn btn-gold" href="/join">Join the church</a></section>`;
    return;
  }
  if (!list.polls.length) { root.innerHTML = `<section class="vote-card center"><h2>Nothing to vote on right now</h2><p class="muted-text">When there's a vote for an event, it'll appear here and on your profile.</p></section>`; return; }
  current ||= list.polls[0].id;
  root.innerHTML = `${list.polls.length > 1 ? `<nav class="vote-tabs">${list.polls.map((p) => `<button data-p="${esc(p.id)}" class="${p.id === current ? "on" : ""}"><b>${esc(p.title)}</b><span>${p.state === "open" ? (p.voted ? "Voted ✓" : "Voting now") : p.state === "upcoming" ? `Opens ${when(p.opens_at)}` : "Closed"}</span></button>`).join("")}</nav>` : ""}<div id="vote-poll"></div>`;
  root.querySelector(".vote-tabs")?.addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (!b) return; current = b.dataset.p; picked = null; root.querySelectorAll(".vote-tabs button").forEach((x) => x.classList.toggle("on", x === b)); history.replaceState(null, "", `?p=${current}`); load(true); });
  load(true);
}

async function load(full) {
  clearTimeout(timer);
  try { data = await api(`/api/votes/${encodeURIComponent(current)}`); } catch (e) { document.getElementById("vote-poll").innerHTML = `<p class="muted-text">${esc(e.message)}</p>`; return; }
  const p = data.poll, box = document.getElementById("vote-poll");
  const canVote = p.state === "open" && !data.my_vote;
  if (full || !box.querySelector(".race-live")) {
    box.innerHTML = `<section class="vote-card">
      <div class="vote-title"><div><p class="eyebrow">${esc(p.event_name || "Vote")}</p><h2>${esc(p.title)}</h2>${p.description ? `<p class="muted-text">${esc(p.description)}</p>` : ""}</div>
        <span class="vote-state ${p.state}">${p.state === "open" ? `${icon("clock")} ${left(p.closes_at)}` : p.state === "upcoming" ? `Opens ${when(p.opens_at)}` : "Closed"}</span></div>
      ${canVote ? `<div class="pick"><input class="input" id="v-q" placeholder="Search for a name…" autocomplete="off"><div class="pick-grid" id="v-grid"></div>
        <div class="pick-bar" id="v-bar" hidden><span id="v-who"></span><button class="btn btn-gold btn-glow" id="v-go" type="button">Cast my vote</button></div></div>`
      : data.my_vote ? `<p class="voted">${icon("check")} You voted. Thank you!</p>` : p.state === "upcoming" ? `<p class="muted-text">Voting opens on ${when(p.opens_at)}.</p>` : ""}
      <div class="race-wrap"><h3>${p.state === "closed" ? "Results" : "Live results"}${data.total != null ? ` <span class="muted-text">· ${data.total} vote${data.total === 1 ? "" : "s"}</span>` : ""}</h3><div class="race-live" id="v-race"></div></div>
    </section>`;
    if (canVote) { drawGrid(""); box.querySelector("#v-q").addEventListener("input", (e) => drawGrid(e.target.value)); box.querySelector("#v-go").addEventListener("click", cast); box.querySelector("#v-grid").addEventListener("click", pick); }
  }
  drawRace();
  if (p.state === "open" && !document.hidden) timer = setTimeout(() => load(false), 4000);
}

function drawGrid(q) {
  const term = q.trim().toLowerCase();
  const people = data.candidates.filter((c) => c.id !== data.me && (!term || c.name.toLowerCase().includes(term))).slice(0, term ? 60 : 24);
  document.getElementById("v-grid").innerHTML = people.map((c) => `<button type="button" class="pick-person${picked === c.id ? " on" : ""}" data-id="${esc(c.id)}">${face(c)}<span>${esc(c.name)}</span></button>`).join("")
    + (data.candidates.length > 24 && !term ? `<p class="muted-text pick-more">Type a name to find more people.</p>` : "");
}
function pick(e) {
  const b = e.target.closest(".pick-person"); if (!b) return;
  picked = b.dataset.id;
  document.querySelectorAll(".pick-person").forEach((x) => x.classList.toggle("on", x === b));
  const c = data.candidates.find((x) => x.id === picked);
  document.getElementById("v-bar").hidden = false;
  document.getElementById("v-who").innerHTML = `${face(c, "sm")} <b>${esc(c.name)}</b>`;
}
async function cast() {
  if (!picked) return;
  const c = data.candidates.find((x) => x.id === picked);
  if (!confirm(`Vote for ${c.name}? You can only vote once.`)) return;
  try { await api(`/api/votes/${encodeURIComponent(current)}`, { method: "POST", body: { member_id: picked } }); toast("Your vote is in. Thank you! 🎉"); picked = null; load(true); }
  catch (e) { toast(e.message); }
}

// Live chart: each person has a row that slides to its new place as the votes come in.
const ROW = 52;
function drawRace() {
  const el = document.getElementById("v-race");
  if (!data.results) { el.innerHTML = `<p class="muted-text">Results will show here when voting closes.</p>`; return; }
  const top = data.results.slice(0, 10);
  if (!top.length) { el.innerHTML = `<p class="muted-text">No votes yet. Be the first!</p>`; return; }
  const max = Math.max(1, ...top.map((r) => r.votes));
  el.style.height = `${top.length * ROW}px`;
  const seen = new Set();
  top.forEach((r, i) => {
    seen.add(r.id);
    let row = el.querySelector(`[data-id="${CSS.escape(r.id)}"]`);
    if (!row) {
      row = document.createElement("div"); row.className = "rrow"; row.dataset.id = r.id;
      row.innerHTML = `${face(r)}<span class="rname">${esc(r.name)}</span><span class="rbar"><i></i></span><b class="rcount"></b>`;
      row.style.transform = `translateY(${top.length * ROW}px)`; row.style.opacity = "0";
      el.append(row);
    }
    requestAnimationFrame(() => {
      row.style.transform = `translateY(${i * ROW}px)`; row.style.opacity = "1";
      row.querySelector(".rbar i").style.width = `${Math.max(4, (r.votes / max) * 100)}%`;
      row.querySelector(".rcount").textContent = r.votes;
      row.classList.toggle("lead", i === 0);
      row.classList.toggle("mine", r.id === data.my_vote);
    });
  });
  el.querySelectorAll(".rrow").forEach((row) => { if (!seen.has(row.dataset.id)) row.remove(); });
}

document.addEventListener("visibilitychange", () => { if (!document.hidden && data?.poll.state === "open") load(false); });
whenSignedIn(() => start());
start();
