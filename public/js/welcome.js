// Animated "Welcome" (inspired by a hand-drawn "Hey" animation): a smiley appears, its smile
// stretches and melts away, then "Welcome" writes itself in one continuous line.
// Used after joining, for newly verified members and on the weekly-letter welcome.
import { esc } from "./site.js";

export const WELCOME_SVG = `<svg class="welcome-art" viewBox="0 0 580 220" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="9" role="img" aria-label="Welcome">
  <g class="w-face"><path class="w-eye" d="M268 86 L268 86.5" pathLength="1"/><path class="w-eye" d="M312 86 L312 86.5" pathLength="1"/><path class="w-smile" d="M250 118 C270 142 310 142 330 118" pathLength="1"/></g>
  <path class="w-word w-1" d="M40 62 C46 98 56 138 66 148 C74 156 84 124 94 94 C100 120 108 150 118 150 C130 150 142 102 150 62" pathLength="1"/><path class="w-word w-2" d="M162 128 C180 128 196 118 196 104 C196 92 184 88 175 92 C160 99 156 120 162 136 C168 150 186 152 200 146 C214 138 226 110 232 82 C238 54 230 38 222 44 C212 52 214 110 220 136 C224 150 236 152 246 146 C258 140 268 116 280 108 C286 104 294 104 294 110 C290 103 272 104 266 120 C260 136 268 152 284 150 C294 149 306 142 316 134 C318 116 328 104 344 104 C358 104 364 120 360 134 C356 148 338 154 330 144 C322 134 330 108 350 106 C360 105 370 108 378 112 C384 120 388 132 388 150 C390 124 398 104 410 104 C420 104 422 116 422 150 C424 122 432 104 444 104 C454 104 456 116 456 140 C458 148 468 150 478 146 C494 142 512 128 512 112 C512 100 502 96 494 100 C480 106 474 128 480 142 C486 154 506 154 522 144 C532 138 540 130 544 124" pathLength="1"/>
</svg>`;

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
