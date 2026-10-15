// Poster maker: 1 service & date → 2 details → 3 photo (optional, never altered) → 4 look, then share or download.
import { api, esc, toast } from "./site.js";
import { getMe, whenSignedIn } from "./auth.js";
import { icon } from "./icons.js";
import { PALETTES, THEMES, drawPoster } from "./poster-art.js";

const $ = (id) => document.getElementById(id);
const S = { step: 1, size: "post", theme: "glow", palette: PALETTES[0], svc: null, date: "", photo: null, photoUrl: null, shape: "circle", focus: 35, scene: "light", bgV: 0, headline: "", blob: null };
let OPT = null, drawing = 0, timer = 0;
const long = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const wd = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-ZA", { weekday: "long", timeZone: "UTC" });
const short = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(",", "");
const loadImg = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
const bgCache = new Map();

function svc() { return OPT?.services.find((s) => s.id === S.svc); }
function planned() { return svc()?.planned.find((p) => p.date === S.date); }

async function render() {
  const n = ++drawing, s = svc();
  if (!s) return;
  let bg = null;
  if (S.theme === "painted") {
    const key = `${S.scene}:${S.bgV}`;
    if (!bgCache.has(key)) bgCache.set(key, loadImg(`/api/poster/bg?scene=${encodeURIComponent(S.scene)}&v=${S.bgV}`));
    $("pm-canvas").classList.add("busy");
    bg = await bgCache.get(key);
    if (!bg) { bgCache.delete(key); toast("The painted background isn't ready right now. Showing a plain look."); }
  }
  const blob = await drawPoster({
    size: S.size, theme: S.theme, palette: S.palette, service: s.title, eyebrow: s.title,
    headline: $("pm-topic").value.trim() ? (S.headline && S.headlineFor === $("pm-topic").value.trim() ? S.headline : $("pm-topic").value.trim()) : s.title,
    tagline: $("pm-tagline").value.trim(), weekday: S.date ? wd(S.date) : s.day_label, dateLine: S.date ? long(S.date) : "", time: s.time,
    speaker: $("pm-speaker").value.trim(), word: $("pm-word").value.trim(), address: OPT.address, photo: S.photo, shape: S.shape, focus: S.focus, bg,
  });
  if (n !== drawing || !blob) return;
  S.blob = blob;
  const im = $("pm-img"); if (im.src) URL.revokeObjectURL(im.src);
  im.src = URL.createObjectURL(blob); im.hidden = false;
  $("pm-canvas").querySelector(".word-art-wait")?.remove(); $("pm-canvas").classList.remove("busy");
  $("pm-canvas").dataset.size = S.size;
}
const redraw = () => { clearTimeout(timer); timer = setTimeout(render, 180); };

function drawServices() {
  $("pm-svcs").innerHTML = OPT.services.map((s) => `<button type="button" class="pm-svc" data-svc="${esc(s.id)}" aria-pressed="${s.id === S.svc}">
    <b>${esc(s.day_label)}</b><span>${esc(s.title)}</span><small>${esc(s.time || "")}${s.frequency === "twice_monthly" ? " · twice a month" : s.frequency === "monthly" ? " · monthly" : ""}</small></button>`).join("")
    || `<p class="muted-text">No weekday services are set up yet.</p>`;
}
function drawDates() {
  const s = svc(); if (!s) return;
  const ny = $("pm-next-year").checked, list = [...s.dates, ...(ny ? s.dates_next_year : [])];
  if (!list.includes(S.date)) S.date = list[0] || "";
  $("pm-date").innerHTML = list.map((d) => `<option value="${d}" ${d === S.date ? "selected" : ""}>${esc(short(d))}${d === OPT.today ? " · today" : ""}${s.planned.some((p) => p.date === d) ? " · planned" : ""}</option>`).join("")
    || `<option value="">No more ${esc(s.day_label)}s this year. Tick ${OPT.next_year} dates.</option>`;
  $("pm-date-hint").textContent = S.date ? `${wd(S.date)} ${long(S.date)}${s.time ? `, ${s.time}` : ""}. Only today and upcoming dates can be used.` : "";
}
function fillPlanned() {
  const p = planned(); if (!p) return;
  if (!$("pm-topic").value && p.topic) $("pm-topic").value = p.topic;
  if (!$("pm-speaker").value && p.speaker) $("pm-speaker").value = p.speaker;
  if (!$("pm-word").value && p.scripture) $("pm-word").value = p.scripture.split(/[·(—-]/)[0].trim().slice(0, 60);
}
function drawLook() {
  $("pm-themes").innerHTML = THEMES.map(([k, l]) => `<button type="button" class="pm-theme t-${k}" data-theme="${k}" aria-pressed="${k === S.theme}"><i></i><span>${l}</span></button>`).join("")
    + (S.theme === "painted" ? `<button type="button" class="pm-theme pm-repaint" data-repaint>${icon("sparkles")}<span>New painting</span></button>` : "");
  $("pm-pals").innerHTML = PALETTES.map((p, i) => `<button type="button" class="pm-pal" data-pal="${i}" aria-pressed="${p.join() === S.palette.join()}" aria-label="Colours ${i + 1}">${p.map((c) => `<i style="background:${c}"></i>`).join("")}</button>`).join("")
    + (S.aiPalette ? `<button type="button" class="pm-pal" data-pal="ai" aria-pressed="${S.aiPalette.join() === S.palette.join()}" aria-label="AI colours">${S.aiPalette.map((c) => `<i style="background:${c}"></i>`).join("")}<b>AI</b></button>` : "");
}

function go(step) {
  if (step === 2 && !S.date) { toast("Choose a date first."); return; }
  if (step === 3 && !$("pm-topic").value.trim()) { toast("Add the topic or theme."); $("pm-topic").focus(); return; }
  S.step = step;
  document.querySelectorAll(".pm-step").forEach((el) => { el.hidden = Number(el.dataset.step) !== step; });
  document.querySelectorAll("[data-dot]").forEach((el) => { el.classList.toggle("on", Number(el.dataset.dot) <= step); });
  $("pm-back").hidden = step === 1; $("pm-next").hidden = step === 4;
  if (step === 2) fillPlanned();
  if (step === 4) drawLook();
  redraw();
  if (matchMedia("(max-width: 860px)").matches) document.querySelector(".pm-steps").scrollIntoView({ block: "start", behavior: "smooth" });
}

async function start() {
  const me = await getMe();
  if (!me.user) { location.href = "/me"; return; }
  try { OPT = await api("/api/poster/options"); }
  catch (e) { document.querySelector(".pm-grid").innerHTML = `<div class="notice">${esc(e.message)}</div>`; return; }
  $("pm-ny-label").textContent = `Show ${OPT.next_year} dates too`;
  // Default: the next service from today.
  const soonest = OPT.services.filter((s) => s.dates.length).sort((a, b) => a.dates[0].localeCompare(b.dates[0]))[0];
  S.svc = soonest?.id || OPT.services[0]?.id || null;
  drawServices(); drawDates(); fillPlanned(); render();
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-svc],[data-size],[data-theme],[data-pal],[data-shape],[data-repaint]");
  if (!b) return;
  if (b.dataset.svc) { S.svc = b.dataset.svc; drawServices(); drawDates(); }
  if (b.dataset.size) { S.size = b.dataset.size; document.querySelectorAll("[data-size]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }
  if (b.dataset.theme) { S.theme = b.dataset.theme; drawLook(); }
  if (b.dataset.pal) { S.palette = b.dataset.pal === "ai" ? S.aiPalette : PALETTES[Number(b.dataset.pal)]; drawLook(); }
  if (b.dataset.shape) { S.shape = b.dataset.shape; document.querySelectorAll("[data-shape]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }
  if (b.hasAttribute("data-repaint")) S.bgV = (S.bgV + 1) % 3;
  redraw();
});
$("pm-date").addEventListener("change", () => { S.date = $("pm-date").value; drawDates(); redraw(); });
$("pm-next-year").addEventListener("change", () => { drawDates(); redraw(); });
["pm-topic", "pm-speaker", "pm-word", "pm-tagline"].forEach((id) => $(id).addEventListener("input", redraw));
$("pm-next").addEventListener("click", () => go(S.step + 1));
$("pm-back").addEventListener("click", () => go(S.step - 1));
document.querySelectorAll("[data-dot]").forEach((d) => d.addEventListener("click", () => go(Number(d.dataset.dot))));
$("pm-focus").addEventListener("input", () => { S.focus = Number($("pm-focus").value); redraw(); });
$("pm-photo").addEventListener("change", async () => {
  const f = $("pm-photo").files[0]; if (!f) return;
  if (S.photoUrl) URL.revokeObjectURL(S.photoUrl);
  S.photoUrl = URL.createObjectURL(f); S.photo = await loadImg(S.photoUrl);   // stays on this phone: never uploaded, never changed
  $("pm-photo-opts").hidden = !S.photo; $("pm-file-label").textContent = S.photo ? "Change photo" : "Choose a photo";
  redraw();
});
$("pm-photo-x").addEventListener("click", () => { S.photo = null; $("pm-photo").value = ""; $("pm-photo-opts").hidden = true; $("pm-file-label").textContent = "Choose a photo"; redraw(); });
$("pm-ai").addEventListener("click", async (e) => {
  const btn = e.currentTarget, s = svc();
  btn.disabled = true; const label = btn.innerHTML; btn.innerHTML = `${icon("sparkles")} Thinking…`;
  try {
    const r = await api("/api/poster/suggest", { method: "POST", body: { service: s?.title, topic: $("pm-topic").value, scripture: $("pm-word").value, speaker: $("pm-speaker").value } });
    if (r.headline) { S.headline = r.headline; S.headlineFor = $("pm-topic").value.trim(); }
    if (r.tagline && !$("pm-tagline").value) $("pm-tagline").value = r.tagline;
    if (r.palette) { S.aiPalette = r.palette; S.palette = r.palette; }
    if (r.scene) S.scene = r.scene;
    toast(r.ai ? "Here's an idea. Change anything you like." : "Suggestions aren't available right now.");
    redraw();
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; btn.innerHTML = label; }
});
const fileName = () => `${(svc()?.title || "poster").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${S.date}.png`;
function download() { if (!S.blob) return; const a = document.createElement("a"); a.href = URL.createObjectURL(S.blob); a.download = fileName(); document.body.append(a); a.click(); a.remove(); toast("Poster saved"); }
$("pm-save").addEventListener("click", download);
$("pm-share").addEventListener("click", async () => {
  if (!S.blob) return;
  const file = new File([S.blob], fileName(), { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], text: `${svc()?.title}: ${long(S.date)} · Sandton City Church` }); return; } catch (err) { if (err?.name === "AbortError") return; } }
  download();
});

whenSignedIn(() => start());
start().catch((e) => toast(e.message));
