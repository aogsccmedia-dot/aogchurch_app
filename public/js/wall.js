// Prayer Wall: shared requests (approved by a leader first), "I prayed" taps, answered prayers.
import { api, esc, toast } from "./site.js";
import { getMe, openSignIn, whenSignedIn } from "./auth.js";
import { icon } from "./icons.js";

const $ = (id) => document.getElementById(id);
const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
};
const ACCENTS = ["sage", "lilac", "green", "gold"];

function card(p, i) {
  return `<article class="wall-card ${ACCENTS[i % 4]} ${p.answered ? "answered" : ""}" data-id="${esc(p.id)}">
    ${p.answered ? `<span class="wall-badge">${icon("sparkles")} Answered</span>` : ""}
    <p class="wall-text">${esc(p.request)}</p>
    ${p.answered && p.answered_note ? `<p class="wall-note">“${esc(p.answered_note)}”</p>` : ""}
    <div class="wall-foot"><span class="wall-who">${esc(p.display_name || "Someone")} · ${ago(p.created_at)}</span>
      <button class="pray-btn ${p.prayed ? "on" : ""}" type="button" data-pray ${p.prayed || p.mine ? "disabled" : ""} aria-label="I prayed for this">${icon("handHeart")} <span>${p.prayed ? "Prayed" : p.mine ? "Your request" : "I prayed"}</span> <b>${p.prayed_count}</b></button></div>
  </article>`;
}

async function load() {
  const d = await api("/api/wall").catch(() => null);
  if (!d) return;
  $("wall-total").textContent = d.prayers_total ? `${d.prayers_total} prayers prayed so far` : "Be the first to pray";
  $("wall-list").innerHTML = d.posts.length ? d.posts.map(card).join("")
    : `<div class="events-empty" style="grid-column:1/-1">No requests on the wall yet. Share the first one: the church family is ready to pray.</div>`;
  $("wall-compose").hidden = !d.signed_in; $("wall-signin").hidden = d.signed_in;
  $("wall-mine").innerHTML = d.mine.length ? `<p class="eyebrow">My requests</p>` + d.mine.map((m) => `<div class="wall-mine-row" data-id="${esc(m.id)}">
      <span>${esc(m.request.slice(0, 80))}${m.request.length > 80 ? "…" : ""}</span>
      <span class="tag">${m.status === "pending" ? "Waiting for a leader" : m.status === "hidden" ? "Removed" : m.answered ? "Answered 🙌" : `${m.prayed_count} prayed`}</span>
      ${m.status === "approved" && !m.answered ? `<button class="btn btn-sm btn-lilac" type="button" data-answered>Mark answered</button>` : ""}</div>`).join("") : "";
}

$("wall-list").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-pray]"); if (!b) return;
  const me = await getMe();
  if (!me.user) { openSignIn(); return; }
  b.disabled = true;
  try {
    const r = await api(`/api/wall/${b.closest("[data-id]").dataset.id}/pray`, { method: "POST" });
    b.classList.add("on"); b.querySelector("span").textContent = "Prayed"; b.querySelector("b").textContent = r.prayed_count;
    b.animate([{ transform: "scale(1)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], { duration: 350 });
  } catch (err) { toast(err.message); b.disabled = false; }
});
$("wall-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, st = f.querySelector("[data-status]"), btn = f.querySelector("[type=submit]");
  btn.disabled = true; st.hidden = true;
  try {
    const r = await api("/api/wall", { method: "POST", body: { request: f.request.value, show_name: !f.anonymous.checked } });
    st.className = "notice ok"; st.textContent = r.message; st.hidden = false; f.reset(); load();
  } catch (err) { st.className = "notice err"; st.textContent = err.message; st.hidden = false; }
  finally { btn.disabled = false; }
});
$("wall-signin").querySelector("button").addEventListener("click", openSignIn);
$("wall-mine").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-answered]"); if (!b) return;
  const note = prompt("Praise God! Want to share how it was answered? (optional)") ?? null;
  if (note === null) return;
  try { await api(`/api/wall/${b.closest("[data-id]").dataset.id}/answered`, { method: "POST", body: { note } }); toast("Marked as answered. Thank You, Jesus! 🙌"); load(); }
  catch (err) { toast(err.message); }
});
whenSignedIn(load);
load();
