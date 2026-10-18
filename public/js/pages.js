import { MINISTRIES } from "./options.js";
import { api, esc, jsonForm, getSettings } from "./site.js";
import { getMe, googleButton, whenSignedIn } from "./auth.js";
import { initPhotos } from "./photos.js";
import { icon } from "./icons.js";

initPhotos();

// Hero: three strips of photos, each fading to its next picture in turn.
(function strips() {
  const list = [...document.querySelectorAll(".strips .strip")];
  if (!list.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let turn = 0;
  setInterval(() => {
    if (document.hidden) return;
    const s = list[turn % list.length], imgs = [...s.querySelectorAll("img")], i = imgs.findIndex((x) => x.classList.contains("on"));
    imgs[i].classList.remove("on"); imgs[(i + 1) % imgs.length].classList.add("on");
    turn++;
  }, 1800);
})();

// Shared behaviour for the public content pages (home, about, events, get involved, prayer, visit).
// Every block is optional: it only runs when its section is on the page.
const $id = (id) => document.getElementById(id);

// ---------- ministries ----------
if ($id("ministries")) $id("ministries").innerHTML = MINISTRIES.map((m) => `
  <a class="ministry" href="/join?interest=${m.slug}">${m.icon}<b>${esc(m.label)}</b><span>${esc(m.desc)}</span></a>`).join("");

// ---------- events ----------
const TZ = "Africa/Johannesburg";
const fmt = (o) => new Intl.DateTimeFormat("en-ZA", { ...o, timeZone: TZ });
const FALLBACKS = ["worship", "congregation", "prayer", "hospitality"];
const eventsEl = document.getElementById("events");
const whenShort = (s) => `${fmt({ weekday: "short", day: "numeric", month: "short" }).format(new Date(s))} · ${fmt({ hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s))}`;
const whenLong = (s, e) => `${fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(s))}<br>${fmt({ hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s))}${e ? " – " + fmt({ hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(e)) : ""}`;
const coverImg = (ev, i, eager = false) => ev.cover_url
  ? `<img src="${esc(ev.cover_url)}" alt="${esc(ev.title)}" ${eager ? "" : 'loading="lazy"'}>`
  : `<picture><source type="image/webp" srcset="/assets/photos/${FALLBACKS[i % 4]}-800.webp"><img src="/assets/photos/${FALLBACKS[i % 4]}-1200.jpg" alt="" loading="lazy"></picture>`;
const spots = (ev) => !ev.registration_open ? "" : ev.spots_left === 0 ? `<span class="tag full">Waitlist open</span>` : ev.spots_left ? `<span class="tag">${ev.spots_left} spots left</span>` : "";

async function renderFeatured(ev) {
  const sec = document.getElementById("featured");
  let detail = {};
  try { detail = (await api(`/api/events/${encodeURIComponent(ev.slug)}`)).event; } catch { /* fall back to list data */ }
  document.getElementById("feature-card").innerHTML = `
    <a class="feature-cover photo alive cover-square" href="/event?e=${encodeURIComponent(ev.slug)}">${coverImg(ev, 0, true)}</a>
    <div class="feature-body">
      <p class="eyebrow gold">Next up · ${esc(ev.category)}</p>
      <h2 id="featured-title">${esc(ev.title)}</h2>
      ${ev.description ? `<p class="lede">${esc(ev.description)}</p>` : ""}
      <ul class="facts-list">
        <li>${icon("calendar")}<span>${whenLong(ev.starts_at, ev.ends_at)}</span></li>
        <li>${icon("mapPin")}<span>${esc(ev.location || "17 Humber Street, Woodmead, Sandton")}</span></li>
        ${ev.price_label ? `<li>${icon("ticket")}<span>${esc(ev.price_label)}</span></li>` : ""}
      </ul>
      <div class="feature-actions">
        ${ev.registration_open ? `<a class="btn btn-gold btn-glow" href="/event?e=${encodeURIComponent(ev.slug)}">${icon("ticket")} Get Ticket ${icon("arrowRight", "arr")}</a>` : ""}
        <details class="cal-menu"><summary class="btn">${icon("calendarPlus")} Add to calendar</summary>
          <div class="cal-pop"><a href="${esc(detail.calendar_url || "#")}" target="_blank" rel="noopener">Google Calendar</a><a href="/api/events/${encodeURIComponent(ev.slug)}/calendar.ics">Apple / iPhone (.ics)</a><a href="${esc(detail.outlook_url || "#")}" target="_blank" rel="noopener">Outlook</a></div></details>
      </div>
    </div>`;
  sec.hidden = false;
}
document.addEventListener("click", (e) => { document.querySelectorAll(".cal-menu[open]").forEach((m) => { if (!m.contains(e.target)) m.open = false; }); });

async function loadEvents() {
  if (!eventsEl) return;
  const limit = Number(eventsEl.dataset.limit || 0);
  try {
    const { events } = await api("/api/events");
    if (!events.length) {
      eventsEl.innerHTML = `<div class="events-empty" style="grid-column:1/-1"><b style="font-weight:450;color:var(--text)">New dates are on their way.</b>
        <span>Sign up for the weekly letter and we'll send you the services every Sunday afternoon.</span><a class="btn btn-sm" href="${$id("letter") ? "#letter" : "/#letter"}">Get the weekly letter ${icon("arrowRight", "arr")}</a></div>`;
      return;
    }
    const featured = events.find((e) => e.cover_url && e.registration_open) || events.find((e) => e.registration_open);
    // Hero: "Get Tickets" next to "Join the church", straight to the next event with tickets open.
    const open = events.find((e) => e.registration_open), home = location.pathname === "/" || location.pathname === "/index";
    if (open) document.querySelectorAll("[data-hero-ticket]").forEach((ht) => { if (ht.classList.contains("hdr-ticket") && !home) return; ht.href = `/event?e=${encodeURIComponent(open.slug)}`; ht.hidden = false; ht.title = open.title; });
    // The next event with a promo video plays at the top of "What's coming up".
    const promo = events.find((e) => e.cover_video), slot = $id("promo-slot");
    if (promo && slot) { const { promoHtml, initPromos } = await import("./promo.js"); slot.innerHTML = promoHtml(promo, { ticket: promo.registration_open, label: promo.registration_open ? "Get Ticket" : "Details" }); slot.hidden = false; initPromos(slot, { sound: true }); }
    if (featured && $id("featured")) renderFeatured(featured);
    eventsEl.innerHTML = (limit ? events.slice(0, limit) : events).map((ev, i) => `<a class="event-card" href="/event?e=${encodeURIComponent(ev.slug)}">
        <figure class="photo cover-square">${coverImg(ev, i)}</figure>
        <div class="body"><span class="eyebrow gold">${esc(whenShort(ev.starts_at))}</span><h3>${esc(ev.title)}</h3>
          <p class="meta">${esc(ev.location || "17 Humber Street, Woodmead")}</p>
          <div class="foot"><span class="price">${esc(ev.price_label || "Free")}</span>${spots(ev)}<span class="btn btn-sm${ev.registration_open ? " btn-gold btn-glow" : ""}">${ev.registration_open ? "Get Ticket" : "Details"} ${icon("arrowRight", "arr")}</span></div></div></a>`).join("");
    initPhotos(eventsEl);
  } catch {
    eventsEl.innerHTML = `<div class="events-empty" style="grid-column:1/-1">We couldn't load events right now. Please try again shortly.</div>`;
  }
}
loadEvents();

// ---------- weekly letter ----------
const letterStatus = $id("letter-status");
const letterForm = $id("letter-form");
const q = new URLSearchParams(location.search).get("letter");
if (letterForm) {
  const showLetter = (msg, ok = true) => { letterStatus.textContent = msg; letterStatus.className = `notice ${ok ? "ok" : "err"}`; letterStatus.hidden = false; };
  if (q === "confirmed") {
    showLetter("You're confirmed! Look out for our letter every Sunday afternoon. 💛");
    import("./welcome.js").then(({ showWelcome }) => showWelcome({ title: "to the weekly letter", line: "Every Sunday afternoon: the week's services, what's on at church and a word to carry with you." }));
  }
  if (q === "unsubscribed") showLetter("You've been unsubscribed. We'll miss you — you're always welcome back.");
  if (q === "invalid") showLetter("That link has expired or was already used.", false);
  letterForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = letterForm.querySelector('[type="submit"]'); if (btn) btn.disabled = true;
    const body = Object.fromEntries(new FormData(letterForm).entries());
    try { const r = await api("/api/newsletter/subscribe", { method: "POST", body }); showLetter(r.message); letterForm.reset(); }
    catch (err) { showLetter(err.message, false); }
    finally { if (btn) btn.disabled = false; }
  });
  const setupLetterForMe = async (me) => {
    if (me?.user) {
      if (me.subscribed) { letterForm.hidden = true; showLetter(`You're subscribed as ${me.user.email}. Manage it anytime from your profile.`); return; }
      letterForm.innerHTML = `<button class="btn btn-gold" type="button" id="one-tap-sub">Subscribe as ${esc(me.user.email)}</button>`;
      $id("one-tap-sub").addEventListener("click", async () => {
        const r = await api("/api/newsletter/subscribe", { method: "POST", body: {} }); showLetter(r.message); letterForm.hidden = true;
      });
      return;
    }
    const shown = await googleButton($id("letter-google"), { text: "continue_with" });
    $id("letter-or").hidden = !shown;
  };
  getMe().then(setupLetterForMe);
  whenSignedIn(setupLetterForMe);
  if (q) setTimeout(() => $id("letter").scrollIntoView({ behavior: "smooth" }), 300);
}

// ---------- forms ----------
if ($id("prayer-form")) jsonForm($id("prayer-form"), "/api/prayer");
if ($id("contact-form")) jsonForm($id("contact-form"), "/api/contact");
getSettings().then((s) => { if (s.contact_email) document.querySelector('[data-setting-row="contact_email"]')?.removeAttribute("hidden"); });
