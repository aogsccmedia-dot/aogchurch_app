import { icon } from "./icons.js";
import { api, esc, toast } from "./site.js";
import { getMe, googleButton, signOut, whenSignedIn } from "./auth.js";
import { revokeFlow } from "./offboard.js";
import { switchReady } from "./switcher.js";

const $ = (id) => document.getElementById(id);
const TZ = "Africa/Johannesburg";
let revoked = false, firstName = "friend";   // offboarding state
const fmt = (s) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(s));

const day = (iso) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

function memberCard(m) {
  if (!m) return `<div class="notice">You haven't joined the church family yet. <a href="/join" style="color:var(--gold-2)">Complete joining</a>. It's mostly pre-filled for you.</div>`;
  if (m.status === "revoked") return `<div class="ms-card"><div class="row"><span>Membership</span><b>Revoked</b></div>
    <div class="row"><span>Revoked on</span><b>${esc(day(m.revoked_at))}</b></div><div class="actions"><a class="btn btn-sm btn-gold" href="/join">Rejoin</a></div></div>`;
  const due = m.next_checkin_at && new Date(m.next_checkin_at) <= new Date(Date.now() + 30 * 864e5);
  return `<div class="ms-card">
    <div class="row"><span>Membership</span><b>Active · ${esc(m.ref_code)}</b></div>
    <div class="row"><span>Member since</span><b>${esc(day(m.created_at))}</b></div>
    ${m.last_confirmed_at ? `<div class="row"><span>Last confirmed</span><b>${esc(day(m.last_confirmed_at))}</b></div>` : ""}
    ${m.next_checkin_at ? `<div class="row"><span>Next check-in</span><b>${esc(day(m.next_checkin_at))}</b></div>` : ""}
    <div class="actions">${due ? `<button class="btn btn-sm btn-gold" type="button" data-ms-confirm>I'm still a member</button>` : ""}<button class="btn btn-sm btn-ghost danger" type="button" data-ms-revoke>Revoke membership</button></div>
  </div>`;
}

async function render() {
  // Session + profile in parallel so the page fills in quickly after Google sign-in.
  const [me, d] = await Promise.all([getMe(true), api("/api/me").catch(() => null)]);
  if (!me.user || !d) {
    $("me-signin").hidden = false; $("me-view").hidden = true;
    switchReady();
    const ok = await googleButton($("me-google"), { text: "signin_with" });
    if (!ok) $("me-google").outerHTML = `<p class="muted-text">Google sign-in is being set up. In the meantime, <a href="/join" style="color:var(--gold-2)">join here</a>.</p>`;
    return;
  }
  if (me.admin_account) { location.href = "/admin/"; return; }
  $("me-signin").hidden = true; $("me-view").hidden = false;
  const u = d.user;
  $("me-avatar").innerHTML = u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : esc((u.given_name || u.email)[0].toUpperCase());
  $("me-name").textContent = u.name || u.email;
  $("me-email").textContent = u.email;
  firstName = d.member?.preferred_name || d.member?.first_name || (d.user?.name || "").split(" ")[0] || "friend";
  $("me-member").innerHTML = memberCard(d.member);
  roleSwitch(me);
  switchReady();
  loadComplaints(d.member);
  maybeWelcome(d.member, u);
  $("me-letter").checked = !!d.subscribed;
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
$("me-member").addEventListener("click", async (e) => {
  if (e.target.closest("[data-ms-confirm]")) {
    try { await api("/api/me/membership/confirm", { method: "POST" }); toast("Thank you! Your membership is confirmed 💛"); render(); } catch (err) { toast(err.message); }
  }
  if (e.target.closest("[data-ms-revoke]")) openOffboarding();
});
// People with an admin role can hop between this member view and their admin workspace.
function roleSwitch(me) {
  let bar = $("role-switch");
  if (!(me.can_admin || me.is_admin) || me.admin_account) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement("div"); bar.id = "role-switch"; bar.className = "role-switch";
    bar.innerHTML = `<span class="rs-opt on" aria-current="true">Member view</span><button type="button" class="rs-opt" data-switch="admin">Admin</button>`;
    $("me-view").prepend(bar);
  }
}

// Revoking membership: a gentle three-step sheet (why → confirm → goodbye).

function openOffboarding() {
  let dlg = $("offboard");
  if (!dlg) {
    dlg = document.createElement("dialog"); dlg.id = "offboard"; dlg.className = "sheet ob-sheet";
    dlg.setAttribute("aria-label", "Revoke membership");
    document.body.append(dlg);
    dlg.addEventListener("close", () => { if (revoked) { revoked = false; render(); } });
  }
  dlg.innerHTML = `<button class="btn btn-icon btn-ghost ob-x" type="button" aria-label="Close">${icon("x")}</button><div class="ob-host"></div>`;
  dlg.querySelector(".ob-x").addEventListener("click", () => dlg.close());
  revokeFlow(dlg.querySelector(".ob-host"), {
    name: firstName,
    submit: async (body) => { await api("/api/me/membership/revoke", { method: "POST", body }); revoked = true; },
    onKeep: () => { dlg.close(); toast("We're so glad you're staying 💛"); },
    onClose: () => dlg.close(),
  });
  dlg.showModal();
}

// Newly verified members get the animated welcome once (or whenever they open /me?welcome=1 from the email).
function maybeWelcome(m, u) {
  if (!m || m.status !== "member") return;
  const key = `scc-welcomed-${m.ref_code}`;
  const asked = new URLSearchParams(location.search).has("welcome");
  let seen = false;
  try { seen = localStorage.getItem(key) === "1"; } catch { seen = true; }
  if (!asked && seen) return;
  try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
  if (asked) history.replaceState(null, "", "/me");
  import("./welcome.js").then(({ showWelcome }) => showWelcome({
    title: `you're officially a member, ${m.preferred_name || m.first_name || u.given_name || "friend"}`,
    line: "Your membership is verified. Your events, tickets and membership all live here.",
  }));
}

// ---------- complaints (approved members) ----------
const CMP_LABEL = { received: "Received", in_review: "Being looked into", resolved: "Resolved", closed: "Closed" };
async function loadComplaints(member) {
  const box = $("complaints");
  if (!member || member.status === "revoked") { box.hidden = true; return; }
  box.hidden = false;
  const { eligible, complaints } = await api("/api/me/complaints").catch(() => ({ eligible: false, complaints: [] }));
  $("cmp-eligible").hidden = !eligible; $("cmp-not-eligible").hidden = eligible;
  $("cmp-mine").innerHTML = complaints.length ? `<p class="eyebrow">My complaints</p>` + complaints.map((c) => `<article class="cmp-item">
      <div class="cmp-top"><b>${esc(c.subject)}</b><span class="tag">${esc(CMP_LABEL[c.status] || c.status)}</span></div>
      <p class="muted-text" style="font-size:13px">${esc(c.ref_code)} · raised ${new Date(c.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}</p>
      ${c.response ? `<p class="cmp-reply">${esc(c.response)}</p>` : ""}</article>`).join("") : "";
  if (location.hash === "#complaints") box.scrollIntoView({ behavior: "smooth" });
}
$("cmp-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, status = f.querySelector("[data-status]"), btn = f.querySelector("[type=submit]");
  f.querySelectorAll(".field.invalid").forEach((x) => x.classList.remove("invalid"));
  const body = Object.fromEntries(new FormData(f).entries()); body.confidential = f.confidential.checked;
  btn.disabled = true; status.hidden = true;
  try {
    const r = await api("/api/me/complaints", { method: "POST", body });
    status.className = "notice ok"; status.textContent = `Thank you. We've received it (${r.ref}) and emailed you a copy. A leader will respond within 7 working days.`; status.hidden = false;
    f.reset(); loadComplaints({ status: "member" });
  } catch (err) {
    for (const [k, msg] of Object.entries(err.details || {})) { const fl = f.querySelector(`[name="${k}"]`)?.closest(".field"); if (fl) { fl.classList.add("invalid"); fl.querySelector(".error").textContent = msg; } }
    status.className = "notice err"; status.textContent = err.message; status.hidden = false;
  } finally { btn.disabled = false; }
});

$("me-signout").addEventListener("click", signOut);
whenSignedIn(render);
render();
