// Daily Word: today's verse, a question, a prayer prompt, "I've read it & prayed", streak and community count.
import { api, esc, toast } from "./site.js";
import { openSignIn, whenSignedIn } from "./auth.js";
import { icon } from "./icons.js";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function dots(last7) {
  return `<div class="word-week" aria-label="Last 7 days">${last7.map((d) => {
    const day = DOW[new Date(d.day + "T12:00:00Z").getUTCDay()];
    return `<span class="${d.done ? "on" : ""}" title="${esc(d.day)}"><i></i>${day}</span>`;
  }).join("")}</div>`;
}

function render(el, data) {
  const { word: w, readers_today: readers, me } = data;
  const compact = el.dataset.word === "compact";
  const status = me
    ? me.done
      ? `<div class="word-done">${icon("check")} Done for today <span class="streak">${icon("flame")} ${me.streak}-day streak</span></div>`
      : `<button class="btn btn-green" type="button" data-word-done>${icon("bookOpen")} I've read it &amp; prayed</button>${me.streak ? `<span class="streak">${icon("flame")} ${me.streak}-day streak, keep it going!</span>` : ""}`
    : `<button class="btn btn-green" type="button" data-word-signin>${icon("bookOpen")} Sign in to start your streak</button>`;
  el.innerHTML = `<article class="word-card ${compact ? "compact" : ""}">
    <div class="word-main">
      <p class="eyebrow">Today's Word · Day ${w.number} of ${w.of}</p>
      <blockquote class="word-verse">“${esc(w.text)}”</blockquote>
      <p class="word-ref">${esc(w.ref)} <span>KJV</span> · <a href="${esc(w.read_url)}" target="_blank" rel="noopener">Read the chapter ${icon("externalLink")}</a></p>
      ${compact ? "" : `<div class="word-prompts"><p><b>Think about it</b>${esc(w.reflect)}</p><p><b>Pray</b>${esc(w.pray)}</p></div>`}
    </div>
    <aside class="word-side">
      <div class="word-actions">${status}</div>
      ${me ? dots(me.last7) : ""}
      <p class="word-community">${icon("users")} ${readers ? `<b>${readers}</b> ${readers === 1 ? "person has" : "people have"} read today` : "Be the first to read today"}</p>
      <button class="btn btn-ghost btn-sm" type="button" data-word-share>${icon("share")} Share today's verse</button>
    </aside>
  </article>`;
  el.querySelector("[data-word-signin]")?.addEventListener("click", openSignIn);
  el.querySelector("[data-word-done]")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api("/api/word/today", { method: "POST" });
      render(el, { ...data, ...r });
      toast(r.me.streak > 1 ? `🔥 ${r.me.streak} days in a row. Amazing!` : "Day one done. See you tomorrow! 🙌");
    } catch (err) { toast(err.message); e.currentTarget.disabled = false; }
  });
  el.querySelector("[data-word-share]").addEventListener("click", async () => {
    const text = `“${w.text}” ${w.ref}\n\nToday's Word from Sandton City Church`;
    try { if (navigator.share) await navigator.share({ text, url: location.origin + "/#word" }); else { await navigator.clipboard.writeText(text + "\n" + location.origin); toast("Verse copied"); } } catch { /* cancelled */ }
  });
}

export async function loadWord() {
  const els = document.querySelectorAll("[data-word]");
  if (!els.length) return;
  try { const data = await api("/api/word/today"); els.forEach((el) => render(el, data)); } catch { els.forEach((el) => { el.hidden = true; }); }
}
loadWord();
whenSignedIn(loadWord);
