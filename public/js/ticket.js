// /ticket?c=CODE: the digital ticket (QR to show at the door). When the church admin opens it
// (e.g. by scanning the QR with a phone camera) it becomes a check-in screen.
import { api, esc, toast } from "./site.js";
import { icon } from "./icons.js";

const root = document.getElementById("tk-root");
const code = (new URLSearchParams(location.search).get("c") || "").toUpperCase();
const STATE = { valid: ["Valid", "ok"], used: ["Already checked in", "warn"], void: ["Not valid", "bad"] };
const adminApi = (path, body) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-scc-admin": "1" }, body: JSON.stringify(body) })
  .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed"); return j; });

async function render(c) {
  let d;
  try { d = await api(`/api/tickets/${encodeURIComponent(c)}`); }
  catch (e) { root.innerHTML = `<div class="tk-card"><h1>Ticket not found</h1><p class="muted-text">${esc(e.message)}</p><a class="btn" href="/me">My profile</a></div>`; return; }
  const t = d.ticket, [label, cls] = STATE[t.state];
  if (d.admin_view) { renderAdmin(t, label, cls); return; }
  root.innerHTML = `<article class="tk-card">
      <header class="tk-band"><img src="/assets/logo-64.png" alt="" width="40" height="40"><div><b>AOG Sandton City Church</b><span>Admit one · Ticket ${t.seq} of ${t.quantity}</span></div></header>
      <div class="tk-body">
        <h1>${esc(t.event.title)}</h1>
        <p class="tk-when">${icon("calendar")} ${esc(t.event.when)}</p>
        ${t.event.location ? `<p class="tk-when">${icon("mapPin")} ${esc(t.event.location)}</p>` : ""}
        <div class="tk-qr ${t.state !== "valid" ? "dim" : ""}"><img src="/api/tickets/${esc(t.code)}/qr.svg" alt="Ticket QR code" width="260" height="260"></div>
        <p class="tk-code">${esc(t.code.replace(/(.{4})(?=.)/g, "$1 "))}</p>
        <p class="tk-state ${cls}">${label}${t.checked_in_at ? ` · ${new Date(t.checked_in_at).toLocaleString("en-ZA", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}` : ""}</p>
        <dl class="tk-meta"><div><dt>Holder</dt><dd>${esc(t.holder)}</dd></div><div><dt>Booking ref</dt><dd>${esc(t.ref)}</dd></div></dl>
        ${t.siblings.length > 1 ? `<nav class="tk-sibs" aria-label="Tickets in this booking">${t.siblings.map((s) => `<a href="/ticket?c=${esc(s.code)}" ${s.code === t.code ? 'aria-current="page"' : ""}>Ticket ${s.seq}</a>`).join("")}</nav>` : ""}
        <div class="tk-actions"><a class="btn btn-gold" href="/api/tickets/${esc(t.code)}/pdf${t.quantity > 1 ? "?all=1" : ""}" download>${icon("download")} ${t.quantity > 1 ? `Download all ${t.quantity} (PDF)` : "Download PDF"}</a><a class="btn" href="/event?e=${esc(t.event.slug)}">Event details</a></div>
        <p class="hint" style="text-align:center">Turn your screen brightness up at the door. Each ticket can be scanned once.</p>
      </div>
    </article>
    ${d.is_admin && !d.admin_view ? `<section class="tk-admin" id="tk-admin"><p class="eyebrow">Door check-in · admin</p><button class="btn btn-green tk-admit" type="button" ${t.state !== "valid" ? "disabled" : ""}>${icon("check")} Admit ${esc(t.holder)}</button><div id="tk-result"></div><a class="btn btn-ghost btn-sm" href="/admin/#scan">Open the scanner</a></section>` : ""}`;
  bindAdmit(t);
}
function bindAdmit(t) {
  root.querySelector(".tk-admit")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await adminApi("/api/admin/tickets/check-in", { code: t.code });
      const msg = { ok: ["Admitted ✓", "ok"], already_used: ["Already used!", "bad"], void: ["Not valid", "bad"], wrong_event: ["Different event", "bad"] }[r.result];
      document.getElementById("tk-result").innerHTML = `<div class="scan-result ${msg[1]}"><b>${msg[0]}</b><span>${esc(r.ticket.holder)} · ticket ${r.ticket.seq}/${r.ticket.quantity}${r.ticket.checked_in_at && r.result !== "ok" ? ` · first scanned ${new Date(r.ticket.checked_in_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}` : ""}</span></div>`;
      if (navigator.vibrate) navigator.vibrate(r.result === "ok" ? 60 : [80, 60, 80]);
    } catch (err) { toast(err.message); e.currentTarget.disabled = false; }
  });
}
// Admins (scanning someone else's ticket) only see a check-in card: no QR code, no PDF.
function renderAdmin(t, label, cls) {
  root.innerHTML = `<section class="tk-admin solo">
      <p class="eyebrow">Door check-in · admin</p>
      <h1>${esc(t.holder)}</h1>
      <p class="tk-when">${esc(t.event.title)} · ${esc(t.event.when)}</p>
      <dl class="tk-meta"><div><dt>Ticket</dt><dd>${t.seq} of ${t.quantity}</dd></div><div><dt>Booking ref</dt><dd>${esc(t.ref)}</dd></div></dl>
      <p class="tk-state ${cls}">${label}${t.checked_in_at ? ` · ${new Date(t.checked_in_at).toLocaleString("en-ZA", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}` : ""}</p>
      <button class="btn btn-green tk-admit" type="button" ${t.state !== "valid" ? "disabled" : ""}>${icon("check")} Admit ${esc(t.holder.split(" ")[0])}</button>
      <div id="tk-result"></div>
      <p class="hint">Tickets belong to their holder. Admins can check people in but can't open or download their tickets.</p>
      <a class="btn btn-ghost btn-sm" href="/admin/#scan">Open the scanner</a>
    </section>`;
  bindAdmit(t);
}
if (code) render(code); else root.innerHTML = `<div class="tk-card"><h1>No ticket selected</h1><p class="muted-text">Open the link from your confirmation email, or find your tickets on your profile.</p><a class="btn btn-gold" href="/me">My profile</a></div>`;
