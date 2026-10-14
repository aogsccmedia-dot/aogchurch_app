// Evangelism + Discipleship pages: the response forms, and (for signed-in members) the leaders people can call.
import { api, esc, toast } from "./site.js";

const wa = (n) => `https://wa.me/${String(n).replace(/\D/g, "").replace(/^0/, "27")}`;
const tel = (n) => `tel:${String(n).replace(/[^\d+]/g, "")}`;

function wire(id, path) {
  const f = document.getElementById(id); if (!f) return;
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    if (!String(data.name || "").trim()) { toast("Please add your name."); f.name.focus(); return; }
    if (!String(data.phone || "").trim() && !String(data.email || "").trim()) { toast("Please leave a phone number or email."); f.phone.focus(); return; }
    const btn = f.querySelector("[type=submit]"); btn.disabled = true;
    try {
      const r = await api(path, { method: "POST", body: data });
      f.innerHTML = `<div class="ev-done"><span>🎉</span><h3>${data.decision === "prayed" ? "Welcome to God's family!" : "Thank you!"}</h3><p>${esc(r.message)}</p>
        ${id === "ev-form" ? `<a class="btn" href="/discipleship">See discipleship classes</a>` : `<a class="btn" href="/evangelism">Read the good news</a>`}</div>`;
    } catch (err) { toast(err.message); btn.disabled = false; }
  });
}
wire("ev-form", "/api/evangelism/respond");
wire("dc-form", "/api/discipleship");

const box = document.getElementById("ev-leaders");
if (box) api("/api/evangelism").then((d) => {
  const items = [];
  if (d.whatsapp) items.push(`<a class="ev-leader wa" href="${wa(d.whatsapp)}" target="_blank" rel="noopener"><b>Church WhatsApp</b><span>${esc(d.whatsapp)}</span></a>`);
  for (const l of d.leaders || []) items.push(`<a class="ev-leader" href="${tel(l.phone)}"><b>${esc(l.name)}</b><span>${esc(l.role)} · ${esc(l.phone)}</span></a>`);
  box.innerHTML = items.join("");
  if (d.leaders?.length) document.getElementById("ev-talk-line").textContent = "Tap a name to call. Please be kind with their time.";
}).catch(() => {});
