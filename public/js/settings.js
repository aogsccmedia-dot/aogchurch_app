// Settings: account, my role (and asking for more access), emails, membership, complaints.
import { icon } from "./icons.js";
import { api, esc, toast } from "./site.js";
import { getMe, googleButton, signOut, whenSignedIn } from "./auth.js";
import { revokeFlow } from "./offboard.js";
import { helloOnce, renderTabs, roleName } from "./portal.js";
import { faceInner } from "./faces.js";

const $ = (id) => document.getElementById(id);
const day = (iso) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
let firstName = "friend", revoked = false;

function memberCard(m) {
  if (!m) return `<p class="muted-text">You haven't joined yet. <a href="/join" style="color:var(--gold-2)">Complete joining</a>.</p>`;
  if (m.status === "revoked") return `<div class="ms-card"><div class="row"><span>Membership</span><b>Revoked</b></div><div class="row"><span>Revoked on</span><b>${esc(day(m.revoked_at))}</b></div><div class="actions"><a class="btn btn-sm btn-gold" href="/join">Rejoin</a></div></div>`;
  const due = m.next_checkin_at && new Date(m.next_checkin_at) <= new Date(Date.now() + 30 * 864e5);
  return `<div class="ms-card">
    <div class="row"><span>Status</span><b>${m.status === "member" ? "Active" : "Being confirmed"} · ${esc(m.ref_code)}</b></div>
    <div class="row"><span>Member since</span><b>${esc(day(m.created_at))}</b></div>
    ${m.next_checkin_at ? `<div class="row"><span>Next check-in</span><b>${esc(day(m.next_checkin_at))}</b></div>` : ""}
    <div class="actions">${due ? `<button class="btn btn-sm btn-gold" type="button" data-ms-confirm>I'm still a member</button>` : ""}<button class="btn btn-sm btn-ghost danger" type="button" data-ms-revoke>Leave membership</button></div></div>`;
}

async function render() {
  const [me, d] = await Promise.all([getMe(true), api("/api/me").catch(() => null)]);
  $("st-loading")?.remove();
  if (!me.user || !d) { $("st-signin").hidden = false; googleButton($("st-google"), { text: "signin_with" }); return; }
  $("st-signin").hidden = true; $("st-view").hidden = false;
  renderTabs($("portal-tabs"), me, "/settings");
  helloOnce(me);
  const u = d.user;
  firstName = d.member?.preferred_name || d.member?.first_name || (u.name || "").split(" ")[0] || "friend";
  $("st-avatar").innerHTML = faceInner(u);
  $("st-name").textContent = u.name || u.email; $("st-email").textContent = u.email;
  $("st-letter").checked = !!d.subscribed; $("st-reminders").checked = d.service_reminders !== false; $("st-prayer").checked = d.prayer_weekly !== false;
  $("st-membership").hidden = !!me.admin_account;
  $("me-member").innerHTML = memberCard(d.member);
  loadComplaints(d.member);
  if (roleName(me)) loadRole(me);
}

// ---------- my role + request more access
async function loadRole(me) {
  $("st-role").hidden = false;
  const who = await api("/api/admin/whoami").catch(() => null);
  const role = roleName(me);
  $("st-role-line").textContent = me.admin_role === "super" ? "You're the main admin: you can do everything." : `You're ${me.admin_role === "youth" ? "a youth leader" : "an admin"}. Here's what you can open in your ${me.admin_role === "youth" ? "Youth leader" : "Admin"} tab:`;
  const labels = new Map((who?.all_perms || []).map(([k, l]) => [k, l]));
  const can = me.admin_role === "super" ? [] : (who?.perms || []).map((k) => labels.get(k) || k);
  $("st-can").innerHTML = can.map((c) => `<li>${icon("check")} ${esc(c)}</li>`).join("");
  if (me.admin_role === "super") { $("st-ask").hidden = true; return; }
  const r = await api("/api/admin/access-requests").catch(() => ({ requests: [], options: [] }));
  const have = new Set(who?.perms || []);
  $("st-ask-options").innerHTML = (r.options || []).filter((o) => !have.has(o.key)).map((o) => `<label class="check"><input type="checkbox" name="wants" value="${esc(o.key)}"> ${esc(o.label)}</label>`).join("") || `<p class="muted-text">You already have everything.</p>`;
  const pending = (r.requests || []).find((x) => x.status === "pending");
  $("st-requests").innerHTML = (r.requests || []).slice(0, 3).map((x) => `<p class="st-req ${esc(x.status)}"><b>${x.status === "pending" ? "Waiting for the main admin" : x.status === "approved" ? "Approved" : "Not approved"}</b> · ${esc(x.wants.map((k) => (r.options.find((o) => o.key === k) || {}).label || k).join(", "))}</p>`).join("");
  $("st-ask").hidden = !!pending;
}
$("st-ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const wants = [...e.target.querySelectorAll("[name=wants]:checked")].map((x) => x.value);
  if (!wants.length) return toast("Tick what you'd like access to.");
  const btn = e.target.querySelector("[type=submit]"); btn.disabled = true;
  try { await api("/api/admin/access-requests", { method: "POST", body: { wants, note: e.target.note.value } }); toast("Sent. The main admin will reply by email."); e.target.reset(); render(); }
  catch (err) { toast(err.message); } finally { btn.disabled = false; }
});

// ---------- email toggles (instant, the server follows)
const toggle = (id, fn, on, off) => $(id).addEventListener("change", async (e) => {
  const v = e.target.checked; toast(v ? on : off);
  try { await fn(v); } catch (err) { e.target.checked = !v; toast(err.message); }
});
toggle("st-letter", (v) => api("/api/me/letter", { method: "POST", body: { subscribed: v } }), "Weekly letter on 💛", "Weekly letter off");
toggle("st-reminders", (v) => api("/api/me/reminders", { method: "PATCH", body: { on: v } }), "Service reminders on", "Service reminders off");
toggle("st-prayer", (v) => api("/api/me/prayer-weekly", { method: "PATCH", body: { on: v } }), "Weekly prayer list on 🙏", "Weekly prayer list off");

// ---------- membership
$("me-member").addEventListener("click", async (e) => {
  if (e.target.closest("[data-ms-confirm]")) { try { await api("/api/me/membership/confirm", { method: "POST" }); toast("Thank you! Your membership is confirmed 💛"); render(); } catch (err) { toast(err.message); } }
  if (e.target.closest("[data-ms-revoke]")) openOffboarding();
});
function openOffboarding() {
  let dlg = $("offboard");
  if (!dlg) {
    dlg = document.createElement("dialog"); dlg.id = "offboard"; dlg.className = "sheet ob-sheet"; dlg.setAttribute("aria-label", "Leave membership");
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

// ---------- complaints (approved members)
const CMP_LABEL = { received: "Received", in_review: "Being looked into", resolved: "Resolved", closed: "Closed" };
async function loadComplaints(member) {
  const box = $("complaints");
  if (!member || member.status === "revoked") { box.hidden = true; return; }
  box.hidden = false;
  const { eligible, complaints } = await api("/api/me/complaints").catch(() => ({ eligible: false, complaints: [] }));
  $("cmp-eligible").hidden = !eligible; $("cmp-not-eligible").hidden = eligible;
  $("cmp-mine").innerHTML = complaints.length ? `<p class="eyebrow">My complaints</p>` + complaints.map((c) => `<article class="cmp-item">
      <div class="cmp-top"><b>${esc(c.subject)}</b><span class="tag">${esc(CMP_LABEL[c.status] || c.status)}</span></div>
      <p class="muted-text" style="font-size:13px">${esc(c.ref_code)} · raised ${esc(day(c.created_at))}</p>
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

$("st-signout").addEventListener("click", signOut);
whenSignedIn(render);
render();
