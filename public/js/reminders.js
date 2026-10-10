// /reminders?t=<token>: the "Stop service reminders" link in reminder emails lands here.
// Stopping only affects service reminders; the weekly letter is separate.
import { api, esc } from "./site.js";

const token = new URLSearchParams(location.search).get("t");
const $ = (id) => document.getElementById(id);
const set = (title, text, actions = "") => { $("rm-title").textContent = title; $("rm-text").innerHTML = text; $("rm-actions").innerHTML = actions; };

async function show() {
  if (!token) return set("This link is incomplete", "Use the link in your reminder email, or change reminders from your profile.", `<a class="btn btn-gold" href="/me">My profile</a>`);
  try {
    const r = await api("/api/reminders/lookup", { method: "POST", body: { t: token } });
    if (r.on) {
      set("Stop service reminders?", `We'll stop sending weekly service reminders to <b>${esc(r.email)}</b>. Your weekly letter isn't affected.`,
        `<button class="btn btn-gold" type="button" id="rm-stop">Stop service reminders</button><a class="btn" href="/">Keep them</a>`);
      $("rm-stop").onclick = () => change(false);
    } else {
      set("Service reminders are off", `<b>${esc(r.email)}</b> won't get weekly service reminders. Your weekly letter isn't affected.`,
        `<button class="btn" type="button" id="rm-start">Turn reminders back on</button><a class="btn btn-gold" href="/">Home</a>`);
      $("rm-start").onclick = () => change(true);
    }
  } catch (e) { set("This link can't be used", esc(e.message), `<a class="btn btn-gold" href="/me">My profile</a><a class="btn" href="/">Home</a>`); }
}
async function change(on) {
  try { await api(on ? "/api/reminders/start" : "/api/reminders/stop", { method: "POST", body: { t: token } }); show(); }
  catch (e) { set("Something went wrong", esc(e.message)); }
}
show();
