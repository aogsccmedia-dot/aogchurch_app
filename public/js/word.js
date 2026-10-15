// Daily Word: today's verse, a question, a prayer prompt, "I've read it & prayed" and how many read today.
import { api, esc, toast } from "./site.js";
import { openSignIn, whenSignedIn } from "./auth.js";
import { icon } from "./icons.js";
import { STYLES, STYLE_NAMES, saveArt, shareArt, wordArt } from "./word-art.js";



// Today's Word is always shown as art (an image), never as plain text. The words stay in the image's alt text for screen readers.
// The AI sets the day's look (/api/word/art); "Shuffle" walks through every style, from clean and minimal to full colour.
let PLAN = null, style = null;
const planP = fetch("/api/word/art").then((r) => r.json()).then((d) => (PLAN = d.plan)).catch(() => null);
const arts = new Map();
const art = async (w) => {
  await planP;
  style ??= PLAN?.style || STYLES[(Number(w.number) || 0) % STYLES.length];
  const k = `${w.ref}|${style}`;
  if (!arts.has(k)) arts.set(k, wordArt(w, PLAN || {}, style));
  return arts.get(k);
};
const figure = (w) => `<figure class="word-art" data-art><img alt="${esc(`Today's Word: “${w.text}” ${w.ref}`)}" width="1080" height="1350" hidden><span class="word-art-wait" aria-hidden="true"></span></figure>`;
const shuffleBtn = `<button class="btn btn-ghost btn-sm" type="button" data-art-shuffle>${icon("sparkles")} <span>Shuffle look</span></button>`;
function paintArt(el, w) {
  const show = () => art(w).then((blob) => {
    const img = el.querySelector("[data-art] img"); if (!img || !blob) return;
    img.src = URL.createObjectURL(blob); img.hidden = false; el.querySelector(".word-art-wait")?.remove();
    const lab = el.querySelector("[data-art-shuffle] span"); if (lab) lab.textContent = `Shuffle look · ${STYLE_NAMES[style] || ""}`;
  });
  show();
  el.querySelectorAll("[data-art-share]").forEach((b) => b.addEventListener("click", async () => {
    const r = await shareArt(await art(w), w); if (r === "saved") toast("Image saved");
  }));
  el.querySelectorAll("[data-art-save]").forEach((b) => b.addEventListener("click", async () => { saveArt(await art(w)); toast("Image saved"); }));
  el.querySelectorAll("[data-art-shuffle]").forEach((b) => b.addEventListener("click", async () => {
    style = STYLES[(STYLES.indexOf(style) + 1) % STYLES.length];
    b.disabled = true; await show(); b.disabled = false;
    document.querySelectorAll("[data-word]").forEach((other) => { if (other !== el) other.querySelector("[data-art-shuffle]") && paintArtImg(other, w); });
  }));
}
function paintArtImg(el, w) { art(w).then((blob) => { const img = el.querySelector("[data-art] img"); if (img && blob) { img.src = URL.createObjectURL(blob); img.hidden = false; } }); }

function render(el, data) {
  const { word: w, readers_today: readers, me } = data;
  if (el.dataset.word === "art") {
    // Website: just the artwork with share and save.
    el.innerHTML = `<div class="word-art-only">${figure(w)}<div class="word-art-actions">
      <button class="btn btn-gold" type="button" data-art-share>${icon("share")} Share image</button>
      <button class="btn" type="button" data-art-save>${icon("download")} Save</button>
      ${shuffleBtn}
      <a class="btn btn-ghost" href="/devotions">${icon("bookOpen")} Read &amp; pray</a></div></div>`;
    paintArt(el, w);
    return;
  }
  const compact = el.dataset.word === "compact";
  const status = me
    ? me.done
      ? `<div class="word-done">${icon("check")} Read &amp; prayed today</div>`
      : `<button class="btn btn-green" type="button" data-word-done>${icon("bookOpen")} I've read it &amp; prayed</button>`
    : `<button class="btn btn-green" type="button" data-word-signin>${icon("bookOpen")} Sign in to join in</button>`;
  el.innerHTML = `<article class="word-card ${compact ? "compact" : ""}">
    <div class="word-main">
      <p class="eyebrow">Today's Word · Day ${w.number} of ${w.of}</p>
      ${figure(w)}
      <p class="word-ref">${esc(w.ref)} <span>KJV</span> · <a href="${esc(w.read_url)}" target="_blank" rel="noopener">Read the chapter ${icon("externalLink")}</a></p>
      ${compact ? "" : `<div class="word-prompts"><p><b>Think about it</b>${esc(w.reflect)}</p><p><b>Pray</b>${esc(w.pray)}</p></div>`}
    </div>
    <aside class="word-side">
      <div class="word-actions">${status}</div>
      <p class="word-community">${icon("users")} ${readers ? `<b>${readers}</b> ${readers === 1 ? "person has" : "people have"} read today` : "Be the first to read today"}</p>
      <div class="word-art-actions"><button class="btn btn-gold btn-sm" type="button" data-art-share>${icon("share")} Share image</button><button class="btn btn-ghost btn-sm" type="button" data-art-save>${icon("download")} Save</button>${shuffleBtn}</div>
    </aside>
  </article>`;
  el.querySelector("[data-word-signin]")?.addEventListener("click", openSignIn);
  el.querySelector("[data-word-done]")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api("/api/word/today", { method: "POST" });
      render(el, { ...data, ...r });
      toast("Amen 🙏 See you tomorrow.");
    } catch (err) { toast(err.message); e.currentTarget.disabled = false; }
  });
  paintArt(el, w);
}

export async function loadWord() {
  const els = document.querySelectorAll("[data-word]");
  if (!els.length) return;
  try { const data = await api("/api/word/today"); els.forEach((el) => render(el, data)); } catch { els.forEach((el) => { el.hidden = true; }); }
}
loadWord();
whenSignedIn(loadWord);
