// Go Ye: the evangelism team in the app. Log the people you meet; the Call Office follows them up.
import { api, esc, toast } from "./site.js";
import { getMe, whenSignedIn } from "./auth.js";

const $ = (id) => document.getElementById(id);
const STATUS = { new: "Waiting for a call", no_answer: "Call Office trying again", called: "Called ✓", connected: "Connected to church 🎉", closed: "Closed" };
const DEC = { prayed: "Prayed", interested: "Interested", visit: "Wants to visit", prayer: "Prayer", class: "Classes", talk: "Talk" };
const day = (s) => new Date(s).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
const tel = (n) => `tel:${String(n).replace(/[^\d+]/g, "")}`;

async function load() {
  const me = await getMe();
  if (!me.user) { location.href = "/me"; return; }
  const d = await api("/api/go");
  $("go-stats").innerHTML = `<span><b>${d.team.contacts}</b> people met this month</span><span><b>${d.team.saved}</b> prayed to receive Jesus</span><span><b>${d.mine.length}</b> by you</span>`;
  $("go-mine").innerHTML = d.mine.length ? d.mine.map((c) => `<div class="go-person"><div><b>${esc(c.name)}</b><span>${esc(c.area || "")}${c.area ? " · " : ""}${day(c.created_at)}</span></div>
      <span class="go-pill ${esc(c.decision)}">${esc(DEC[c.decision] || c.decision)}</span><span class="go-status ${esc(c.status)}">${esc(STATUS[c.status] || c.status)}</span></div>`).join("")
    : `<p class="muted-text">Nobody yet. The first conversation is the bravest one. 💛</p>`;
  if (d.leaders?.length) { $("go-leaders-sec").hidden = false; $("go-leaders").innerHTML = d.leaders.map((l) => `<a class="ev-leader" href="${tel(l.phone)}"><b>${esc(l.name)}</b><span>${esc(l.role)} · ${esc(l.phone)}</span></a>`).join(""); }
}

$("go-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, data = Object.fromEntries(new FormData(f));
  if (!String(data.name || "").trim()) { toast("Add their name."); f.name.focus(); return; }
  const btn = f.querySelector("[type=submit]"); btn.disabled = true;
  try { const r = await api("/api/go/contacts", { method: "POST", body: data }); toast(r.message); f.reset(); load(); }
  catch (err) { toast(err.message); } finally { btn.disabled = false; }
});

whenSignedIn(() => load());
load().catch((e) => { $("go-mine").innerHTML = `<p class="muted-text">${esc(e.message)}</p>`; });
