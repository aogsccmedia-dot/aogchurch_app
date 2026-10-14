// Admin: the Call Office (check-ups on brethren + evangelism follow-up + discipleship sign-ups) and Analytics (main admin).
export function initExtra(ctx) {
  const { api, $, esc, toast, safe, loaders, icon, fmtDate } = ctx;
  const tel = (n) => `tel:${String(n || "").replace(/[^\d+]/g, "")}`;
  const wa = (n) => `https://wa.me/${String(n || "").replace(/\D/g, "").replace(/^0/, "27")}`;
  const ago = (iso) => { if (!iso) return "never"; const d = Math.round((Date.now() - Date.parse(iso)) / 86400000); return d < 1 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : fmtDate(iso); };

  // ------------------------------------------------------------ Call Office
  let callTab = "contacts", calls = null;
  const C_STATUS = [["no_answer", "No answer"], ["called", "Spoke to them"], ["connected", "Connected to church"], ["closed", "Close"]];
  const OUT = [["spoke", "Spoke"], ["no_answer", "No answer"], ["message", "Left a message"], ["needs_help", "Needs help"]];
  async function loadCalls() {
    calls = await api("/api/admin/calls");
    const nNew = calls.contacts.filter((c) => c.status === "new").length;
    $("#co-tabs").innerHTML = [["contacts", `Evangelism follow-up${nNew ? ` <span class="badge">${nNew}</span>` : ""}`], ["brethren", "Check on brethren"], ["classes", `Discipleship${calls.classes.length ? ` <span class="badge">${calls.classes.length}</span>` : ""}`]]
      .map(([k, l]) => `<button type="button" data-co="${k}" class="${k === callTab ? "on" : ""}">${l}</button>`).join("");
    $("#co-sum").innerHTML = `<span><b>${calls.contacts.length}</b> to follow up</span><span><b>${calls.calls_this_week}</b> check-up calls this week</span><span><b>${calls.classes.length}</b> waiting for a class</span>`;
    drawCalls();
  }
  function drawCalls() {
    const box = $("#co-list");
    if (callTab === "contacts") {
      box.innerHTML = calls.contacts.length ? calls.contacts.map((c) => `<article class="co-card ${esc(c.status)}" data-ct="${esc(c.id)}">
        <div class="co-top"><b>${esc(c.name)}</b><span class="pill">${esc(calls.labels[c.decision] || c.decision)}</span><span class="muted">${c.source === "web" ? "From the website" : `Met by ${esc(c.brought_by_name || "the team")}`}${c.area ? ` · ${esc(c.area)}` : ""} · ${ago(c.created_at)}</span></div>
        ${c.notes ? `<p class="co-note">“${esc(c.notes)}”</p>` : ""}${c.last_note ? `<p class="muted">Last call: ${esc(c.last_note)}</p>` : ""}
        <div class="co-act">${c.phone ? `<a class="btn btn-sm btn-gold" href="${tel(c.phone)}">${icon("smartphone")} Call ${esc(c.phone)}</a><a class="btn btn-sm" href="${wa(c.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}${c.email ? `<a class="btn btn-sm" href="mailto:${esc(c.email)}">${icon("mail")} Email</a>` : ""}</div>
        <div class="co-log"><input class="input" placeholder="How did it go? (optional)" data-note maxlength="1000">${C_STATUS.map(([k, l]) => `<button type="button" class="btn btn-sm" data-cs="${k}">${l}</button>`).join("")}</div></article>`).join("")
        : `<div class="empty">${icon("check")} Everyone has been followed up. 🙏</div>`;
    } else if (callTab === "brethren") {
      box.innerHTML = `<p class="muted">Longest since a check-up call first.</p>` + calls.brethren.map((m) => `<article class="co-card" data-mb="${esc(m.id)}">
        <div class="co-top"><b>${esc(`${m.first || ""} ${m.last || ""}`.trim())}</b><span class="muted">${m.ref_code ? esc(m.ref_code) + " · " : ""}last call ${ago(m.last_call)}${m.last_outcome ? ` (${esc(m.last_outcome.replace("_", " "))})` : ""}</span></div>
        <div class="co-act">${m.phone ? `<a class="btn btn-sm btn-gold" href="${tel(m.phone)}">${icon("smartphone")} Call</a><a class="btn btn-sm" href="${wa(m.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : `<span class="muted">No number</span>`}</div>
        <div class="co-log"><input class="input" placeholder="Note (optional)" data-note maxlength="1000">${OUT.map(([k, l]) => `<button type="button" class="btn btn-sm" data-out="${k}">${l}</button>`).join("")}</div></article>`).join("");
    } else {
      box.innerHTML = calls.classes.length ? calls.classes.map((c) => `<article class="co-card" data-cl="${esc(c.id)}">
        <div class="co-top"><b>${esc(c.name)}</b><span class="pill">${esc(c.track)}</span><span class="muted">${esc(c.status)} · ${ago(c.created_at)}</span></div>${c.note ? `<p class="co-note">“${esc(c.note)}”</p>` : ""}
        <div class="co-act">${c.phone ? `<a class="btn btn-sm" href="${tel(c.phone)}">${icon("smartphone")} ${esc(c.phone)}</a>` : ""}${c.email ? `<a class="btn btn-sm" href="mailto:${esc(c.email)}">${icon("mail")} ${esc(c.email)}</a>` : ""}
          <button type="button" class="btn btn-sm btn-gold" data-cls="placed">Placed in a class</button><button type="button" class="btn btn-sm" data-cls="done">Finished</button></div></article>`).join("")
        : `<div class="empty">Nobody waiting for a class.</div>`;
    }
  }
  $("#co-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-co]"); if (!b) return; callTab = b.dataset.co; $("#co-tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); drawCalls(); });
  $("#co-list").addEventListener("click", safe(async (e) => {
    const card = e.target.closest(".co-card"); if (!card) return;
    const note = card.querySelector("[data-note]")?.value || "";
    const cs = e.target.closest("[data-cs]"), out = e.target.closest("[data-out]"), cls = e.target.closest("[data-cls]");
    if (cs) { await api(`/api/admin/calls/contacts/${card.dataset.ct}`, { method: "PATCH", body: { status: cs.dataset.cs, note } }); toast("Saved 🙏"); }
    else if (out) { await api(`/api/admin/calls/members/${card.dataset.mb}`, { method: "POST", body: { outcome: out.dataset.out, note } }); toast("Call logged 🙏"); }
    else if (cls) { await api(`/api/admin/calls/classes/${card.dataset.cl}`, { method: "PATCH", body: { status: cls.dataset.cls } }); toast("Saved"); }
    else return;
    card.style.opacity = ".45"; setTimeout(loadCalls, 350);
  }));
  loaders.calls = loadCalls;

  // ------------------------------------------------------------ Analytics (main admin)
  let days = 30;
  const n = (v) => Number(v || 0).toLocaleString("en-ZA").replace(/,/g, " ");
  const chg = (v) => v == null ? "" : `<em class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${Math.abs(v)}%</em>`;
  const COLORS = ["#8f80d8", "#f2a9c9", "#f3c76e", "#9fe0d6", "#a9d4f5", "#f7c2a2", "#b9e4c9", "#c8b6f5"];
  const bars = (rows, label = (r) => r.k) => {
    if (!rows?.length) return `<p class="muted">No data yet.</p>`;
    const max = Math.max(...rows.map((r) => r.n));
    return `<div class="an-bars">${rows.map((r, i) => `<div class="an-bar"><span class="an-l" title="${esc(label(r))}">${esc(label(r))}</span><span class="an-track"><i style="width:${Math.max(3, (100 * r.n) / max)}%;background:${COLORS[i % COLORS.length]}"></i></span><b>${n(r.n)}</b></div>`).join("")}</div>`;
  };
  function chart(daily) {
    if (!daily.length) return `<p class="muted">No visits recorded yet. They'll appear here as people use the site.</p>`;
    const W = 720, H = 200, max = Math.max(1, ...daily.map((d) => d.views)), bw = W / daily.length;
    const y = (v) => H - 18 - (v / max) * (H - 36);
    const line = daily.map((d, i) => `${i ? "L" : "M"}${(i + .5) * bw},${y(d.visitors || d.users || 0)}`).join(" ");
    return `<svg class="an-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily page views">${daily.map((d, i) => `<rect x="${(i + .5) * bw - Math.min(bw * .35, 18)}" y="${y(d.views)}" width="${Math.min(bw * .7, 36)}" height="${H - 18 - y(d.views)}" rx="3" fill="#c8b6f5"><title>${d.day}: ${d.views} views, ${d.visitors} visitors</title></rect>`).join("")}
      <path d="${line}" fill="none" stroke="#e0567a" stroke-width="2.5" stroke-linejoin="round"/>
      ${daily.map((d, i) => (daily.length <= 14 || i % Math.ceil(daily.length / 10) === 0) ? `<text x="${(i + .5) * bw}" y="${H - 3}" text-anchor="middle">${d.day.slice(5)}</text>` : "").join("")}</svg>
      <p class="an-key"><i style="background:#c8b6f5"></i>Page views <i style="background:#e0567a"></i>Visitors</p>`;
  }
  function hours(h) {
    const byH = Object.fromEntries((h || []).map((x) => [Number(x.h), x.n])), max = Math.max(1, ...Object.values(byH));
    return `<div class="an-hours">${Array.from({ length: 24 }, (_, i) => `<span title="${i}:00 · ${byH[i] || 0} views" style="--o:${(byH[i] || 0) / max}"><i></i><small>${i % 3 ? "" : i}</small></span>`).join("")}</div>`;
  }
  function retention(rows) {
    if (!rows?.length) return `<p class="muted">Retention appears once people visit over a few weeks (only for visitors who allowed “remember on this device”, and everyone signed in).</p>`;
    return `<div class="an-ret-wrap"><table class="an-ret"><thead><tr><th>First week</th><th>People</th>${[1, 2, 3, 4, 5, 6, 7].map((w) => `<th>+${w}w</th>`).join("")}</tr></thead><tbody>
      ${rows.map((c) => `<tr><td>${esc(c.week)}</td><td>${c.size}</td>${[1, 2, 3, 4, 5, 6, 7].map((w) => { const p = c.size ? Math.round((100 * c.back[w]) / c.size) : 0; return `<td style="--p:${p / 100}">${c.back[w] ? p + "%" : ""}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  async function loadAnalytics() {
    const a = await api(`/api/admin/analytics?days=${days}`);
    const t = a.totals;
    $("#an-range").querySelectorAll("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.days) === days));
    $("#an-body").innerHTML = `
      <div class="an-kpis">
        <div class="an-kpi k1"><span>Visitors</span><b>${n(t.visitors)}</b>${chg(t.change?.visitors)}</div>
        <div class="an-kpi k2"><span>Page views</span><b>${n(t.views)}</b>${chg(t.change?.views)}</div>
        <div class="an-kpi k3"><span>Signed-in people</span><b>${n(t.users)}</b>${chg(t.change?.users)}</div>
        <div class="an-kpi k4"><span>Sessions</span><b>${n(t.sessions)}</b><em>${t.pages_per_session ?? "–"} pages each</em></div>
        <div class="an-kpi k5"><span>Taps & clicks</span><b>${n(t.clicks)}</b></div>
        <div class="an-kpi k6"><span>Came back</span><b>${t.returning_pct ?? "–"}%</b><em>returning visitors</em></div>
        <div class="an-kpi k7"><span>Left after 1 page</span><b>${t.bounce_pct ?? "–"}%</b><em>bounce rate</em></div>
        <div class="an-kpi k8"><span>Load time</span><b>${t.ms ? (t.ms / 1000).toFixed(2) + "s" : "–"}</b><em>${t.app_pct ?? 0}% in the installed app</em></div>
      </div>
      <div class="card"><h3>Every day</h3>${chart(a.daily)}</div>
      <div class="an-grid">
        <div class="card"><h3>Active people (signed in)</h3><div class="an-active"><div><b>${n(a.active?.dau)}</b><span>today</span></div><div><b>${n(a.active?.wau)}</b><span>this week</span></div><div><b>${n(a.active?.mau)}</b><span>this month</span></div></div>
          <div class="an-active growth"><div><b>${n(a.growth.accounts)}</b><span>new accounts</span></div><div><b>${n(a.growth.members)}</b><span>joined the church</span></div><div><b>${n(a.growth.tickets)}</b><span>tickets</span></div><div><b>${n(a.growth.notifications)}</b><span>phones with notifications</span></div></div></div>
        <div class="card"><h3>Busiest hours</h3>${hours(a.hours)}</div>
      </div>
      <div class="an-grid">
        <div class="card"><h3>Top pages</h3>${bars(a.pages)}</div>
        <div class="card"><h3>Where people come from</h3>${bars(a.sources)}</div>
        <div class="card"><h3>Countries</h3>${bars(a.countries)}</div>
        <div class="card"><h3>Cities</h3>${bars(a.cities)}</div>
        <div class="card"><h3>Devices</h3>${bars(a.devices)}</div>
        <div class="card"><h3>Browsers</h3>${bars(a.browsers)}</div>
        <div class="card"><h3>Phones & computers</h3>${bars(a.os)}</div>
        <div class="card"><h3>Most tapped</h3>${bars(a.clicks, (r) => `${r.k} · ${r.path}`)}</div>
      </div>
      <div class="card"><h3>Retention: do people come back?</h3><p class="muted">Each row is the week people first visited; the columns show how many came back in the weeks after.</p>${retention(a.retention)}</div>`;
  }
  $("#an-range").addEventListener("click", (e) => { const b = e.target.closest("[data-days]"); if (!b) return; days = Number(b.dataset.days); safe(loadAnalytics)(); });
  $("#an-push").addEventListener("click", safe(async () => { const r = await api("/api/admin/push/test", { method: "POST" }); toast(r.devices ? `Sent to ${r.sent} of ${r.devices} devices` : "No phones have notifications on yet."); }));
  loaders.analytics = loadAnalytics;
}
