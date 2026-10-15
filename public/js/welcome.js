// Animated "Welcome" (inspired by a hand-drawn "Hey" animation): a smiley appears, its smile
// stretches and melts away, then "Welcome" writes itself in one continuous line.
// Used after joining, for newly verified members and on the weekly-letter welcome.
import { esc } from "./site.js";

export { WELCOME_SVG } from "./welcome-art.js";
import { WELCOME_SVG } from "./welcome-art.js";

/** Full-screen welcome moment. Resolves when the person continues. */
export function showWelcome({ title = "", line = "", actions = [] } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "welcome-screen";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Welcome");
    el.innerHTML = `<div class="welcome-blobs" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="welcome-inner">${WELCOME_SVG}
        <h2 class="welcome-title">${esc(title)}</h2>
        ${line ? `<p class="welcome-line">${esc(line)}</p>` : ""}
        <div class="welcome-actions">${actions.map((a, i) => `<a class="btn ${i === 0 ? "btn-green" : ""}" href="${esc(a.href || "#")}" data-i="${i}">${esc(a.label)}</a>`).join("")}
          <button class="btn btn-ghost" type="button" data-close>Continue</button></div>
      </div>`;
    document.body.append(el);
    document.body.style.overflow = "hidden";
    const close = () => { el.classList.add("out"); document.body.style.overflow = ""; setTimeout(() => el.remove(), 450); resolve(); };
    el.querySelector("[data-close]").addEventListener("click", close);
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    requestAnimationFrame(() => { el.classList.add("play"); el.querySelector("[data-close]").focus({ preventScroll: true }); });
  });
}
