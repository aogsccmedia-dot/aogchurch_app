// People's faces: their photo when they have one, otherwise a friendly "blank face" picked from a set of
// illustrated avatars (different backgrounds, skin tones, hair and clothes), always the same one for the same person.
const BG = ["#e3eefd", "#ece4fd", "#fde6f0", "#e3f5ea", "#fff1d9", "#e6f3f7", "#f3e9e1", "#eceaf3"];
const SKIN = ["#f1c9a5", "#d9a37a", "#b97a52", "#8d5a3b", "#5e3a26"];
const HAIR = ["#1d1b26", "#3b2a20", "#6b4a2b", "#a07a4a", "#2c2c34"];
const SHIRT = ["#6b5aa8", "#c8963e", "#2f7a4d", "#d06a8c", "#4a90d9", "#111016", "#8b6fe0", "#c0412f"];

function hash(s) { let h = 2166136261; for (const c of String(s || "?")) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

const HAIRS = [
  (c) => `<path d="M30 40c0-12 8-19 20-19s20 7 20 19c-3-5-9-8-20-8s-17 3-20 8z" fill="${c}"/>`,                          // short
  (c) => `<circle cx="50" cy="36" r="21" fill="${c}"/>`,                                                                     // round / afro
  (c) => `<path d="M28 42c0-14 9-22 22-22s22 8 22 22v22c-4-6-6-14-6-22-5 3-11 4-16 4s-11-1-16-4c0 8-2 16-6 22z" fill="${c}"/>`, // long
  (c) => `<path d="M29 37c2-11 10-17 21-17s19 6 21 17c-6-3-13-5-21-5s-15 2-21 5z" fill="${c}"/><rect x="29" y="33" width="42" height="5" rx="2.5" fill="${c}"/>`, // cap
  (c) => `<path d="M27 40c0-13 10-21 23-21s23 8 23 21c0 4-2 6-4 6-3-7-10-11-19-11s-16 4-19 11c-2 0-4-2-4-6z" fill="${c}"/>`,    // headwrap
];

/** An illustrated face with no features, chosen from `seed` (their id, email or name). */
export function blankFace(seed) {
  const h = hash(seed);
  const bg = BG[h % BG.length], skin = SKIN[(h >>> 3) % SKIN.length], hair = HAIR[(h >>> 6) % HAIR.length];
  const shirt = SHIRT[(h >>> 9) % SHIRT.length], style = HAIRS[(h >>> 12) % HAIRS.length];
  const wrap = (h >>> 12) % HAIRS.length === 4 ? SHIRT[(h >>> 15) % SHIRT.length] : hair;
  const behind = (h >>> 12) % HAIRS.length === 1;   // a round afro sits behind the head
  return `<svg viewBox="12 12 76 88" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" class="blank-face"><rect x="0" y="0" width="100" height="100" fill="${bg}"/>
    ${behind ? style(wrap) : ""}<path d="M18 100c2-20 15-30 32-30s30 10 32 30z" fill="${shirt}"/><rect x="43" y="56" width="14" height="16" rx="6" fill="${skin}"/>
    <ellipse cx="50" cy="44" rx="17" ry="19" fill="${skin}"/>${behind ? "" : style(wrap)}</svg>`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** Inner HTML for a round avatar: their photo (sharp, cropped to the face) or their blank face. */
export function faceInner(p) {
  // Google photos come small by default; ask for a sharper one.
  const src = p?.picture ? String(p.picture).replace(/=s\d+(-c)?$/, "=s256-c") : "";
  return src ? `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer" loading="lazy" decoding="async">` : blankFace(p?.id || p?.email || p?.name);
}
/** A complete avatar element. */
export function face(p, cls = "") { return `<span class="face-av ${cls}">${faceInner(p)}</span>`; }
