// Photos rest in black & white and come to colour on hover. On touch screens
// (no hover) and for full-bleed photos, they come alive as they scroll into view.
const touch = matchMedia("(hover: none)").matches;
let io;

export function initPhotos(root = document) {
  io ??= "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const en of entries) en.target.classList.toggle("alive", en.intersectionRatio >= 0.55);
      }, { threshold: [0, 0.55, 1] })
    : null;
  const targets = root.querySelectorAll(touch ? ".photo" : ".photo[data-scroll-color]");
  targets.forEach((el) => (io ? io.observe(el) : el.classList.add("alive")));
}
