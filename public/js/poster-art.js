// Poster drawing for the poster maker. Pure canvas: photos are only scaled, cropped and placed, never altered.
export const SIZES = { post: [1080, 1350], story: [1080, 1920], square: [1080, 1080] };
export const THEMES = [
  ["clean", "Clean"], ["night", "Night"], ["glow", "Glow"], ["pop", "Pop"], ["bold", "Bold"], ["waves", "Waves"], ["painted", "Painted"], ["party", "Party"],
];
export const PALETTES = [
  ["#1b1340", "#5a3fd0", "#f3b4d6", "#ffd27a"], ["#0d2b2a", "#1f7d6c", "#a8f0d6", "#f7d68f"], ["#2b0e1e", "#c23f5f", "#ffc3a3", "#ffe2a8"],
  ["#0a1d3b", "#2c6ade", "#a6e2ff", "#ffe08a"], ["#24170a", "#b9822f", "#ffe4b0", "#fff3da"], ["#ff3d7f", "#ffb800", "#00b8ff", "#7cff6b"],
  ["#00c9a7", "#845ec2", "#ffc75f", "#f9f871"], ["#111111", "#3a3a3a", "#e9e9e9", "#d6a650"],
];
const SANS = "Jost, 'Helvetica Neue', Arial, sans-serif";
const img = (src) => new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
let logoP;
const logo = () => (logoP ??= img("/assets/logo-192.png"));

function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function lum(hex) { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function deep(hex, target = 0.06) {
  let n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const h = () => `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;
  for (let i = 0; i < 14 && lum(h()) > target; i++) { r *= 0.8; g *= 0.8; b *= 0.8; }
  return h();
}
function seeded(n) { let s = (Math.abs(n) * 9301 + 49297) % 233280 || 1; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
function star(x, cx, cy, r) { x.beginPath(); for (let i = 0; i < 10; i++) { const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); x.fill(); }
const glow = (x, W, H, cx, cy, r, col, a) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0)); x.fillStyle = g; x.fillRect(0, 0, W, H); };
function lines(x, text, maxW) { const out = []; let cur = ""; for (const w of String(text).split(/\s+/).filter(Boolean)) { const t = cur ? cur + " " + w : w; if (x.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }
function fit(x, text, maxW, maxH, weight, max, min, lh = 1.05, upper = false) {
  const t = upper ? String(text).toUpperCase() : String(text);
  for (let s = max; s >= min; s -= 4) { x.font = `${weight} ${s}px ${SANS}`; const L = lines(x, t, maxW); if (L.length * s * lh <= maxH) return { s, L }; }
  x.font = `${weight} ${min}px ${SANS}`; return { s: min, L: lines(x, t, maxW) };
}
/** Draw a photo into a shape, cropping only (cover), with a vertical focus 0–100. */
function placePhoto(x, ph, rx, ry, rw, rh, focus) {
  const sc = Math.max(rw / ph.width, rh / ph.height), iw = ph.width * sc, ih = ph.height * sc;
  x.drawImage(ph, rx + (rw - iw) / 2, ry + (rh - ih) * (focus / 100), iw, ih);
}

const BG = {
  clean(x, W, H, p) { x.fillStyle = "#faf7f1"; x.fillRect(0, 0, W, H); x.strokeStyle = "rgba(0,0,0,.08)"; x.lineWidth = 3; x.strokeRect(36, 36, W - 72, H - 72); return { ink: "#141414", sub: "#5c574f", acc: lum(p[1]) < 0.4 ? p[1] : deep(p[1], 0.15), pill: "#141414", pillInk: "#fff" }; },
  night(x, W, H, p) { x.fillStyle = "#0e0e10"; x.fillRect(0, 0, W, H); x.strokeStyle = hexA(p[3], 0.22); x.lineWidth = 3; for (const r of [220, 320]) { x.beginPath(); x.arc(W - 90, 140, r, 0, 7); x.stroke(); } return { ink: "#fff", sub: "rgba(255,255,255,.7)", acc: p[3], pill: p[3], pillInk: lum(p[3]) > 0.4 ? "#141414" : "#fff" }; },
  glow(x, W, H, p, r) { x.fillStyle = deep(p[0]); x.fillRect(0, 0, W, H); [[p[1], 0.95], [p[3], 0.65], [p[2], 0.55], ["#ff5fa2", 0.4]].forEach(([c, a]) => glow(x, W, H, r() * W, r() * H, 420 + r() * 400, c, a)); x.fillStyle = "rgba(0,0,0,.25)"; x.fillRect(0, 0, W, H); return { ink: "#fff", sub: "rgba(255,255,255,.82)", acc: p[3], pill: "#fff", pillInk: "#141414" }; },
  pop(x, W, H, p, r) {
    x.fillStyle = p[1]; x.fillRect(0, 0, W, H);
    x.fillStyle = p[3]; x.beginPath(); x.arc(W - 40, 120, 250, 0, 7); x.fill();
    x.fillStyle = p[2]; x.beginPath(); x.arc(30, H * 0.62, 200, 0, 7); x.fill();
    for (let i = 0; i < 10; i++) { x.fillStyle = [p[3], p[2], "#fff", p[0]][i % 4]; const sx = r() < 0.5 ? r() * 70 + 10 : W - 10 - r() * 70; star(x, sx, 160 + r() * (H - 320), 12 + r() * 16); }
    const dark = lum(p[1]) > 0.42; return { ink: dark ? "#141414" : "#fff", sub: dark ? "rgba(0,0,0,.72)" : "rgba(255,255,255,.85)", acc: dark ? "#141414" : p[3], pill: p[0], pillInk: "#fff", shadow: true };
  },
  bold(x, W, H, p) { const bg = lum(p[2]) > 0.55 ? p[2] : "#fff4e6"; x.fillStyle = bg; x.fillRect(0, 0, W, H); x.fillStyle = p[1]; x.fillRect(0, 0, 28, H); return { ink: "#141414", sub: "#3f3a33", acc: lum(p[1]) < 0.45 ? p[1] : deep(p[1], 0.12), pill: p[1], pillInk: lum(p[1]) > 0.45 ? "#141414" : "#fff", upper: true }; },
  waves(x, W, H, p) {
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, deep(p[0])); g.addColorStop(1, deep(p[1], 0.14)); x.fillStyle = g; x.fillRect(0, 0, W, H);
    [[p[2], 0.18, 0.2], [p[3], 0.2, 0.28], [p[1], 0.35, 0.36]].forEach(([c, a, k], i) => { x.fillStyle = hexA(c, a); x.beginPath(); x.moveTo(0, 0); for (let px = 0; px <= W; px += 20) x.lineTo(px, H * k + Math.sin(px / (170 + i * 40) + i) * 30); x.lineTo(W, 0); x.closePath(); x.fill(); });
    return { ink: "#fff", sub: "rgba(255,255,255,.8)", acc: p[3], pill: p[3], pillInk: lum(p[3]) > 0.4 ? "#141414" : "#fff" };
  },
  party(x, W, H, p, r) {
    x.fillStyle = "#fffaf2"; x.fillRect(0, 0, W, H); const cols = [p[1], p[3], p[2], "#ff5fa2", "#36c2ff", "#ffd23f"];
    for (let i = 0; i < 120; i++) { const cx = r() * W, cy = r() * H; if (cx > 90 && cx < W - 90 && cy > 140 && cy < H - 140 && r() < 0.9) continue; x.save(); x.translate(cx, cy); x.rotate(r() * 6.28); x.fillStyle = cols[i % cols.length]; i % 2 ? x.fillRect(-10, -4, 22, 8) : star(x, 0, 0, 12); x.restore(); }
    return { ink: "#151515", sub: "#555", acc: lum(p[1]) < 0.5 ? p[1] : "#d23b6b", pill: lum(p[1]) < 0.5 ? p[1] : "#d23b6b", pillInk: "#fff" };
  },
};

/**
 * Draw a poster. d = { size, theme, palette, service, eyebrow, headline, tagline, weekday, dateLine, time, speaker, word, address, photo (Image|null),
 *   shape: circle|card|full, focus, bg (Image|null for "painted") }. Resolves to a PNG Blob.
 */
export async function drawPoster(d) {
  try { await Promise.all([document.fonts.load(`700 60px Jost`), document.fonts.load(`500 40px Jost`), document.fonts.load(`italic 400 40px Jost`)]); } catch { /* system font */ }
  const [W, H] = SIZES[d.size] || SIZES.post, P = 80, pal = d.palette?.length === 4 ? d.palette : PALETTES[0];
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"); x.textBaseline = "alphabetic";
  if (!x.roundRect) x.roundRect = function (a, b, w, h) { this.rect(a, b, w, h); };
  const r = seeded((d.headline || "").length * 31 + pal.join("").length);
  let t;
  const full = d.photo && d.shape === "full";
  if (full || (d.theme === "painted" && d.bg)) {
    const bgImg = full ? d.photo : d.bg;
    x.fillStyle = "#111"; x.fillRect(0, 0, W, H); placePhoto(x, bgImg, 0, 0, W, H, full ? d.focus : 50);
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(0,0,0,.55)"); g.addColorStop(0.45, "rgba(0,0,0,.25)"); g.addColorStop(1, "rgba(0,0,0,.82)"); x.fillStyle = g; x.fillRect(0, 0, W, H);
    t = { ink: "#fff", sub: "rgba(255,255,255,.85)", acc: pal[3], pill: pal[3], pillInk: lum(pal[3]) > 0.4 ? "#141414" : "#fff" };
  } else {
    t = (BG[d.theme] || BG.night)(x, W, H, pal, r);
  }

  // Header: logo + church name
  const lg = await logo();
  if (lg) { x.save(); x.beginPath(); x.arc(P + 34, 96, 34, 0, 7); x.clip(); x.drawImage(lg, P, 62, 68, 68); x.restore(); }
  x.fillStyle = t.ink; x.font = `600 26px ${SANS}`; try { x.letterSpacing = "6px"; } catch { /* */ } x.fillText("SANDTON CITY CHURCH", P + 88, 106); try { x.letterSpacing = "0px"; } catch { /* */ }

  // Service pill
  let y = 190;
  x.font = `700 30px ${SANS}`; const ey = String(d.eyebrow || d.service || "").toUpperCase(), ew = x.measureText(ey).width;
  x.fillStyle = t.pill; x.beginPath(); x.roundRect(P, y - 40, ew + 48, 58, 29); x.fill(); x.fillStyle = t.pillInk; x.fillText(ey, P + 24, y);
  y += 50;

  // Photo placement (circle/card) decides how wide the text can be lower down.
  const hasSide = d.photo && !full;
  const photoR = Math.round(Math.min(W, H) * (H <= 1080 ? 0.15 : 0.2));
  const bottomBlockTop = H - (H > 1500 ? 560 : 440);

  // Headline
  const head = d.headline || d.service || "";
  const room = Math.max(220, bottomBlockTop - y - (d.tagline ? 110 : 40) - (hasSide && d.shape === "card" && H < 1200 ? 0 : 0));
  const { s, L } = fit(x, head, W - P * 2, room, 800, H > 1500 ? 170 : 140, 64, 1.0, t.upper);
  x.fillStyle = t.ink; if (t.shadow) { x.shadowColor = "rgba(0,0,0,.18)"; x.shadowOffsetX = 6; x.shadowOffsetY = 6; }
  L.forEach((l, i) => x.fillText(l, P - 4, y + s * 0.92 + i * s * 1.0));
  x.shadowColor = "transparent"; x.shadowOffsetX = 0; x.shadowOffsetY = 0;
  y += L.length * s + 20;
  x.fillStyle = t.acc; x.fillRect(P, y, 120, 10); y += 46;
  if (d.tagline) { x.fillStyle = t.sub; x.font = `italic 400 38px ${SANS}`; lines(x, d.tagline, W - P * 2).slice(0, 2).forEach((l, i) => x.fillText(l, P, y + 30 + i * 48)); }

  // Photo (circle or card), bottom right
  if (hasSide) {
    x.save();
    if (d.shape === "circle") {
      const cx = W - P - photoR, cy = Math.min(bottomBlockTop + photoR - 20, H - 150 - photoR);
      x.beginPath(); x.arc(cx, cy, photoR + 10, 0, 7); x.fillStyle = t.acc; x.fill();
      x.beginPath(); x.arc(cx, cy, photoR, 0, 7); x.clip(); placePhoto(x, d.photo, cx - photoR, cy - photoR, photoR * 2, photoR * 2, d.focus);
    } else {
      const cw = Math.round(W * 0.36), ch = Math.round(cw * 1.25), cx = W - P - cw, cy = Math.min(bottomBlockTop - 40, H - 160 - ch);
      x.translate(cx + cw / 2, cy + ch / 2); x.rotate(0.03); x.translate(-(cx + cw / 2), -(cy + ch / 2));
      x.fillStyle = "#fff"; x.beginPath(); x.roundRect(cx - 12, cy - 12, cw + 24, ch + 24, 28); x.fill();
      x.beginPath(); x.roundRect(cx, cy, cw, ch, 20); x.clip(); placePhoto(x, d.photo, cx, cy, cw, ch, d.focus);
    }
    x.restore();
  }

  // When / where block, bottom left
  const textW = hasSide ? W - P * 2 - (d.shape === "circle" ? photoR * 2 + 30 : W * 0.36 + 30) : W - P * 2;
  let by = bottomBlockTop + 10;
  const wdS = H > 1500 ? 92 : 80; x.fillStyle = t.acc; x.font = `800 ${wdS}px ${SANS}`; x.fillText(String(d.weekday || "").toUpperCase(), P - 3, by + wdS * 0.8); by += wdS * 0.8 + 62;
  x.fillStyle = t.ink; x.font = `600 44px ${SANS}`; x.fillText(d.dateLine || "", P, by); by += 56;
  if (d.time) { x.fillStyle = t.sub; x.font = `500 38px ${SANS}`; x.fillText(d.time, P, by); by += 52; }
  if (d.speaker) { x.fillStyle = t.ink; x.font = `500 36px ${SANS}`; const sp = `with ${d.speaker}`; x.fillText(lines(x, sp, textW)[0], P, by); by += 50; }
  if (d.word) { x.fillStyle = t.sub; x.font = `italic 400 32px ${SANS}`; x.fillText(lines(x, d.word, textW)[0], P, by); }

  // Footer
  x.fillStyle = hexA(t.ink === "#fff" ? "#ffffff" : "#000000", 0.16); x.fillRect(P, H - 120, W - P * 2, 2);
  x.fillStyle = t.sub; x.font = `500 28px ${SANS}`; x.fillText(d.address || "17 Humber Street, Woodmead, Sandton", P, H - 70);
  x.textAlign = "right"; x.fillStyle = t.ink; x.font = `600 28px ${SANS}`; x.fillText("Everyone welcome", W - P, H - 70); x.textAlign = "left";

  return new Promise((ok) => c.toBlob((b) => ok(b), "image/png"));
}
