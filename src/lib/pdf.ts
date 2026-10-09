/**
 * Tiny PDF writer for event tickets: one A5 page per ticket, the church fonts (Jost + Playfair Display, embedded),
 * vector QR code, embedded JPEG logo. No dependencies.
 */
import { qrMatrix } from "./qr.ts";
import { LOGO_JPEG_B64, LOGO_SIZE } from "./ticket-logo.ts";
import { fromB64 } from "./crypto.ts";
import { PDF_FONTS, type PdfFont } from "./pdf-fonts.ts";

// Resource name → embedded church font (same Jost + Playfair Display as the website and emails).
const FONT_RES: Record<string, PdfFont> = { F: PDF_FONTS.sans, FB: PDF_FONTS.sansBold, FS: PDF_FONTS.serif, FI: PDF_FONTS.serifItalic };

export interface TicketPage {
  eventTitle: string; when: string; location: string; holder: string; seq: number; quantity: number;
  ref: string; code: string; url: string; price?: string | null;
}

const W = 420, H = 595;   // A5 portrait in points

/** Map text to WinAnsi-safe characters and escape PDF string delimiters. */
function pdfText(s: string): string {
  const map: Record<string, string> = { "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "·": "·", "→": "->", "✦": "*" };
  return Array.from(String(s ?? "")).map((c) => map[c] ?? c).map((c) => (c.charCodeAt(0) > 255 ? "?" : c)).join("")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
const rgb = (hex: string) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");

// Exact advance widths from the embedded fonts, so text centres and wraps precisely.
function textWidth(s: string, size: number, font = "F") {
  const f = FONT_RES[font] ?? FONT_RES.F;
  let w = 0;
  for (const c of pdfText(s).replace(/\\(.)/g, "$1")) { const code = c.charCodeAt(0); w += code >= 32 && code <= 255 ? f.widths[code - 32] || 500 : 500; }
  return (w * size) / 1000;
}
function wrap(s: string, size: number, max: number, font = "F"): string[] {
  const words = s.split(/\s+/), lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (textWidth(t, size, font) > max && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function pageContent(t: TicketPage): string {
  const out: string[] = [];
  const text = (x: number, y: number, s: string, font: string, size: number, color = "#1c1712") =>
    out.push(`BT ${rgb(color)} rg /${font} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(s)}) Tj ET`);
  const centre = (y: number, s: string, font: string, size: number, color?: string) => text((W - textWidth(s, size, font)) / 2, y, s, font, size, color);
  const rect = (x: number, y: number, w: number, h: number, color: string) => out.push(`${rgb(color)} rg ${x} ${y} ${w} ${h} re f`);

  // paper + dark band
  rect(0, 0, W, H, "#fbf7f0");
  rect(0, H - 118, W, 118, "#14110e");
  rect(0, H - 121, W, 3, "#d6a650");
  out.push(`q 54 0 0 54 ${(W - 54) / 2} ${H - 74} cm /Logo Do Q`);
  centre(H - 92, "AOG SANDTON CITY CHURCH", "FB", 9, "#f6d28b");
  centre(H - 106, "Bound in fellowship by the Spirit", "FI", 9, "#b9b0a3");

  // event
  let y = H - 154;
  centre(y, `ADMIT ONE  ·  TICKET ${t.seq} OF ${t.quantity}`, "FB", 9, "#9a6a1f");
  y -= 30;
  for (const line of wrap(t.eventTitle, 24, W - 70, "FS").slice(0, 2)) { centre(y, line, "FS", 24); y -= 28; }
  y -= 2;
  for (const line of wrap(t.when, 11, W - 70).slice(0, 2)) { centre(y, line, "F", 11, "#4a4137"); y -= 15; }
  for (const line of wrap(t.location, 10, W - 70).slice(0, 2)) { centre(y, line, "F", 10, "#8a7f72"); y -= 14; }

  // QR code (vector)
  const m = qrMatrix(t.url), n = m.length, qrSize = 186, cell = qrSize / n, qx = (W - qrSize) / 2, qy = 150;
  rect(qx - 14, qy - 14, qrSize + 28, qrSize + 28, "#ffffff");
  out.push(`${rgb("#1c1712")} rg`);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) out.push(`${(qx + c * cell).toFixed(2)} ${(qy + (n - 1 - r) * cell).toFixed(2)} ${(cell + 0.05).toFixed(2)} ${(cell + 0.05).toFixed(2)} re f`);
  centre(qy - 32, t.code.replace(/(.{4})(?=.)/g, "$1 "), "FB", 12, "#1c1712");

  // holder + ref
  out.push(`${rgb("#eadfcd")} RG 0.8 w 40 112 m ${W - 40} 112 l S`);
  text(40, 92, "TICKET HOLDER", "FB", 7.5, "#8a7f72");
  text(40, 76, t.holder, "FB", 12);
  const refLabel = "BOOKING REF";
  text(W - 40 - textWidth(refLabel, 7.5, "FB"), 92, refLabel, "FB", 7.5, "#8a7f72");
  text(W - 40 - textWidth(t.ref, 12, "FB"), 76, t.ref, "FB", 12);
  if (t.price) text(40, 60, t.price, "F", 9.5, "#9a6a1f");
  centre(32, "Show this QR code at the door. Each ticket can be scanned once.", "F", 8.5, "#8a7f72");
  centre(19, "aogsccyouth.com", "FB", 8, "#9a6a1f");
  return out.join("\n");
}

/** Build a PDF (Uint8Array) with one page per ticket. */
export function ticketsPdf(pages: TicketPage[]): Uint8Array {
  // PDF content uses single-byte WinAnsi/Latin-1 strings (all text is mapped to <= U+00FF first).
  const enc = { encode: (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff) };
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const add = (data: Uint8Array | string) => { const b = typeof data === "string" ? enc.encode(data) : data; chunks.push(b); length += b.length; };
  const obj = (id: number, body: (Uint8Array | string)[]) => { offsets[id] = length; add(`${id} 0 obj\n`); body.forEach(add); add("\nendobj\n"); };

  add("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  const logo = fromB64(LOGO_JPEG_B64);
  // 1 catalog, 2 pages, 3-6 fonts, 7 logo, then (page, content) pairs; font descriptors/files follow at the end.
  const fontDefs: [number, PdfFont][] = [[3, FONT_RES.F], [4, FONT_RES.FB], [5, FONT_RES.FS], [6, FONT_RES.FI]];
  const kids = pages.map((_, i) => 8 + i * 2);
  const extra = 8 + pages.length * 2;   // first id after the pages
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages.length} >>`]);
  fontDefs.forEach(([id, f], i) => obj(id, [`<< /Type /Font /Subtype /TrueType /BaseFont /${f.name} /FirstChar 32 /LastChar 255 /Widths [${f.widths.join(" ")}] /FontDescriptor ${extra + i * 2} 0 R /Encoding /WinAnsiEncoding >>`]));
  obj(7, [`<< /Type /XObject /Subtype /Image /Width ${LOGO_SIZE} /Height ${LOGO_SIZE} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.length} >>\nstream\n`, logo, "\nendstream"]);
  pages.forEach((p, i) => {
    const content = enc.encode(pageContent(p));
    obj(8 + i * 2, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${9 + i * 2} 0 R /Resources << /Font << /F 3 0 R /FB 4 0 R /FS 5 0 R /FI 6 0 R >> /XObject << /Logo 7 0 R >> >> >>`]);
    obj(9 + i * 2, [`<< /Length ${content.length} >>\nstream\n`, content, "\nendstream"]);
  });
  fontDefs.forEach(([, f], i) => {
    const file = fromB64(f.b64);
    obj(extra + i * 2, [`<< /Type /FontDescriptor /FontName /${f.name} /Flags ${f.flags} /FontBBox [${f.bbox.join(" ")}] /ItalicAngle ${f.italic} /Ascent ${f.ascent} /Descent ${f.descent} /CapHeight ${f.cap} /StemV ${f.stemV} /FontFile2 ${extra + i * 2 + 1} 0 R >>`]);
    obj(extra + i * 2 + 1, [`<< /Length ${file.length} /Length1 ${file.length} >>\nstream\n`, file, "\nendstream"]);
  });
  const xrefAt = length, count = extra + fontDefs.length * 2;
  add(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) add(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  add(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  const outBuf = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) { outBuf.set(c, o); o += c.length; }
  return outBuf;
}
