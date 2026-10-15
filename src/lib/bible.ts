/**
 * Scripture for FreeCreator Online: public-domain translations, fetched a whole chapter at a time and cached,
 * so a Sunday service costs a handful of upstream calls. References are checked against the real chapter
 * counts first, so nothing invalid is ever sent upstream (bible-api.com blocks addresses that ask for many
 * missing passages). If the main source is busy, a second free source is tried.
 */
import { HttpError } from "./http.ts";
import type { Env } from "../env.ts";

export const BOOKS = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
  "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah",
  "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah",
  "Malachi", "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians",
  "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John",
  "3 John", "Jude", "Revelation"];
export const CHAPTERS = [50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3,
  3, 2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22];
export const TRANSLATIONS = ["kjv", "web", "asv", "bbe", "ylt"];
const BOLLS: Record<string, string> = { kjv: "KJV", web: "WEB", ylt: "YLT" };

export type Verse = { chapter: number; verse: number; text: string };
export type Ref = { book: number; chapter: number; from: number | null; toChapter: number; to: number | null };

const norm = (s: string) => s.toLowerCase().replace(/^psalm\b/, "psalms").replace(/[^a-z0-9]/g, "");
const BY_NAME = new Map(BOOKS.map((b, i) => [norm(b), i]));

/** "John 3:16-18", "Psalm 23", "1 Corinthians 13:4-7", "John 3:16-4:2" (as the app formats them). */
export function parseRef(input: string): Ref | null {
  const m = /^\s*([1-3]?\s?[A-Za-z][A-Za-z ]*?)\s+(\d{1,3})(?::(\d{1,3}))?(?:\s*-\s*(\d{1,3})(?::(\d{1,3}))?)?\s*$/.exec(String(input).replace(/[–—]/g, "-"));
  if (!m) return null;
  const book = BY_NAME.get(norm(m[1]));
  if (book == null) return null;
  const chapter = Number(m[2]);
  if (chapter < 1 || chapter > CHAPTERS[book]) return null;
  const from = m[3] ? Number(m[3]) : null;
  let toChapter = chapter, to: number | null = from;
  if (m[4] && m[5]) { toChapter = Number(m[4]); to = Number(m[5]); }
  else if (m[4]) { if (from == null) { toChapter = Number(m[4]); to = null; } else to = Number(m[4]); }
  if (toChapter < chapter || toChapter > CHAPTERS[book] || toChapter - chapter > 2) return null;
  if (toChapter === chapter && from != null && to != null && to < from) return { book, chapter, from: to, toChapter, to: from };
  return { book, chapter, from, toChapter, to };
}

const clean = (t: string) => String(t || "").replace(/<S>\d+<\/S>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function fromBibleApi(book: number, chapter: number, tr: string): Promise<Verse[] | "busy"> {
  const res = await fetch(`https://bible-api.com/${encodeURIComponent(`${BOOKS[book]} ${chapter}`)}?translation=${tr}`, { headers: { "user-agent": "aogsccyouth.com FreeCreator Online" } }).catch(() => null);
  if (!res || !res.ok) return "busy";
  const d = await res.json().catch(() => null) as { verses?: { chapter: number; verse: number; text: string }[] } | null;
  const v = (d?.verses || []).map((x) => ({ chapter: Number(x.chapter) || chapter, verse: Number(x.verse), text: clean(x.text) })).filter((x) => x.verse && x.text);
  return v.length ? v : "busy";
}
async function fromBolls(book: number, chapter: number, tr: string): Promise<Verse[] | null> {
  const code = BOLLS[tr]; if (!code) return null;
  const res = await fetch(`https://bolls.life/get-text/${code}/${book + 1}/${chapter}/`, { headers: { "user-agent": "aogsccyouth.com FreeCreator Online" } }).catch(() => null);
  if (!res || !res.ok) return null;
  const d = await res.json().catch(() => null) as { verse: number; text: string }[] | null;
  const v = (Array.isArray(d) ? d : []).map((x) => ({ chapter, verse: Number(x.verse), text: clean(x.text) })).filter((x) => x.verse && x.text);
  return v.length ? v : null;
}

/** One chapter, cached for a month (edge cache, then KV), from bible-api.com or the fallback. */
export async function chapterText(env: Env, book: number, chapter: number, tr: string): Promise<{ verses: Verse[]; translation: string }> {
  const ck = `bible:${tr}:${book + 1}:${chapter}`;
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default, key = new Request(`https://cache.internal/${ck}`);
  const hit = await cache?.match(key).then((r) => r?.json()).catch(() => null) as { verses: Verse[]; translation: string } | null
    ?? await (async () => { try { return await env.FILES_KV?.get(ck, "json"); } catch { return null; } })() as { verses: Verse[]; translation: string } | null;
  if (hit?.verses?.length) return hit;
  let verses = await fromBibleApi(book, chapter, tr), translation = tr.toUpperCase();
  if (verses === "busy") {
    const alt = await fromBolls(book, chapter, tr);
    if (!alt) throw new HttpError(503, "The Bible service is busy. Try again in a moment.");
    verses = alt;
  }
  const out = { verses, translation };
  await cache?.put(key, new Response(JSON.stringify(out), { headers: { "cache-control": "max-age=2592000", "content-type": "application/json" } })).catch(() => {});
  try { await env.FILES_KV?.put(ck, JSON.stringify(out), { expirationTtl: 90 * 86400 }); } catch { /* cache only */ }
  return out;
}

export async function passage(env: Env, input: string, tr: string): Promise<{ reference: string; translation: string; verses: Verse[] }> {
  const r = parseRef(input);
  if (!r) throw new HttpError(422, "Try a reference like John 3:16 or Psalm 23.");
  const all: Verse[] = []; let translation = tr.toUpperCase();
  for (let c = r.chapter; c <= r.toChapter; c++) { const ch = await chapterText(env, r.book, c, tr); translation = ch.translation; all.push(...ch.verses.map((v) => ({ ...v, chapter: c }))); }
  const after = (v: Verse) => r.from == null || v.chapter > r.chapter || v.verse >= r.from;
  const before = (v: Verse) => r.to == null || v.chapter < r.toChapter || v.verse <= r.to;
  const verses = all.filter((v) => after(v) && before(v));
  const name = BOOKS[r.book];
  if (!verses.length) throw new HttpError(404, `${name} ${r.chapter} doesn't have verse ${r.from}.`);
  const reference = `${name} ${r.chapter}${r.from != null ? `:${r.from}${r.to != null && (r.to !== r.from || r.toChapter !== r.chapter) ? `-${r.toChapter !== r.chapter ? `${r.toChapter}:` : ""}${r.to}` : ""}` : r.toChapter !== r.chapter ? `-${r.toChapter}` : ""}`;
  return { reference, translation, verses };
}
