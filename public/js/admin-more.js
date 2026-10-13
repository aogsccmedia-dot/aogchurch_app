// Admin: Approvals (every payment waiting, one tap each), Friday services and member Voting.
export function initMore(ctx) {
  const { api, $, $$, esc, toast, safe, loaders, detailRoutes, showView, icon } = ctx;
  const TZ = "Africa/Johannesburg";
  const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const rand = (n) => "R" + Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }).replace(/,/g, " ");
  const dayLabel = (d) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
  const longDay = (iso) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(iso));

  // ------------------------------------------------------------ Approvals
  let approvals = [];
  let apScope = "all";
  async function loadApprovals(focusId) {
    const r = await api("/api/admin/approvals");
    approvals = r.approvals; apScope = r.scope || "all";
    drawApprovals(focusId);
  }
  function drawApprovals(focusId) {
    const list = $("#ap-list");
    const note = apScope === "youth" ? `<p class="muted ap-scope">Showing tickets for youth events.</p>` : "";
    if (!approvals.length) { list.innerHTML = note + `<div class="empty">${icon("check")} All caught up. Nobody is waiting.</div>`; badge(); return; }
    const events = [...new Map(approvals.map((r) => [r.event_id, r.event_title])).entries()];
    list.innerHTML = note + `<div class="ap-events">${events.map(([id, t]) => `<button class="btn btn-sm" data-notify="${esc(id)}" data-title="${esc(t)}">${icon("mail")} Tell ${esc(t)} ticket holders about a change</button>`).join("")}</div>` + approvals.map((r) => {
      const img = r.pop_type && r.pop_type.startsWith("image/");
      return `<article class="ap-card${r.id === focusId ? " focus" : ""}" data-id="${esc(r.id)}">
        <a class="ap-proof" href="/api/admin/files/${esc(r.pop_attachment_id || "")}" target="_blank" rel="noopener" ${r.pop_attachment_id ? "" : "hidden"}>
          ${img ? `<img src="/api/admin/files/${esc(r.pop_attachment_id)}" alt="Proof of payment" loading="lazy">` : `<span>${icon("file")}<b>Open proof</b></span>`}</a>
        <div class="ap-body">
          <b class="ap-name">${esc(r.name)}</b>
          <span class="ap-event">${esc(r.event_title)} · ${longDay(r.starts_at)}</span>
          <span class="ap-meta">${1 + Number(r.guests || 0)} ticket${r.guests ? "s" : ""}${r.amount_due ? ` · <b>${rand(r.amount_due)}</b>` : ""} · Ref ${esc(r.ref_code)} · ${ago(r.created_at)}</span>
          <span class="ap-meta">${esc(r.email)}${r.phone ? ` · ${esc(r.phone)}` : ""}</span>
        </div>
        <div class="ap-actions"><button class="btn btn-gold ap-yes" data-yes>${icon("check")} Approve</button><button class="btn ap-no" data-no>Decline</button></div>
      </article>`;
    }).join("");
    badge();
    if (focusId) list.querySelector(".focus")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const badge = () => $$('[data-count="pending_payments"]').forEach((b) => { b.textContent = approvals.length || ""; });
  async function decide(card, status) {
    const id = card.dataset.id, r = approvals.find((x) => x.id === id); if (!r) return;
    let note = null;
    if (status === "rejected") { note = prompt(`Why are you declining ${r.name.split(" ")[0]}? (They'll see this.)`, "The amount didn't match"); if (note === null) return; }
    // Instant: the card leaves the list as you tap. If saving fails, it comes back.
    card.classList.add(status === "confirmed" ? "leaving-yes" : "leaving-no");
    const idx = approvals.indexOf(r);
    setTimeout(() => { approvals = approvals.filter((x) => x.id !== id); drawApprovals(); }, 260);
    try {
      await api(`/api/admin/registrations/${id}`, { method: "PATCH", body: { status, note } });
      toast(status === "confirmed" ? `${r.name.split(" ")[0]} approved · ticket on its way` : `${r.name.split(" ")[0]} declined · they'll be emailed`);
    } catch (e) { approvals.splice(idx, 0, r); drawApprovals(); toast(e.message || "Couldn't save. Try again."); }
  }
  $("#ap-list").addEventListener("click", (e) => {
    const n = e.target.closest("[data-notify]"); if (n) return notifyHolders(n.dataset.notify, n.dataset.title);
    const card = e.target.closest(".ap-card"); if (!card) return;
    if (e.target.closest("[data-yes]")) decide(card, "confirmed");
    if (e.target.closest("[data-no]")) decide(card, "rejected");
  });
  $("#ap-refresh").addEventListener("click", () => safe(loadApprovals)());
  loaders.approvals = () => loadApprovals();
  detailRoutes.approvals = (id) => { showView("approvals", "approvals", "approvals"); $$("[data-go-tab]").forEach((b) => b.classList.remove("active")); return safe(loadApprovals)(id); };

  // ------------------------------------------------------------ Fridays
  let fr = null, openDate = null;
  async function loadFridays() {
    fr = await api("/api/admin/fridays");
    const t = fr.totals;
    $("#fr-kpis").innerHTML = [
      [t.held, "Fridays captured", t.missing ? `${t.missing} still to capture` : "All up to date"],
      [t.average, "Average attendance", `Best night: ${t.best}`],
      [t.attendance, "People in total", `${t.first_timers} first-timers`],
      [rand(t.money), "Money in", "Final amounts, all Fridays"],
    ].map(([v, l, n]) => `<div class="kpi"><b>${esc(String(v))}</b><span>${esc(l)}</span><small>${esc(n)}</small></div>`).join("");
    const held = fr.fridays.filter((f) => f.status === "captured").slice().reverse();
    const max = Math.max(1, ...held.map((f) => f.attendance || 0));
    $("#fr-chart").hidden = held.length < 2;
    $("#fr-chart").innerHTML = `<h3>Attendance by Friday</h3><div class="fr-bars">${held.slice(-16).map((f) => `<div class="fr-bar" title="${dayLabel(f.date)}: ${f.attendance}"><i style="height:${Math.round((f.attendance / max) * 100)}%"></i><span>${dayLabel(f.date).replace(/^\w+ /, "")}</span><b>${f.attendance}</b></div>`).join("")}</div>`;
    if (!openDate) openDate = fr.fridays.find((f) => f.status === "today" || f.status === "missing")?.date || null;
    drawFridays();
  }
  const ST = { captured: ["Captured", "member"], missing: ["Not captured", "new"], today: ["Tonight", "pending"], upcoming: ["Coming up", ""], cancelled: ["No service", ""] };
  function drawFridays() {
    $("#fr-list").innerHTML = fr.fridays.map((f) => {
      const [label, cls] = ST[f.status];
      const open = f.date === openDate && f.status !== "upcoming";
      return `<article class="fr-row ${f.status}${open ? " open" : ""}" data-date="${f.date}">
        <button class="fr-head" type="button" ${f.status === "upcoming" ? "disabled" : ""}>
          <span class="fr-date"><b>${dayLabel(f.date)}</b>${f.date === fr.from ? `<small>First Friday tracked</small>` : ""}</span>
          <span class="fr-nums">${f.status === "captured" ? `<span>${icon("users")} ${f.attendance}</span><span>${rand(f.amount)}</span>` : f.status === "cancelled" ? `<span class="muted">${esc(f.cancel_reason)}</span>` : f.status === "upcoming" ? `<span class="muted">Opens on the night</span>` : ""}</span>
          <span class="pill ${cls}">${label}</span></button>
        ${open ? `<form class="fr-form" novalidate>
          <div class="fr-grid">
            <label class="field"><span>People who came</span><input class="input big" name="attendance" type="number" inputmode="numeric" min="0" value="${f.attendance ?? ""}" required></label>
            <label class="field"><span>Final amount (R)</span><input class="input big" name="amount" inputmode="decimal" placeholder="0" value="${f.amount ?? ""}"></label>
            <label class="field"><span>First-timers</span><input class="input" name="first_timers" type="number" inputmode="numeric" min="0" value="${f.first_timers ?? ""}"></label>
            <label class="field"><span>Gave their lives to Christ</span><input class="input" name="salvations" type="number" inputmode="numeric" min="0" value="${f.salvations ?? ""}"></label>
          </div>
          <label class="field"><span>Notes</span><input class="input" name="notes" maxlength="1000" value="${esc(f.notes || "")}" placeholder="Anything worth remembering"></label>
          <label class="check"><input type="checkbox" name="cancelled" ${f.status === "cancelled" ? "checked" : ""}> No service this Friday</label>
          <label class="field" data-reason ${f.status === "cancelled" ? "" : "hidden"}><span>Why?</span><input class="input" name="cancel_reason" maxlength="200" value="${esc(f.cancel_reason || "")}" placeholder="e.g. Youth camp, public holiday"></label>
          <div class="row"><button class="btn btn-gold" type="submit">${f.status === "captured" ? "Save changes" : "Save Friday"}</button>${f.updated_by ? `<span class="muted">Last saved by ${esc(f.updated_by)}</span>` : ""}</div>
        </form>` : ""}
      </article>`;
    }).join("");
  }
  $("#fr-list").addEventListener("click", (e) => {
    const head = e.target.closest(".fr-head"); if (!head || head.disabled) return;
    const date = head.closest(".fr-row").dataset.date;
    openDate = openDate === date ? null : date; drawFridays();
    $(`.fr-row[data-date="${date}"] input[name="attendance"]`)?.focus();
  });
  $("#fr-list").addEventListener("change", (e) => { if (e.target.name === "cancelled") { const f = e.target.form; f.querySelector("[data-reason]").hidden = !e.target.checked; } });
  $("#fr-list").addEventListener("submit", safe(async (e) => {
    e.preventDefault();
    const f = e.target, date = f.closest(".fr-row").dataset.date;
    const body = { attendance: f.attendance.value, amount: f.amount.value, first_timers: f.first_timers.value, salvations: f.salvations.value, notes: f.notes.value, cancelled: f.cancelled.checked, cancel_reason: f.cancel_reason.value };
    await api(`/api/admin/fridays/${date}`, { method: "PUT", body });
    toast(`${dayLabel(date)} saved 🙌`);
    openDate = null; await loadFridays();
  }));
  loaders.fridays = loadFridays;

  // ------------------------------------------------------------ Voting (elections: roles, rounds, appointments)
  let vtTimer = null;
  const face = (p, size = 34) => p.picture ? `<img class="face" src="${esc(p.picture)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer" loading="lazy">`
    : `<span class="face" style="--h:${[...(p.name || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}">${esc((p.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase())}</span>`;
  const STATE = { open: ["Voting now", "member"], upcoming: ["Starts soon", "pending"], between: ["Between rounds", "pending"], complete: ["Finished", ""], cancelled: ["Cancelled", ""], draft: ["Draft", ""] };
  const sad = (iso) => dayLabel(new Date(Date.parse(iso) + 2 * 3600_000).toISOString().slice(0, 10));
  async function loadVotes() {
    const { polls } = await api("/api/admin/votes");
    $("#vt-list").innerHTML = polls.length ? polls.map((p) => {
      const [label, cls] = STATE[p.state] || [p.state, ""];
      return `<article class="card vote-card" data-id="${esc(p.id)}">
        <div class="vh"><div><b class="vote-title">${esc(p.title)}</b><div class="muted">${p.event_name ? `${esc(p.event_name)} · ` : ""}${p.rounds} round${p.rounds > 1 ? "s" : ""}: ${p.schedule.map((r) => `${sad(r.opens_at)}–${sad(r.closes_at)}`).join(", ")}</div></div>
          <span class="pill ${cls}">${label}${p.state === "open" || p.state === "between" ? ` · round ${p.round}` : ""}</span></div>
        ${p.state === "open" ? `<div class="statline"><b>${p.voters}</b> of ${p.eligible_voters} members have voted in this round (${p.eligible_voters ? Math.round((p.voters / p.eligible_voters) * 100) : 0}%)</div>` : ""}
        ${p.roles.map((role) => {
          const max = Math.max(1, ...role.results.map((r) => r.votes));
          return `<div class="vt-role-res"><b>${esc(role.name)}</b>${role.seats > 1 ? ` <span class="muted">(${role.seats} places)</span>` : ""}<div class="muted">${esc(role.description || "")}</div>
            ${role.appointed.length ? `<div class="vt-appointed">${icon("check")} Appointed: ${role.appointed.map((a) => `${face(a, 24)} ${esc(a.name)}`).join(", ")}</div>` : ""}
            <div class="race">${role.results.slice(0, 6).map((r, i) => `<div class="race-row" style="--w:${(r.votes / max) * 100}%;--i:${i}">${face(r)}<span class="race-name">${esc(r.name)}</span><span class="race-bar"><i></i></span><b>${r.votes}</b></div>`).join("") || `<p class="muted">${p.state === "upcoming" ? "Voting hasn't started." : "No votes yet."}</p>`}</div></div>`;
        }).join("")}
        <div class="row">
          ${p.state === "cancelled" ? `<button class="btn btn-sm" data-act="open">Restore</button>` : p.state !== "complete" ? `<button class="btn btn-sm" data-act="close">Cancel this vote</button>` : ""}
          <a class="btn btn-sm btn-ghost" href="/vote?p=${esc(p.id)}" target="_blank" rel="noopener">Members' view</a>
          <button class="btn btn-sm btn-ghost" data-act="delete">Delete</button></div>
      </article>`;
    }).join("") : `<div class="empty">No votes set up yet. Tap “Set up a vote” to fill roles for an event.</div>`;
    clearTimeout(vtTimer);
    if (polls.some((p) => p.state === "open") && document.body.dataset.view === "votes") vtTimer = setTimeout(() => safe(loadVotes)(), 8000);
  }
  loaders.votes = loadVotes;
  const VF = () => $("#vt-form");
  const roleRow = (r = {}) => `<div class="vt-role"><input class="input" data-r="name" maxlength="80" placeholder="Role, e.g. Youth chairperson" value="${esc(r.name || "")}">
    <input class="input" data-r="description" maxlength="300" placeholder="What it means, e.g. Leads the youth committee and Friday services" value="${esc(r.description || "")}">
    <select class="input" data-r="seats" aria-label="How many people">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n} ${n === 1 ? "person" : "people"}</option>`).join("")}</select>
    <button type="button" class="btn btn-sm btn-ghost" data-rm-role aria-label="Remove">×</button></div>`;
  function drawPlan() {
    const f = VF(); if (!f.first_day.value) { $("#vt-plan").textContent = ""; return; }
    const add = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const out = []; let d = f.first_day.value; const days = Number(f.round_days.value), gap = Number(f.gap_days.value);
    for (let r = 1; r <= Number(f.rounds.value); r++) { const end = add(d, days - 1); out.push(`Round ${r}: ${dayLabel(d)} – ${dayLabel(end)}`); d = add(end, gap + 1); }
    $("#vt-plan").innerHTML = `<b>Plan</b><br>${out.join("<br>")}<br><span class="muted">Members get a reminder to pray every two weeks until voting starts, and an email when each round opens.</span>`;
  }
  $("#vt-new").addEventListener("click", safe(async () => {
    const f = VF(); f.hidden = !f.hidden; if (f.hidden) return;
    $("#vt-roles").innerHTML = roleRow();
    const t = new Date(Date.now() + 2 * 3600_000 + 14 * 86400_000).toISOString().slice(0, 10);
    f.first_day.value ||= t; drawPlan(); f.title.focus();
    const el = await api("/api/admin/votes/eligible?years=5");
    $("#vt-eligible").innerHTML = `<b>${el.count}</b> of ${el.members} confirmed members can be chosen (saved for at least ${el.years} years, from their join form).${el.count ? `<div class="vt-elig">${el.eligible.slice(0, 24).map((m) => `<span class="chip-person">${face(m, 22)}${esc(m.name)}</span>`).join("")}${el.count > 24 ? ` <span class="muted">+${el.count - 24} more</span>` : ""}</div>` : ""}`;
  }));
  $("#vt-add-role").addEventListener("click", () => $("#vt-roles").insertAdjacentHTML("beforeend", roleRow()));
  $("#vt-roles").addEventListener("click", (e) => { const b = e.target.closest("[data-rm-role]"); if (b && $$(".vt-role").length > 1) b.closest(".vt-role").remove(); });
  ["first_day", "rounds", "round_days", "gap_days"].forEach((n) => VF()[n].addEventListener("change", drawPlan));
  $("#vt-cancel").addEventListener("click", () => { VF().hidden = true; });
  VF().addEventListener("submit", safe(async (e) => {
    e.preventDefault();
    const f = e.target;
    const roles = $$(".vt-role").map((row) => ({ name: row.querySelector('[data-r="name"]').value, description: row.querySelector('[data-r="description"]').value, seats: Number(row.querySelector('[data-r="seats"]').value) })).filter((r) => r.name.trim());
    await api("/api/admin/votes", { method: "POST", body: { title: f.title.value, event_name: f.event_name.value, description: f.description.value, first_day: f.first_day.value,
      rounds: Number(f.rounds.value), round_days: Number(f.round_days.value), gap_days: Number(f.gap_days.value), runoff: Number(f.runoff.value), roles } });
    toast("Vote set up. Members will be reminded to pray every two weeks until it starts."); f.reset(); f.hidden = true; loadVotes();
  }));
  $("#vt-list").addEventListener("click", safe(async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = b.closest("[data-id]").dataset.id, act = b.dataset.act;
    if (act === "delete") { if (!confirm("Delete this vote and all its ballots?")) return; await api(`/api/admin/votes/${id}`, { method: "DELETE" }); toast("Deleted"); }
    else if (act === "close") { if (!confirm("Cancel this vote? Members won't be able to vote.")) return; await api(`/api/admin/votes/${id}`, { method: "PATCH", body: { status: "closed" } }); }
    else if (act === "open") await api(`/api/admin/votes/${id}`, { method: "PATCH", body: { status: "open" } });
    loadVotes();
  }));


  // ------------------------------------------------------------ Tell ticket holders about a change
  function notifyHolders(eventId, title) {
    let dlg = document.getElementById("notify-dlg");
    dlg?.remove();
    dlg = document.createElement("dialog"); dlg.id = "notify-dlg"; dlg.className = "sheet";
    dlg.innerHTML = `<form class="form-grid notify-form" method="dialog">
      <h3>Tell ticket holders about a change</h3>
      <p class="muted">Everyone with a ticket for <b>${esc(title)}</b> (confirmed, awaiting approval and waitlist) gets this by email, with the event details.</p>
      <label class="field"><span>What changed?</span><textarea class="input" name="message" rows="4" maxlength="2000" required placeholder="e.g. We now start at 19:00. Doors open at 18:30."></textarea></label>
      <label class="check"><input type="checkbox" name="waitlist" checked> Include people on the waitlist</label>
      <div class="row"><button class="btn btn-gold" type="submit">${icon("mail")} Send email</button><button class="btn" type="button" data-x>Cancel</button></div></form>`;
    document.body.append(dlg);
    dlg.querySelector("[data-x]").addEventListener("click", () => dlg.close());
    dlg.querySelector("form").addEventListener("submit", safe(async (e) => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        const r = await api(`/api/admin/events/${encodeURIComponent(eventId)}/notify`, { method: "POST", body: { message: f.message.value, include_waitlist: f.waitlist.checked } });
        dlg.close(); toast(`Sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}`);
      } finally { btn.disabled = false; }
    }));
    dlg.showModal(); dlg.querySelector("textarea").focus();
  }

  // ------------------------------------------------------------ Ask SCC (main admin)
  async function loadAssistant() {
    const d = await api("/api/admin/assistant");
    const ai = (d.by_mode || []).find((m) => m.mode === "ai") || {}, rules = (d.by_mode || []).find((m) => m.mode === "rules") || {};
    const total = (ai.n || 0) + (rules.n || 0);
    const pct = (a, b) => b ? Math.round((a / b) * 100) + "%" : "—";
    $("#as-body").innerHTML = `
      <div class="card as-controls">
        <label class="toggle-row"><input type="checkbox" id="as-enabled" ${d.enabled ? "checked" : ""}> <b>Ask SCC is on</b></label>
        <div><b>AI answers reach</b> <span class="as-pct">${d.ai_pct}%</span> of members ${d.ai_ready ? "" : `<span class="pill">AI not connected: built-in answers only</span>`}
          <div class="seg as-steps">${d.steps.map((x) => `<button data-pct="${x}" class="${x === d.ai_pct ? "on" : ""}">${x}%</button>`).join("")}</div></div>
        <label class="toggle-row"><input type="checkbox" id="as-auto" ${d.auto ? "checked" : ""}> Widen automatically while healthy, roll back if answers fail (checked daily at 07:00)</label>
        ${d.last_change ? `<p class="muted">Last change: ${esc(d.last_change)}</p>` : ""}
        <p class="muted">Model: ${esc(d.models[0])} (fallback ${esc(d.models[1])}) · prompt ${esc(d.prompt_version)}</p>
      </div>
      <div class="kpis">
        <div class="kpi"><b>${total}</b><span>Questions (7 days)</span></div>
        <div class="kpi"><b>${d.last24?.people || 0}</b><span>People (24 h)</span></div>
        <div class="kpi"><b>${pct(ai.errors || 0, ai.n || 0)}</b><span>AI fallbacks</span></div>
        <div class="kpi"><b>${pct((ai.up || 0) + (rules.up || 0), (ai.up || 0) + (rules.up || 0) + (ai.down || 0) + (rules.down || 0))}</b><span>Helpful</span></div>
        <div class="kpi"><b>${ai.ms || rules.ms || 0} ms</b><span>Average answer time</span></div>
      </div>
      <div class="card"><h3>Which helpers people use</h3>${(d.by_agent || []).length ? d.by_agent.map((a) => `<div class="bar"><span>${esc(a.label)}</span><span class="track"><i style="width:${Math.round((a.n / Math.max(1, d.by_agent[0].n)) * 100)}%"></i></span><b>${a.n}</b></div>`).join("") : `<p class="muted">No questions yet.</p>`}</div>`;
    const save = (body) => api("/api/admin/assistant", { method: "PATCH", body }).then(() => { toast("Saved"); loadAssistant(); }).catch((e) => toast(e.message));
    $("#as-enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
    $("#as-auto").addEventListener("change", (e) => save({ auto: e.target.checked }));
    $$(".as-steps [data-pct]").forEach((b) => b.addEventListener("click", () => save({ ai_pct: Number(b.dataset.pct) })));
  }
  loaders.assistant = () => loadAssistant();
  $("#as-refresh").addEventListener("click", () => safe(loadAssistant)());

  return { loadApprovals, notifyHolders };
}
