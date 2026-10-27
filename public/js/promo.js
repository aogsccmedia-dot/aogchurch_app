// Event promo videos: play by themselves (muted, on loop) with rounded corners and a "Get Ticket →" button in the
// bottom-right corner. The video only downloads when it's about to come on screen, and in the size it's shown at
// (720p unless it's displayed big on a sharp screen). Videos pause when scrolled out of view to save data and battery,
// and a small speaker button turns the sound on.
import { esc } from "./site.js";
import { icon } from "./icons.js";

/** 1080p only when the video is shown wider than 720p can fill sharply. */
const pick = (base, v) => `${base}-${(v.getBoundingClientRect().width || innerWidth) * Math.min(devicePixelRatio || 1, 2) > 1400 ? "1080" : "720"}.mp4`;
function load(v) {
  if (v.dataset.loaded) return; v.dataset.loaded = "1";
  const base = v.dataset.base;
  v.innerHTML = `<source src="${esc(pick(base, v))}" type="video/mp4"><source src="${esc(base)}-720.webm" type="video/webm">`;
  v.preload = "auto"; v.load();
}

// Sound: the promo tries to play with sound when it's on screen. Browsers only allow sound after the visitor has
// tapped or clicked the page once, so if it's blocked it plays muted and the sound comes on at the first tap or click.
let wantSound = false, armed = false;
function setSound(v, on) {
  v.muted = !on;
  const b = v.closest("[data-promo]")?.querySelector("[data-promo-sound]");
  if (b) { b.classList.toggle("on", on); b.innerHTML = icon(on ? "volume2" : "volumeX"); b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", on ? "Turn sound off" : "Turn sound on"); }
}
async function trySound(v) {
  if (!wantSound || v.dataset.userMuted) return;
  setSound(v, true);
  try { await v.play(); }
  catch { setSound(v, false); v.play().catch(() => {}); arm(); }
}
function arm() {
  if (armed) return; armed = true;
  const go = () => {
    ["pointerdown", "keydown", "touchend"].forEach((t) => removeEventListener(t, go, true));
    document.querySelectorAll("[data-promo] video").forEach((v) => { const r = v.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight && !v.dataset.userMuted) { setSound(v, true); v.play().catch(() => setSound(v, false)); } });
  };
  ["pointerdown", "keydown", "touchend"].forEach((t) => addEventListener(t, go, { capture: true, passive: true }));
}

/** HTML for an event's promo video. `ticket`: show the Get Ticket button; `href`: where it goes. */
export function promoHtml(ev, { ticket = true, href = null, label = "Get Ticket" } = {}) {
  if (!ev?.cover_video) return "";
  const base = ev.cover_video, url = href || `/event?e=${encodeURIComponent(ev.slug)}`;
  return `<div class="promo" data-promo>
    <video class="promo-v" poster="${esc(base)}-poster.jpg" muted loop playsinline preload="none" data-base="${esc(base)}" aria-label="${esc(ev.title)} video"></video>
    <button type="button" class="promo-sound" data-promo-sound aria-label="Turn sound on" aria-pressed="false">${icon("volumeX")}</button>
    ${ticket ? `<a class="promo-ticket" href="${esc(url)}">${icon("ticket")}<span>${esc(label)}</span>${icon("arrowRight", "arr")}</a>` : ""}
  </div>`;
}

const seen = new WeakSet();
// Start downloading a little before the video scrolls into view, so it's already playing when it arrives.
const near = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { load(e.target); near.unobserve(e.target); }
}, { rootMargin: "400px 0px" }) : null;
const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    const v = e.target;
    if (e.isIntersecting) { load(v); if (wantSound && v.muted && !v.dataset.userMuted) trySound(v); else v.play().catch(() => {}); }
    else { v.pause(); if (!v.muted) setSound(v, false); }   // never talk from off screen
  }
}, { threshold: 0.25 }) : null;

/** Start the videos inside `root` (autoplay needs muted + a nudge on some phones). */
/** `sound`: try to play with sound while the video is on screen (event page; landing page once scrolled to). */
export function initPromos(root = document, { sound = false } = {}) {
  if (sound) wantSound = true;
  root.querySelectorAll("[data-promo] video").forEach((v) => {
    if (seen.has(v)) return; seen.add(v);
    v.muted = true; v.defaultMuted = true;
    const go = () => { const r = v.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) v.play().catch(() => {}); };
    v.addEventListener("loadeddata", go, { once: true });
    if (near) { near.observe(v); io.observe(v); } else { load(v); go(); }
  });
}

document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-promo-sound]"); if (!b) return;
  e.preventDefault();
  const v = b.closest("[data-promo]").querySelector("video");
  const on = v.muted;
  if (on) delete v.dataset.userMuted; else v.dataset.userMuted = "1";   // muted on purpose: stay quiet
  setSound(v, on); if (on) v.play().catch(() => {});
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) document.querySelectorAll("[data-promo] video").forEach((v) => { const r = v.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) v.play().catch(() => {}); }); });
