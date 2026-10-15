// Today's Word as art (never plain text). Drawn on a canvas at 1080×1350 (phone / Instagram portrait).
// The AI picks the day's palette, the words to highlight, a tagline and a painted background (see /api/word/art);
// the look rotates from minimal to bold and colourful, and "Shuffle" walks through every style.
export const STYLES = ["minimal-light", "mesh", "minimal-dark", "pop", "rays", "waves", "photo", "editorial", "confetti"];
export const STYLE_NAMES = { "minimal-light": "Clean", mesh: "Glow", "minimal-dark": "Night", pop: "Pop", rays: "Light", waves: "Waves", photo: "Painted", editorial: "Bold", confetti: "Party" };
const W = 1080, H = 1350, PAD = 96;
const SANS = "Jost, 'Helvetica Neue', Arial, sans-serif";
const DEFAULT_PALETTE = ["#1b1340", "#5a3fd0", "#f3b4d6", "#ffd27a"];

let logo;
const loadImg = (src) => new Promise((ok) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
const loadLogo = () => (logo ??= loadImg("/assets/logo-192.png"));
const bgCache = new Map();
const loadBg = (src) => { if (!src) return Promise.resolve(null); if (!bgCache.has(src)) bgCache.set(src, loadImg(src)); return bgCache.get(src); };

function seeded(n) { let s = (Math.abs(n) * 9301 + 49297) % 233280 || 1; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9']/g, "");
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
/** Make sure a colour is dark enough for white text on top. */
function deep(hex, target = 0.06) {
  let n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  for (let i = 0; i < 12 && lum(`#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`) > target; i++) { r *= 0.8; g *= 0.8; b *= 0.8; }
  return `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;
}
function lum(hex) { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }

/** Split the verse into words, marking the highlighted phrase. */
function tokens(text, highlight) {
  const words = text.split(/\s+/).filter(Boolean).map((w) => ({ w, hl: false }));
  if (highlight) {
    const hw = highlight.split(/\s+/).map(norm).filter(Boolean);
    for (let i = 0; i + hw.length <= words.length; i++) if (hw.every((h, j) => norm(words[i + j].w) === h)) { for (let j = 0; j < hw.length; j++) words[i + j].hl = true; break; }
  }
  return words;
}
function layout(x, toks, maxW, font, size, hlFont) {
  x.font = font(size);
  const space = x.measureText(" ").width, lines = [[]];
  let wNow = 0;
  for (const t of toks) {
    if (t.hl && hlFont) x.font = hlFont(size);
    const tw = x.measureText(t.w).width;
    x.font = font(size);
    if (wNow && wNow + space + tw > maxW) { lines.push([]); wNow = 0; }
    lines.at(-1).push({ ...t, tw }); wNow += (wNow ? space : 0) + tw;
  }
  return { lines, space };
}
/** Fit and draw the verse. hl(x, word, px, py, size) can decorate highlighted words. */
function verse(x, w, o) {
  const text = `“${String(w.text || "").trim()}”`, toks = tokens(text, o.highlight);
  const font = (s) => `${o.weight || 500} ${s}px ${SANS}`;
  let size = o.max || 84, L;
  for (; size >= (o.min || 36); size -= 2) { L = layout(x, toks, o.width, font, size, o.hlFont); if (L.lines.length * size * (o.lh || 1.22) <= o.height) break; }
  const lh = size * (o.lh || 1.22), blockH = L.lines.length * lh;
  let y = o.top + (o.valign === "top" ? 0 : Math.max(0, (o.height - blockH) / 2)) + size * 0.9;
  x.font = font(size); x.textBaseline = "alphabetic";
  // Place every word first, then draw highlights underneath, then the words on top.
  const placed = [];
  for (const line of L.lines) {
    const lineW = line.reduce((a, t) => a + t.tw, 0) + L.space * (line.length - 1);
    let px = o.align === "center" ? o.left + (o.width - lineW) / 2 : o.left;
    for (const t of line) { placed.push({ ...t, px, y }); px += t.tw + L.space; }
    y += lh;
  }
  if (o.mark) {
    // One highlight per line for the whole phrase (not word by word).
    const runs = [];
    for (const t of placed) { if (!t.hl) continue; const r = runs.at(-1); if (r && r.y === t.y) r.end = t.px + t.tw; else runs.push({ y: t.y, px: t.px, end: t.px + t.tw }); }
    for (const r of runs) o.mark(x, r.px, r.y, r.end - r.px, size);
  }
  for (const t of placed) {
    x.font = t.hl && o.hlFont ? o.hlFont(size) : font(size);
    x.fillStyle = t.hl && o.hlColor ? o.hlColor : o.color;
    if (o.shadow && !(t.hl && o.mark)) { x.shadowColor = o.shadow; x.shadowBlur = 22; }
    x.fillText(t.w, t.px, t.y); x.shadowBlur = 0;
  }
  x.font = font(size);
  return y - lh + size * 0.35;   // bottom of the text block
}
function header(x, label, color, left = PAD, y = 160, align = "left") {
  x.save(); x.fillStyle = color; x.font = `600 28px ${SANS}`; x.textAlign = align;
  try { x.letterSpacing = "8px"; } catch { /* older browsers */ }
  x.fillText(label, left, y); x.restore();
}
function ref(x, text, y, color, accent, left = PAD, align = "left") {
  x.save(); x.textAlign = align; x.font = `600 38px ${SANS}`;
  if (align === "center") { x.fillStyle = color; x.fillText(text, W / 2, y); x.fillStyle = accent; x.fillRect(W / 2 - 30, y + 26, 60, 5); }
  else { x.fillStyle = accent; x.fillRect(left, y - 12, 60, 5); x.fillStyle = color; x.fillText(text, left + 84, y); }
  x.restore();
}
function tagline(x, t, y, color, left = PAD, align = "left") {
  if (!t) return; x.save(); x.textAlign = align; x.fillStyle = color; x.font = `italic 400 34px ${SANS}`; x.fillText(t, align === "center" ? W / 2 : left, y); x.restore();
}
async function footer(x, dark) {
  const lg = await loadLogo();
  x.fillStyle = dark ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.18)"; x.fillRect(PAD, H - 190, W - PAD * 2, 2);
  if (lg) { x.save(); x.beginPath(); x.arc(PAD + 44, H - 100, 44, 0, Math.PI * 2); x.clip(); x.drawImage(lg, PAD, H - 144, 88, 88); x.restore(); }
  x.fillStyle = dark ? "#151515" : "#fff"; x.font = `600 32px ${SANS}`; x.fillText("Sandton City Church", PAD + 114, H - 108);
  x.fillStyle = dark ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.75)"; x.font = `400 26px ${SANS}`; x.fillText("aogsccyouth.com · Bound in fellowship by the Spirit", PAD + 114, H - 68);
}
const glow = (x, cx, cy, r, col, a) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0)); x.fillStyle = g; x.fillRect(0, 0, W, H); };
const marker = (col) => (x, px, y, tw, s) => { x.save(); x.fillStyle = col; x.translate(px - 12, y - s * 0.8); x.rotate(-0.015); x.beginPath(); x.roundRect(0, 0, tw + 24, s * 1.02, 12); x.fill(); x.restore(); };
const underline = (col) => (x, px, y, tw) => { x.save(); x.strokeStyle = col; x.lineWidth = 6; x.lineCap = "round"; x.beginPath(); x.moveTo(px, y + 14); x.quadraticCurveTo(px + tw / 2, y + 22, px + tw, y + 12); x.stroke(); x.restore(); };
const pill = (col) => (x, px, y, tw, s) => { x.save(); x.fillStyle = col; x.beginPath(); x.roundRect(px - 12, y - s * 0.86, tw + 24, s * 1.08, s * 0.3); x.fill(); x.restore(); };

const DRAW = {
  "minimal-light"(x, w, p) {
    const [, main] = p.palette;
    x.fillStyle = "#faf7f1"; x.fillRect(0, 0, W, H);
    x.strokeStyle = "rgba(0,0,0,.08)"; x.lineWidth = 2; x.strokeRect(40, 40, W - 80, H - 80);
    header(x, "TODAY'S WORD", "#8a8578");
    const end = verse(x, w, { left: PAD, top: 220, width: W - PAD * 2, height: 760, color: "#141414", weight: 400, highlight: p.highlight, hlColor: lum(main) < 0.5 ? main : "#141414", hlFont: (s) => `italic 500 ${s}px ${SANS}`, mark: underline(p.palette[3]) });
    ref(x, w.ref, end + 90, "#141414", main); tagline(x, p.tagline, end + 150, "#6d685e");
    return true;
  },
  "minimal-dark"(x, w, p) {
    const acc = p.palette[3];
    x.fillStyle = "#0e0e10"; x.fillRect(0, 0, W, H);
    x.strokeStyle = hexA(acc, 0.25); x.lineWidth = 2; x.beginPath(); x.arc(W - 120, 160, 260, 0, Math.PI * 2); x.stroke();
    header(x, "TODAY'S WORD", hexA(acc, 0.9));
    const end = verse(x, w, { left: PAD, top: 230, width: W - PAD * 2, height: 760, color: "#f2f2f2", weight: 400, highlight: p.highlight, hlColor: acc });
    ref(x, w.ref, end + 90, "#fff", acc); tagline(x, p.tagline, end + 150, "rgba(255,255,255,.6)");
    return false;
  },
  editorial(x, w, p) {
    const [dark, main, light, acc] = p.palette;
    const bg = lum(light) > 0.6 ? light : "#fff4e6"; x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.fillStyle = main; x.fillRect(0, 0, 26, H);
    header(x, "TODAY'S WORD", hexA(dark, 0.7));
    const big = (p.highlight || p.tagline || "Today's word").toUpperCase();
    x.fillStyle = lum(dark) < 0.3 ? dark : "#141414"; let s = 150; x.font = `800 ${s}px ${SANS}`;
    const words = big.split(" "); const lines = []; let cur = "";
    for (; s > 70; s -= 6) { x.font = `800 ${s}px ${SANS}`; lines.length = 0; cur = ""; for (const wd of words) { const t = cur ? cur + " " + wd : wd; if (x.measureText(t).width > W - PAD * 2 && cur) { lines.push(cur); cur = wd; } else cur = t; } lines.push(cur); if (lines.length * s * 0.98 < 420) break; }
    lines.forEach((l, i) => x.fillText(l, PAD, 300 + i * s * 0.98));
    x.fillStyle = acc; x.fillRect(PAD, 300 + lines.length * s * 0.98 - s * 0.55, 140, 14);
    const end = verse(x, w, { left: PAD, top: 360 + lines.length * s * 0.98, width: W - PAD * 2, height: 1040 - (360 + lines.length * s * 0.98), max: 46, min: 28, color: "#2a2a2a", weight: 400, valign: "top", highlight: p.highlight, hlColor: lum(main) < 0.5 ? main : "#000", hlFont: (q) => `600 ${q}px ${SANS}` });
    ref(x, w.ref, Math.min(end + 80, H - 230), "#141414", main);
    return true;
  },
  mesh(x, w, p) {
    const [d0, main, light, acc] = p.palette, dark = deep(d0), r = seeded(w.number * 7);
    x.fillStyle = dark; x.fillRect(0, 0, W, H);
    [[main, 0.95], [acc, 0.7], [light, 0.6], [main, 0.8], ["#ff5fa2", 0.45]].forEach(([c, a]) => glow(x, r() * W, r() * H, 420 + r() * 380, c, a));
    x.fillStyle = "rgba(0,0,0,.24)"; x.fillRect(0, 0, W, H);
    header(x, "TODAY'S WORD", "#fff");
    const end = verse(x, w, { left: PAD, top: 230, width: W - PAD * 2, height: 760, color: "#fff", shadow: "rgba(0,0,0,.25)", highlight: p.highlight, mark: marker(acc), hlColor: lum(acc) > 0.35 ? "#141414" : "#fff" });
    ref(x, w.ref, end + 90, "#fff", acc); tagline(x, p.tagline, end + 150, "rgba(255,255,255,.85)");
    return false;
  },
  rays(x, w, p) {
    const [d0, m0, light, acc] = p.palette, dark = deep(d0), main = deep(m0, 0.14), r = seeded(w.number);
    const g = x.createLinearGradient(0, 0, W * 0.35, H); g.addColorStop(0, dark); g.addColorStop(1, main); x.fillStyle = g; x.fillRect(0, 0, W, H);
    glow(x, W * 0.85, H * 0.1, 620, light, 0.55); glow(x, W * 0.05, H * 0.95, 560, acc, 0.28);
    x.save(); x.translate(W * 0.92, -40); x.fillStyle = "rgba(255,255,255,.07)";
    for (let i = 0; i < 9; i++) { x.rotate(0.12 + r() * 0.05); x.beginPath(); x.moveTo(0, 0); x.lineTo(-40, H * 1.4); x.lineTo(30, H * 1.4); x.closePath(); x.fill(); }
    x.restore();
    for (let i = 0; i < 46; i++) { x.globalAlpha = 0.25 + r() * 0.55; x.fillStyle = i % 5 ? "#fff" : acc; x.beginPath(); x.arc(r() * W, r() * H, 1 + r() * 2.6, 0, 7); x.fill(); }
    x.globalAlpha = 1;
    header(x, "TODAY'S WORD", acc);
    const end = verse(x, w, { left: PAD, top: 230, width: W - PAD * 2, height: 760, color: "#fff", shadow: "rgba(0,0,0,.25)", highlight: p.highlight, hlColor: acc });
    ref(x, w.ref, end + 90, acc, acc); tagline(x, p.tagline, end + 150, "rgba(255,255,255,.8)");
    return false;
  },
  waves(x, w, p) {
    const [d0, m0, light, acc] = p.palette, dark = deep(d0), main = deep(m0, 0.14);
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, dark); g.addColorStop(0.7, main); x.fillStyle = g; x.fillRect(0, 0, W, H);
    glow(x, W * 0.75, 200, 300, acc, 0.6);
    x.fillStyle = hexA(acc, 0.95); x.beginPath(); x.arc(W * 0.75, 200, 90, 0, 7); x.fill();
    [[light, 0.55, 1010], [acc, 0.75, 1080], [main, 1, 1150], [dark, 1, 1210]].forEach(([c, a, base], i) => {
      x.fillStyle = hexA(c, a); x.shadowColor = "rgba(0,0,0,.25)"; x.shadowBlur = 30; x.beginPath(); x.moveTo(0, H);
      for (let px = 0; px <= W; px += 20) x.lineTo(px, base + Math.sin(px / (180 + i * 40) + i * 1.7) * (34 - i * 4));
      x.lineTo(W, H); x.closePath(); x.fill(); x.shadowBlur = 0;
    });
    header(x, "TODAY'S WORD", "#fff");
    const end = verse(x, w, { left: PAD, top: 230, width: W - PAD * 2 - 60, height: 640, color: "#fff", shadow: "rgba(0,0,0,.3)", highlight: p.highlight, hlColor: acc });
    ref(x, w.ref, Math.min(end + 80, 990), "#fff", acc);
    return false;
  },
  pop(x, w, p) {
    const [dark, main, light, acc] = p.palette, r = seeded(w.number * 13);
    x.fillStyle = main; x.fillRect(0, 0, W, H);
    x.fillStyle = acc; x.beginPath(); x.arc(W - 60, 120, 260, 0, 7); x.fill();
    x.fillStyle = light; x.beginPath(); x.arc(40, H - 160, 220, 0, 7); x.fill();
    x.strokeStyle = dark; x.lineWidth = 14; x.lineCap = "round"; x.beginPath(); x.moveTo(80, 150);
    for (let i = 0; i < 6; i++) x.quadraticCurveTo(110 + i * 60, i % 2 ? 110 : 190, 140 + i * 60, 150); x.stroke();
    for (let i = 0; i < 9; i++) { const sx = r() * W, sy = 260 + r() * 900; x.fillStyle = [acc, light, "#fff", dark][i % 4]; star(x, sx, sy, 14 + r() * 16); }
    // White card
    x.save(); x.shadowColor = hexA(dark, 0.9); x.shadowOffsetX = 18; x.shadowOffsetY = 18; x.fillStyle = "#fff"; x.beginPath(); x.roundRect(70, 250, W - 140, 760, 40); x.fill(); x.restore();
    x.strokeStyle = dark; x.lineWidth = 6; x.beginPath(); x.roundRect(70, 250, W - 140, 760, 40); x.stroke();
    header(x, "TODAY'S WORD", "#141414", 130, 320);
    const end = verse(x, w, { left: 130, top: 350, width: W - 260, height: 520, color: "#141414", weight: 700, highlight: p.highlight, mark: pill(main), hlColor: lum(main) > 0.45 ? "#141414" : "#fff" });
    ref(x, w.ref, Math.min(end + 70, 960), "#141414", main, 130);
    if (p.tagline) { x.save(); x.translate(W - 110, 1050); x.rotate(-0.06); x.font = `700 34px ${SANS}`; const tw = x.measureText(p.tagline).width; x.fillStyle = acc; x.strokeStyle = dark; x.lineWidth = 5; x.beginPath(); x.roundRect(-tw - 44, -50, tw + 44, 72, 36); x.fill(); x.stroke(); x.fillStyle = lum(acc) > 0.45 ? "#141414" : "#fff"; x.textAlign = "right"; x.fillText(p.tagline, -22, -3); x.restore(); }
    return lum(main) > 0.5;
  },
  confetti(x, w, p) {
    const [, main, light, acc] = p.palette, r = seeded(w.number * 31), cols = [main, acc, light, "#ff5fa2", "#36c2ff", "#ffd23f"];
    x.fillStyle = "#fffaf2"; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 140; i++) {
      const cx = r() * W, cy = r() * H; if (cy > 210 && cy < 1080 && cx > 70 && cx < W - 70 && r() < 0.85) continue;
      x.save(); x.translate(cx, cy); x.rotate(r() * 6.28); x.fillStyle = cols[i % cols.length];
      const k = i % 3; if (k === 0) x.fillRect(-10, -4, 20 + r() * 14, 8); else if (k === 1) { x.beginPath(); x.arc(0, 0, 6 + r() * 6, 0, 7); x.fill(); } else star(x, 0, 0, 10 + r() * 8);
      x.restore();
    }
    header(x, "TODAY'S WORD", lum(main) < 0.5 ? main : "#141414", W / 2, 180, "center");
    const end = verse(x, w, { left: PAD, top: 230, width: W - PAD * 2, height: 760, color: "#151515", weight: 700, align: "center", highlight: p.highlight, hlColor: lum(main) < 0.55 ? main : "#d23b6b" });
    ref(x, w.ref, end + 90, "#151515", acc, PAD, "center"); tagline(x, p.tagline, end + 170, "#555", PAD, "center");
    return true;
  },
  async photo(x, w, p) {
    const img = await loadBg(p.bg);
    if (!img) return DRAW.rays(x, w, p);
    const sc = Math.max(W / img.width, H / img.height), iw = img.width * sc, ih = img.height * sc;
    x.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih);
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(0,0,0,.55)"); g.addColorStop(0.5, "rgba(0,0,0,.35)"); g.addColorStop(1, "rgba(0,0,0,.7)"); x.fillStyle = g; x.fillRect(0, 0, W, H);
    header(x, "TODAY'S WORD", p.palette[3]);
    const end = verse(x, w, { left: PAD, top: 230, width: W - PAD * 2, height: 760, color: "#fff", shadow: "rgba(0,0,0,.5)", highlight: p.highlight, hlColor: p.palette[3] });
    ref(x, w.ref, end + 90, "#fff", p.palette[3]); tagline(x, p.tagline, end + 150, "rgba(255,255,255,.85)");
    return false;
  },
};
function star(x, cx, cy, r) { x.beginPath(); for (let i = 0; i < 10; i++) { const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); x.fill(); }

/** Draw the art. plan: { style, palette, highlight, tagline, bg } from /api/word/art (optional). Resolves to a PNG Blob. */
export async function wordArt(w, plan = {}, style) {
  try { await Promise.all([document.fonts.load(`500 60px Jost`), document.fonts.load(`italic 400 40px Jost`), document.fonts.load(`700 60px Jost`)]); } catch { /* system font */ }
  const p = { palette: DEFAULT_PALETTE, highlight: null, tagline: null, bg: null, ...plan };
  if (!Array.isArray(p.palette) || p.palette.length < 4) p.palette = DEFAULT_PALETTE;
  const s = DRAW[style] ? style : DRAW[p.style] ? p.style : "rays";
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  if (!x.roundRect) x.roundRect = function (rx, ry, rw, rh) { this.rect(rx, ry, rw, rh); };
  const dark = await DRAW[s](x, w, p);
  await footer(x, dark);
  return new Promise((ok) => c.toBlob((b) => ok(b), "image/png"));
}

/** Share the art as an image where the phone allows it; otherwise save it. */
export async function shareArt(blob, w) {
  const file = new File([blob], `todays-word-${String(w.ref || "verse").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`, { type: "image/png" });
  const text = `Today's Word from Sandton City Church · ${location.origin}/devotions`;
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], text }); return "shared"; } catch (e) { if (e?.name === "AbortError") return "cancelled"; } }
  saveArt(blob, file.name); return "saved";
}
export function saveArt(blob, name = "todays-word.png") {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
