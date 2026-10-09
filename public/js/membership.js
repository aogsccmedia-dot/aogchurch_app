// /membership?t=<token>&a=stay|revoke: the buttons in the 4-monthly check-in email land here.
// "Still a member" confirms straight away; revoking walks through why → confirm → goodbye (offboard.js).
import { api, esc } from "./site.js";
import { icon } from "./icons.js";
import { revokeFlow } from "./offboard.js";

const q = new URLSearchParams(location.search);
const token = q.get("t");
const action = q.get("a");
const $ = (id) => document.getElementById(id);
const set = (title, text, actions = "") => { $("ms-title").innerHTML = title; $("ms-text").innerHTML = text; $("ms-actions").innerHTML = actions; };
const when = (iso) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

async function stay() {
  const r = await api("/api/membership/confirm", { method: "POST", body: { token } });
  set(`Thank you, ${esc(r.first_name)}! 💛`, `You're confirmed as a member of AOG Sandton City Church. We'll check in again around ${esc(when(r.next_checkin_at))}.`,
    `<a class="btn btn-gold" href="/events">See what's coming up ${icon("arrowRight", "arr")}</a><a class="btn" href="/me">My profile</a>`);
}

// Revoking: the gentle three-step flow (why → confirm → goodbye) takes over the card.
function askRevoke(name) {
  const card = $("mship"), head = card.querySelectorAll("img, .eyebrow, #ms-title, #ms-text, #ms-actions");
  head.forEach((el) => { el.hidden = true; });
  let host = $("ms-flow");
  if (!host) { host = document.createElement("div"); host.id = "ms-flow"; card.append(host); }
  host.hidden = false;
  revokeFlow(host, {
    name,
    submit: (body) => api("/api/membership/revoke", { method: "POST", body: { token, ...body } }),
    onKeep: () => { host.hidden = true; head.forEach((el) => { el.hidden = false; }); run(stay); },
  });
}

async function run(fn) {
  try { await fn(); }
  catch (e) { set("This link can't be used", esc(e.message), `<a class="btn btn-gold" href="/me">Manage it from my profile</a><a class="btn" href="/">Home</a>`); }
}

run(async () => {
  if (!token) throw new Error("This link is incomplete. Please use the buttons in your email, or manage your membership from your profile.");
  const info = await api("/api/membership/lookup", { method: "POST", body: { token } });
  if (info.status === "revoked") throw new Error("This membership was already revoked. You're always welcome to rejoin.");
  if (action === "stay") return stay();
  if (action === "revoke") return askRevoke(info.first_name);
  set(`Hi ${esc(info.first_name)}, are you still part of the family?`, `You've been a member since ${esc(when(info.since))}.`,
    `<button class="btn btn-gold" type="button" id="ms-yes">Yes, I'm still a member</button><button class="btn" type="button" id="ms-no">Revoke my membership</button>`);
  $("ms-yes").addEventListener("click", () => run(stay));
  $("ms-no").addEventListener("click", () => askRevoke(info.first_name));
});
