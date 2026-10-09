// /membership?t=<token>&a=stay|revoke: the buttons in the 4-monthly check-in email land here.
// "Still a member" confirms straight away; revoking always asks once more (and for an optional reason).
import { api, esc } from "./site.js";
import { icon } from "./icons.js";

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

function askRevoke(name) {
  set(`Revoke your membership, ${esc(name)}?`, "We'll remove you from our member list and stop these check-ins. You're always welcome back, and this doesn't affect the weekly letter.",
    `<div class="field" style="width:100%"><label for="ms-reason">Would you like to tell us why? (optional)</label><textarea class="input" id="ms-reason" maxlength="500" placeholder="Moved away, found another church home…"></textarea></div>
     <button class="btn" type="button" id="ms-stay">Actually, I'm still a member</button><button class="btn btn-gold" type="button" id="ms-revoke">Yes, revoke my membership</button>`);
  $("ms-stay").addEventListener("click", () => run(stay));
  $("ms-revoke").addEventListener("click", () => run(async () => {
    const r = await api("/api/membership/revoke", { method: "POST", body: { token, reason: $("ms-reason").value } });
    set(`Thank you, ${esc(r.first_name)}`, "Your membership has been revoked. Thank you for being part of the family. Our doors at 17 Humber Street are always open.",
      `<a class="btn btn-gold" href="/join">Rejoin anytime</a><a class="btn" href="/">Home</a>`);
  }));
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
