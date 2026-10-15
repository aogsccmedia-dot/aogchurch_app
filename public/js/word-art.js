// Today's Word as a piece of art (never plain text): drawn on a canvas at 1080×1350 (a phone/Instagram portrait),
// a new colour mood every day, the church logo, and ready to share or save as an image.
const W = 1080, H = 1350;
const MOODS = [
  { a: "#1b1340", b: "#5a3fd0", glow: "#f3b4d6", accent: "#ffd27a" },   // violet dusk
  { a: "#0d2b2a", b: "#1f7d6c", glow: "#a8f0d6", accent: "#f7d68f" },   // deep teal
  { a: "#2b0e1e", b: "#c23f5f", glow: "#ffc3a3", accent: "#ffe2a8" },   // rose ember
  { a: "#0a1d3b", b: "#2c6ade", glow: "#a6e2ff", accent: "#ffe08a" },   // morning sky
  { a: "#24170a", b: "#b9822f", glow: "#ffe4b0", accent: "#fff3da" },   // church gold
  { a: "#11261a", b: "#4c9a66", glow: "#e6f6c4", accent: "#ffd88a" },   // garden
  { a: "#22102f", b: "#8a4ed6", glow: "#ffc2e4", accent: "#a9f0ff" },   // grape & sky
];
const SANS = "Jost, 'Helvetica Neue', Arial, sans-serif";

let logo;
const loadLogo = () => (logo ??= new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = "/assets/logo-192.png"; }));

function seeded(n) { let s = (n * 9301 + 49297) % 233280 || 1; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

function wrap(x, text, maxW) {
  const words = text.split(/\s+/), lines = [];
  let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines;
}

/** Draw the art for a word ({ text, ref, number }). Resolves to a PNG Blob. */
export async function wordArt(w) {
  try { await Promise.all([document.fonts.load(`500 60px Jost`), document.fonts.load(`italic 400 40px Jost`)]); } catch { /* system font */ }
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  const m = MOODS[(Number(w.number) || 0) % MOODS.length], rnd = seeded(Number(w.number) || 7);

  // Background: a deep gradient with soft glowing light.
  const g = x.createLinearGradient(0, 0, W * 0.35, H);
  g.addColorStop(0, m.a); g.addColorStop(1, m.b);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const glow = (cx, cy, r, col, a) => { const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, col); rg.addColorStop(1, "transparent"); x.globalAlpha = a; x.fillStyle = rg; x.fillRect(0, 0, W, H); x.globalAlpha = 1; };
  glow(W * 0.85, H * 0.1, 620, m.glow, 0.55);
  glow(W * 0.05, H * 0.95, 560, m.accent, 0.28);
  // Rays of light from the top corner.
  x.save(); x.translate(W * 0.92, -40); x.globalAlpha = 0.07; x.fillStyle = "#fff";
  for (let i = 0; i < 9; i++) { x.rotate(0.12 + rnd() * 0.05); x.beginPath(); x.moveTo(0, 0); x.lineTo(-40, H * 1.4); x.lineTo(30, H * 1.4); x.closePath(); x.fill(); }
  x.restore();
  // Gentle rings and tiny stars.
  x.strokeStyle = "rgba(255,255,255,.10)"; x.lineWidth = 2;
  for (const r of [180, 260, 340]) { x.beginPath(); x.arc(W * 0.08, H * 0.12, r, 0, Math.PI * 2); x.stroke(); }
  for (let i = 0; i < 46; i++) { x.globalAlpha = 0.25 + rnd() * 0.55; x.fillStyle = i % 5 ? "#fff" : m.accent; x.beginPath(); x.arc(rnd() * W, rnd() * H, 1 + rnd() * 2.6, 0, Math.PI * 2); x.fill(); }
  x.globalAlpha = 1;

  // Header.
  x.fillStyle = m.accent; x.font = `600 30px ${SANS}`; x.textBaseline = "alphabetic";
  x.letterSpacing = "8px";
  x.fillText("TODAY'S WORD", 96, 170);
  x.letterSpacing = "0px";

  // The verse: as big as it can be while fitting.
  const text = `“${String(w.text || "").trim()}”`, maxW = W - 192, maxH = 720;
  let size = 84, lines = [];
  for (; size >= 38; size -= 2) { x.font = `500 ${size}px ${SANS}`; lines = wrap(x, text, maxW); if (lines.length * size * 1.22 <= maxH) break; }
  const lh = size * 1.22, top = 250 + Math.max(0, (maxH - lines.length * lh) / 2) + size;
  x.fillStyle = "#fff"; x.shadowColor = "rgba(0,0,0,.25)"; x.shadowBlur = 24;
  lines.forEach((l, i) => x.fillText(l, 96, top + i * lh));
  x.shadowBlur = 0;
  // Reference with an accent line.
  const refY = top + lines.length * lh + 30;
  x.fillStyle = m.accent; x.fillRect(96, refY - 12, 64, 5);
  x.font = `600 40px ${SANS}`; x.fillText(String(w.ref || ""), 182, refY);

  // Footer: logo + church name.
  const lg = await loadLogo();
  x.fillStyle = "rgba(255,255,255,.14)"; x.fillRect(96, H - 190, W - 192, 2);
  if (lg) { x.save(); x.beginPath(); x.arc(96 + 44, H - 100, 44, 0, Math.PI * 2); x.clip(); x.drawImage(lg, 96, H - 144, 88, 88); x.restore(); }
  x.fillStyle = "#fff"; x.font = `600 32px ${SANS}`; x.fillText("Sandton City Church", 210, H - 108);
  x.fillStyle = "rgba(255,255,255,.72)"; x.font = `400 26px ${SANS}`; x.fillText("aogsccyouth.com · Bound in fellowship by the Spirit", 210, H - 68);

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
