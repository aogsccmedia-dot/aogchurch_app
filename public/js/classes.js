// Discipleship page: "Coming soon" until a pastor or the main admin opens classes; then the upcoming classes, with
// "Join online" for members who signed up (once the pastor has opened the room).
import { api, esc } from "./site.js";

const $ = (id) => document.getElementById(id);
const MODE = { online: "Online", in_person: "At church" };

async function load() {
  let d;
  try { d = await api("/api/classes"); } catch { return; }
  const open = d.status === "open";
  $("dc-soon").hidden = open;
  if (open) {
    $("dc-cta").firstChild.textContent = "Sign me up ";
    $("dc-su-eyebrow").textContent = "Sign up";
    $("signup-title").textContent = "Join the next class";
    $("dc-su-lede").textContent = "Tell us which track you'd like. Signed-in members who sign up can join online classes straight from this page.";
    $("dc-submit").firstChild.textContent = "Sign me up ";
  }
  $("dc-teach").hidden = !d.can_teach;
  if (!d.classes.length && !d.can_teach) return;
  $("dc-classes").hidden = false;
  if (d.can_teach && !open) $("dc-classes-title").textContent = "Next classes (only pastors see these until classes open)";
  $("dc-list").innerHTML = d.classes.length ? d.classes.map((c) => {
    const live = c.status === "live", ended = c.status === "ended";
    const action = ended
      ? (c.has_notes && c.joined ? `<a class="btn btn-sm" href="/api/classes/${esc(c.id)}/notes.pdf">Notes (PDF)</a>` : `<span class="pill">Finished</span>`)
      : c.mode !== "online" ? ""
      : c.can_join ? `<a class="btn btn-sm btn-gold" href="/class?id=${esc(c.id)}">${live ? "Join now" : d.can_teach ? "Open the room" : "Join"}</a>`
      : d.signed_up ? `<span class="pill">Opens when the pastor starts</span>` : "";
    return `<article class="dc-class${live ? " live" : ""}">
      <div class="dc-when"><b>${esc(c.when)}</b><span>${c.minutes} min · ${esc(MODE[c.mode] || "")}${c.location ? ` · ${esc(c.location)}` : ""}</span></div>
      <div class="dc-what"><span class="dc-track">${esc(c.track_label)}</span><h3>${esc(c.title)}</h3>${c.details ? `<p>${esc(c.details)}</p>` : ""}</div>
      <div class="dc-go">${live ? `<span class="dc-live">Live</span>` : ""}${action}</div></article>`;
  }).join("") : `<p class="muted-text">No classes scheduled yet. Add one in <a href="/admin/#discipleship">Discipleship</a>.</p>`;
}
load();
