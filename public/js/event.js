import { api, esc, toast } from "./site.js";
import { getMe, googleButton, whenSignedIn } from "./auth.js";
import { renderField } from "./forms.js";

const slug = new URLSearchParams(location.search).get("e");
const $ = (id) => document.getElementById(id);
const TZ = "Africa/Johannesburg";
const fmtWhen = (s, e) => {
  const d = new Date(s);
  const day = new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(d);
  const t = (x) => new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(x);
  return `${day} · ${t(d)}${e ? "–" + t(new Date(e)) : ""}`;
};

let event;
const form = $("reg-form");

function done(status, ref, message, already) {
  form.hidden = true; $("reg-google").hidden = true;
  const wait = status === "waitlist";
  $("reg-done").hidden = false;
  $("reg-done").innerHTML = `<img class="seal" src="/assets/seal.png" alt="">
    <h3>${already ? "You're already registered" : wait ? "You're on the waitlist" : "You're in! 🎉"}</h3>
    <p class="muted-text">${wait ? "This event is full right now — we'll email you the moment a spot opens." : "We've emailed your confirmation. We can't wait to see you!"}</p>
    ${message ? `<p class="statement">${esc(message)}</p>` : ""}
    <span class="tag">Ref ${esc(ref)}</span>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><a class="btn btn-sm" href="${esc(event.calendar_url)}" target="_blank" rel="noopener">Add to calendar</a><a class="btn btn-sm" href="/#services">More events</a></div>`;
}

function prefill(me) {
  if (!me?.user) return;
  form.name.value ||= me.user.name || "";
  $("r-email-field").hidden = true;
  form.email.required = false;
  $("reg-heading").textContent = `Hi ${me.user.given_name || "there"} — save your seat`;
  $("reg-google").hidden = true;
}

async function load() {
  if (!slug) { $("ev-title").textContent = "Event not found"; return; }
  let r;
  try {
    r = await api(`/api/events/${encodeURIComponent(slug)}`);
    event = r.event;
  } catch (e) {
    $("ev-title").textContent = "Event not found";
    $("reg-card").innerHTML = `<p class="muted-text">${esc(e.message)}</p><a class="btn" href="/#services">See all events</a>`;
    return;
  }
  document.title = `${event.title} · AOG Sandton City Church`;
  $("ev-cat").textContent = event.category;
  $("ev-title").textContent = event.title;
  $("ev-when").textContent = fmtWhen(event.starts_at, event.ends_at);
  $("ev-where").textContent = event.location || "17 Humber Street, Woodmead, Sandton";
  $("ev-desc").textContent = event.description || "";
  $("ev-cal").href = event.calendar_url;
  if (event.cover_url) $("ev-cover").innerHTML = `<img src="${esc(event.cover_url)}" alt="">`;
  if (event.capacity) { $("ev-cap-row").hidden = false; $("ev-cap").textContent = event.spots_left > 0 ? `${event.spots_left} of ${event.capacity} spots left` : "Fully booked — join the waitlist"; }
  if (!event.collect_phone) { $("r-phone-field").hidden = true; }
  else form.phone.required = true;
  $("custom-fields").innerHTML = event.form.map(renderField).join("");

  if (r.mine) { done(r.mine.status, r.mine.ref_code, null, true); return; }
  if (!event.registration_open) {
    $("reg-card").innerHTML = `<p class="eyebrow gold">Registration</p><h3>Registration is closed</h3><p class="muted-text">But you're still very welcome to join us!</p>`;
    return;
  }
  form.hidden = false;
  const me = await getMe();
  if (me.user) prefill(me);
  else await googleButton($("reg-google"), { text: "continue_with" });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  form.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
  const status = form.querySelector("[data-status]");
  status.hidden = true;
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    const r = await api(`/api/events/${encodeURIComponent(slug)}/register`, { method: "POST", form: new FormData(form) });
    done(r.status, r.ref, r.message, r.already);
  } catch (err) {
    let first;
    for (const [k, msg] of Object.entries(err.details || {})) {
      const field = form.querySelector(`[data-field="${k}"]`) || form.querySelector(`[name="${k}"]`)?.closest(".field");
      if (field) { field.classList.add("invalid"); field.querySelector(".error").textContent = msg; first ??= field; }
    }
    first?.scrollIntoView({ behavior: "smooth", block: "center" });
    status.textContent = err.message; status.hidden = false;
  } finally { btn.disabled = false; }
});

$("ev-share").addEventListener("click", async () => {
  const data = { title: event?.title, text: `Join me at ${event?.title}`, url: location.href };
  try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(location.href); toast("Link copied"); } } catch { /* cancelled */ }
});

whenSignedIn(async (me) => {
  prefill(me);
  const r = await api(`/api/events/${encodeURIComponent(slug)}`).catch(() => null);
  if (r?.mine) done(r.mine.status, r.mine.ref_code, null, true);
});

load();
