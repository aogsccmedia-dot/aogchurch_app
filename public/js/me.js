import { icon } from "./icons.js";
import { api, esc, toast } from "./site.js";
import { getMe, googleButton, signOut, whenSignedIn } from "./auth.js";

const $ = (id) => document.getElementById(id);
const TZ = "Africa/Johannesburg";
const fmt = (s) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(s));

async function render() {
  const me = await getMe(true);
  if (!me.user) {
    $("me-signin").hidden = false; $("me-view").hidden = true;
    const ok = await googleButton($("me-google"), { text: "signin_with" });
    if (!ok) $("me-google").outerHTML = `<p class="muted-text">Google sign-in is being set up. In the meantime, <a href="/join" style="color:var(--gold-2)">join here</a>.</p>`;
    return;
  }
  if (me.admin_account) { location.href = "/admin/"; return; }
  const d = await api("/api/me");
  $("me-signin").hidden = true; $("me-view").hidden = false;
  const u = d.user;
  $("me-avatar").innerHTML = u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : esc((u.given_name || u.email)[0].toUpperCase());
  $("me-name").textContent = u.name || u.email;
  $("me-email").textContent = u.email;
  $("me-member").innerHTML = d.member
    ? `<p class="tag">Member · ${esc(d.member.ref_code)}</p><p class="muted-text" style="font-size:13px">Joined ${new Date(d.member.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}</p>`
    : `<div class="notice">You haven't joined the church family yet. <a href="/join" style="color:var(--gold-2)">Complete joining</a>. It's mostly pre-filled for you.</div>`;
  $("me-letter").checked = !!d.subscribed;
  $("me-events").innerHTML = d.registrations.length ? d.registrations.map((r) => `
    <article class="event-card"><div class="body">
      <span class="eyebrow">${r.status === "waitlist" ? "Waitlist" : "Registered"} · ${esc(r.ref_code)}</span>
      <h3><a href="/event?e=${encodeURIComponent(r.slug)}">${esc(r.title)}</a></h3>
      <p class="meta">${esc(fmt(r.starts_at))}${r.location ? " · " + esc(r.location) : ""}</p>
      ${new Date(r.starts_at) > new Date() ? `<div class="foot"><span></span><button class="btn btn-sm" data-cancel="${esc(r.ref_code)}">Can't make it</button></div>` : ""}
    </div></article>`).join("")
    : `<div class="events-empty" style="grid-column:1/-1">No events yet. <a class="btn btn-sm" href="/#services">Browse what's coming up ${icon("arrowRight", "arr")}</a></div>`;
}

$("me-letter").addEventListener("change", async (e) => {
  try { await api("/api/me/letter", { method: "POST", body: { subscribed: e.target.checked } }); toast(e.target.checked ? "You're subscribed 💛" : "Unsubscribed"); }
  catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
});
$("me-events").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cancel]");
  if (!b || !confirm("Cancel this registration? Your spot will go to someone on the waitlist.")) return;
  await api(`/api/me/registrations/${encodeURIComponent(b.dataset.cancel)}/cancel`, { method: "POST" });
  toast("Registration cancelled"); render();
});
$("me-signout").addEventListener("click", signOut);
whenSignedIn(render);
render();
