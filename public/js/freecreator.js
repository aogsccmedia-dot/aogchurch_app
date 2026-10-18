// FreeCreator Online landing: free for anyone on a computer, no account needed. One button opens the app in its own window.
// Phones and tablets are asked to use a computer (a few team accounts can use their phone as an extra Studio camera).
// Signed-in church teams can share their library; church admins add their members; the main admin approves new churches.
import { api, esc, toast } from "./site.js";
import { getMe } from "./auth.js";
import { isPhoneOrTablet } from "/freecreator/app/gate.js";
const $ = (id) => document.getElementById(id);

async function show() {
  const phone = isPhoneOrTablet();
  if (phone) { $("fc-go").hidden = true; $("fc-phone").hidden = false; }
  $("fc-open").addEventListener("click", () => setTimeout(() => toast("FreeCreator opened in a new window"), 300));
  const me = await getMe(true).catch(() => ({}));
  if (!me?.user || me.user.visitor || me.visitor) return;   // guests: nothing else to do, just open it
  const a = await api("/api/freecreator/access").catch(() => ({}));
  if (a.super) churches();
  if (phone && a.mobile) {
    const open = $("fc-open"); open.href = "/freecreator/app/camera.html"; open.lastChild.textContent = " Use this phone as a camera";
    $("fc-go").hidden = false; $("fc-phone").textContent = "On phones, FreeCreator works as an extra camera for the Studio on your computer.";
  }
  if (!a.church) { noChurch(a); return; }
  $("fc-who").textContent = `${a.church.name}: songs and shows are shared with your church team.`;
  if (a.church.role !== "member") manage(a.church);
}

function noChurch(a) {
  const box = $("fc-church"); box.hidden = false;
  if (a.pending) { box.innerHTML = `<p class="muted-text">Your church <b>${esc(a.pending.name)}</b> is ${a.pending.status === "declined" ? "not approved for a shared workspace" : "waiting for approval for a shared workspace"}. You can use FreeCreator on your own in the meantime.</p>`; return; }
  box.innerHTML = `<details class="fc-admin"><summary>Want your team to share songs and shows? Register your church</summary>
    <p class="muted-text"><b>Sandton City Church:</b> sharing opens once your membership is approved. <b>Another church?</b> Register it here; once approved, you add your own team.</p>
    <form class="fc-reg" id="fc-reg">
      <label class="field"><span>Church name</span><input class="input" name="name" required maxlength="120"></label>
      <label class="field"><span>City</span><input class="input" name="city" maxlength="80"></label>
      <label class="field"><span>Contact email</span><input class="input" name="contact" type="email" maxlength="200"></label>
      <label class="field"><span>Anything we should know? <small>optional</small></span><textarea class="input" name="note" rows="2" maxlength="600"></textarea></label>
      <button class="btn btn-gold" type="submit">Register church</button></form></details>`;
  $("fc-reg").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("/api/freecreator/church/register", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); toast("Thanks! Your church is waiting for approval."); show(); }
    catch (err) { toast(err.message); }
  };
}

async function manage(church) {
  const el = $("fc-manage"); el.hidden = false;
  const d = await api("/api/freecreator/church/members").catch(() => null); if (!d) { el.hidden = true; return; }
  const was = el.querySelector("details")?.open;
  el.innerHTML = `<details${was ? " open" : ""}><summary>People in ${esc(church.name)}'s workspace <small>${d.members.length}</small></summary>
    <p class="muted-text">${d.automatic ? "Approved members, the team and the media team have access automatically. Add media people or a guest technician here. Each person can be in one church only." : "Only the people you add here can use FreeCreator Online for your church."}</p>
    <form class="fc-add" id="fc-add"><input class="input" name="email" type="email" required placeholder="their.email@example.com"><select class="input" name="role"><option value="member">Member</option>${church.id === "scc" ? `<option value="media">Media team</option>` : ""}${church.role === "owner" ? `<option value="admin">Admin</option>` : ""}</select><button class="btn btn-gold" type="submit">Add</button></form>
    <ul class="fc-people">${d.members.map((m) => `<li><span>${esc(m.email)}</span><small>${esc(m.role)}</small>${m.role !== "owner" ? `<button class="link-btn" data-rm="${esc(m.email)}">Remove</button>` : ""}</li>`).join("") || `<li class="muted-text">Nobody added by hand yet.</li>`}</ul></details>`;
  $("fc-add").onsubmit = async (e) => { e.preventDefault(); try { await api("/api/freecreator/church/members", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); toast("Added"); manage(church); } catch (err) { toast(err.message); } };
  el.onclick = async (e) => { const b = e.target.closest("[data-rm]"); if (!b || !confirm(`Remove ${b.dataset.rm}?`)) return; try { await api("/api/freecreator/church/members", { method: "POST", body: { email: b.dataset.rm, remove: true } }); manage(church); } catch (err) { toast(err.message); } };
}

async function churches() {
  const el = $("fc-churches"); el.hidden = false;
  const d = await api("/api/freecreator/churches").catch(() => null); if (!d) { el.hidden = true; return; }
  const was = el.querySelector("details")?.open;
  el.innerHTML = `<details${was ? " open" : ""}><summary>Churches using FreeCreator <small>${d.churches.filter((c) => c.status === "pending").length ? `${d.churches.filter((c) => c.status === "pending").length} waiting` : d.churches.length}</small></summary><ul class="fc-people">${d.churches.map((c) => `<li><span><b>${esc(c.name)}</b>${c.city ? ` · ${esc(c.city)}` : ""}<br><small>${c.id === "scc" ? "Approved members automatically" : `${esc(c.contact_email || "")} · ${c.members} ${c.members === 1 ? "person" : "people"}`}${c.note ? ` · ${esc(c.note)}` : ""}</small></span><small class="pill">${esc(c.status)}</small>
    ${c.id !== "scc" ? `${c.status !== "active" ? `<button class="btn btn-sm btn-gold" data-ch="${c.id}" data-st="active">Approve</button>` : ""}${c.status !== "declined" ? `<button class="btn btn-sm" data-ch="${c.id}" data-st="declined">${c.status === "active" ? "Switch off" : "Decline"}</button>` : ""}` : ""}</li>`).join("")}</ul></details>`;
  el.onclick = async (e) => { const b = e.target.closest("[data-ch]"); if (!b) return; try { await api(`/api/freecreator/churches/${b.dataset.ch}`, { method: "POST", body: { status: b.dataset.st } }); churches(); } catch (err) { toast(err.message); } };
}
show();
