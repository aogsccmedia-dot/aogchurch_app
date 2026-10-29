// Event promo videos: play by themselves (muted) with rounded corners and a "Get Ticket →" button in the
// bottom-right corner. The video only downloads when it's about to come on screen, and in the size it's shown at
// (720p unless it's displayed big on a sharp screen). Videos pause when scrolled out of view to save data and battery,
// and a small speaker button turns the sound on.
//
// Reel: when an event has extra clips (event.videos), its page plays the main promo and then each clip in turn, on a
// loop. Two stacked video layers take turns: while one plays, the next clip loads underneath, then they crossfade
// with a gentle zoom. Story-style bars along the top show where you are; tap one to jump to that clip.
import { esc } from "./site.js";
import { icon } from "./icons.js";

/** 1080p only when the video is shown wider than 720p can fill sharply. */
const pick = (base, v) => `${base}-${(v.getBoundingClientRect().width || innerWidth) * Math.min(devicePixelRatio || 1, 2) > 1400 ? "1080" : "720"}.mp4`;
function load(v) {
  if (v.dataset.loaded === v.dataset.base) return; v.dataset.loaded = v.dataset.base;
  const base = v.dataset.base;
  v.poster = `${base}-poster.jpg`;
  v.innerHTML = `<source src="${esc(pick(base, v))}" type="video/mp4"><source src="${esc(base)}-720.webm" type="video/webm">`;
  v.preload = "auto"; v.load();
}
const box = (el) => el.closest("[data-promo]");
/** The video that's showing in a promo (in a reel, the one on top). */
const liveVideo = (p) => p.querySelector(".reel-v.on") || p.querySelector("video:not(.reel-v)");
const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };

// Sound: the promo tries to play with sound when it's on screen. Browsers only allow sound after the visitor has
// tapped or clicked the page once, so if it's blocked it plays muted and the sound comes on at the first tap or click.
let wantSound = false, armed = false;
function setSound(p, on) {
  p.querySelectorAll("video").forEach((v) => { v.muted = !on; });   // a reel keeps its sound from clip to clip
  p.dataset.sound = on ? "1" : "";
  const b = p.querySelector("[data-promo-sound]");
  if (b) { b.classList.toggle("on", on); b.innerHTML = icon(on ? "volume2" : "volumeX"); b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", on ? "Turn sound off" : "Turn sound on"); }
}
async function trySound(p) {
  const v = liveVideo(p);
  if (!wantSound || p.dataset.userMuted) { v.play().catch(() => {}); return; }
  setSound(p, true);
  try { await v.play(); }
  catch { setSound(p, false); v.play().catch(() => {}); arm(); }
}
function arm() {
  if (armed) return; armed = true;
  const go = () => {
    ["pointerdown", "keydown", "touchend"].forEach((t) => removeEventListener(t, go, true));
    document.querySelectorAll("[data-promo]").forEach((p) => { if (onScreen(p) && !p.dataset.userMuted) { setSound(p, true); liveVideo(p).play().catch(() => setSound(p, false)); } });
  };
  ["pointerdown", "keydown", "touchend"].forEach((t) => addEventListener(t, go, { capture: true, passive: true }));
}

const soundBtn = () => `<button type="button" class="promo-sound" data-promo-sound aria-label="Turn sound on" aria-pressed="false">${icon("volumeX")}</button>`;
const ticketBtn = (url, label) => `<a class="promo-ticket" href="${esc(url)}">${icon("ticket")}<span>${esc(label)}</span>${icon("arrowRight", "arr")}</a>`;

/** HTML for an event's promo video. `ticket`: show the Get Ticket button; `href`: where it goes; `reel`: rotate the event's extra clips too. */
export function promoHtml(ev, { ticket = true, href = null, label = "Get Ticket", reel = false } = {}) {
  if (!ev?.cover_video) return "";
  const base = ev.cover_video, url = href || `/event?e=${encodeURIComponent(ev.slug)}`;
  const clips = reel && Array.isArray(ev.videos) && ev.videos.length ? [{ src: base, label: ev.title }, ...ev.videos] : null;
  if (clips) {
    return `<div class="promo reel" data-promo data-reel='${esc(JSON.stringify(clips))}'>
    <video class="promo-v reel-v on" poster="${esc(base)}-poster.jpg" muted playsinline preload="none" data-base="${esc(base)}" aria-label="${esc(ev.title)} video"></video>
    <video class="promo-v reel-v" muted playsinline preload="none" aria-hidden="true"></video>
    <div class="reel-bars" role="group" aria-label="Videos">${clips.map((c, i) => `<button type="button" class="reel-bar${i ? "" : " now"}" data-reel-go="${i}" aria-label="Play ${esc(c.label)}"><i></i></button>`).join("")}</div>
    <span class="reel-name" data-reel-name>${esc(clips[0].label)}</span>
    ${soundBtn()}${ticket ? ticketBtn(url, label) : ""}
  </div>`;
  }
  return `<div class="promo" data-promo>
    <video class="promo-v" poster="${esc(base)}-poster.jpg" muted loop playsinline preload="none" data-base="${esc(base)}" aria-label="${esc(ev.title)} video"></video>
    ${soundBtn()}${ticket ? ticketBtn(url, label) : ""}
  </div>`;
}

// ---------------------------------------------------------------- the reel
function reel(p) {
  const clips = JSON.parse(p.dataset.reel);
  const [v1, v2] = p.querySelectorAll(".reel-v");
  const bars = [...p.querySelectorAll(".reel-bar")], name = p.querySelector("[data-reel-name]");
  let idx = 0, live = v1, spare = v2, readyFor = -1, busy = false;
  const next = () => (idx + 1) % clips.length;
  const paint = () => bars.forEach((b, i) => { b.classList.toggle("now", i === idx); b.style.setProperty("--p", i < idx ? "100%" : i > idx ? "0%" : b.style.getPropertyValue("--p") || "0%"); });
  const prepare = (i) => { if (readyFor === i) return; readyFor = i; spare.dataset.base = clips[i].src; spare.muted = live.muted; load(spare); };
  function show(i) {
    if (busy || i === idx && live.dataset.loaded) return;
    busy = true;
    prepare(i);
    const from = live; idx = i; [live, spare] = [spare, live];
    try { live.currentTime = 0; } catch { /* not loaded yet */ }
    live.muted = from.muted;
    live.play().catch(() => {});
    live.classList.add("on"); live.removeAttribute("aria-hidden"); live.setAttribute("aria-label", `${clips[i].label} video`);
    from.classList.remove("on"); from.setAttribute("aria-hidden", "true");
    bars[i].style.setProperty("--p", "0%"); paint();
    name.classList.add("swap"); setTimeout(() => { name.textContent = clips[i].label; name.classList.remove("swap"); }, 250);
    setTimeout(() => { from.pause(); busy = false; }, 750);   // after the crossfade
    readyFor = -1;
  }
  for (const v of [v1, v2]) {
    v.addEventListener("timeupdate", () => {
      if (v !== live || !v.duration) return;
      bars[idx].style.setProperty("--p", `${Math.min(100, (v.currentTime / v.duration) * 100)}%`);
      if (v.currentTime > Math.min(3, v.duration / 3)) prepare(next());   // load the next clip early, so the change is seamless
      if (v.duration - v.currentTime < 0.35) show(next());                 // start the crossfade just before the end
    });
    v.addEventListener("ended", () => { if (v === live) show(next()); });
  }
  p.addEventListener("click", (e) => { const b = e.target.closest("[data-reel-go]"); if (!b) return; e.preventDefault(); show(Number(b.dataset.reelGo)); });
}

// ---------------------------------------------------------------- start and stop with the screen
const seen = new WeakSet();
// Start downloading a little before the video scrolls into view, so it's already playing when it arrives.
const near = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { load(liveVideo(e.target)); near.unobserve(e.target); }
}, { rootMargin: "400px 0px" }) : null;
const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    const p = e.target, v = liveVideo(p);
    if (e.isIntersecting) { load(v); if (wantSound && v.muted && !p.dataset.userMuted) trySound(p); else v.play().catch(() => {}); }
    else { p.querySelectorAll("video").forEach((x) => x.pause()); if (!v.muted) setSound(p, false); }   // never talk from off screen
  }
}, { threshold: 0.25 }) : null;

/** Start the videos inside `root` (autoplay needs muted + a nudge on some phones). */
/** `sound`: try to play with sound while the video is on screen (event page; landing page once scrolled to). */
export function initPromos(root = document, { sound = false } = {}) {
  if (sound) wantSound = true;
  root.querySelectorAll("[data-promo]").forEach((p) => {
    if (seen.has(p)) return; seen.add(p);
    p.querySelectorAll("video").forEach((v) => { v.muted = true; v.defaultMuted = true; });
    if (p.dataset.reel) reel(p);
    const v = liveVideo(p);
    v.addEventListener("loadeddata", () => { if (onScreen(p)) v.play().catch(() => {}); }, { once: true });
    if (near) { near.observe(p); io.observe(p); } else { load(v); v.play().catch(() => {}); }
  });
}

document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-promo-sound]"); if (!b) return;
  e.preventDefault();
  const p = box(b), on = liveVideo(p).muted;
  if (on) delete p.dataset.userMuted; else p.dataset.userMuted = "1";   // muted on purpose: stay quiet
  setSound(p, on); if (on) liveVideo(p).play().catch(() => {});
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) document.querySelectorAll("[data-promo]").forEach((p) => { if (onScreen(p)) liveVideo(p).play().catch(() => {}); }); });
