// Poster drawing for the poster maker. Pure canvas, creative layouts.
// Speaker photos are only scaled, cropped and placed inside a frame: never altered, never sent anywhere.
export const SIZES = { post: [1080, 1350], story: [1080, 1920], square: [1080, 1080] };
export const THEMES = [
  ["arch", "Arch"], ["neon", "Neon"], ["magazine", "Magazine"], ["split", "Split"], ["polaroid", "Polaroid"],
  ["bold", "Big type"], ["glow", "Glow"], ["pop", "Pop"], ["painted", "Painted"], ["clean", "Clean"],
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

// ---------- colour helpers
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hexA = (hex, a) => `rgba(${rgb(hex).join(",")},${a})`;
function lum(hex) { const c = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function shade(hex, target, dir = -1) {
  let [r, g, b] = rgb(hex);
  const h = () => `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;
  for (let i = 0; i < 16 && (dir < 0 ? lum(h()) > target : lum(h()) < target); i++) {
    if (dir < 0) { r *= 0.8; g *= 0.8; b *= 0.8; } else { r += (255 - r) * 0.2; g += (255 - g) * 0.2; b += (255 - b) * 0.2; }
  }
  return h();
}
const deep = (hex, t = 0.05) => shade(hex, t, -1);
const pale = (hex, t = 0.8) => shade(hex, t, 1);
const inkOn = (hex) => (lum(hex) > 0.42 ? "#141414" : "#ffffff");
function seeded(n) { let s = (Math.abs(n) * 9301 + 49297) % 233280 || 1; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

// ---------- drawing helpers
function star(x, cx, cy, r) { x.beginPath(); for (let i = 0; i < 10; i++) { const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); x.fill(); }
const blob = (x, W, H, cx, cy, r, col, a) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0)); x.fillStyle = g; x.fillRect(0, 0, W, H); };
function wrap(x, text, maxW) { const out = []; let cur = ""; for (const w of String(text).split(/\s+/).filter(Boolean)) { const t = cur ? cur + " " + w : w; if (x.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }
function fit(x, text, maxW, maxH, weight, max, min, lh = 1.0, upper = false, italic = false) {
  const t = upper ? String(text).toUpperCase() : String(text), f = (s) => `${italic ? "italic " : ""}${weight} ${s}px ${SANS}`;
  for (let s = max; s >= min; s -= 3) { x.font = f(s); const L = wrap(x, t, maxW); if (L.length * s * lh <= maxH && L.every((l) => x.measureText(l).width <= maxW)) return { s, L, f }; }
  x.font = f(min); return { s: min, L: wrap(x, t, maxW), f };
}
function text(x, str, px, py, font, color, align = "left") { x.font = font; x.fillStyle = color; x.textAlign = align; x.fillText(str, px, py); x.textAlign = "left"; }
function spaced(x, str, px, py, font, color, sp = 6, align = "left") { x.save(); try { x.letterSpacing = `${sp}px`; } catch { /* old browsers */ } text(x, str, px, py, font, color, align); x.restore(); }
/** Crop-to-fill a photo into a box (cover), with a vertical focus 0–100. Only scales and crops. */
function cover(x, ph, rx, ry, rw, rh, focus = 35) { const sc = Math.max(rw / ph.width, rh / ph.height), iw = ph.width * sc, ih = ph.height * sc; x.drawImage(ph, rx + (rw - iw) / 2, ry + (rh - ih) * (focus / 100), iw, ih); }
function archPath(x, rx, ry, rw, rh) { const r = rw / 2; x.beginPath(); x.moveTo(rx, ry + rh); x.lineTo(rx, ry + r); x.arc(rx + r, ry + r, r, Math.PI, 0); x.lineTo(rx + rw, ry + rh); x.closePath(); }
function initials(name) { return String(name || "").split(/\s+/).filter((w) => !/^(pastor|ps|pst|rev|dr|mr|mrs|ms|bro|sis|elder|deacon|apostle|prophet|evangelist)\.?$/i.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "★"; }

/** One framed portrait. shape: circle | arch | rect | polaroid. Empty photo → initials on a colour. */
function portrait(x, s, shape, bx, by, bw, bh, o) {
  x.save();
  if (shape === "polaroid") {
    x.translate(bx + bw / 2, by + bh / 2); x.rotate(o.tilt || 0); x.translate(-(bx + bw / 2), -(by + bh / 2));
    x.shadowColor = "rgba(0,0,0,.28)"; x.shadowBlur = 30; x.shadowOffsetY = 12; x.fillStyle = "#fff"; x.fillRect(bx, by, bw, bh); x.shadowColor = "transparent";
    const pad = bw * 0.07, ph = bh - pad - bw * 0.28;
    x.save(); x.beginPath(); x.rect(bx + pad, by + pad, bw - pad * 2, ph); x.clip();
    if (s.img) cover(x, s.img, bx + pad, by + pad, bw - pad * 2, ph, s.focus); else { x.fillStyle = o.fill; x.fillRect(bx + pad, by + pad, bw - pad * 2, ph); text(x, initials(s.name), bx + bw / 2, by + pad + ph / 2 + bw * 0.08, `700 ${bw * 0.22}px ${SANS}`, inkOn(o.fill), "center"); }
    x.restore();
    const nm = fit(x, s.name || "", bw - pad * 2, bw * 0.16, 500, Math.round(bw * 0.11), 18, 1.1, false, true);
    nm.L.slice(0, 1).forEach((l) => text(x, l, bx + bw / 2, by + bh - bw * 0.1, nm.f(nm.s), "#222", "center"));
    x.fillStyle = hexA(o.ring, 0.75); x.save(); x.translate(bx + bw / 2, by - 6); x.rotate(-0.05); x.fillRect(-bw * 0.18, -16, bw * 0.36, 34); x.restore();   // tape
    x.restore(); return;
  }
  if (o.ring) {
    x.fillStyle = o.ring;
    if (shape === "circle") { x.beginPath(); x.arc(bx + bw / 2, by + bh / 2, bw / 2 + o.ringW, 0, 7); x.fill(); }
    else if (shape === "arch") { archPath(x, bx - o.ringW, by - o.ringW, bw + o.ringW * 2, bh + o.ringW * 2); x.fill(); }
    else { x.beginPath(); x.roundRect(bx - o.ringW, by - o.ringW, bw + o.ringW * 2, bh + o.ringW * 2, 26); x.fill(); }
  }
  if (o.glow) { x.shadowColor = o.glow; x.shadowBlur = 40; }
  if (shape === "circle") { x.beginPath(); x.arc(bx + bw / 2, by + bh / 2, bw / 2, 0, 7); }
  else if (shape === "arch") archPath(x, bx, by, bw, bh);
  else { x.beginPath(); x.roundRect(bx, by, bw, bh, 20); }
  x.fillStyle = o.fill; x.fill(); x.shadowColor = "transparent"; x.clip();
  if (s.img) cover(x, s.img, bx, by, bw, bh, s.focus);
  else text(x, initials(s.name), bx + bw / 2, by + bh / 2 + bw * 0.1, `700 ${bw * 0.3}px ${SANS}`, inkOn(o.fill), "center");
  x.restore();
}
/** Lay out 1–3 speakers in a box, names underneath (or none when nameColor is null). */
function speakers(x, list, box, shape, o) {
  const n = list.length; if (!n) return;
  const gap = 34, nameH = o.nameColor ? 86 : 0, ratio = shape === "arch" ? 1.3 : shape === "polaroid" ? 1.2 : shape === "rect" ? 1.25 : 1;
  let w = Math.min((box.w - gap * (n - 1)) / n, (box.h - nameH) / ratio, o.max || 9999);
  const h = w * ratio, total = n * w + (n - 1) * gap, x0 = box.x + (o.align === "left" ? 0 : (box.w - total) / 2);
  list.forEach((s, i) => {
    const bx = x0 + i * (w + gap), by = box.y + (box.h - nameH - h) * (o.valign === "top" ? 0 : 1);
    portrait(x, s, shape, bx, by, w, h, { ...o, tilt: shape === "polaroid" ? [-0.06, 0.05, -0.03][i] : 0 });
    if (o.nameColor && shape !== "polaroid") {
      const nm = fit(x, s.name || "", w + gap - 6, 72, 700, n === 1 ? 46 : 34, 20, 1.05);
      nm.L.slice(0, 2).forEach((l, k) => text(x, l, bx + w / 2, by + h + 44 + k * nm.s * 1.05, nm.f(nm.s), o.nameColor, "center"));
    }
  });
}
function badge(x, cx, cy, r, bg, ink, d, rot = -0.14) {
  x.save(); x.translate(cx, cy); x.rotate(rot);
  x.fillStyle = bg; x.beginPath(); x.arc(0, 0, r, 0, 7); x.fill();
  x.strokeStyle = hexA(ink === "#ffffff" ? "#ffffff" : "#000000", 0.25); x.lineWidth = 3; x.setLineDash([6, 8]); x.beginPath(); x.arc(0, 0, r - 14, 0, 7); x.stroke(); x.setLineDash([]);
  spaced(x, d.wdShort, 0, -r * 0.34, `700 ${r * 0.2}px ${SANS}`, ink, 4, "center");
  text(x, d.dayNum, 0, r * 0.26, `800 ${r * 0.62}px ${SANS}`, ink, "center");
  spaced(x, d.monShort, 0, r * 0.56, `700 ${r * 0.18}px ${SANS}`, ink, 4, "center");
  x.restore();
}
async function header(x, P, ink, y = 96) {
  const lg = await logo();
  if (lg) { x.save(); x.beginPath(); x.arc(P + 32, y, 32, 0, 7); x.clip(); x.drawImage(lg, P, y - 32, 64, 64); x.restore(); }
  spaced(x, "SANDTON CITY CHURCH", P + 84, y + 9, `600 24px ${SANS}`, ink, 6);
}
function pill(x, label, px, py, bg, ink, size = 28) {
  x.font = `700 ${size}px ${SANS}`; const w = x.measureText(label).width + size * 1.6;
  x.fillStyle = bg; x.beginPath(); x.roundRect(px, py - size * 1.35, w, size * 2, size); x.fill(); text(x, label, px + size * 0.8, py, `700 ${size}px ${SANS}`, ink); return w;
}
function footer(x, W, H, P, d, ink, sub, line) {
  x.fillStyle = line; x.fillRect(P, H - 116, W - P * 2, 2);
  text(x, d.address, P, H - 66, `500 27px ${SANS}`, sub);
  text(x, "Everyone welcome", W - P, H - 66, `700 27px ${SANS}`, ink, "right");
}
function whenLines(x, d, px, py, maxW, c, big = 44) {
  let y = py;
  text(x, `${d.weekday} ${d.dateLine}`, px, y, `700 ${big}px ${SANS}`, c.ink); y += big * 1.25;
  if (d.time) { text(x, d.time, px, y, `500 ${big * 0.82}px ${SANS}`, c.sub); y += big * 1.1; }
  if (d.word) { para(x, d.word, px, y, maxW, `italic 400 ${big * 0.72}px ${SANS}`, c.sub, big, 1); y += big; }
  return y;
}
/** Up to `max` wrapped lines of text; returns the height used. */
function para(x, str, px, py, maxW, font, color, lh, max = 2) { x.font = font; const L = wrap(x, str, maxW).slice(0, max); L.forEach((l, i) => text(x, l, px, py + i * lh, font, color)); return L.length * lh; }
const speakerLine = (list) => list.map((s) => s.name).filter(Boolean).join(" · ");

// ---------- the layouts
const L = {
  async arch(x, W, H, P, p, d, r) {
    const bg = pale(p[2], 0.82); x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.fillStyle = hexA(p[3], 0.9); x.beginPath(); x.arc(W - 40, 200, 230, 0, 7); x.fill();
    x.strokeStyle = hexA(p[1], 0.5); x.lineWidth = 4; x.beginPath(); x.arc(70, H * 0.55, 160, 0, 7); x.stroke();
    for (let i = 0; i < 6; i++) { x.fillStyle = [p[1], p[3]][i % 2]; star(x, 60 + r() * 120, 180 + r() * (H - 500), 10 + r() * 8); }
    const ink = deep(p[0], 0.03);
    await header(x, P, ink);
    pill(x, d.service.toUpperCase(), P, 196, ink, "#fff", 26);
    const head = fit(x, d.headline, W - P * 2 - 120, H * 0.24, 800, H > 1500 ? 150 : 124, 60, 0.98);
    head.L.forEach((l, i) => text(x, l, P - 4, 250 + head.s * 0.86 + i * head.s * 0.98, head.f(head.s), ink));
    let y = 250 + head.L.length * head.s * 0.98 + 34;
    if (d.tagline) { const t = fit(x, d.tagline, W - P * 2, 96, 400, 38, 26, 1.25, false, true); t.L.slice(0, 2).forEach((l, i) => text(x, l, P, y + 30 + i * t.s * 1.25, t.f(t.s), deep(p[1], 0.08))); y += 30 + t.L.slice(0, 2).length * t.s * 1.25; }
    const spTop = Math.max(y + 40, H * 0.42), spBox = { x: P, y: spTop, w: W - P * 2, h: H - 330 - spTop };
    if (d.speakers.length) speakers(x, d.speakers, spBox, "arch", { fill: p[1], ring: "#fff", ringW: 10, nameColor: ink, max: 420 });
    else { x.fillStyle = hexA(p[1], 0.15); archPath(x, W / 2 - 200, spTop, 400, spBox.h); x.fill(); }
    badge(x, W - P - 90, spTop + 30, 100, p[1], inkOn(p[1]), d, 0.16);
    const wy = H - 230; whenLines(x, { ...d, word: d.word }, P, wy, W - P * 2, { ink, sub: hexA(ink, 0.72) }, 38);
    footer(x, W, H, P, d, ink, hexA(ink, 0.7), hexA(ink, 0.15));
  },

  async neon(x, W, H, P, p, d, r) {
    x.fillStyle = "#07060c"; x.fillRect(0, 0, W, H);
    blob(x, W, H, W * 0.2, H * 0.15, 520, p[1], 0.35); blob(x, W, H, W * 0.9, H * 0.7, 520, p[3], 0.22);
    // synthwave floor
    x.strokeStyle = hexA(p[2], 0.25); x.lineWidth = 2; const hz = H * 0.66;
    for (let i = 0; i < 14; i++) { const yy = hz + (i * i) * 3.2; if (yy > H) break; x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy); x.stroke(); }
    for (let i = -10; i <= 10; i++) { x.beginPath(); x.moveTo(W / 2 + i * 40, hz); x.lineTo(W / 2 + i * 260, H); x.stroke(); }
    const acc = pale(p[3], 0.45), acc2 = pale(p[2], 0.4);
    await header(x, P, "#fff");
    x.shadowColor = acc2; x.shadowBlur = 18; x.strokeStyle = acc2; x.lineWidth = 3; x.font = `700 26px ${SANS}`;
    const lab = d.service.toUpperCase(), lw = x.measureText(lab).width + 44; x.beginPath(); x.roundRect(P, 160, lw, 54, 27); x.stroke(); x.shadowBlur = 0; text(x, lab, P + 22, 196, `700 26px ${SANS}`, acc2);
    const head = fit(x, d.headline, W - P * 2, H * 0.27, 800, H > 1500 ? 160 : 132, 60, 1.0, true);
    head.L.forEach((l, i) => {
      const yy = 260 + head.s * 0.86 + i * head.s;
      x.font = head.f(head.s);
      if (i % 2 === 0) { x.shadowColor = acc; x.shadowBlur = 36; x.fillStyle = "#fff"; x.fillText(l, P, yy); x.shadowBlur = 14; x.fillText(l, P, yy); }
      else { x.shadowColor = acc2; x.shadowBlur = 24; x.strokeStyle = acc2; x.lineWidth = 4; x.strokeText(l, P, yy); }
      x.shadowBlur = 0;
    });
    let y = 260 + head.L.length * head.s + 30;
    if (d.tagline) { y += para(x, d.tagline, P, y + 20, W - P * 2, `italic 400 36px ${SANS}`, "rgba(255,255,255,.8)", 45) + 24; }
    const spTop = Math.max(y + 30, H * 0.44), spH = H - 360 - spTop;
    if (d.speakers.length) speakers(x, d.speakers, { x: P, y: spTop, w: W - P * 2, h: spH }, "circle", { fill: p[1], ring: acc, ringW: 6, glow: acc, nameColor: "#fff", max: 380 });
    let wy = H - 250; x.shadowColor = acc; x.shadowBlur = 20; text(x, `${d.weekday.toUpperCase()} · ${d.dateLine}`, P, wy, `800 44px ${SANS}`, acc); x.shadowBlur = 0;
    wy += 52; if (d.time) text(x, d.time + (d.word ? `  ·  ${d.word}` : ""), P, wy, `500 34px ${SANS}`, "rgba(255,255,255,.82)");
    footer(x, W, H, P, d, "#fff", "rgba(255,255,255,.7)", "rgba(255,255,255,.18)");
  },

  async magazine(x, W, H, P, p, d, r) {
    const top = Math.round(H * (H > 1500 ? 0.56 : 0.52)), first = d.speakers.find((s) => s.img);
    if (first) cover(x, first.img, 0, 0, W, top, first.focus);
    else { x.fillStyle = deep(p[0]); x.fillRect(0, 0, W, top); blob(x, W, top, W * 0.3, top * 0.4, 500, p[1], 0.9); blob(x, W, top, W * 0.85, top * 0.8, 420, p[3], 0.6); }
    const g = x.createLinearGradient(0, 0, 0, top); g.addColorStop(0, "rgba(0,0,0,.45)"); g.addColorStop(0.4, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.55)"); x.fillStyle = g; x.fillRect(0, 0, W, top);
    const band = deep(p[1], 0.07); x.fillStyle = band; x.fillRect(0, top, W, H - top);
    x.fillStyle = p[3]; x.fillRect(0, top, W, 14);
    await header(x, P, "#fff");
    if (first) { spaced(x, (first.name || "").toUpperCase(), P, top - 44, `700 40px ${SANS}`, "#fff", 4); x.fillStyle = p[3]; x.fillRect(P, top - 30, 90, 6); }
    pill(x, d.service.toUpperCase(), P, 200, p[3], inkOn(p[3]), 26);
    const head = fit(x, d.headline, W - P * 2, (H - top) * 0.42, 800, H > 1500 ? 140 : 112, 54, 0.98, true);
    head.L.forEach((l, i) => text(x, l, P - 3, top + 40 + head.s * 0.86 + i * head.s * 0.98, head.f(head.s), "#fff"));
    let y = top + 40 + head.L.length * head.s * 0.98 + 20;
    if (d.tagline) { y += para(x, d.tagline, P, y + 14, W - P * 2, `italic 400 34px ${SANS}`, hexA("#ffffff", 0.82), 42) + 16; }
    const others = d.speakers.filter((s) => s !== first);
    const rightW = others.length ? Math.min(380, 150 * others.length) : 0;
    if (others.length) speakers(x, others, { x: W - P - rightW, y: H - 120 - 240, w: rightW, h: 230 }, "circle", { fill: p[2], ring: p[3], ringW: 5, nameColor: "#fff", max: 140, align: "left" });
    if (!first && d.speakers.length && !others.length) { /* no photo: name in the band */ }
    whenLines(x, d, P, H - 300, W - P * 2 - rightW - 20, { ink: "#fff", sub: "rgba(255,255,255,.75)" }, 40);
    if (!first && d.speakers.length) text(x, `with ${speakerLine(d.speakers)}`, P, H - 140, `600 30px ${SANS}`, p[3]);
    footer(x, W, H, P, d, "#fff", "rgba(255,255,255,.7)", "rgba(255,255,255,.18)");
  },

  async split(x, W, H, P, p, d, r) {
    const first = d.speakers.find((s) => s.img), base = deep(p[1], 0.08);
    x.fillStyle = p[2]; x.fillRect(0, 0, W, H);
    if (first) { x.save(); x.beginPath(); x.moveTo(W * 0.5, 0); x.lineTo(W, 0); x.lineTo(W, H); x.lineTo(W * 0.32, H); x.closePath(); x.clip(); cover(x, first.img, W * 0.32, 0, W * 0.68, H, first.focus); x.restore(); }
    else { x.fillStyle = p[3]; x.beginPath(); x.moveTo(W * 0.5, 0); x.lineTo(W, 0); x.lineTo(W, H); x.lineTo(W * 0.32, H); x.closePath(); x.fill(); for (let i = 0; i < 8; i++) { x.fillStyle = hexA("#ffffff", 0.35); x.beginPath(); x.arc(W * 0.6 + r() * W * 0.4, r() * H, 30 + r() * 80, 0, 7); x.fill(); } }
    x.fillStyle = base; x.beginPath(); x.moveTo(0, 0); x.lineTo(W * 0.62, 0); x.lineTo(W * 0.44, H); x.lineTo(0, H); x.closePath(); x.fill();
    x.fillStyle = p[3]; x.beginPath(); x.moveTo(W * 0.62, 0); x.lineTo(W * 0.655, 0); x.lineTo(W * 0.475, H); x.lineTo(W * 0.44, H); x.closePath(); x.fill();
    await header(x, P, "#fff");
    pill(x, d.service.toUpperCase(), P, 200, p[3], inkOn(p[3]), 24);
    const colW = W * 0.46 - P;
    const head = fit(x, d.headline, colW, H * 0.36, 800, H > 1500 ? 130 : 108, 48, 0.98, true);
    head.L.forEach((l, i) => text(x, l, P - 3, 260 + head.s * 0.86 + i * head.s * 0.98, head.f(head.s), "#fff"));
    let y = 260 + head.L.length * head.s * 0.98 + 30;
    if (d.tagline) { const t = fit(x, d.tagline, colW, 130, 400, 34, 24, 1.25, false, true); t.L.slice(0, 3).forEach((l, i) => text(x, l, P, y + i * t.s * 1.25, t.f(t.s), "rgba(255,255,255,.82)")); y += t.L.slice(0, 3).length * t.s * 1.25 + 10; }
    const others = d.speakers.filter((s) => s !== first);
    if (others.length) speakers(x, others, { x: P, y: y + 20, w: colW, h: Math.min(260, H - 470 - y) }, "circle", { fill: p[2], ring: p[3], ringW: 5, nameColor: "#fff", max: 150, align: "left" });
    if (first) { x.save(); x.translate(W - P, H - 170); x.rotate(-0.04); x.font = `700 36px ${SANS}`; const nw = x.measureText(first.name || "").width; x.fillStyle = p[3]; x.fillRect(-nw - 40, -50, nw + 40, 70); text(x, first.name || "", -20, -2, `700 36px ${SANS}`, inkOn(p[3]), "right"); x.restore(); }
    badge(x, W * 0.47, H * 0.62, 92, p[3], inkOn(p[3]), d, -0.12);
    let wy = H - 300; text(x, d.weekday.toUpperCase(), P, wy, `800 64px ${SANS}`, p[3]); wy += 56;
    text(x, d.dateLine, P, wy, `600 36px ${SANS}`, "#fff"); wy += 46; if (d.time) text(x, d.time, P, wy, `500 32px ${SANS}`, "rgba(255,255,255,.8)");
    x.fillStyle = "rgba(255,255,255,.18)"; x.fillRect(P, H - 116, W * 0.36, 2);
    text(x, d.address, P, H - 66, `500 24px ${SANS}`, "rgba(255,255,255,.75)");
  },

  async polaroid(x, W, H, P, p, d, r) {
    const bg = pale(p[2], 0.86); x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.strokeStyle = hexA(deep(p[0]), 0.06); x.lineWidth = 2; for (let gx = 0; gx < W; gx += 48) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, H); x.stroke(); } for (let gy = 0; gy < H; gy += 48) { x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke(); }
    for (let i = 0; i < 14; i++) { x.fillStyle = [p[1], p[3], "#ff5fa2"][i % 3]; const sx = r() < 0.5 ? r() * 90 + 10 : W - 10 - r() * 90; star(x, sx, 140 + r() * (H - 300), 9 + r() * 9); }
    const ink = deep(p[0], 0.02);
    await header(x, P, ink);
    x.save(); x.translate(P, 200); x.rotate(-0.03); pill(x, d.service.toUpperCase(), 0, 0, p[1], inkOn(p[1]), 26); x.restore();
    const head = fit(x, d.headline, W - P * 2, H * 0.22, 800, H > 1500 ? 140 : 116, 56, 0.98);
    head.L.forEach((l, i) => text(x, l, P - 3, 270 + head.s * 0.86 + i * head.s * 0.98, head.f(head.s), ink));
    let y = 270 + head.L.length * head.s * 0.98 + 10;
    x.strokeStyle = p[3]; x.lineWidth = 10; x.lineCap = "round"; x.beginPath(); x.moveTo(P, y + 6); x.quadraticCurveTo(P + 160, y + 26, P + 320, y + 2); x.stroke();
    y += 40;
    if (d.tagline) { y += para(x, d.tagline, P, y + 26, W - P * 2, `italic 400 36px ${SANS}`, hexA(ink, 0.75), 45) + 24; }
    const spTop = Math.max(y + 40, H * 0.42), spH = H - 380 - spTop;
    if (d.speakers.length) speakers(x, d.speakers, { x: P, y: spTop, w: W - P * 2, h: spH }, "polaroid", { fill: p[1], ring: p[3], max: 400 });
    badge(x, W - P - 70, H - 250, 80, p[1], inkOn(p[1]), d, 0.18);
    whenLines(x, d, P, H - 236, W - P * 2 - 200, { ink, sub: hexA(ink, 0.7) }, 38);
    footer(x, W, H, P, d, ink, hexA(ink, 0.7), hexA(ink, 0.15));
  },

  async bold(x, W, H, P, p, d, r) {
    const bg = deep(p[0], 0.03); x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const acc = pale(p[3], 0.5);
    await header(x, P, "#fff");
    pill(x, d.service.toUpperCase(), P, 196, acc, inkOn(acc), 26);
    // Each word on its own line, as wide as the poster: alternating solid and outline.
    const words = String(d.headline).toUpperCase().split(/\s+/).filter(Boolean).slice(0, 6);
    const maxH = H * (d.speakers.length ? 0.4 : 0.5); let y = 250;
    const sizes = words.map((w) => { x.font = `900 100px ${SANS}`; return Math.min(260, Math.floor(100 * (W - P * 2) / x.measureText(w).width)); });
    const total = sizes.reduce((a, s) => a + s * 0.9, 0), k = Math.min(1, maxH / total);
    words.forEach((w, i) => {
      const s = Math.floor(sizes[i] * k); y += s * 0.86; x.font = `900 ${s}px ${SANS}`;
      if (i % 2 === 0) { x.fillStyle = i % 4 === 0 ? "#fff" : acc; x.fillText(w, P - 4, y); } else { x.strokeStyle = acc; x.lineWidth = Math.max(3, s / 30); x.strokeText(w, P - 4, y); }
      y += s * 0.06;
    });
    y += 30;
    if (d.tagline) { y += para(x, d.tagline, P, y + 20, W - P * 2, `italic 400 36px ${SANS}`, "rgba(255,255,255,.8)", 45) + 24; }
    const spTop = y + 20, spH = H - 330 - spTop;
    if (d.speakers.length && spH > 160) speakers(x, d.speakers, { x: P, y: spTop, w: W - P * 2, h: spH }, "circle", { fill: p[1], ring: acc, ringW: 6, nameColor: "#fff", max: 300, align: d.speakers.length === 1 ? "left" : "center" });
    else if (d.speakers.length) text(x, `with ${speakerLine(d.speakers)}`, P, spTop + 40, `600 34px ${SANS}`, acc);
    whenLines(x, d, P, H - 236, W - P * 2, { ink: "#fff", sub: "rgba(255,255,255,.72)" }, 40);
    footer(x, W, H, P, d, "#fff", "rgba(255,255,255,.7)", "rgba(255,255,255,.16)");
  },

  async glow(x, W, H, P, p, d, r, bgImg) {
    x.fillStyle = deep(p[0]); x.fillRect(0, 0, W, H);
    if (bgImg) { cover(x, bgImg, 0, 0, W, H, 50); x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(0, 0, W, H); }
    else { [[p[1], 0.95], [p[3], 0.6], [p[2], 0.55], ["#ff5fa2", 0.4]].forEach(([c, a]) => blob(x, W, H, r() * W, r() * H, 420 + r() * 420, c, a)); x.fillStyle = "rgba(0,0,0,.2)"; x.fillRect(0, 0, W, H); }
    await header(x, P, "#fff");
    pill(x, d.service.toUpperCase(), P, 196, "#fff", "#141414", 26);
    const head = fit(x, d.headline, W - P * 2, H * 0.25, 800, H > 1500 ? 150 : 124, 56, 0.98);
    x.shadowColor = "rgba(0,0,0,.3)"; x.shadowBlur = 24;
    head.L.forEach((l, i) => text(x, l, P - 3, 252 + head.s * 0.86 + i * head.s * 0.98, head.f(head.s), "#fff"));
    x.shadowBlur = 0;
    let y = 252 + head.L.length * head.s * 0.98 + 20;
    if (d.tagline) { y += para(x, d.tagline, P, y + 20, W - P * 2, `italic 400 36px ${SANS}`, "rgba(255,255,255,.88)", 45) + 24; }
    // Glass card for the details
    const cardH = 250, cardY = H - 140 - cardH;
    const spTop = y + 30, spH = cardY - 30 - spTop;
    if (d.speakers.length && spH > 150) speakers(x, d.speakers, { x: P, y: spTop, w: W - P * 2, h: spH }, "circle", { fill: p[1], ring: "rgba(255,255,255,.85)", ringW: 6, nameColor: "#fff", max: 360 });
    x.fillStyle = "rgba(255,255,255,.14)"; x.strokeStyle = "rgba(255,255,255,.35)"; x.lineWidth = 2; x.beginPath(); x.roundRect(P - 20, cardY, W - P * 2 + 40, cardH, 30); x.fill(); x.stroke();
    whenLines(x, d, P + 14, cardY + 70, W - P * 2 - 220, { ink: "#fff", sub: "rgba(255,255,255,.8)" }, 42);
    badge(x, W - P - 80, cardY + cardH / 2, 90, p[3], inkOn(p[3]), d, 0.1);
    footer(x, W, H, P, d, "#fff", "rgba(255,255,255,.75)", "rgba(255,255,255,.2)");
  },

  async pop(x, W, H, P, p, d, r) {
    x.fillStyle = p[1]; x.fillRect(0, 0, W, H);
    x.fillStyle = p[3]; x.beginPath(); x.arc(W - 40, 130, 250, 0, 7); x.fill();
    x.fillStyle = p[2]; x.beginPath(); x.arc(20, H * 0.7, 210, 0, 7); x.fill();
    x.strokeStyle = deep(p[0]); x.lineWidth = 12; x.lineCap = "round"; x.beginPath(); x.moveTo(W - 330, H * 0.36); for (let i = 0; i < 5; i++) x.quadraticCurveTo(W - 300 + i * 50, H * 0.36 + (i % 2 ? -36 : 36), W - 270 + i * 50, H * 0.36); x.stroke();
    for (let i = 0; i < 10; i++) { x.fillStyle = [p[3], p[2], "#fff", deep(p[0])][i % 4]; const sx = r() < 0.5 ? r() * 70 + 10 : W - 10 - r() * 70; star(x, sx, 180 + r() * (H - 360), 12 + r() * 14); }
    const dark = deep(p[0], 0.02), ink = inkOn(p[1]);
    await header(x, P, ink);
    // Offset white card with the headline
    const cardY = 160, head = fit(x, d.headline, W - P * 2 - 80, H * 0.22, 800, H > 1500 ? 130 : 110, 54, 0.98), cardH = head.L.length * head.s * 0.98 + 150 + (d.tagline ? 50 : 0);
    x.fillStyle = dark; x.beginPath(); x.roundRect(P + 16, cardY + 16, W - P * 2, cardH, 36); x.fill();
    x.fillStyle = "#fff"; x.beginPath(); x.roundRect(P, cardY, W - P * 2, cardH, 36); x.fill(); x.strokeStyle = dark; x.lineWidth = 6; x.stroke();
    pill(x, d.service.toUpperCase(), P + 40, cardY + 70, p[1], inkOn(p[1]), 24);
    head.L.forEach((l, i) => text(x, l, P + 38, cardY + 110 + head.s * 0.86 + i * head.s * 0.98, head.f(head.s), "#141414"));
    if (d.tagline) para(x, d.tagline, P + 40, cardY + cardH - 40, W - P * 2 - 80, `italic 400 32px ${SANS}`, "#444", 40, 1);
    const spTop = cardY + cardH + 50, spH = H - 360 - spTop;
    if (d.speakers.length && spH > 150) speakers(x, d.speakers, { x: P, y: spTop, w: W - P * 2, h: spH }, "circle", { fill: p[2], ring: dark, ringW: 8, nameColor: ink, max: 360 });
    badge(x, W - P - 70, H - 300, 88, dark, "#fff", d, 0.15);
    whenLines(x, d, P, H - 236, W - P * 2 - 200, { ink, sub: ink === "#ffffff" ? "rgba(255,255,255,.82)" : "rgba(0,0,0,.7)" }, 40);
    footer(x, W, H, P, d, ink, ink === "#ffffff" ? "rgba(255,255,255,.8)" : "rgba(0,0,0,.65)", hexA(ink === "#ffffff" ? "#ffffff" : "#000000", 0.2));
  },

  async painted(x, W, H, P, p, d, r, bgImg) { return L.glow(x, W, H, P, p, d, r, bgImg); },

  async clean(x, W, H, P, p, d) {
    x.fillStyle = "#faf8f4"; x.fillRect(0, 0, W, H);
    x.strokeStyle = "rgba(0,0,0,.08)"; x.lineWidth = 2; x.strokeRect(34, 34, W - 68, H - 68);
    const ink = "#151515", acc = lum(p[1]) < 0.35 ? p[1] : deep(p[1], 0.12);
    await header(x, P, ink);
    spaced(x, d.service.toUpperCase(), P, 200, `600 26px ${SANS}`, acc, 6);
    const head = fit(x, d.headline, W - P * 2, H * 0.24, 500, H > 1500 ? 140 : 116, 54, 1.02);
    head.L.forEach((l, i) => text(x, l, P - 3, 250 + head.s * 0.86 + i * head.s * 1.02, head.f(head.s), ink));
    let y = 250 + head.L.length * head.s * 1.02 + 16; x.fillStyle = acc; x.fillRect(P, y, 80, 4); y += 30;
    if (d.tagline) { y += para(x, d.tagline, P, y + 24, W - P * 2, `italic 400 34px ${SANS}`, "#5c574f", 42.5) + 26; }
    const spTop = Math.max(y + 30, H * 0.42), spH = H - 330 - spTop;
    if (d.speakers.length) speakers(x, d.speakers, { x: P, y: spTop, w: W - P * 2, h: spH }, "rect", { fill: pale(p[2], 0.75), nameColor: ink, max: 380, align: "left" });
    whenLines(x, d, P, H - 236, W - P * 2, { ink, sub: "#5c574f" }, 40);
    footer(x, W, H, P, d, ink, "#6d685e", "rgba(0,0,0,.1)");
  },
};

/**
 * Draw a poster. d = { size, theme, palette, service, headline, tagline, weekday, dateLine, wdShort, dayNum, monShort, time, word, address,
 *   speakers: [{ name, img (Image|null), focus }], bg (Image|null for "painted") }. Resolves to a PNG Blob.
 */
export async function drawPoster(d) {
  try { await Promise.all([document.fonts.load(`800 60px Jost`), document.fonts.load(`500 40px Jost`), document.fonts.load(`italic 400 40px Jost`)]); } catch { /* system font */ }
  const [W, H] = SIZES[d.size] || SIZES.post, pal = d.palette?.length === 4 ? d.palette : PALETTES[0];
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"); x.textBaseline = "alphabetic";
  if (!x.roundRect) x.roundRect = function (a, b, w, h) { this.rect(a, b, w, h); };
  const r = seeded(String(d.headline || "").length * 31 + pal.join("").length + (d.speakers?.length || 0));
  const data = { ...d, headline: d.headline || d.service || "", speakers: (d.speakers || []).filter((s) => s.name || s.img).slice(0, 3), address: d.address || "17 Humber Street, Woodmead, Sandton" };
  await (L[d.theme] || L.arch)(x, W, H, 80, pal, data, r, d.bg || null);
  return new Promise((ok) => c.toBlob((b) => ok(b), "image/png"));
}
