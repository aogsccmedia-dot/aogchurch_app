// Ticket money against the target: a card for the main admin, church admins and verified pastors only
// (the server checks this too). The main admin can change the target and send themselves this week's email.
import { api, esc, toast } from "./site.js";

const rand = (n) => "R" + String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const day = (iso) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Johannesburg" }).format(new Date(iso));

export async function mountTicketProgress(box) {
  if (!box) return;
  let d;
  try { d = await api("/api/leaders/ticket-progress"); } catch { box.hidden = true; return; }
  if (!d.events.length) { box.hidden = true; return; }
  const card = (e) => {
    const pct = e.percent ?? 0, left = e.target ? Math.max(0, e.target - e.money) : 0, need = e.target && e.price ? Math.ceil(left / e.price) : 0;
    return `<article class="tp-card" data-tp="${esc(e.id)}">
      <header><div><p class="tp-eye">Ticket money · leaders only</p><h3>${esc(e.title)}</h3><span class="tp-sub">${esc(day(e.starts_at))} · R${esc(e.price)} a ticket</span></div>
        ${e.target ? `<b class="tp-pct">${pct}%</b>` : ""}</header>
      ${e.target ? `<div class="tp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Progress to target"><i style="width:${Math.max(pct, pct ? 1.5 : 0)}%"></i></div>` : ""}
      <div class="tp-nums">
        <span><b>${rand(e.money)}</b>${e.target ? ` of ${rand(e.target)}` : " so far"}</span>
        <span><b>${e.tickets}</b> tickets sold</span>
        <span><b>+${rand(e.week_money)}</b> this week (${e.week_tickets} tickets)</span>
        ${e.pending_tickets ? `<span>${e.pending_tickets} waiting for approval (${rand(e.pending_money)})</span>` : ""}
      </div>
      ${e.target ? `<p class="tp-left">${left > 0 ? `Still to go: <b>${rand(left)}</b>, about <b>${need}</b> more tickets.` : "Target reached. Praise God! 🎉"}</p>` : ""}
      ${d.can_set ? `<form class="tp-set" data-tp-set><label>Target (R)<input class="input" name="target" type="number" min="0" step="500" inputmode="numeric" value="${e.target ?? ""}" placeholder="e.g. 80000"></label><button class="btn btn-sm" type="submit">Save target</button></form>` : ""}
    </article>`;
  };
  box.innerHTML = d.events.map(card).join("") + (d.can_set ? `<p class="tp-foot">Every Sunday evening this goes by email to you, church admins and verified pastors only. <button type="button" class="link-btn" data-tp-test>Send me this week's email now</button></p>` : `<p class="tp-foot">Only church admins and pastors see this. A summary comes by email every Sunday evening.</p>`);
  box.hidden = false;
  box.onsubmit = async (e) => {
    const f = e.target.closest("[data-tp-set]"); if (!f) return; e.preventDefault();
    try { await api(`/api/leaders/ticket-progress/${f.closest("[data-tp]").dataset.tp}`, { method: "PUT", body: { target: f.target.value } }); toast("Target saved."); mountTicketProgress(box); } catch (err) { toast(err.message); }
  };
  box.onclick = async (e) => {
    if (!e.target.closest("[data-tp-test]")) return;
    try { const r = await api("/api/leaders/ticket-progress/test", { method: "POST" }); toast(r.sent ? "Sent to your inbox." : "Nothing to send yet."); } catch (err) { toast(err.message); }
  };
}
