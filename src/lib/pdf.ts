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
  return assemble(pages.map(pageContent), W, H);
}

/** Put page content streams together into one PDF with the church fonts and logo. */
function assemble(contents: string[], PW: number, PH: number): Uint8Array {
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
  const kids = contents.map((_, i) => 8 + i * 2);
  const extra = 8 + contents.length * 2;   // first id after the pages
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${contents.length} >>`]);
  fontDefs.forEach(([id, f], i) => obj(id, [`<< /Type /Font /Subtype /TrueType /BaseFont /${f.name} /FirstChar 32 /LastChar 255 /Widths [${f.widths.join(" ")}] /FontDescriptor ${extra + i * 2} 0 R /Encoding /WinAnsiEncoding >>`]));
  obj(7, [`<< /Type /XObject /Subtype /Image /Width ${LOGO_SIZE} /Height ${LOGO_SIZE} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.length} >>\nstream\n`, logo, "\nendstream"]);
  contents.forEach((c, i) => {
    const content = enc.encode(c);
    obj(8 + i * 2, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents ${9 + i * 2} 0 R /Resources << /Font << /F 3 0 R /FB 4 0 R /FS 5 0 R /FI 6 0 R >> /XObject << /Logo 7 0 R >> >> >>`]);
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

// ---------------------------------------------------------------- class notes (A4, as many pages as needed)
export interface NotesDoc {
  title: string; when: string; teacher: string; attendees: string[];
  summary: string; points: string[]; scriptures: string[]; actions: string[]; questions: string[];
  transcript: { name: string; time: string; text: string }[];
}
/** Discipleship class notes: summary first, then everything that was said. */
export function notesPdf(d: NotesDoc): Uint8Array {
  const PW = 595, PH = 842, M = 54, MAX = PW - M * 2;
  const pages: string[] = [];
  let out: string[] = [], y = 0;
  const text = (x: number, yy: number, s: string, font: string, size: number, color = "#1c1712") =>
    out.push(`BT ${rgb(color)} rg /${font} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${pdfText(s)}) Tj ET`);
  const rect = (x: number, yy: number, w: number, h: number, color: string) => out.push(`${rgb(color)} rg ${x} ${yy} ${w} ${h} re f`);
  const footer = () => { const n = pages.length + 1; const f = `AOG Sandton City Church · Discipleship class notes · page ${n}`; text((PW - textWidth(f, 8)) / 2, 28, f, "F", 8, "#8a7f72"); };
  const newPage = (first = false) => {
    if (out.length) { footer(); pages.push(out.join("\n")); }
    out = [];
    rect(0, 0, PW, PH, "#ffffff");
    if (first) {
      rect(0, PH - 120, PW, 120, "#fbf7f0"); rect(0, PH - 123, PW, 3, "#d6a650");
      out.push(`q 44 0 0 44 ${M} ${PH - 84} cm /Logo Do Q`);
      text(M + 58, PH - 58, "AOG SANDTON CITY CHURCH", "FB", 9, "#9a6a1f");
      text(M + 58, PH - 76, "Discipleship class notes", "FI", 11, "#4a4137");
      y = PH - 160;
    } else y = PH - 60;
  };
  const need = (h: number) => { if (y - h < 56) newPage(); };
  const para = (s: string, size = 11, font = "F", color = "#2b241d", indent = 0, lead = 1.45) => {
    for (const line of wrap(s, size, MAX - indent, font)) { need(size * lead); text(M + indent, y, line, font, size, color); y -= size * lead; }
  };
  const heading = (s: string) => { y -= 10; need(40); text(M, y, s.toUpperCase(), "FB", 9, "#9a6a1f"); y -= 6; out.push(`${rgb("#eadfcd")} RG 0.8 w ${M} ${y} m ${PW - M} ${y} l S`); y -= 18; };
  const bullets = (list: string[]) => { for (const b of list) { need(16); text(M + 2, y, "·", "FB", 12, "#d6a650"); para(b, 11, "F", "#2b241d", 14); y -= 3; } };

  newPage(true);
  for (const line of wrap(d.title, 24, MAX, "FS").slice(0, 3)) { text(M, y, line, "FS", 24); y -= 30; }
  para(d.when, 10.5, "F", "#4a4137");
  para(`Taught by ${d.teacher}`, 10.5, "F", "#4a4137");
  if (d.attendees.length) para(`Joined online: ${d.attendees.join(", ")}`, 9.5, "F", "#8a7f72");
  if (d.summary) { heading("Summary"); para(d.summary); }
  if (d.points.length) { heading("Key points"); bullets(d.points); }
  if (d.scriptures.length) { heading("Scriptures"); bullets(d.scriptures); }
  if (d.actions.length) { heading("To do this week"); bullets(d.actions); }
  if (d.questions.length) { heading("Questions to think about"); bullets(d.questions); }
  if (d.transcript.length) {
    heading("What was said");
    for (const t of d.transcript) { need(30); text(M, y, `${t.name}  ·  ${t.time}`, "FB", 8.5, "#8a7f72"); y -= 13; para(t.text, 10, "F", "#2b241d", 0, 1.4); y -= 6; }
  }
  y -= 8; para("These notes were made automatically from the class and may contain small mistakes.", 8.5, "FI", "#8a7f72");
  footer(); pages.push(out.join("\n"));
  return assemble(pages, PW, PH);
}
