// /followup?t=<token>&a=yes|no: the leader's "Have you connected?" buttons.
import { api, esc } from "./site.js";

const q = new URLSearchParams(location.search), token = q.get("t");
const $ = (id) => document.getElementById(id);
const set = (title, text, actions = "") => { $("fu-title").textContent = title; $("fu-text").innerHTML = text; $("fu-actions").innerHTML = actions; };
let info;
const contactBtns = () => {
  const wa = (info.whatsapp || info.phone || "").replace(/\D/g, "").replace(/^0/, "27");
  return `${wa ? `<a class="btn btn-gold" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp ${esc(info.first)}</a>` : ""}${info.phone ? `<a class="btn" href="tel:${esc(info.phone)}">Call</a>` : ""}${info.email ? `<a class="btn" href="mailto:${esc(info.email)}">Email</a>` : ""}`;
};
function yes() {
  set(`How did you connect with ${info.first}?`, "Wonderful! Just so we know:",
    `<div class="rv-reasons">${info.methods.map(([k, l]) => `<button class="chip-btn" type="button" data-m="${esc(k)}">${esc(l)}</button>`).join("")}</div>
     <div class="field rv-other"><textarea class="input" id="fu-note" rows="2" maxlength="1000" placeholder="Anything the team should know? (optional)"></textarea></div>
     <div class="rv-row"><button class="btn btn-gold" type="button" id="fu-save" disabled>Save</button></div>`);
  let method = null;
  $("fu-actions").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b) return; method = b.dataset.m; $("fu-actions").querySelectorAll("[data-m]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); $("fu-save").disabled = false; });
  $("fu-save").onclick = () => run(async () => {
    await api("/api/followup", { method: "POST", body: { t: token, met: true, method, note: $("fu-note").value } });
    set("Thank you 🙏", `Saved. Please keep in touch with ${esc(info.first)}; you can log every catch-up under <b>My people</b> in the admin.`, `<a class="btn btn-gold" href="/admin/#people">My people</a>`);
  });
}
function notYet() {
  set("No problem", `When would you like us to check in again about ${esc(info.first)}?`,
    `<div class="rv-reasons">${[[2, "In 2 days"], [3, "In 3 days"], [7, "Next week"]].map(([d, l]) => `<button class="chip-btn" type="button" data-d="${d}">${l}</button>`).join("")}</div>
     <p class="muted-text">Or reach out now:</p><div class="rv-row">${contactBtns()}</div>`);
  $("fu-actions").addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (!b) return; run(async () => {
    const r = await api("/api/followup", { method: "POST", body: { t: token, met: false, days: Number(b.dataset.d) } });
    set("Got it", `We'll check in again in ${r.days} day${r.days === 1 ? "" : "s"}. Thank you for caring for ${esc(info.first)} 💛`, `<div class="rv-row">${contactBtns()}</div>`);
  }); });
}
async function run(fn) { try { await fn(); } catch (e) { set("This link can't be used", esc(e.message), `<a class="btn btn-gold" href="/admin/#people">My people</a>`); } }
run(async () => {
  if (!token) throw new Error("This link is incomplete. Please use the buttons in your email.");
  info = await api("/api/followup/lookup", { method: "POST", body: { t: token } });
  const a = q.get("a");
  if (a === "yes") return yes();
  if (a === "no") return notYet();
  set(`Have you connected with ${info.member}?`, "",
    `<button class="btn btn-gold" type="button" id="fu-y">Yes, we've connected</button><button class="btn" type="button" id="fu-n">Not yet</button>`);
  $("fu-y").onclick = yes; $("fu-n").onclick = notYet;
});
