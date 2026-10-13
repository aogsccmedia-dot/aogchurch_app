import { icon } from "./icons.js";
import { api, esc, toast } from "./site.js";
import { getMe, googleButton, whenSignedIn } from "./auth.js";
import { switchReady } from "./switcher.js";
import { helloOnce, renderTabs, roleName } from "./portal.js";

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

async function render() {
  // Session + profile in parallel so the page fills in quickly after Google sign-in.
  const [me, d] = await Promise.all([getMe(true), api("/api/me").catch(() => null)]);
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
  renderTabs($("portal-tabs"), me, "/me");
  const u = d.user;
  $("me-avatar").innerHTML = u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : esc((u.given_name || u.email)[0].toUpperCase());
  firstName = d.member?.preferred_name || d.member?.first_name || (d.user?.name || "").split(" ")[0] || "friend";
  const hour = Number(new Intl.DateTimeFormat("en-ZA", { hour: "numeric", hour12: false, timeZone: TZ }).format(new Date()));
  $("me-greet").textContent = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  $("me-name").textContent = firstName;
  const role = roleName(me);
  $("me-status").textContent = [d.member?.status === "member" ? `Member · ${d.member.ref_code}` : d.member ? "Membership being confirmed" : "Not a member yet", role].filter(Boolean).join(" · ");
  $("me-member").innerHTML = memberCard(d.member);
  switchReady();
  if (!maybeWelcome(d.member, u)) helloOnce(me);
  if (d.member?.status === "member") voteBanner();
  $("me-events").innerHTML = d.registrations.length ? d.registrations.map((r) => `
    <article class="event-card"><div class="body">
      <span class="eyebrow">${{ waitlist: "Waitlist", pending: "Awaiting payment approval", confirmed: "Confirmed", rejected: "Payment not approved" }[r.status] || r.status} · ${esc(r.ref_code)}</span>
      <h3><a href="/event?e=${encodeURIComponent(r.slug)}">${esc(r.title)}</a></h3>
      <p class="meta">${esc(fmt(r.starts_at))}${r.location ? " · " + esc(r.location) : ""}</p>
      <div class="foot">${r.ticket_code ? `<a class="btn btn-sm btn-green" href="/ticket?c=${esc(r.ticket_code)}">${icon("ticket")} ${r.guests ? `My ${1 + Number(r.guests)} tickets` : "My ticket"}</a>` : "<span></span>"}
        ${new Date(r.starts_at) > new Date() ? `<button class="btn btn-sm btn-ghost" data-cancel="${esc(r.ref_code)}">Can't make it</button>` : ""}</div>
    </div></article>`).join("")
    : `<div class="events-empty" style="grid-column:1/-1">No events yet. <a class="btn btn-sm" href="/events">Browse what's coming up ${icon("arrowRight", "arr")}</a></div>`;
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
