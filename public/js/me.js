import { icon } from "./icons.js";
import { api, cachedGet, esc, freshGet, toast } from "./site.js";
import { getMe, googleButton, whenSignedIn } from "./auth.js";
import { switchReady } from "./switcher.js";
import { cachedMe, helloOnce, renderTabs, roleName, toolsFor } from "./portal.js";
import { faceInner } from "./faces.js";

const $ = (id) => document.getElementById(id);
const TZ = "Africa/Johannesburg";
let firstName = "friend";
const fmt = (s) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(s));

const day = (iso) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

function memberCard(m) {
  if (!m) return `<div class="notice">You haven't joined the church family yet. <a href="/join" style="color:var(--gold-2)">Complete joining</a>. It's mostly pre-filled for you.</div>`;
  if (m.status === "revoked") return `<div class="notice">Your membership was revoked on ${esc(day(m.revoked_at))}. <a href="/join" style="color:var(--gold-2)">Rejoin</a></div>`;
  const due = m.next_checkin_at && new Date(m.next_checkin_at) <= new Date(Date.now() + 30 * 864e5);
  return due ? `<div class="notice me-due"><span>Time for your yearly check-in.</span><button class="btn btn-sm btn-gold" type="button" data-ms-confirm>I'm still a member</button></div>` : "";
}

let painted = false;
async function render() {
  // Instant: draw from this visit's last answers straight away, then refresh with the latest.
  const cm = cachedMe(), cd = cachedGet("/api/me");
  if (!painted && cm?.user && cd && !cm.admin_account) { painted = true; $("me-loading")?.remove(); $("me-signin").hidden = true; $("me-view").hidden = false; paint(cm, cd, true); }
  const [me, d] = await Promise.all([getMe(true), freshGet("/api/me").catch(() => null)]);
  $("me-loading")?.remove();
  if (!me.user || !d) {
    $("me-signin").hidden = false; $("me-view").hidden = true;
    switchReady();
    const ok = await googleButton($("me-google"), { text: "signin_with" });
    if (!ok) $("me-google").outerHTML = `<p class="muted-text">Google sign-in is being set up. In the meantime, <a href="/join" style="color:var(--gold-2)">join here</a>.</p>`;
    return;
  }
  if (me.admin_account) { location.href = "/admin/"; return; }   // the main admin isn't a member: their home is the admin portal
  $("me-signin").hidden = true; $("me-view").hidden = false;
  paint(me, d, false);
}

function paint(me, d, fromCache) {
  renderTabs($("portal-tabs"), me, "/me");
  const u = d.user;
  $("me-avatar").innerHTML = faceInner(u);
  firstName = d.member?.preferred_name || d.member?.first_name || (d.user?.name || "").split(" ")[0] || "friend";
  const hour = Number(new Intl.DateTimeFormat("en-ZA", { hour: "numeric", hour12: false, timeZone: TZ }).format(new Date()));
  $("me-greet").textContent = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  $("me-name").textContent = firstName;
  const role = roleName(me);
  $("me-status").textContent = [d.member?.status === "member" ? `Member · ${d.member.ref_code}` : d.member ? "Membership being confirmed" : "Not a member yet", role].filter(Boolean).join(" · ");
  $("me-member").innerHTML = memberCard(d.member);
  // People with a role simply see their extra tools here (no separate admin area to switch to).
  const tools = toolsFor(me), tb = $("me-tools");
  if (tb) {
    tb.hidden = !tools.length;
    $("me-tools-role").textContent = role || "";
    $("me-tools-grid").innerHTML = tools.map(([h, i, l]) => `<a class="tool-tile" href="${h}">${icon(i)}<span>${esc(l)}</span></a>`).join("");
  }
  switchReady();
  if (!fromCache) { helloOnce(me, { skip: maybeWelcome(d.member, u) }); if (d.member?.status === "member") voteBanner(); }
  const upcoming = d.registrations.filter((r) => new Date(r.ends_at || r.starts_at) > new Date(Date.now() - 6 * 3600_000) && r.status !== "rejected");
  $("me-events").innerHTML = upcoming.length ? upcoming.map((r) => `
    <article class="slide tix">
      <span class="tix-status ${esc(r.status)}">${{ waitlist: "Waitlist", pending: "Awaiting approval", confirmed: "Confirmed" }[r.status] || esc(r.status)}</span>
      <h3><a href="/event?e=${encodeURIComponent(r.slug)}">${esc(r.title)}</a></h3>
      <p class="meta">${esc(fmt(r.starts_at))}${r.location ? "<br>" + esc(r.location) : ""}</p>
      <p class="tix-ref">Ref ${esc(r.ref_code)}${r.guests ? ` · ${1 + Number(r.guests)} people` : ""}</p>
      <div class="foot">${r.ticket_code ? `<a class="btn btn-sm btn-gold" href="/ticket?c=${esc(r.ticket_code)}">${icon("ticket")} Show ticket</a>` : ""}
        ${new Date(r.starts_at) > new Date() ? `<button class="btn btn-sm btn-ghost" data-cancel="${esc(r.ref_code)}">Can't make it</button>` : ""}</div>
    </article>`).join("")
    : `<div class="slide empty-slide"><b>No tickets yet</b><p class="muted-text">When you get a ticket, it shows here with its QR code.</p><a class="btn btn-sm btn-gold btn-glow" href="#upcoming">${icon("ticket")} Get Ticket</a></div>`;
  loadUpcoming(fromCache); loadKnow(fromCache);
}

$("me-events").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cancel]");
  if (!b || !confirm("Cancel this registration? Your spot will go to someone on the waitlist.")) return;
  await api(`/api/me/registrations/${encodeURIComponent(b.dataset.cancel)}/cancel`, { method: "POST" });
  toast("Registration cancelled"); render();
});
$("me-member").addEventListener("click", async (e) => {
  if (e.target.closest("[data-ms-confirm]")) {
    try { await api("/api/me/membership/confirm", { method: "POST" }); toast("Thank you! Your membership is confirmed 💛"); render(); } catch (err) { toast(err.message); }
  }
});
// Newly verified members get the animated welcome once (or whenever they open /me?welcome=1 from the email).
function maybeWelcome(m, u) {
  if (!m || m.status !== "member") return false;
  const key = `scc-welcomed-${m.ref_code}`;
  const asked = new URLSearchParams(location.search).has("welcome");
  let seen = false;
  try { seen = localStorage.getItem(key) === "1"; } catch { seen = true; }
  if (!asked && seen) return false;
  try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
  if (asked) history.replaceState(null, "", "/me");
  import("./welcome.js").then(({ showWelcome }) => showWelcome({
    title: `you're officially a member, ${m.preferred_name || m.first_name || u.given_name || "friend"}`,
    line: "Your membership is verified. Your events, tickets and membership all live here.",
  }));
  return true;
}

whenSignedIn(render);
render();


// Open votes for members: a friendly nudge at the top of the profile.
async function voteBanner() {
  const r = await api("/api/votes").catch(() => null);
  const open = (r?.polls || []).filter((p) => p.state === "open");
  if (!open.length || document.getElementById("vote-banner")) return;
  const p = open[0], todo = open.filter((x) => !x.voted).length;
  const el = document.createElement("a");
  el.id = "vote-banner"; el.className = "vote-banner"; el.href = `/vote?p=${encodeURIComponent(p.id)}`;
  el.innerHTML = `<span class="vb-ico">${icon("vote")}</span><span><b>${todo ? "Your vote is waiting" : "Watch the live results"}</b><small>${esc(p.title)}${p.event_name ? ` · ${esc(p.event_name)}` : ""}</small></span><span class="btn btn-sm btn-gold${todo ? " btn-glow" : ""}">${todo ? "Vote now" : "See results"}</span>`;
  $("me-view").insertBefore(el, $("me-member"));
}


// Coming up at church: the next events, swipe through.
async function loadUpcoming(fromCache) {
  const r = (fromCache ? cachedGet("/api/events") : null) || await freshGet("/api/events").catch(() => ({ events: [] }));
  const list = (r.events || []).slice(0, 12);
  $("me-upcoming").innerHTML = list.length ? list.map((e) => `<a class="slide ev-slide" href="/event?e=${encodeURIComponent(e.slug)}">
      ${e.cover_url ? `<img src="${esc(e.cover_url)}" alt="" loading="lazy">` : `<span class="ev-ph">${icon("calendar")}</span>`}
      <span class="ev-body"><b>${esc(e.title)}</b><small>${esc(fmt(e.starts_at))}${e.price_label ? ` · ${esc(e.price_label)}` : ""}</small>
      ${e.registration_open ? `<span class="btn btn-sm btn-gold btn-glow">${icon("ticket")} Get Ticket</span>` : ""}</span></a>`).join("")
    : `<div class="slide empty-slide"><b>Nothing new just yet</b><p class="muted-text">New events appear here first.</p></div>`;
}

// What to know: service times and the next vote.
async function loadKnow(fromCache) {
  const p = (fromCache ? cachedGet("/api/programme?limit=1") : null) || await freshGet("/api/programme?limit=1").catch(() => null);
  const w = p?.weekly || [];
  $("know-services").querySelector("small").innerHTML = w.length ? w.map((x) => `${esc(x.day.slice(0, 3))} · ${esc(x.title)} ${esc(x.time || "")}`).join("<br>") : "Sundays 08:45–11:00";
  const v = (fromCache ? cachedGet("/api/votes") : null) || await freshGet("/api/votes").catch(() => null);
  const s = $("know-vote").querySelector("small");
  const open = (v?.polls || []).find((x) => x.state === "open"), next = (v?.polls || []).find((x) => x.state === "upcoming");
  s.textContent = v?.member === false ? "For confirmed members" : open ? `Voting is open: ${open.title}` : next ? `Next: ${next.title}, ${new Date(next.opens_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long" })}` : v ? `No votes planned yet in ${new Date().getFullYear()}` : "For confirmed members";
}
