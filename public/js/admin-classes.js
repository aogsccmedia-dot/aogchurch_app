// Admin: discipleship classes (verified pastors and the main admin) and verified pastors (main admin only, in Team & roles).
export function initClasses(ctx) {
  const { api, $, esc, toast, safe, loaders, icon, fmtDate } = ctx;
  const F = () => $("#dc-class-form");
  let editing = null, data = null;
  const STATUS = { scheduled: "Scheduled", live: "Live now", ended: "Finished", cancelled: "Cancelled" };
  // ISO (UTC) → "2026-11-05T18:00" in South African time, for the date box.
  const toLocal = (iso) => new Date(new Date(iso).getTime() + 2 * 3600_000).toISOString().slice(0, 16);

  async function load() {
    data = await api("/api/admin/discipleship");
    const open = data.status === "open";
    $("#dc-state").innerHTML = `<div class="dc-state-row"><div><b>${open ? "Classes are open" : "Coming soon"}</b>
        <p class="muted">${open ? "Members see the upcoming classes and can join online ones." : "The Discipleship page says “Coming soon” and collects names. Only pastors and you see the classes."}</p></div>
      <button class="btn ${open ? "" : "btn-gold"}" type="button" id="dc-toggle">${open ? "Back to Coming soon" : "Open classes to members"}</button></div>`;
    const list = data.classes;
    $("#dc-classes-list").innerHTML = list.length ? list.map((c) => `<div class="item dc-row" data-id="${esc(c.id)}">
        <div><b>${esc(c.title)}</b> <span class="pill${c.status === "live" ? " member" : ""}">${STATUS[c.status] || c.status}</span>
          <div class="meta">${esc(c.when)} · ${c.minutes} min · ${c.mode === "online" ? "Online" : `At ${esc(c.location || "church")}`} · ${esc(c.track_label)}</div>
          ${c.status === "ended" ? `<div class="meta">${c.joined} joined · ${c.said ? `notes ${c.notes_sent ? `emailed ${fmtDate(c.notes_sent)}` : "being prepared"}` : "no notes taken"}</div>` : ""}</div>
        <div class="team-actions">
          ${c.mode === "online" && c.status !== "ended" && c.status !== "cancelled" ? `<a class="btn btn-sm btn-gold" href="/class?id=${esc(c.id)}">${icon("video")} ${c.status === "live" ? "Rejoin" : "Start"}</a>` : ""}
          ${c.status === "scheduled" ? `<button class="btn btn-sm" type="button" data-edit>Edit</button>` : ""}
          ${c.status === "ended" && c.said ? `<a class="btn btn-sm" href="/api/classes/${esc(c.id)}/notes.pdf">Notes PDF</a><button class="btn btn-sm" type="button" data-resend>Email notes again</button>` : ""}
          ${c.status !== "cancelled" && c.status !== "ended" ? `<button class="btn btn-sm" type="button" data-del>Cancel</button>` : `<button class="btn btn-sm" type="button" data-del>Delete</button>`}
        </div></div>`).join("") : `<div class="empty">No classes yet. Use “Schedule a class”.</div>`;
    $("#dc-signups").innerHTML = data.signups.length ? data.signups.map((x) => `<div class="item"><div><b>${esc(x.name)}</b> <span class="pill">${esc(data.tracks[x.track] || x.track)}</span>
        <div class="meta">${[x.phone, x.email].filter(Boolean).map(esc).join(" · ")} · ${fmtDate(x.created_at)}</div>${x.note ? `<div class="meta">“${esc(x.note)}”</div>` : ""}</div></div>`).join("")
      : `<div class="empty">No sign-ups yet.</div>`;
  }
  loaders.discipleship = load;

  const showForm = (c = null) => {
    editing = c?.id || null;
    const f = F(); f.reset(); f.hidden = false;
    if (c) { f.title.value = c.title; f.track.value = c.track; f.starts_local.value = toLocal(c.starts_at); f.minutes.value = String(c.minutes); f.mode.value = c.mode; f.location.value = c.location || ""; f.details.value = c.details || ""; }
    $("[data-dc-loc]", f).hidden = f.mode.value !== "in_person";
    $("#dc-save").textContent = c ? "Save changes" : "Schedule";
    f.scrollIntoView({ behavior: "smooth", block: "start" }); f.title.focus({ preventScroll: true });
  };
  $("#dc-new").addEventListener("click", () => showForm());
  $("#dc-cancel").addEventListener("click", () => { F().hidden = true; editing = null; });
  F().mode.addEventListener("change", () => { $("[data-dc-loc]", F()).hidden = F().mode.value !== "in_person"; });
  F().addEventListener("submit", safe(async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(F()));
    if (!String(body.title).trim()) { toast("Give the class a title."); return; }
    if (!body.starts_local) { toast("Choose the date and time."); return; }
    await api(editing ? `/api/admin/discipleship/classes/${editing}` : "/api/admin/discipleship/classes", { method: editing ? "PATCH" : "POST", body });
    toast(editing ? "Saved." : "Class scheduled."); F().hidden = true; editing = null; load();
  }));
  $("#dc-state").addEventListener("click", safe(async (e) => {
    if (!e.target.closest("#dc-toggle")) return;
    const open = data.status !== "open";
    await api("/api/admin/discipleship/status", { method: "PUT", body: { status: open ? "open" : "soon" } });
    toast(open ? "Classes are open: members can see them now." : "The page says “Coming soon” again."); load();
  }));
  $("#dc-classes-list").addEventListener("click", safe(async (e) => {
    const row = e.target.closest("[data-id]"); if (!row) return;
    const c = data.classes.find((x) => x.id === row.dataset.id); if (!c) return;
    if (e.target.closest("[data-edit]")) return showForm(c);
    if (e.target.closest("[data-resend]")) { const r = await api(`/api/admin/discipleship/classes/${c.id}/notes`, { method: "POST" }); toast(`Notes emailed to ${r.sent} ${r.sent === 1 ? "person" : "people"}.`); load(); return; }
    if (e.target.closest("[data-del]")) {
      const r = await api(`/api/admin/discipleship/classes/${c.id}`, { method: "DELETE" });
      toast(r.deleted ? "Deleted, with its notes." : "Class cancelled."); load();
    }
  }));

  // ------------------------------------------------------------ verified pastors (main admin, Team & roles)
  const list = $("#pastor-list"); if (!list) return;
  async function loadPastors() {
    const { pastors } = await api("/api/admin/pastors");
    list.innerHTML = pastors.length ? pastors.map((p) => `<div class="item team-row" data-pastor="${esc(p.user_id)}"><div><b>${esc(p.name)}</b><span class="pastor-star" title="Verified pastor">${icon("star")}</span>
        <div class="meta">${esc(p.title || "Pastor")} · ${esc(p.email)} · since ${fmtDate(p.created_at)}</div></div>
        <div class="team-actions"><button class="btn btn-sm" type="button" data-unpastor>Remove</button></div></div>`).join("") : `<div class="empty">No verified pastors yet.</div>`;
  }
  const prevTeam = loaders.team;
  loaders.team = async (...a) => { await Promise.all([prevTeam?.(...a), loadPastors()]); };
  let t;
  $("#pastor-q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(safe(async () => {
    const q = $("#pastor-q").value.trim();
    if (!q) { $("#pastor-find").innerHTML = ""; return; }
    const { people } = await api(`/api/admin/team?q=${encodeURIComponent(q)}`);
    $("#pastor-find").innerHTML = people.length ? people.slice(0, 8).map((p) => `<div class="item team-row"><div><b>${esc(p.first_name ? `${p.first_name} ${p.last_name}` : p.name || p.email)}</b><div class="meta">${esc(p.email)}${p.ref_code ? ` · Member ${esc(p.ref_code)}` : " · not a registered member"}</div></div>
        ${p.ref_code ? `<div class="team-actions"><input class="input" data-title placeholder="Title, e.g. Senior Pastor" maxlength="40" aria-label="Pastor title"><button class="btn btn-sm btn-gold" type="button" data-make="${esc(p.user_id)}">${icon("star")} Verify as pastor</button></div>` : `<span class="pill">Needs to join</span>`}</div>`).join("")
      : `<div class="empty">No one found.</div>`;
  }), 250); });
  $("#pastor-find").addEventListener("click", safe(async (e) => {
    const b = e.target.closest("[data-make]"); if (!b) return;
    const title = b.parentElement.querySelector("[data-title]")?.value || "Pastor";
    await api("/api/admin/pastors", { method: "POST", body: { user_id: b.dataset.make, title } });
    toast("Verified. They now have the purple star and can run discipleship classes."); $("#pastor-q").value = ""; $("#pastor-find").innerHTML = ""; loadPastors();
  }));
  list.addEventListener("click", safe(async (e) => {
    const row = e.target.closest("[data-pastor]"); if (!row || !e.target.closest("[data-unpastor]")) return;
    await api(`/api/admin/pastors/${row.dataset.pastor}`, { method: "DELETE" });
    toast("No longer a verified pastor."); loadPastors();
  }));
}
