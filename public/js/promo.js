// Event promo videos: play by themselves (muted, on loop) with rounded corners and a "Get Ticket →" button in the
// bottom-right corner. Phones get the lighter 720p file. Videos pause when scrolled out of view to save data and battery,
// and a small speaker button turns the sound on.
import { esc } from "./site.js";
import { icon } from "./icons.js";

const pick = (base) => `${base}-${matchMedia("(max-width: 900px)").matches && devicePixelRatio < 3 ? "720" : "1080"}.mp4`;

/** HTML for an event's promo video. `ticket`: show the Get Ticket button; `href`: where it goes. */
export function promoHtml(ev, { ticket = true, href = null, label = "Get Ticket" } = {}) {
  if (!ev?.cover_video) return "";
  const base = ev.cover_video, url = href || `/event?e=${encodeURIComponent(ev.slug)}`;
  return `<div class="promo" data-promo>
    <video class="promo-v" poster="${esc(base)}-poster.jpg" autoplay muted loop playsinline preload="auto" aria-label="${esc(ev.title)} video">
      <source src="${esc(pick(base))}" type="video/mp4"><source src="${esc(base)}-720.webm" type="video/webm"></video>
    <button type="button" class="promo-sound" data-promo-sound aria-label="Turn sound on" aria-pressed="false">${icon("volumeX")}</button>
    ${ticket ? `<a class="promo-ticket" href="${esc(url)}">${icon("ticket")}<span>${esc(label)}</span>${icon("arrowRight", "arr")}</a>` : ""}
  </div>`;
}

const seen = new WeakSet();
const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries) { const v = e.target; if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }
}, { threshold: 0.25 }) : null;

/** Start the videos inside `root` (autoplay needs muted + a nudge on some phones). */
export function initPromos(root = document) {
  root.querySelectorAll("[data-promo] video").forEach((v) => {
    if (seen.has(v)) return; seen.add(v);
    v.muted = true; v.defaultMuted = true;
    const go = () => v.play().catch(() => {});
    if (v.readyState >= 2) go(); else v.addEventListener("loadeddata", go, { once: true });
    io?.observe(v);
  });
}

document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-promo-sound]"); if (!b) return;
  e.preventDefault();
  const v = b.closest("[data-promo]").querySelector("video");
  v.muted = !v.muted; if (!v.muted) v.play().catch(() => {});
  b.setAttribute("aria-pressed", String(!v.muted)); b.setAttribute("aria-label", v.muted ? "Turn sound on" : "Turn sound off");
  b.classList.toggle("on", !v.muted); b.innerHTML = icon(v.muted ? "volumeX" : "volume2");
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) document.querySelectorAll("[data-promo] video").forEach((v) => { const r = v.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) v.play().catch(() => {}); }); });
