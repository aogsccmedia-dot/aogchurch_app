// Admin: event insights (per-event drill-in), the weekly services manager and the church board report.
// Wired in from admin.js with its helpers so it shares the same api(), toast() and routing.

export function initInsights(ctx) {
  const { api, $, $$, esc, toast, safe, loaders, detailRoutes, showView, fmtDate } = ctx;
  const R = (n) => R2(Math.round(Number(n || 0)));
  // Rands, formatted by hand so every browser shows "R10 536.20" the same way.
  const R2 = (n) => {
    const v = Math.round(Number(n || 0) * 100) / 100, abs = Math.abs(v), whole = Math.floor(abs), cents = Math.round((abs - whole) * 100);
    return (v < 0 ? "−R" : "R") + String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (cents ? "." + String(cents).padStart(2, "0") : "");
  };
  const num = (n) => String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const day = (iso) => new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso.slice(0, 10) + "T12:00:00Z"));
  const longDay = (iso) => new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }).format(new Date(iso));
  const plural = (n, one, many = one + "s") => `${num(n)} ${n === 1 ? one : many}`;
  let META = { groups: [], days: [], today: new Date().toISOString().slice(0, 10) };

  // ------------------------------------------------------------ shared: ministry group selects
  async function loadMeta() {
    META = await api("/api/admin/meta");
    $$("select[data-groups]").forEach((sel) => {
      const keep = sel.dataset.groupsAll ? `<option value="">${esc(sel.dataset.groupsAll)}</option>` : sel.querySelector('option[value=""]')?.outerHTML || "";
      const v = sel.value;
      sel.innerHTML = keep + META.groups.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("");
      if (v) sel.value = v;
    });
  }
  const groupOptions = (sel) => META.groups.map(([k, l]) => `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
  const kpi = (value, label, note = "") => `<div class="kpi"><b>${value}</b><span>${esc(label)}</span>${note ? `<small>${note}</small>` : ""}</div>`;
  const vbars = (pairs, fmt = (k) => k) => {
    if (!pairs.length) return `<p class="muted small">Nothing to show yet.</p>`;
    const max = Math.max(1, ...pairs.map(([, v]) => v));
    return `<div class="vb">${pairs.map(([k, v]) => `<div class="vb-col" title="${esc(fmt(k))}: ${v}"><span class="vb-val">${v}</span><i style="height:${Math.max(4, (v / max) * 100)}%"></i><span class="vb-lab">${esc(fmt(k))}</span></div>`).join("")}</div>`;
  };

  // ------------------------------------------------------------ insights: all events
  const periodRange = (p) => {
    const y = Number(META.today.slice(0, 4));
    if (p === "12m") { const d = new Date(META.today + "T12:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() - 1); return [d.toISOString().slice(0, 10), `${y + 1}-12-31`, "the last 12 months"]; }
    if (p === "last") return [`${y - 1}-01-01`, `${y - 1}-12-31`, String(y - 1)];
    if (p === "all") return ["2000-01-01", "2100-12-31", "all time"];
    return [`${y}-01-01`, `${y}-12-31`, String(y)];
  };
  let insEvents = [];
  loaders.insights = async () => {
    if (!META.groups.length) await loadMeta();
    const [from, to, label] = periodRange($("#ins-period").value);
    const { events } = await api(`/api/admin/insights/events?from=${from}&to=${to}`);
    insEvents = events;
    drawInsights(label);
  };
  function drawInsights(label) {
    const g = $("#ins-group").value;
    const list = insEvents.filter((e) => !g || e.group === g);
    const past = list.filter((e) => e.ended);
    const sold = list.reduce((t, e) => t + e.sold, 0), soldPast = past.reduce((t, e) => t + e.sold, 0), came = past.reduce((t, e) => t + e.came, 0);
    const income = list.reduce((t, e) => t + e.income, 0), pendingValue = list.reduce((t, e) => t + e.pending_value, 0);
    const byGroup = {};
    for (const e of list) { byGroup[e.group_label] ??= 0; byGroup[e.group_label] += e.income; }
    const ranked = Object.entries(byGroup).sort((a, b) => b[1] - a[1]);
    const top = ranked[0] && ranked[0][1] > 0 ? ranked[0][0] : null;
    $("#ins-story").innerHTML = list.length
      ? `In ${esc(label)}, ${plural(list.length, "event")} sold <b>${plural(sold, "ticket")}</b>.${soldPast ? ` For events that have already happened, <b>${num(came)} of ${num(soldPast)}</b> ticket holders came (${pct(came, soldPast)}%).` : ""} <b>${R(income)}</b> was collected${top && ranked.length > 1 ? `, most of it for ${esc(top)}` : ""}.${pendingValue ? ` ${R(pendingValue)} is still waiting for payment approval.` : ""}`
      : "No events in this period yet.";
    $("#ins-kpis").innerHTML = kpi(num(list.length), "Events") + kpi(num(sold), "Tickets sold") + kpi(soldPast ? `${pct(came, soldPast)}%` : "—", "Turn-up", soldPast ? `${num(came)} of ${num(soldPast)} came` : "after events happen") + kpi(R(income), "Money collected") + kpi(R(pendingValue), "Awaiting approval");
    const max = Math.max(1, ...ranked.map(([, v]) => v));
    $("#ins-groups").innerHTML = ranked.length ? ranked.map(([k, v]) => `<div class="hb"><span>${esc(k)}</span><span class="track"><i style="width:${(v / max) * 100}%"></i></span><b>${R(v)}</b></div>`).join("") : `<p class="muted small">No money recorded yet.</p>`;
    $("#ins-events").innerHTML = list.length ? list.map((e) => `<a class="ins-ev" href="#insight:${esc(e.id)}">
        <span class="ins-ev-main"><b>${esc(e.title)}</b><small>${esc(day(e.starts_at))} · ${esc(e.group_label)}${e.ended ? "" : " · upcoming"}</small></span>
        <span class="ins-ev-bar" aria-label="${e.came} of ${e.sold} came"><i style="width:${e.sold ? pct(e.came, e.sold) : 0}%"></i></span>
        <span class="ins-ev-num"><b>${num(e.came)}/${num(e.sold)}</b><small>came</small></span>
        <span class="ins-ev-num"><b>${R(e.income)}</b><small>${e.pending ? `${e.pending} to approve` : "collected"}</small></span></a>`).join("") : `<div class="empty">No events in this period.</div>`;
  }
  $("#ins-period").addEventListener("change", () => safe(loaders.insights)());
  $("#ins-group").addEventListener("change", () => drawInsights(periodRange($("#ins-period").value)[2]));

  // ------------------------------------------------------------ insights: one event
  let ii = null, iiFilter = "";
  detailRoutes.insight = safe(async (id) => {
    showView("insight", `insight:${id}`, "insights");
    if (!META.groups.length) await loadMeta();
    ii = await api(`/api/admin/insights/events/${id}`);
    iiFilter = "";
    drawInsight();
  });
  function drawInsight() {
    const e = ii.event;
    $("#ii-group").textContent = e.group_label;
    $("#ii-title").textContent = e.title;
    $("#ii-when").textContent = longDay(e.starts_at) + (e.ended ? "" : " · upcoming");
    $("#ii-regs").href = `#event:${e.id}`;
    $("#ii-csv").href = `/api/admin/events/${e.id}/registrations.csv`;
    $("#ii-story").innerHTML = e.ended
      ? `<b>${plural(e.sold, "ticket")}</b> sold across ${plural(e.bookings, "booking")}. <b>${num(e.came)}</b> ${e.came === 1 ? "person" : "people"} came (${pct(e.came, e.sold)}%)${e.no_shows ? ` and ${num(e.no_shows)} didn't make it` : ""}. <b>${R(e.income)}</b> collected${e.extra_income ? ` (${R(e.ticket_income)} tickets + ${R(e.extra_income)} other)` : ""}.`
      : `<b>${plural(e.sold, "ticket")}</b> sold so far across ${plural(e.bookings, "booking")}.${e.pending ? ` ${plural(e.pending, "booking")} (${R(e.pending_value)}) waiting for payment approval.` : ""}${e.waitlist ? ` ${num(e.waitlist)} on the waitlist.` : ""} ${e.came ? `${num(e.came)} already checked in.` : ""}`;
    $("#ii-kpis").innerHTML = kpi(num(e.sold), "Tickets sold", e.capacity ? `of ${num(e.capacity)} places` : "") + kpi(num(e.came), "Came", e.sold ? `${pct(e.came, e.sold)}% turn-up` : "")
      + kpi(e.ended ? num(e.no_shows) : "—", "Didn't come") + kpi(R(e.income), "Money collected") + kpi(num(e.pending), "Awaiting approval", e.pending ? R(e.pending_value) : "");
    const missed = Math.max(0, e.sold - e.came);
    $("#ii-came").innerHTML = `<div class="split"><i class="a" style="flex:${e.came || 0.0001}"></i><i class="b" style="flex:${missed || 0.0001}"></i></div>
      <div class="legend"><span><i class="a"></i>Came · ${num(e.came)}</span><span><i class="b"></i>${e.ended ? "Didn't come" : "Not yet"} · ${num(missed)}</span></div>
      ${ii.doors.length ? `<p class="muted small" style="margin-top:12px">Scanned by ${ii.doors.map(([w, c]) => `${esc(w)} (${c})`).join(", ")}</p>` : ""}`;
    $("#ii-money").innerHTML = `<dl class="kv tight"><dt>Tickets (approved)</dt><dd>${R(e.ticket_income)}</dd><dt>Other income</dt><dd>${R(e.extra_income)}${e.extra_income_note ? ` · ${esc(e.extra_income_note)}` : ""}</dd><dt><b>Total</b></dt><dd><b>${R(e.income)}</b></dd>${e.pending_value ? `<dt>Awaiting approval</dt><dd>${R(e.pending_value)}</dd>` : ""}</dl>`;
    const f = $("#ii-income"); f.extra_income.value = e.extra_income || ""; f.extra_income_note.value = e.extra_income_note || "";
    $("#ii-arrivals").innerHTML = vbars(ii.arrivals);
    $("#ii-signups").innerHTML = vbars(ii.signups.slice(-21), (d) => day(d).replace(/^\w+ /, ""));
    drawPeople();
  }
  function drawPeople() {
    $$("#ii-filter button").forEach((b) => b.classList.toggle("on", b.dataset.f === iiFilter));
    const rows = ii.registrations.filter((r) => !iiFilter || (iiFilter === "came" ? r.came > 0 : iiFilter === "missed" ? r.status === "confirmed" && !r.came : r.status === "pending"));
    const ST = { confirmed: ["Confirmed", "member"], pending: ["Awaiting approval", "pending"], waitlist: ["Waitlist", "new"], rejected: ["Declined", ""], cancelled: ["Cancelled", ""] };
    $("#ii-people").innerHTML = `<thead><tr><th>Person</th><th>Status</th><th>Came</th><th>Paid</th></tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>
      <td><b style="font-weight:450">${esc(r.name)}</b>${r.guests ? ` <span class="sub">+${r.guests}</span>` : ""}<div class="sub nowrap">${esc(r.ref_code)}</div></td>
      <td><span class="pill ${ST[r.status]?.[1] || ""}">${ST[r.status]?.[0] || esc(r.status)}</span></td>
      <td>${r.status === "confirmed" ? `${r.came}/${r.tickets || 1 + r.guests}${r.first_in ? ` <span class="sub">· ${new Date(r.first_in).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" })}</span>` : ""}` : `<span class="sub">—</span>`}</td>
      <td>${r.amount_due ? R(r.amount_due) : `<span class="sub">Free</span>`}</td></tr>`).join("") : `<tr><td colspan="4" class="sub" style="text-align:center;padding:24px">Nobody here.</td></tr>`}</tbody>`;
  }
  $("#ii-filter").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (!b || !ii) return; iiFilter = b.dataset.f; drawPeople(); });
  $("#ii-income").addEventListener("submit", safe(async (e) => {
    e.preventDefault();
    const body = { extra_income: e.target.extra_income.value, extra_income_note: e.target.extra_income_note.value };
    const amount = Math.round(Number(String(body.extra_income).replace(/[R\s,]/gi, "")) || 0);
    Object.assign(ii.event, { extra_income: amount, extra_income_note: body.extra_income_note, income: ii.event.ticket_income + amount });
    drawInsight();   // instant
    await api(`/api/admin/events/${ii.event.id}/income`, { method: "PATCH", body });
    toast("Saved");
  }));

  // ------------------------------------------------------------ weekly services
  let SVC = { services: [], today: "" }, SESS = [];
  const COUNTS = [["attendance", "Attendance"], ["first_time_visitors", "First-time visitors"], ["children", "Children"], ["volunteers", "Volunteers serving"]];
  const GROWTH = [["salvations", "Salvations"], ["rededications", "Rededications"], ["spirit_baptisms", "Holy Spirit baptisms"], ["water_baptisms", "Water baptisms"], ["testimonies", "Testimonies & healings"]];
  const MONEY = [["offering", "Offering"], ["tithes", "Tithes"], ["other_income", "Other income"]];
  const money = (s) => (Number(s.offering_cents || 0) + Number(s.tithes_cents || 0) + Number(s.other_income_cents || 0)) / 100;
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  loaders.services = async () => {
    if (!META.groups.length) await loadMeta();
    const [s, x] = await Promise.all([api("/api/admin/services"), api(`/api/admin/sessions?from=${addDays(META.today, -365)}&to=${addDays(META.today, 60)}`)]);
    SVC = s; SESS = x.sessions;
    const sel = $("#svc-filter"), v = sel.value;
    sel.innerHTML = `<option value="">All services</option>` + SVC.services.map((w) => `<option value="${esc(w.id)}">${esc(w.title)} · ${esc(w.day_label)}</option>`).join("");
    sel.value = v;
    drawServices();
  };
  function drawServices() {
    const since = addDays(SVC.today, -84);
    const recent = SESS.filter((s) => s.date >= since && s.date <= SVC.today);
    const withAtt = recent.filter((s) => s.attendance != null);
    const sum = (k) => recent.reduce((t, s) => t + Number(s[k] || 0), 0);
    $("#svc-kpis").innerHTML = kpi(num(recent.length), "Services recorded", "last 12 weeks") + kpi(num(sum("attendance")), "Total attendance", withAtt.length ? `about ${num(Math.round(sum("attendance") / withAtt.length))} per service` : "")
      + kpi(num(sum("first_time_visitors")), "First-time visitors") + kpi(num(sum("salvations")), "Salvations") + kpi(R2(recent.reduce((t, s) => t + money(s), 0)), "Offerings & tithes");
    const active = SVC.services.filter((w) => w.active);
    $("#svc-week").innerHTML = active.length ? active.map((w) => {
      const next = w.next_date, prev = w.dates[w.dates.indexOf(next) - 1];
      const sNext = SESS.find((s) => s.service_id === w.id && s.date === next), sPrev = prev && SESS.find((s) => s.service_id === w.id && s.date === prev);
      const isToday = next === SVC.today;
      return `<article class="svc-card">
        <header><span class="svc-day">${esc(w.day_label.slice(0, 3))}</span><span><b>${esc(w.title)}</b><small>${esc(w.time || "")}${w.time ? " · " : ""}${esc(w.group_label)}</small></span></header>
        ${w.reminders ? `<div class="svc-remind"><span>Email reminder ${w.start_time && w.start_time < "12:00" ? "the evening before" : "on the morning"}</span><button class="link-btn" type="button" data-remind="${esc(w.id)}">Send now</button></div>` : ""}
        <div class="svc-slot">${sNext ? `${sNext.poster_url ? `<img src="${esc(sNext.poster_url)}" alt="">` : ""}<span><em>${isToday ? "Today" : esc(day(next))}</em>${esc(sNext.topic)}</span><button class="btn btn-sm" data-edit-session="${esc(sNext.id)}">${isToday ? "Add results" : "Edit"}</button>`
          : `<span><em>${isToday ? "Today" : "Next · " + esc(day(next))}</em><span class="muted">No topic yet</span></span><button class="btn btn-sm btn-gold" data-new-session="${esc(w.id)}" data-date="${esc(next)}">Plan</button>`}</div>
        ${prev && !isToday ? (sPrev ? (sPrev.status === "cancelled" ? `<div class="svc-slot done"><span><em>Last · ${esc(day(prev))}</em><span class="muted">No service: ${esc(sPrev.cancel_reason || "")}</span></span><button class="btn btn-sm btn-ghost" data-edit-session="${esc(sPrev.id)}">Edit</button></div>` : sPrev.attendance == null ? `<div class="svc-slot due"><span><em>Last · ${esc(day(prev))}</em>${esc(sPrev.topic)}</span><button class="btn btn-sm btn-gold" data-edit-session="${esc(sPrev.id)}">Add results</button></div>`
          : `<div class="svc-slot done"><span><em>Last · ${esc(day(prev))}</em>${num(sPrev.attendance)} people${sPrev.salvations ? ` · ${num(sPrev.salvations)} saved` : ""}${money(sPrev) ? ` · ${R2(money(sPrev))}` : ""}</span><button class="btn btn-sm btn-ghost" data-edit-session="${esc(sPrev.id)}">View</button></div>`)
          : `<div class="svc-slot due"><span><em>Last · ${esc(day(prev))}</em><span class="muted">Not recorded</span></span><button class="btn btn-sm" data-new-session="${esc(w.id)}" data-date="${esc(prev)}">Record</button></div>`) : ""}
      </article>`;
    }).join("") : `<div class="empty">No weekly services yet. Tap “Edit services” to add them.</div>`;
    const f = $("#svc-filter").value;
    const list = SESS.filter((s) => !f || s.service_id === f);
    $("#svc-sessions").innerHTML = list.length ? list.map((s) => `<button class="item svc-rec" type="button" data-edit-session="${esc(s.id)}">
        ${s.poster_url ? `<img src="${esc(s.poster_url)}" alt="" loading="lazy">` : `<span class="ph"></span>`}
        <span class="svc-rec-main"><b>${esc(s.topic)}</b><small>${esc(day(s.date))} · ${esc(s.service_title)}${s.speaker ? ` · ${esc(s.speaker)}` : ""}</small></span>
        <span class="svc-rec-nums">${s.status === "cancelled" ? `<span class="pill">No service</span>` : s.attendance != null ? `<span><b>${num(s.attendance)}</b> came</span>` : s.date > SVC.today ? `<span class="pill new">Planned</span>` : `<span class="pill pending">Add results</span>`}${s.salvations ? `<span><b>${num(s.salvations)}</b> saved</span>` : ""}${money(s) ? `<span><b>${R2(money(s))}</b></span>` : ""}</span></button>`).join("")
      : `<div class="empty">No services recorded yet.</div>`;
  }
  $("#svc-filter").addEventListener("change", drawServices);
  $("#svc-new").addEventListener("click", () => openSession(null, SVC.services.find((w) => w.active)?.id, null));
  $("[data-view=services]").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remind]");
    if (rm) {
      const w = SVC.services.find((x) => x.id === rm.dataset.remind);
      if (!confirm(`Email the reminder for ${w.title} (${day(w.next_date)}) to everyone who gets service reminders now?`)) return;
      rm.textContent = "Sending…"; rm.disabled = true;
      api(`/api/admin/services/${w.id}/remind`, { method: "POST", body: {} })
        .then((r) => { toast(`Reminder going out to ${r.people} ${r.people === 1 ? "person" : "people"}`); rm.textContent = "Sent"; })
        .catch((err) => { toast(err.message); rm.textContent = "Send now"; rm.disabled = false; });
      return;
    }
    const n = e.target.closest("[data-new-session]"), ed = e.target.closest("[data-edit-session]");
    if (n) openSession(null, n.dataset.newSession, n.dataset.date);
    if (ed) openSession(SESS.find((s) => s.id === ed.dataset.editSession));
  });

  // The record form: service → date list fills in automatically from the service's weekday.
  function openSession(sess, serviceId, date) {
    const dlg = $("#session-drawer"), f = $("#session-form");
    const svcId = sess?.service_id || serviceId;
    const services = SVC.services.filter((w) => w.active || w.id === svcId);
    const val = (k) => esc(sess?.[k] ?? "");
    const moneyVal = (k) => (sess?.[k + "_cents"] != null ? String(sess[k + "_cents"] / 100) : "");
    f.innerHTML = `<header class="vh"><div><p class="eyebrow gold">${sess ? "Edit service record" : "Record a service"}</p><h2>${sess ? esc(sess.topic) : "Service details"}</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">✕</button></header>
      <p class="form-error" id="ss-error" hidden></p>
      <div class="card form-grid">
        <div class="grid-2">
          <div class="field"><label>Service <span class="req"></span></label><select class="input" name="service_id" ${sess ? "disabled" : ""}>${services.map((w) => `<option value="${esc(w.id)}" ${w.id === svcId ? "selected" : ""}>${esc(w.title)} · ${esc(w.day_label)}</option>`).join("")}</select></div>
          <div class="field"><label>Date <span class="req"></span></label><select class="input" name="date_pick"></select>
            <input class="input" type="date" name="date_other" hidden style="margin-top:8px">
            <label class="check" data-otherday hidden><input type="checkbox" name="other_day" value="1"> Held on a different day this time</label></div>
        </div>
        <label class="check no-svc"><input type="checkbox" name="cancelled" ${sess?.status === "cancelled" ? "checked" : ""}> No service this week</label>
        <div class="field" data-when-cancelled hidden><label>Why was there no service? <span class="req"></span></label><input class="input" name="cancel_reason" maxlength="200" value="${val("cancel_reason")}" placeholder="e.g. Easter weekend, Youth Quarterly, church prayer night"></div>
        <div class="field" data-when-held><label>Topic or theme <span class="req"></span></label><input class="input" name="topic" maxlength="200" required value="${val("topic")}" placeholder="e.g. Walking by faith"></div>
        <div class="grid-2" data-when-held><div class="field"><label>Speaker</label><input class="input" name="speaker" maxlength="120" value="${val("speaker")}" placeholder="Pastor …"></div>
          <div class="field"><label>MC</label><input class="input" name="mc" maxlength="120" value="${val("mc")}" placeholder="Who led the night"></div></div>
        <div class="field" data-when-held><label>Scripture</label><input class="input" name="scripture" maxlength="160" value="${val("scripture")}" placeholder="Hebrews 11:1–6"></div>
        <div class="field" data-when-held><label>Poster <span class="req"></span></label>
          <div class="poster-pick"><img alt="" ${sess?.poster_url ? `src="${esc(sess.poster_url)}"` : "hidden"}><label class="btn btn-sm"><input type="file" name="poster" accept="image/jpeg,image/png,image/webp" hidden>${sess?.poster_url ? "Change poster" : "Choose poster image"}</label></div>
          <small class="hint">JPG, PNG or WebP. Shown on the website for the coming week.</small></div>
        <div class="field" data-when-held><label>Summary</label><textarea class="input" name="summary" maxlength="3000" rows="3" placeholder="Key points from the message">${val("summary")}</textarea></div>
      </div>
      <details class="card" data-when-held ${sess && sess.date <= SVC.today ? "open" : ""}><summary><b>How it went</b> <span class="muted small">add after the service</span></summary>
        <h4 class="mini-h">Attendance</h4><div class="num-grid">${COUNTS.map(([k, l]) => `<label class="field"><span>${l}</span><input class="input" name="${k}" type="number" inputmode="numeric" min="0" step="1" value="${val(k)}"></label>`).join("")}</div>
        <h4 class="mini-h">Spiritual growth</h4><div class="num-grid">${GROWTH.map(([k, l]) => `<label class="field"><span>${l}</span><input class="input" name="${k}" type="number" inputmode="numeric" min="0" step="1" value="${val(k)}"></label>`).join("")}</div>
        <h4 class="mini-h">Money received (Rands)</h4><div class="num-grid">${MONEY.map(([k, l]) => `<label class="field"><span>${l}</span><input class="input" name="${k}" inputmode="decimal" placeholder="0.00" value="${esc(moneyVal(k))}"></label>`).join("")}</div>
        <div class="field"><label>Notes</label><textarea class="input" name="notes" maxlength="2000" rows="2">${val("notes")}</textarea></div>
      </details>
      <div class="sticky-actions">${sess ? `<button class="btn btn-sm" type="button" id="ss-delete">Delete</button>` : ""}<button class="btn" type="button" data-close>Cancel</button><button class="btn btn-gold" type="submit">Save</button></div>`;
    const pick = f.date_pick, other = f.date_other, svcSel = f.service_id;
    const fillDates = () => {
      const w = SVC.services.find((x) => x.id === svcSel.value); if (!w) return;
      const want = sess?.date || date || w.next_date;
      const dates = [...new Set([...w.dates, ...(want ? [want] : [])])].sort();
      pick.innerHTML = dates.map((d) => `<option value="${d}" ${d === want ? "selected" : ""}>${esc(day(d))}${d === SVC.today ? " (today)" : d === w.next_date ? " (next)" : d < SVC.today ? "" : ""}</option>`).join("") + `<option value="other">Another date…</option>`;
      other.hidden = true; $("[data-otherday]", f).hidden = true;
    };
    svcSel.addEventListener("change", fillDates); fillDates();
    pick.addEventListener("change", () => { const o = pick.value === "other"; other.hidden = !o; $("[data-otherday]", f).hidden = !o; if (o) other.focus(); });
    const syncCancelled = () => { const c = f.cancelled.checked; $$("[data-when-held]", f).forEach((el) => { el.hidden = c; }); $$("[data-when-cancelled]", f).forEach((el) => { el.hidden = !c; }); };
    f.cancelled.addEventListener("change", syncCancelled); syncCancelled();
    const file = f.poster, img = $(".poster-pick img", f);
    file.addEventListener("change", () => { const x = file.files[0]; if (x) { img.src = URL.createObjectURL(x); img.hidden = false; file.closest("label").lastChild.textContent = "Change poster"; } });
    f.onsubmit = (e) => { e.preventDefault(); saveSession(sess); };
    $("#ss-delete", f)?.addEventListener("click", async () => {
      if (!confirm("Delete this service record and its poster?")) return;
      dlg.close(); SESS = SESS.filter((s) => s.id !== sess.id); drawServices();
      api(`/api/admin/sessions/${sess.id}`, { method: "DELETE" }).then(() => toast("Deleted")).catch((err) => { toast(err.message); safe(loaders.services)(); });
    });
    dlg.showModal();
  }
  function saveSession(sess) {
    const dlg = $("#session-drawer"), f = $("#session-form"), err = $("#ss-error", f);
    const date = f.date_pick.value === "other" ? f.date_other.value : f.date_pick.value;
    const problems = [], noService = f.cancelled.checked;
    if (noService && !f.cancel_reason.value.trim()) problems.push("why there was no service");
    if (!noService && !f.topic.value.trim()) problems.push("the topic");
    if (!date) problems.push("the date");
    if (!noService && !sess && !f.poster.files.length) problems.push("the poster image");
    if (problems.length) { err.textContent = `Please add ${problems.join(", ")}.`; err.hidden = false; err.scrollIntoView({ block: "nearest" }); return; }
    const fd = new FormData(f);
    fd.set("date", date); fd.delete("date_pick"); fd.delete("date_other");
    if (sess) fd.set("service_id", sess.service_id);
    fd.set("status", noService ? "cancelled" : "held"); fd.delete("cancelled");
    if (!f.poster.files.length) fd.delete("poster");
    // Close straight away; the upload finishes in the background. If it fails, the form comes back as you left it.
    dlg.close();
    toast(sess ? "Saving…" : "Saving the service record…");
    api(sess ? `/api/admin/sessions/${sess.id}` : "/api/admin/sessions", { method: sess ? "PUT" : "POST", form: fd })
      .then(() => { toast("Saved"); safe(loaders.services)(); })
      .catch((e) => { err.textContent = e.message + (e.details ? " " + Object.values(e.details).join(" ") : ""); err.hidden = false; dlg.showModal(); });
  }

  // Manage the list of weekly services (day, time, group, how often).
  $("#svc-manage").addEventListener("click", () => openServices());
  function openServices() {
    const dlg = $("#services-drawer"), body = $("#services-body");
    const row = (w) => `<form class="svc-edit card" data-id="${esc(w?.id || "")}">
        <div class="svc-edit-grid">
          <label class="field"><span>Name</span><input class="input" name="title" required maxlength="120" value="${esc(w?.title || "")}" placeholder="e.g. Men's breakfast"></label>
          <label class="field"><span>Day</span><select class="input" name="day">${META.days.map((d, i) => `<option value="${i}" ${w && w.day === i ? "selected" : ""}>${d}</option>`).join("")}</select></label>
          <label class="field"><span>Starts</span><input class="input" type="time" name="start_time" value="${esc(w?.start_time || "")}"></label>
          <label class="field"><span>Ends</span><input class="input" type="time" name="end_time" value="${esc(w?.end_time || "")}"></label>
          <label class="field"><span>Ministry group</span><select class="input" name="ministry_group" required>${w ? "" : `<option value="">Choose…</option>`}${groupOptions(w?.ministry_group)}</select></label>
          <label class="field"><span>How often</span><select class="input" name="frequency">${[["weekly", "Every week"], ["twice_monthly", "Twice a month"], ["monthly", "Monthly"]].map(([k, l]) => `<option value="${k}" ${w?.frequency === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        </div>
        <div class="actions"><label class="check"><input type="checkbox" name="active" ${!w || w.active ? "checked" : ""}> Show on the website</label>
          <label class="check"><input type="checkbox" name="reminders" ${w?.reminders ? "checked" : ""}> Email reminders</label>
          ${w ? `<button class="btn btn-sm btn-ghost" type="button" data-remove>Remove</button>` : ""}<button class="btn btn-sm btn-gold" type="submit">${w ? "Save" : "Add service"}</button></div></form>`;
    body.innerHTML = `<header class="vh"><div><p class="eyebrow gold">Weekly services</p><h2>Edit services</h2><p class="muted small">Changes show on the website straight away. Dates for each service follow its day automatically.</p></div><button class="icon-btn" type="button" data-close aria-label="Close">✕</button></header>
      ${SVC.services.map(row).join("")}<h3 class="mini-h">Add a service</h3>${row(null)}`;
    body.onsubmit = safe(async (e) => {
      e.preventDefault();
      const fm = e.target, id = fm.dataset.id;
      const b = Object.fromEntries(new FormData(fm)); b.active = fm.active.checked; b.reminders = fm.reminders.checked; b.day = Number(b.day);
      await api(id ? `/api/admin/services/${id}` : "/api/admin/services", { method: id ? "PUT" : "POST", body: b });
      toast(id ? "Saved" : "Service added"); await loaders.services(); if (!id) openServices();
    });
    body.onclick = safe(async (e) => {
      if (e.target.closest("[data-close]")) return dlg.close();
      const rm = e.target.closest("[data-remove]"); if (!rm) return;
      const fm = rm.closest("form");
      if (!confirm(`Remove “${fm.title.value}”? Past records are kept for reports.`)) return;
      const r = await api(`/api/admin/services/${fm.dataset.id}`, { method: "DELETE" });
      toast(r.retired ? "Hidden from the website (records kept)" : "Removed"); fm.remove(); safe(loaders.services)();
    });
    if (!dlg.open) dlg.showModal();
  }

  // ------------------------------------------------------------ board report
  const quarterStart = (y, q) => `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
  const monthEnd = (y, m) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  function preset(p) {
    const [y, m] = META.today.split("-").map(Number), mi = m - 1, q = Math.floor(mi / 3);
    if (p === "month") return [`${y}-${String(m).padStart(2, "0")}-01`, META.today];
    if (p === "lastmonth") { const d = new Date(Date.UTC(y, mi - 1, 1)); return [d.toISOString().slice(0, 10), monthEnd(d.getUTCFullYear(), d.getUTCMonth())]; }
    if (p === "quarter") return [quarterStart(y, q), META.today];
    if (p === "lastquarter") { const yy = q === 0 ? y - 1 : y, qq = q === 0 ? 3 : q - 1; return [quarterStart(yy, qq), monthEnd(yy, qq * 3 + 2)]; }
    if (p === "year") return [`${y}-01-01`, META.today];
    return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  }
  loaders.report = async () => {
    if (!META.groups.length) await loadMeta();
    if (!$("#rep-from").value) { const [a, b] = preset("quarter"); $("#rep-from").value = a; $("#rep-to").value = b; }
    syncCsv();
    const ys = $("#mr-year");
    if (!ys.options.length) { const y = Number(META.today.slice(0, 4)); ys.innerHTML = [y, y - 1, y - 2].map((v) => `<option>${v}</option>`).join(""); }
    if (!$("#mr-group").dataset.init) { $("#mr-group").value = "youth"; $("#mr-group").dataset.init = "1"; }   // Youth by default
    if (!$("#rep-ministry").hidden) await ministryReport();
  };
  $("#rep-kind").addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]"); if (!b) return;
    $$("#rep-kind button").forEach((x) => x.classList.toggle("on", x === b));
    $("#rep-ministry").hidden = b.dataset.k !== "ministry"; $("#rep-board").hidden = b.dataset.k !== "board";
    if (b.dataset.k === "ministry") safe(ministryReport)();
  });
  ["mr-group", "mr-year"].forEach((id) => $("#" + id).addEventListener("change", () => safe(ministryReport)()));
  $("#mr-print").addEventListener("click", () => window.print());

  // ------------------------------------------------------------ ministry report (Youth by default), admins only
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const shortDay = (d) => new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
  async function ministryReport() {
    const doc = $("#ministry-doc");
    const group = $("#mr-group").value || "youth", year = $("#mr-year").value || META.today.slice(0, 4);
    doc.innerHTML = `<p class="muted">Preparing the report…</p>`;
    const { report: r } = await api(`/api/admin/reports/ministry?group=${encodeURIComponent(group)}&year=${year}`);
    const t = r.totals, sessionsHeld = r.sessions.filter((x) => x.status !== "cancelled");
    const fmtD = (d) => new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
    const label = r.group_label;
    const so = r.to.slice(0, 4) === META.today.slice(0, 4) ? "so far" : "";
    const leftCls = t.left >= 0 ? "pos" : "neg";
    const bars = sessionsHeld.filter((x) => x.attendance != null);
    const maxA = Math.max(1, ...bars.map((x) => x.attendance));
    const maxM = Math.max(1, ...r.months.map((m) => Math.max(m.offerings + m.other_in, m.out)));
    const reasons = r.sessions.filter((x) => x.status === "cancelled");
    const table = (head, rows, foot = "") => `<table class="rep-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${head.length}" class="muted">Nothing recorded yet.</td></tr>`}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ""}</table>`;
    doc.innerHTML = `
      <header class="rep-head"><img src="/assets/logo-192.png" alt="" width="56" height="56"><div><p>AOG Sandton City Church · ${esc(label)}</p><h1>${esc(label)} report ${esc(r.year)}${so ? " (so far)" : ""}</h1><span>${esc(fmtD(r.from))} to ${esc(fmtD(r.to))}</span></div><span class="rep-badge">Admins only · Confidential</span></header>

      <section><h2>At a glance</h2>
        <p class="rep-story">${t.held ? `${esc(label)} met <b>${plural(t.held, "time")}</b> this year${so ? " so far" : ""}${t.counted ? `, reaching <b>${num(t.attendance)} people</b> in total (about <b>${num(t.average)} a night</b>)` : ""}.` : `Nothing has been recorded for ${esc(label)} yet this year.`}
          ${r.best ? ` The biggest night was <b>${esc(r.best.topic)}</b> on ${esc(shortDay(r.best.date))} with ${num(r.best.attendance)} people.` : ""}
          ${t.offerings || t.out ? ` Offerings brought in <b>${R2(t.offerings)}</b>${t.other_in ? ` (plus ${R2(t.other_in)} other income)` : ""}, ${R2(t.out)} went out to monthlies, quarterlies and conventions, leaving <b class="${leftCls}">${R2(t.left)}</b> to spend.` : ""}
          ${t.cancelled ? ` On ${plural(t.cancelled, "Friday")} there was no service (church-wide events, holidays and other reasons, listed below).` : ""}</p>
        <div class="rep-kpis">${[[num(t.held), "Services held"], [num(t.attendance), "People reached"], [t.average != null ? num(t.average) : "—", "Average a night"], [r.best ? num(r.best.attendance) : "—", "Best night"],
          [R2(t.offerings + t.other_in), "Money in"], [R2(t.out), "Money out"], [`<span class="${leftCls}">${R2(t.left)}</span>`, "Left to spend"], [num(t.cancelled), "No-service Fridays"]].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>
      </section>

      <section><h2>Attendance, night by night</h2>
        ${bars.length ? `<div class="rep-bars" role="img" aria-label="Attendance per service">${bars.map((x) => `<div class="rb" title="${esc(x.topic)}: ${x.attendance}"><span class="rb-v">${x.attendance}</span><i style="height:${(x.attendance / maxA) * 100}%"></i><span class="rb-l">${esc(shortDay(x.date))}</span></div>`).join("")}</div>
          <p class="rep-note">Each bar is one service. Nights without a head count aren't shown.</p>` : `<p class="muted">No head counts recorded yet.</p>`}
      </section>

      <section><h2>Month by month</h2>
        ${table(["Month", "Services", "No service", "People", "Avg", "Money in", "Money out", "Net", "Balance"], r.months.filter((m) => m.services || m.cancelled || m.offerings || m.out || m.other_in).map((m) => `<tr><td>${MONTHS[Number(m.month) - 1]}</td><td class="n">${num(m.services)}</td><td class="n">${m.cancelled ? num(m.cancelled) : "—"}</td><td class="n">${m.attendance ? num(m.attendance) : "—"}</td><td class="n">${m.average ?? "—"}</td>
          <td class="n">${R2(m.offerings + m.other_in)}<span class="mini-bar in" style="width:${((m.offerings + m.other_in) / maxM) * 60}px"></span></td><td class="n">${m.out ? R2(m.out) : "—"}${m.out ? `<span class="mini-bar out" style="width:${(m.out / maxM) * 60}px"></span>` : ""}</td>
          <td class="n ${m.net >= 0 ? "pos" : "neg"}">${R2(m.net)}</td><td class="n ${m.running >= 0 ? "pos" : "neg"}"><b>${R2(m.running)}</b></td></tr>`),
          `<tr><th>Total</th><th class="n">${num(t.held)}</th><th class="n">${num(t.cancelled)}</th><th class="n">${num(t.attendance)}</th><th class="n">${t.average ?? "—"}</th><th class="n">${R2(t.offerings + t.other_in)}</th><th class="n">${R2(t.out)}</th><th class="n ${leftCls}" colspan="2">${R2(t.left)} left</th></tr>`)}
      </section>

      <section><h2>Where the money went</h2>
        ${table(["Date", "What for", "Amount", ""], r.ledger.map((l) => `<tr><td>${esc(shortDay(l.date))}</td><td>${esc(l.category)}${l.note ? ` <span class="muted">· ${esc(l.note)}</span>` : ""}</td><td class="n ${l.direction === "in" ? "pos" : ""}">${l.direction === "in" ? "+" : "−"}${R2(l.amount_cents / 100)}</td><td class="n no-print"><button class="link-btn" data-del-ledger="${esc(l.id)}">Remove</button></td></tr>`))}
        <form class="ledger-add no-print" id="ledger-add"><b>Add money in or out</b>
          <div class="row"><input class="input" type="date" name="date" value="${esc(META.today)}" required><select class="input" name="direction"><option value="out">Money out</option><option value="in">Money in</option></select>
          <input class="input" name="category" placeholder="e.g. Youth Monthly bag" required maxlength="120"><input class="input" name="amount" inputmode="decimal" placeholder="Amount (R)" required><button class="btn btn-gold btn-sm" type="submit">Add</button></div></form>
      </section>

      <section><h2>The programme</h2>
        ${table(["Date", "Theme / activity", "Speaker", "MC", "People", "Offering"], r.sessions.map((x) => x.status === "cancelled"
          ? `<tr class="cancelled"><td>${esc(shortDay(x.date))}</td><td colspan="5"><span class="muted">No service: ${esc(x.reason || "")}</span></td></tr>`
          : `<tr><td>${esc(shortDay(x.date))}</td><td>${esc(x.topic)}</td><td>${esc(x.speaker || "—")}</td><td>${esc(x.mc || "—")}</td><td class="n">${x.attendance ?? "—"}</td><td class="n">${x.money != null ? R2(x.money) : "—"}</td></tr>`))}
        ${r.missing.length ? `<p class="rep-note warn"><b>${plural(r.missing.length, "date")} not recorded yet:</b> ${r.missing.map((m) => esc(shortDay(m.date))).join(", ")}. <a class="no-print" href="#services">Record them in Weekly services →</a></p>` : ""}
      </section>

      <section class="grid-2 rep-two"><div><h2>Who served</h2>
          ${r.speakers.length || r.mcs.length ? `<h3>Speakers & facilitators</h3><p class="chips">${r.speakers.map(([n2, c]) => `<span>${esc(n2)}${c > 1 ? ` <b>×${c}</b>` : ""}</span>`).join("")}</p><h3>MCs</h3><p class="chips">${r.mcs.map(([n2, c]) => `<span>${esc(n2)}${c > 1 ? ` <b>×${c}</b>` : ""}</span>`).join("") || "<span class='muted'>None recorded</span>"}</p>` : `<p class="muted">Not recorded yet.</p>`}</div>
        <div><h2>Fridays with no service</h2>${reasons.length ? `<ul class="rep-list">${reasons.map((x) => `<li><b>${esc(shortDay(x.date))}</b> ${esc(x.reason || "")}</li>`).join("")}</ul>` : `<p class="muted">None.</p>`}</div>
      </section>

      ${r.imported ? `<section class="rep-notes"><h2>About these figures</h2>
        <p>Records up to August were imported from the youth team's spreadsheet. Newer services are recorded in Weekly services, so this report stays up to date on its own.</p>
        <p><b>One correction:</b> in the spreadsheet, the 27 February Prayer Night offering (R1 945,20) was typed with a comma, so it was saved as text and left out of the sheet's totals. The sheet therefore showed February as R3 754 and a year balance of −R359. With it included, February's offerings (with the 2 January Youth Monthly) were R5 699.20 and the balance is a <b>positive</b> R1 586.20 (before anything recorded since).</p>
        <p>The 2 January Youth Monthly sits in the sheet's February block; here it counts in January.</p></section>` : ""}
      <footer class="rep-foot">Prepared ${esc(fmtDate(r.generated_at))} for church leaders. Admins only: please don't share outside the leadership.</footer>`;
    $("#ledger-add").onsubmit = safe(async (e) => {
      e.preventDefault(); const f = e.target;
      await api("/api/admin/ledger", { method: "POST", body: { ministry_group: group, date: f.date.value, direction: f.direction.value, category: f.category.value, amount: f.amount.value } });
      toast("Added"); ministryReport();
    });
    doc.onclick = safe(async (e) => {
      const b = e.target.closest("[data-del-ledger]"); if (!b || !confirm("Remove this line?")) return;
      b.closest("tr").remove();
      await api(`/api/admin/ledger/${b.dataset.delLedger}`, { method: "DELETE" }); toast("Removed"); ministryReport();
    });
  }
  const syncCsv = () => { $("#rep-csv").href = `/api/admin/report.csv?from=${$("#rep-from").value}&to=${$("#rep-to").value}`; };
  $("#rep-presets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]"); if (!b) return;
    $$("#rep-presets button").forEach((x) => x.classList.toggle("on", x === b));
    const [a, c] = preset(b.dataset.p); $("#rep-from").value = a; $("#rep-to").value = c; syncCsv(); safe(makeReport)();
  });
  ["rep-from", "rep-to"].forEach((id) => $("#" + id).addEventListener("change", () => { $$("#rep-presets button").forEach((x) => x.classList.remove("on")); syncCsv(); }));
  $("#rep-go").addEventListener("click", safe(() => makeReport()));
  $("#rep-print").addEventListener("click", safe(async () => { if (!$("#report-doc .rep-head")) await makeReport(); window.print(); }));

  async function makeReport() {
    const from = $("#rep-from").value, to = $("#rep-to").value;
    const doc = $("#report-doc");
    doc.innerHTML = `<p class="muted">Preparing the report…</p>`;
    const { report: r } = await api(`/api/admin/report?from=${from}&to=${to}`);
    const t = r.totals, g = r.growth;
    const fmtD = (d) => new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
    const topGroup = r.by_group.find((x) => x.income > 0);
    const table = (head, rows, foot) => `<table class="rep-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${head.length}" class="muted">Nothing recorded in this period.</td></tr>`}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ""}</table>`;
    doc.innerHTML = `
      <header class="rep-head"><img src="/assets/logo-192.png" alt="" width="56" height="56"><div><p>AOG Sandton City Church</p><h1>Report to the Church Board</h1><span>${esc(fmtD(r.period.from))} to ${esc(fmtD(r.period.to))}</span></div></header>
      <section><h2>1. Summary</h2>
        <p class="rep-story">During this period the church received <b>${R2(t.income)}</b>: ${R2(t.event_income)} from ${plural(t.events, "event")}, and ${R2(t.service_income)} in offerings, tithes and other giving across ${plural(t.services_held, "service")} recorded.
        ${t.tickets_sold ? ` Events sold ${plural(t.tickets_sold, "ticket")}${t.attendance_rate != null ? `, and ${t.attendance_rate}% of ticket holders for completed events attended` : ""}.` : ""}
        ${t.service_attendance ? ` Weekly services drew a combined attendance of ${num(t.service_attendance)}, including ${plural(g.first_time_visitors, "first-time visitor")}.` : ""}
        ${g.salvations ? ` <b>${plural(g.salvations, "person", "people")}</b> gave their lives to Christ.` : ""}
        ${topGroup ? ` The ministry with the most income was ${esc(topGroup.label)} (${R2(topGroup.income)}).` : ""}</p>
        <div class="rep-kpis">${[[R2(t.income), "Total income"], [num(t.events), "Events"], [num(t.tickets_sold), "Tickets sold"], [t.attendance_rate != null ? t.attendance_rate + "%" : "—", "Event turn-up"], [num(t.services_held), "Services recorded"], [num(t.service_attendance), "Service attendance"], [num(g.salvations), "Salvations"], [num(r.membership.joined), "New members"]].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>
      </section>
      <section><h2>2. Income</h2>
        ${table(["Source", "Amount"], [["Events (tickets and other event income)", t.event_income], ["Offerings", t.offering], ["Tithes", t.tithes], ["Other service income", t.other]].map(([k, v]) => `<tr><td>${k}</td><td class="n">${R2(v)}</td></tr>`), `<tr><th>Total</th><th class="n">${R2(t.income)}</th></tr>`)}
        <h3>By ministry group</h3>
        ${table(["Ministry", "Events", "Event income", "Services", "Attendance", "Service income", "Salvations", "Total"], r.by_group.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${num(x.events)}</td><td class="n">${R2(x.event_income)}</td><td class="n">${num(x.sessions)}</td><td class="n">${num(x.attendance)}</td><td class="n">${R2(x.service_income)}</td><td class="n">${num(x.salvations)}</td><td class="n"><b>${R2(x.income)}</b></td></tr>`))}
      </section>
      <section><h2>3. Events</h2>
        ${table(["Date", "Event", "Ministry", "Tickets", "Came", "Turn-up", "Income"], r.events.slice().reverse().map((e) => `<tr><td>${esc(day(e.starts_at))}</td><td>${esc(e.title)}</td><td>${esc(e.group_label)}</td><td class="n">${num(e.sold)}</td><td class="n">${e.ended ? num(e.came) : "—"}</td><td class="n">${e.ended && e.attendance_rate != null ? e.attendance_rate + "%" : "upcoming"}</td><td class="n">${R2(e.income)}</td></tr>`),
          r.events.length ? `<tr><th colspan="3">Total</th><th class="n">${num(t.tickets_sold)}</th><th class="n">${num(t.came)}</th><th></th><th class="n">${R2(t.event_income)}</th></tr>` : "")}
      </section>
      <section><h2>4. Weekly services</h2>
        ${table(["Service", "Ministry", "Held", "Avg attendance", "First-timers", "Salvations", "Offering", "Tithes"], r.services.map((s) => `<tr><td>${esc(s.title)} <span class="muted">(${esc(s.day)})</span></td><td>${esc(s.group_label)}</td><td class="n">${num(s.totals.sessions)}</td><td class="n">${s.average_attendance ?? "—"}</td><td class="n">${num(s.totals.first_time_visitors)}</td><td class="n">${num(s.totals.salvations)}</td><td class="n">${R2(s.totals.offering_cents / 100)}</td><td class="n">${R2(s.totals.tithes_cents / 100)}</td></tr>`))}
      </section>
      <section><h2>5. Spiritual growth</h2>
        <div class="rep-kpis">${[["salvations", "Salvations"], ["rededications", "Rededications"], ["spirit_baptisms", "Holy Spirit baptisms"], ["water_baptisms", "Water baptisms"], ["testimonies", "Testimonies & healings"], ["first_time_visitors", "First-time visitors"], ["volunteers", "Volunteer turns served"], ["children", "Children ministered to"]].map(([k, l]) => `<div><b>${num(g[k])}</b><span>${l}</span></div>`).join("")}</div>
      </section>
      <section><h2>6. Membership and care</h2>
        ${table(["Measure", "Number"], [["New members joined", r.membership.joined], ["Verified members (today)", r.membership.verified_total], ["Active member records (today)", r.membership.active_total], ["Memberships revoked", r.membership.revoked], ["Weekly letter subscribers (today)", r.membership.subscribers], ["Prayer requests received", r.care.prayer_requests], ["Complaints raised", r.care.complaints], ["Complaints resolved", r.care.complaints_resolved]].map(([k, v]) => `<tr><td>${k}</td><td class="n">${num(v)}</td></tr>`))}
      </section>
      <footer class="rep-foot">Prepared ${esc(fmtDate(r.generated_at))} from the church's records (event bookings, door scans and weekly service records). Figures for income include approved online payments and amounts recorded by leaders.</footer>`;
  }

  return { loadMeta };
}
