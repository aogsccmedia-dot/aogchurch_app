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
  async function loadApprovals(focusId) {
    approvals = (await api("/api/admin/approvals")).approvals;
    drawApprovals(focusId);
  }
  function drawApprovals(focusId) {
    const list = $("#ap-list");
    if (!approvals.length) { list.innerHTML = `<div class="empty">${icon("check")} All caught up. Nobody is waiting.</div>`; badge(); return; }
    list.innerHTML = approvals.map((r) => {
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

  // ------------------------------------------------------------ Voting
  let chosen = [], mode = "list", vtTimer = null;
  const face = (p, size = 34) => p.picture ? `<img class="face" src="${esc(p.picture)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer" loading="lazy">`
    : `<span class="face" style="--h:${[...(p.name || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}">${esc((p.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase())}</span>`;
  const STATE = { open: ["Voting now", "member"], upcoming: ["Not open yet", "pending"], closed: ["Closed", ""], draft: ["Draft", ""] };
  async function loadVotes() {
    const { polls } = await api("/api/admin/votes");
    $("#vt-list").innerHTML = polls.length ? polls.map((p) => {
      const max = Math.max(1, ...p.results.map((r) => r.votes));
      const [label, cls] = STATE[p.state];
      return `<article class="card vote-card" data-id="${esc(p.id)}">
        <div class="vh"><div><b class="vote-title">${esc(p.title)}</b><div class="muted">${p.event_name ? `${esc(p.event_name)} · ` : ""}${dayLabel(p.opens_at.slice(0, 10))} – ${dayLabel(new Date(Date.parse(p.closes_at) + 2 * 3600_000).toISOString().slice(0, 10))} · ${p.candidates === "all" ? "any member" : `${p.candidate_count} people`}</div></div>
          <span class="pill ${cls}">${label}</span></div>
        <div class="statline"><b>${p.total}</b> vote${p.total === 1 ? "" : "s"} of ${p.eligible} members (${p.eligible ? Math.round((p.total / p.eligible) * 100) : 0}%)</div>
        <div class="race">${p.results.slice(0, 8).map((r, i) => `<div class="race-row" style="--w:${(r.votes / max) * 100}%;--i:${i}">${face(r)}<span class="race-name">${esc(r.name)}</span><span class="race-bar"><i></i></span><b>${r.votes}</b></div>`).join("") || `<p class="muted">No votes yet.</p>`}</div>
        <div class="row">
          ${p.state === "closed" ? `<button class="btn btn-sm" data-act="open">Reopen</button>` : `<button class="btn btn-sm" data-act="close">Close voting now</button>`}
          <button class="btn btn-sm" data-act="live">${p.show_live ? "Hide live results from members" : "Show live results to members"}</button>
          <a class="btn btn-sm btn-ghost" href="/vote?p=${esc(p.id)}" target="_blank" rel="noopener">Members' view</a>
          <button class="btn btn-sm btn-ghost" data-act="delete">Delete</button></div>
      </article>`;
    }).join("") : `<div class="empty">No votes yet. Tap “New vote” to set one up for an event.</div>`;
    clearTimeout(vtTimer);
    if (polls.some((p) => p.state === "open") && document.body.dataset.view === "votes") vtTimer = setTimeout(() => safe(loadVotes)(), 6000);
  }
  loaders.votes = loadVotes;
  const VF = () => $("#vt-form");
  $("#vt-new").addEventListener("click", () => {
    const f = VF(); f.hidden = !f.hidden; chosen = []; drawChosen();
    const today = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
    f.opens.value ||= today; f.closes.value ||= today; f.title.focus();
  });
  $("#vt-cancel").addEventListener("click", () => { VF().hidden = true; });
  $("#vt-mode").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b) return; mode = b.dataset.m; $$("#vt-mode button").forEach((x) => x.classList.toggle("on", x === b)); $("#vt-pick").hidden = mode === "all"; });
  let qT;
  $("#vt-q").addEventListener("input", (e) => { clearTimeout(qT); qT = setTimeout(safe(async () => {
    const q = e.target.value.trim(); if (!q) { $("#vt-results").innerHTML = ""; return; }
    const { members } = await api(`/api/admin/votes/members?q=${encodeURIComponent(q)}`);
    $("#vt-results").innerHTML = members.map((m) => `<button type="button" class="vt-person" data-id="${esc(m.id)}" data-name="${esc(m.name)}" data-pic="${esc(m.picture || "")}" ${chosen.some((c) => c.id === m.id) ? "disabled" : ""}>${face(m, 28)}<span>${esc(m.name)}</span>${icon("plus")}</button>`).join("") || `<p class="muted">No members found.</p>`;
  }), 220); });
  $("#vt-results").addEventListener("click", (e) => { const b = e.target.closest(".vt-person"); if (!b) return; chosen.push({ id: b.dataset.id, name: b.dataset.name, picture: b.dataset.pic || null }); b.disabled = true; drawChosen(); });
  $("#vt-chosen").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (!b) return; chosen = chosen.filter((c) => c.id !== b.dataset.rm); drawChosen(); });
  function drawChosen() { $("#vt-chosen").innerHTML = chosen.map((c) => `<span class="chip-person">${face(c, 24)}${esc(c.name)}<button type="button" data-rm="${esc(c.id)}" aria-label="Remove">×</button></span>`).join(""); }
  VF().addEventListener("submit", safe(async (e) => {
    e.preventDefault();
    const f = e.target;
    await api("/api/admin/votes", { method: "POST", body: { title: f.title.value, event_name: f.event_name.value, description: f.description.value, opens: f.opens.value, closes: f.closes.value, candidates: mode, member_ids: chosen.map((c) => c.id), show_live: f.show_live.checked } });
    toast("Voting is set up. Members will see it on their profile."); f.reset(); f.hidden = true; chosen = []; loadVotes();
  }));
  $("#vt-list").addEventListener("click", safe(async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const card = b.closest("[data-id]"), id = card.dataset.id, act = b.dataset.act;
    if (act === "delete") { if (!confirm("Delete this vote and all its votes?")) return; await api(`/api/admin/votes/${id}`, { method: "DELETE" }); toast("Deleted"); }
    else if (act === "close") await api(`/api/admin/votes/${id}`, { method: "PATCH", body: { status: "closed" } });
    else if (act === "open") await api(`/api/admin/votes/${id}`, { method: "PATCH", body: { status: "open", closes: new Date(Date.now() + 2 * 3600_000 + 86400_000).toISOString().slice(0, 10) } });
    else if (act === "live") await api(`/api/admin/votes/${id}`, { method: "PATCH", body: { show_live: b.textContent.startsWith("Show") } });
    loadVotes();
  }));

  return { loadApprovals };
}
