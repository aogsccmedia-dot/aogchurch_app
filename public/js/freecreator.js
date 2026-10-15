// FreeCreator Online landing: sign in, join through your church workspace, open the app in its own window.
// Church admins add their members here; the main admin approves new churches. Churches never see each other's data.
import { api, esc, toast } from "./site.js";
import { getMe, signInCard, onSignInDone } from "./auth.js";
const $ = (id) => document.getElementById(id);
const phone = () => matchMedia("(pointer: coarse) and (max-width: 900px)").matches;

async function show() {
  const me = await getMe(true);
  if (!me.user) {
    $("fc-need").hidden = !new URLSearchParams(location.search).has("signin");
    $("fc-signin").hidden = false;
    onSignInDone(() => location.assign("/freecreator"));
    await signInCard($("fc-card"));
    return;
  }
  $("fc-signin").hidden = true; $("fc-need").hidden = true;
  const a = await api("/api/freecreator/access").catch(() => ({}));
  if (a.super) churches();
  if (!a.church) { noChurch(a); return; }
  $("fc-go").hidden = false;
  $("fc-who").textContent = `${a.church.name} workspace · signed in as ${me.user.email}.`;
  if (phone()) {
    const open = $("fc-open");
    if (a.mobile) { open.href = "/freecreator/app/camera.html"; open.lastChild.textContent = " Use this phone as a camera"; $("fc-phone").hidden = false; $("fc-phone").textContent = "On phones, FreeCreator works as an extra camera for the Studio on your computer."; }
    else { $("fc-go").hidden = true; $("fc-phone").hidden = false; $("fc-phone").textContent = "FreeCreator Online runs on a laptop or desktop computer. Open this page on a computer to use it."; }
  } else if (new URLSearchParams(location.search).has("signin")) location.replace("/freecreator/app/");
  if (a.church.role !== "member") manage(a.church);
}

function noChurch(a) {
  const box = $("fc-church"); box.hidden = false;
  if (a.pending) { box.innerHTML = `<div class="notice">Your church <b>${esc(a.pending.name)}</b> is ${a.pending.status === "declined" ? "not approved" : "waiting for approval"}. We'll let you know.</div>`; return; }
  box.innerHTML = `<div class="notice">FreeCreator Online is strictly for church members. <b>Sandton City Church:</b> it opens once your membership is approved. <b>Another church?</b> Register it below; once approved, you add your own members.</div>
    <form class="panel fc-reg" id="fc-reg"><h2>Register your church</h2>
      <label class="field"><span>Church name</span><input class="input" name="name" required maxlength="120"></label>
      <label class="field"><span>City</span><input class="input" name="city" maxlength="80"></label>
      <label class="field"><span>Contact email</span><input class="input" name="contact" type="email" maxlength="200"></label>
      <label class="field"><span>Anything we should know? <small>optional</small></span><textarea class="input" name="note" rows="2" maxlength="600"></textarea></label>
      <button class="btn btn-gold" type="submit">Register church</button></form>`;
  $("fc-reg").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("/api/freecreator/church/register", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); toast("Thanks! Your church is waiting for approval."); show(); }
    catch (err) { toast(err.message); }
  };
}

async function manage(church) {
  const el = $("fc-manage"); el.hidden = false;
  const d = await api("/api/freecreator/church/members").catch(() => null); if (!d) { el.hidden = true; return; }
  el.innerHTML = `<h2>People in ${esc(church.name)}'s workspace</h2>
    <p class="muted-text">${d.automatic ? "Approved Sandton City Church members and the team have access automatically. Add anyone else who helps (e.g. a guest technician) here." : "Only the people you add here can use FreeCreator Online for your church."}</p>
    <form class="fc-add" id="fc-add"><input class="input" name="email" type="email" required placeholder="their.email@example.com"><select class="input" name="role"><option value="member">Member</option>${church.role === "owner" ? `<option value="admin">Admin</option>` : ""}</select><button class="btn btn-gold" type="submit">Add</button></form>
    <ul class="fc-people">${d.members.map((m) => `<li><span>${esc(m.email)}</span><small>${esc(m.role)}</small>${m.role !== "owner" ? `<button class="link-btn" data-rm="${esc(m.email)}">Remove</button>` : ""}</li>`).join("") || `<li class="muted-text">Nobody added by hand yet.</li>`}</ul>`;
  $("fc-add").onsubmit = async (e) => { e.preventDefault(); try { await api("/api/freecreator/church/members", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); toast("Added"); manage(church); } catch (err) { toast(err.message); } };
  el.onclick = async (e) => { const b = e.target.closest("[data-rm]"); if (!b || !confirm(`Remove ${b.dataset.rm}?`)) return; try { await api("/api/freecreator/church/members", { method: "POST", body: { email: b.dataset.rm, remove: true } }); manage(church); } catch (err) { toast(err.message); } };
}

async function churches() {
  const el = $("fc-churches"); el.hidden = false;
  const d = await api("/api/freecreator/churches").catch(() => null); if (!d) { el.hidden = true; return; }
  el.innerHTML = `<h2>Churches using FreeCreator <small class="muted-text">(main admin)</small></h2><ul class="fc-people">${d.churches.map((c) => `<li><span><b>${esc(c.name)}</b>${c.city ? ` · ${esc(c.city)}` : ""}<br><small>${c.id === "scc" ? "Approved members automatically" : `${esc(c.contact_email || "")} · ${c.members} ${c.members === 1 ? "person" : "people"}`}${c.note ? ` · ${esc(c.note)}` : ""}</small></span><small class="pill">${esc(c.status)}</small>
    ${c.id !== "scc" ? `${c.status !== "active" ? `<button class="btn btn-sm btn-gold" data-ch="${c.id}" data-st="active">Approve</button>` : ""}${c.status !== "declined" ? `<button class="btn btn-sm" data-ch="${c.id}" data-st="declined">${c.status === "active" ? "Switch off" : "Decline"}</button>` : ""}` : ""}</li>`).join("")}</ul>`;
  el.onclick = async (e) => { const b = e.target.closest("[data-ch]"); if (!b) return; try { await api(`/api/freecreator/churches/${b.dataset.ch}`, { method: "POST", body: { status: b.dataset.st } }); churches(); } catch (err) { toast(err.message); } };
}
show();
