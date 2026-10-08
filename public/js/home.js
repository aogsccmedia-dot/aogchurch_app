import { MINISTRIES } from "./options.js";
import { api, esc, jsonForm, getSettings } from "./site.js";
import { getMe, googleButton, whenSignedIn } from "./auth.js";
import { initPhotos } from "./photos.js";

initPhotos();

// ---------- ministries ----------
document.getElementById("ministries").innerHTML = MINISTRIES.map((m) => `
  <a class="ministry" href="/join?interest=${m.slug}">${m.icon}<b>${esc(m.label)}</b><span>${esc(m.desc)}</span></a>`).join("");

// ---------- events ----------
const TZ = "Africa/Johannesburg";
const fmt = (o) => new Intl.DateTimeFormat("en-ZA", { ...o, timeZone: TZ });
const FALLBACKS = ["worship", "congregation", "prayer", "hospitality"];
const eventsEl = document.getElementById("events");

async function loadEvents() {
  try {
    const { events } = await api("/api/events");
    if (!events.length) {
      eventsEl.innerHTML = `<div class="events-empty" style="grid-column:1/-1"><b style="font-weight:450;color:var(--text)">New dates are on their way.</b>
        <span>Sign up for the weekly letter and we'll send you the services every Sunday afternoon.</span><a class="btn btn-sm" href="#letter">Get the weekly letter →</a></div>`;
      return;
    }
    eventsEl.innerHTML = events.map((ev, i) => {
      const d = new Date(ev.starts_at);
      const img = ev.cover_url
        ? `<img src="${esc(ev.cover_url)}" alt="" loading="lazy">`
        : `<picture><source type="image/webp" srcset="/assets/photos/${FALLBACKS[i % 4]}-800.webp"><img src="/assets/photos/${FALLBACKS[i % 4]}-1200.jpg" alt="" loading="lazy"></picture>`;
      const status = !ev.registration_open ? "" : ev.spots_left === 0 ? `<span class="tag full">Waitlist open</span>` : ev.spots_left ? `<span class="tag">${ev.spots_left} spots left</span>` : `<span class="tag">Open</span>`;
      return `<a class="event-card" href="/event?e=${encodeURIComponent(ev.slug)}">
        <figure class="photo"><span class="date-chip"><b>${fmt({ day: "2-digit" }).format(d)}</b><span>${fmt({ month: "short" }).format(d)}</span></span>${img}</figure>
        <div class="body"><span class="eyebrow">${esc(ev.category)}</span><h3>${esc(ev.title)}</h3>
          <p class="meta">${esc(fmt({ weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false }).format(d))}${ev.location ? " · " + esc(ev.location) : ""}</p>
          <div class="foot">${status}<span class="explore">${ev.registration_open ? "Register" : "Details"} →</span></div></div></a>`;
    }).join("");
    initPhotos(eventsEl);
  } catch {
    eventsEl.innerHTML = `<div class="events-empty" style="grid-column:1/-1">We couldn't load events right now. Please try again shortly.</div>`;
  }
}
loadEvents();

// ---------- weekly letter ----------
const letterStatus = document.getElementById("letter-status");
const showLetter = (msg, ok = true) => { letterStatus.textContent = msg; letterStatus.className = `notice ${ok ? "ok" : "err"}`; letterStatus.hidden = false; };
const q = new URLSearchParams(location.search).get("letter");
if (q === "confirmed") showLetter("You're confirmed! Look out for our letter every Sunday afternoon. 💛");
if (q === "unsubscribed") showLetter("You've been unsubscribed. We'll miss you — you're always welcome back.");
if (q === "invalid") showLetter("That link has expired or was already used.", false);

const letterForm = document.getElementById("letter-form");
letterForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(letterForm).entries());
  try { const r = await api("/api/newsletter/subscribe", { method: "POST", body }); showLetter(r.message); letterForm.reset(); }
  catch (err) { showLetter(err.message, false); }
});

async function setupLetterForMe(me) {
  if (me?.user) {
    if (me.subscribed) { letterForm.hidden = true; showLetter(`You're subscribed as ${me.user.email}. Manage it anytime from your profile.`); return; }
    letterForm.innerHTML = `<button class="btn btn-gold" type="button" id="one-tap-sub">Subscribe as ${esc(me.user.email)}</button>`;
    document.getElementById("one-tap-sub").addEventListener("click", async () => {
      const r = await api("/api/newsletter/subscribe", { method: "POST", body: {} }); showLetter(r.message); letterForm.hidden = true;
    });
    return;
  }
  const shown = await googleButton(document.getElementById("letter-google"), { text: "continue_with" });
  document.getElementById("letter-or").hidden = !shown;
}
getMe().then(setupLetterForMe);
whenSignedIn(setupLetterForMe);

// ---------- forms ----------
jsonForm(document.getElementById("prayer-form"), "/api/prayer");
jsonForm(document.getElementById("contact-form"), "/api/contact");
getSettings().then((s) => { if (s.contact_email) document.querySelector('[data-setting-row="contact_email"]')?.removeAttribute("hidden"); });
if (q) setTimeout(() => document.getElementById("letter").scrollIntoView({ behavior: "smooth" }), 300);

