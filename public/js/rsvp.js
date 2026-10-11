// /rsvp?t=<token>&a=yes|no: the "I'm coming" / "Can't make it" buttons in service reminder emails.
// The answer is saved straight away; for "can't make it", sharing a reason is optional.
import { api, esc } from "./site.js";

const q = new URLSearchParams(location.search);
const token = q.get("t");
const $ = (id) => document.getElementById(id);
const set = (title, text, actions = "") => { $("rv-title").textContent = title; $("rv-text").innerHTML = text; $("rv-actions").innerHTML = actions; };
const dayLabel = (d) => new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
let info;

async function answer(response) {
  await api("/api/rsvp", { method: "POST", body: { t: token, response } });
  if (response === "yes") {
    set(`See you there${info.name ? `, ${esc(info.name.split(" ")[0])}` : ""}! 🙌`, `${esc(info.service)}, ${esc(dayLabel(info.date))}${info.time ? `, ${esc(info.time)}` : ""}.<br>17 Humber Street, Woodmead, Sandton.`,
      `<a class="btn btn-gold" href="https://maps.google.com/?q=17+Humber+Street+Woodmead+Sandton" target="_blank" rel="noopener">Directions</a><button class="btn" type="button" id="rv-change">Actually, I can't make it</button>`);
    $("rv-change").onclick = () => run(() => answer("no"));
    return;
  }
  set("Thanks for letting us know", `We'll miss you at ${esc(info.service)}. If you're comfortable sharing, what's keeping you away? <span class="muted-text">(Totally optional.)</span>`,
    `<div class="rv-reasons">${info.reasons.map(([k, l]) => `<button class="chip-btn" type="button" data-r="${esc(k)}">${esc(l)}</button>`).join("")}</div>
     <div class="field rv-other" hidden><textarea class="input" id="rv-text-in" rows="2" maxlength="300" placeholder="A few words, if you'd like"></textarea></div>
     <div class="rv-row"><button class="btn" type="button" id="rv-skip">Prefer not to say</button><button class="btn btn-gold" type="button" id="rv-send" hidden>Send</button></div>
     <button class="link-btn" type="button" id="rv-yes">Actually, I'm coming</button>`);
  let code = null;
  $("rv-actions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]"); if (!b) return;
    code = b.dataset.r;
    $("rv-actions").querySelectorAll("[data-r]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("rv-actions").querySelector(".rv-other").hidden = code !== "other";
    $("rv-send").hidden = false;
    if (code === "other") $("rv-text-in").focus();
  });
  $("rv-send").onclick = () => run(async () => {
    await api("/api/rsvp", { method: "POST", body: { t: token, response: "no", reason_code: code, reason: $("rv-text-in")?.value || null } });
    done(code === "unwell" ? "We're praying for you to feel better soon 🙏" : "We'll keep you in our prayers, and we'd love to see you next time 💛");
  });
  $("rv-skip").onclick = () => done("No problem at all. We'd love to see you next time 💛");
  $("rv-yes").onclick = () => run(() => answer("yes"));
}
const done = (text) => set("Thank you", esc(text), `<a class="btn btn-gold" href="/events">This week's services</a>`);
async function run(fn) {
  try { await fn(); } catch (e) { set("This link can't be used", esc(e.message), `<a class="btn btn-gold" href="/events">This week's services</a>`); }
}
run(async () => {
  if (!token) throw new Error("This link is incomplete. Please use the buttons in your reminder email.");
  info = await api("/api/rsvp/lookup", { method: "POST", body: { t: token } });
  $("rv-eyebrow").textContent = `${info.service} · ${dayLabel(info.date)}`;
  const a = q.get("a");
  if (a === "yes" || a === "no") return answer(a);
  set(`Will you be at ${info.service}?`, `${esc(dayLabel(info.date))}${info.time ? `, ${esc(info.time)}` : ""}.`,
    `<button class="btn btn-gold" type="button" id="rv-y">I'm coming</button><button class="btn" type="button" id="rv-n">Can't make it</button>`);
  $("rv-y").onclick = () => run(() => answer("yes")); $("rv-n").onclick = () => run(() => answer("no"));
});
