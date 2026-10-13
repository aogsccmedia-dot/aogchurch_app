// Members' voting: each vote fills church roles over one or more rounds. Pick one person per role, watch the live
// results race, and see who was appointed when it's done. Ballots are secret.
import { api, esc, toast } from "./site.js";
import { getMe, googleButton, whenSignedIn } from "./auth.js";
import { icon } from "./icons.js";
import { renderTabs } from "./portal.js";

const root = document.getElementById("vote-root");
const TZ = "Africa/Johannesburg";
const params = new URLSearchParams(location.search);
let current = params.get("p"), timer = null, data = null;
const picked = {};

const face = (p, cls = "") => p.picture ? `<img class="vface ${cls}" src="${esc(p.picture)}" alt="" referrerpolicy="no-referrer" loading="lazy">`
  : `<span class="vface ${cls}" style="--h:${[...(p.name || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}">${esc((p.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase())}</span>`;
const when = (iso) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "long", timeZone: TZ }).format(new Date(iso));
const left = (iso) => { const ms = Date.parse(iso) - Date.now(); if (ms <= 0) return "closing"; const h = Math.floor(ms / 3600000); return h >= 48 ? `${Math.floor(h / 24)} days left` : h >= 1 ? `${h} h left` : `${Math.max(1, Math.round(ms / 60000))} min left`; };
const STATE = { open: "Voting now", upcoming: "Coming up", between: "Between rounds", complete: "Finished", cancelled: "Cancelled" };

async function start() {
  const me = await getMe();
  renderTabs(document.getElementById("portal-tabs"), me, "/vote");
  if (!me.user) {
    root.innerHTML = `<section class="vote-card center"><h2>Sign in to vote</h2><p class="muted-text">Voting is for confirmed members of AOG Sandton City Church.</p><div class="gbtn" id="v-g"></div><a class="btn" href="/me">Sign in</a></section>`;
    googleButton(document.getElementById("v-g"), { text: "signin_with", width: 300 });
    return;
  }
  let list;
  try { list = await api("/api/votes"); }
  catch (e) { root.innerHTML = `<section class="vote-card center"><h2>Voting is for members</h2><p class="muted-text">${esc(e.message)}</p><a class="btn btn-gold" href="/join">Join the church</a></section>`; return; }
  const live = list.polls.filter((p) => p.state !== "cancelled");
  if (!live.length) {
    root.innerHTML = `<section class="vote-card center vote-none">${icon("vote")}<h2>No votes planned yet${list.year === 2026 ? " in 2026" : ""}</h2>
      <p class="muted-text">When the church sets up a vote, you'll see the roles to fill and the voting days here, and we'll email you a reminder to pray every two weeks before it starts.</p></section>`;
    return;
  }
  current = live.some((p) => p.id === current) ? current : live[0].id;
  root.innerHTML = `${live.length > 1 ? `<nav class="vote-tabs">${live.map((p) => `<button data-p="${esc(p.id)}" class="${p.id === current ? "on" : ""}"><b>${esc(p.title)}</b><span>${p.state === "open" ? (p.voted ? "Voted ✓" : "Voting now") : p.state === "upcoming" ? `Starts ${when(p.opens_at)}` : STATE[p.state]}</span></button>`).join("")}</nav>` : ""}<div id="vote-poll"></div>`;
  root.querySelector(".vote-tabs")?.addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (!b) return; current = b.dataset.p; root.querySelectorAll(".vote-tabs button").forEach((x) => x.classList.toggle("on", x === b)); history.replaceState(null, "", `?p=${current}`); load(true); });
  load(true);
}

async function load(full) {
  clearTimeout(timer);
  try { data = await api(`/api/votes/${encodeURIComponent(current)}`); } catch (e) { document.getElementById("vote-poll").innerHTML = `<p class="muted-text">${esc(e.message)}</p>`; return; }
  const p = data.poll, box = document.getElementById("vote-poll");
  if (full || !box.querySelector(".vote-role")) {
    const status = p.state === "open" ? `${icon("clock")} Round ${p.round}${p.rounds > 1 ? ` of ${p.rounds}` : ""} · ${left(p.next.closes_at)}`
      : p.state === "upcoming" ? `Starts ${when(p.next.opens_at)}` : p.state === "between" ? `Round ${p.round + 1} starts ${when(p.next.opens_at)}` : STATE[p.state];
    box.innerHTML = `<section class="vote-card">
      <div class="vote-title"><div><p class="eyebrow">${esc(p.event_name || "Church vote")}</p><h2>${esc(p.title)}</h2>${p.description ? `<p class="muted-text">${esc(p.description)}</p>` : ""}</div>
        <span class="vote-state ${p.state}">${status}</span></div>
      <ol class="vote-rounds">${p.schedule.map((r) => `<li class="${r.round === p.round && p.state === "open" ? "on" : r.round <= p.round ? "done" : ""}"><b>Round ${r.round}</b><span>${when(r.opens_at)} – ${when(r.closes_at)}</span></li>`).join("")}</ol>
      ${p.state === "upcoming" ? `<p class="vote-pray">${icon("handHeart")} Please pray for wisdom and for the people who will serve. We'll email you when voting opens.</p>` : ""}
      ${p.state === "open" && p.round === 1 ? `<p class="muted-text vote-rule">You can choose any confirmed member who has been saved for at least ${p.min_saved_years} years. One vote per role. Your vote is secret.</p>` : p.state === "open" ? `<p class="muted-text vote-rule">Round ${p.round}: choose from the people who went through from the last round.</p>` : ""}
      <div class="vote-roles">${data.roles.map((r) => roleHtml(r, p)).join("")}</div>
    </section>`;
    box.querySelectorAll("[data-q]").forEach((inp) => inp.addEventListener("input", () => drawGrid(inp.dataset.q, inp.value)));
    data.roles.forEach((r) => { if (p.state === "open" && !r.my_vote) drawGrid(r.id, ""); });
  }
  data.roles.forEach((r) => drawRace(r));
  if (p.state === "open" && !document.hidden) timer = setTimeout(() => load(false), 5000);
}

function roleHtml(r, p) {
  const canVote = p.state === "open" && !r.my_vote;
  return `<article class="vote-role" data-role="${esc(r.id)}">
    <header><h3>${esc(r.name)}${r.seats > 1 ? ` <small>· ${r.seats} places</small>` : ""}</h3>${r.description ? `<p class="muted-text">${esc(r.description)}</p>` : ""}</header>
    ${r.appointed?.length ? `<div class="appointed">${icon("check")} Appointed: ${r.appointed.map((a) => `${face(a, "sm")} <b>${esc(a.name)}</b>`).join(", ")}</div>` : ""}
    ${canVote ? `<div class="pick"><input class="input" data-q="${esc(r.id)}" placeholder="Search for a name…" autocomplete="off"><div class="pick-grid" data-grid="${esc(r.id)}"></div>
      <div class="pick-bar" data-bar="${esc(r.id)}" hidden><span></span><button class="btn btn-gold btn-glow" type="button" data-cast="${esc(r.id)}">Cast my vote</button></div></div>`
    : r.my_vote ? `<p class="voted">${icon("check")} You voted for this role. Thank you!</p>` : ""}
    ${p.state !== "upcoming" ? `<div class="race-wrap"><h4>${p.state === "complete" ? "Final results" : "Live results"} <span class="muted-text">· ${r.total} vote${r.total === 1 ? "" : "s"}</span></h4><div class="race-live" data-race="${esc(r.id)}"></div></div>` : ""}
  </article>`;
}

function drawGrid(roleId, q) {
  const r = data.roles.find((x) => x.id === roleId), el = document.querySelector(`[data-grid="${CSS.escape(roleId)}"]`);
  if (!r || !el) return;
  const term = q.trim().toLowerCase();
  const people = r.candidates.filter((c) => !term || c.name.toLowerCase().includes(term)).slice(0, term ? 60 : 18);
  el.innerHTML = people.map((c) => `<button type="button" class="pick-person${picked[roleId] === c.id ? " on" : ""}" data-id="${esc(c.id)}">${face(c)}<span>${esc(c.name)}</span></button>`).join("")
    + (!r.candidates.length ? `<p class="muted-text">Nobody can be chosen for this role yet.</p>` : r.candidates.length > 18 && !term ? `<p class="muted-text pick-more">Type a name to find more people.</p>` : "");
}

root.addEventListener("click", async (e) => {
  const b = e.target.closest(".pick-person");
  if (b) {
    const roleId = b.closest("[data-role]").dataset.role, r = data.roles.find((x) => x.id === roleId);
    picked[roleId] = b.dataset.id;
    b.parentElement.querySelectorAll(".pick-person").forEach((x) => x.classList.toggle("on", x === b));
    const c = r.candidates.find((x) => x.id === b.dataset.id), bar = document.querySelector(`[data-bar="${CSS.escape(roleId)}"]`);
    bar.hidden = false; bar.querySelector("span").innerHTML = `${face(c, "sm")} <b>${esc(c.name)}</b> for ${esc(r.name)}`;
    return;
  }
  const cast = e.target.closest("[data-cast]");
  if (cast) {
    const roleId = cast.dataset.cast, r = data.roles.find((x) => x.id === roleId), c = r.candidates.find((x) => x.id === picked[roleId]);
    if (!c || !confirm(`Vote for ${c.name} as ${r.name}? You can only vote once for this role in this round.`)) return;
    cast.disabled = true;
    try { await api(`/api/votes/${encodeURIComponent(current)}`, { method: "POST", body: { role_id: roleId, member_id: c.id } }); toast("Your vote is in. Thank you! 🙏"); delete picked[roleId]; load(true); }
    catch (err) { toast(err.message); cast.disabled = false; }
  }
});

// Live chart per role: rows slide to their new place as votes come in.
const ROW = 52;
function drawRace(r) {
  const el = document.querySelector(`[data-race="${CSS.escape(r.id)}"]`);
  if (!el) return;
  const top = r.results.slice(0, 8);
  if (!top.length) { el.style.height = ""; el.innerHTML = `<p class="muted-text">No votes yet.</p>`; return; }
  el.querySelector("p")?.remove();
  const max = Math.max(1, ...top.map((x) => x.votes));
  el.style.height = `${top.length * ROW}px`;
  const seen = new Set();
  top.forEach((x, i) => {
    seen.add(x.id);
    let row = el.querySelector(`[data-id="${CSS.escape(x.id)}"]`);
    if (!row) {
      row = document.createElement("div"); row.className = "rrow"; row.dataset.id = x.id;
      row.innerHTML = `${face(x)}<span class="rname">${esc(x.name)}</span><span class="rbar"><i></i></span><b class="rcount"></b>`;
      row.style.transform = `translateY(${top.length * ROW}px)`; row.style.opacity = "0";
      el.append(row);
    }
    requestAnimationFrame(() => {
      row.style.transform = `translateY(${i * ROW}px)`; row.style.opacity = "1";
      row.querySelector(".rbar i").style.width = `${Math.max(4, (x.votes / max) * 100)}%`;
      row.querySelector(".rcount").textContent = x.votes;
      row.classList.toggle("lead", i === 0);
      row.classList.toggle("mine", x.id === r.my_vote);
    });
  });
  el.querySelectorAll(".rrow").forEach((row) => { if (!seen.has(row.dataset.id)) row.remove(); });
}

document.addEventListener("visibilitychange", () => { if (!document.hidden && data?.poll.state === "open") load(false); });
whenSignedIn(() => start());
start();
