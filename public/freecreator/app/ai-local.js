// Built-in AI fallbacks (no network), copied from the desktop app.
import { parseLyrics, songToText, dedupeSections } from "./shared/lyrics.js";
import { parseReference, formatReference } from "./shared/scripture.js";

// Built-in topic list used when there's no key or no internet.
const TOPICS = {
  love: ["1 Corinthians 13:4-7", "John 3:16", "Romans 8:38-39", "1 John 4:7-8", "John 15:12-13"],
  faith: ["Hebrews 11:1", "Hebrews 11:6", "Romans 10:17", "Mark 11:22-24", "2 Corinthians 5:7"],
  hope: ["Jeremiah 29:11", "Romans 15:13", "Isaiah 40:31", "Lamentations 3:22-23", "Romans 5:3-5"],
  peace: ["Philippians 4:6-7", "John 14:27", "Isaiah 26:3", "Matthew 11:28-30", "Psalm 4:8"],
  fear: ["Isaiah 41:10", "2 Timothy 1:7", "Psalm 27:1", "Joshua 1:9", "Psalm 56:3-4"],
  strength: ["Philippians 4:13", "Isaiah 40:29-31", "Psalm 46:1", "2 Corinthians 12:9-10", "Nehemiah 8:10"],
  forgiveness: ["1 John 1:9", "Ephesians 4:32", "Colossians 3:13", "Psalm 103:12", "Matthew 6:14-15"],
  prayer: ["Philippians 4:6", "1 Thessalonians 5:16-18", "Matthew 6:9-13", "James 5:16", "Jeremiah 33:3"],
  grace: ["Ephesians 2:8-9", "2 Corinthians 12:9", "Titus 2:11", "Hebrews 4:16", "Romans 5:20"],
  salvation: ["Romans 10:9-10", "Acts 4:12", "John 14:6", "Romans 6:23", "Ephesians 2:8-9"],
  thanksgiving: ["Psalm 100:4", "1 Thessalonians 5:18", "Colossians 3:17", "Psalm 107:1", "Psalm 136:1"],
  worship: ["John 4:23-24", "Psalm 95:1-6", "Romans 12:1", "Psalm 150:6", "Hebrews 13:15"],
  youth: ["1 Timothy 4:12", "Ecclesiastes 12:1", "Psalm 119:9", "2 Timothy 2:22", "Proverbs 3:5-6"],
  family: ["Joshua 24:15", "Ephesians 6:1-4", "Proverbs 22:6", "Colossians 3:18-21", "Psalm 127:1"],
  healing: ["Isaiah 53:5", "James 5:14-15", "Jeremiah 17:14", "Psalm 103:2-3", "3 John 1:2"],
  giving: ["2 Corinthians 9:7", "Malachi 3:10", "Luke 6:38", "Acts 20:35", "Proverbs 3:9-10"],
  holy_spirit: ["Acts 1:8", "Galatians 5:22-23", "John 14:26", "Romans 8:26", "Acts 2:4"],
  guidance: ["Proverbs 3:5-6", "Psalm 32:8", "Psalm 119:105", "Isaiah 30:21", "James 1:5"],
  purpose: ["Jeremiah 29:11", "Ephesians 2:10", "Romans 8:28", "Proverbs 19:21", "Philippians 1:6"],
  joy: ["Nehemiah 8:10", "Psalm 16:11", "John 15:11", "Romans 15:13", "James 1:2-3"],
};
const SYNONYMS = { anxiety: "peace", worry: "peace", afraid: "fear", courage: "fear", power: "strength", weak: "strength", mercy: "grace", saved: "salvation", gospel: "salvation", thanks: "thanksgiving", praise: "worship", young: "youth", marriage: "family", parents: "family", sick: "healing", tithe: "giving", offering: "giving", spirit: "holy_spirit", direction: "guidance", wisdom: "guidance", calling: "purpose", happiness: "joy", trust: "faith", believe: "faith" };


// ── Built-in fallbacks (also used by the tests) ─────────────────────────────

export function tidyLocally(raw) {
  const cleaned = String(raw || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !/^\s*([A-G][#b]?(m|maj|min|sus|dim|aug|add)?\d*(\/[A-G][#b]?)?\s*)+$/.test(l)) // chord-only lines
    .filter((l) => !/(ccli|copyright|©|all rights reserved)/i.test(l))
    .map((l) => l.replace(/\s*\(?\s*x\s*\d\s*\)?\s*$/i, "").replace(/\s{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  const { sections, arrangement } = dedupeSections(parseLyrics(cleaned));
  return songToText({ sections: arrangement.filter((v, i, a) => a.indexOf(v) === i).map((i) => sections[i]) });
}

export function topicLocally(topic) {
  const words = String(topic || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const keys = new Set();
  for (const w of words) {
    if (TOPICS[w]) keys.add(w);
    else if (SYNONYMS[w]) keys.add(SYNONYMS[w]);
    else { const k = Object.keys(TOPICS).find((t) => t.startsWith(w) && w.length >= 4); if (k) keys.add(k); }
  }
  if (!keys.size) keys.add("hope");
  const refs = [...new Set([...keys].flatMap((k) => TOPICS[k]))].slice(0, 8);
  return refs.map((ref) => ({ ref, why: `About ${[...keys].join(", ").replace(/_/g, " ")}` }));
}

const REF_IN_TEXT = /\b((?:[1-3]\s?)?[A-Z][a-z]+\.?\s\d{1,3}(?::\d{1,3}(?:\s?[-–]\s?\d{1,3})?)?)\b/g;
export function sermonLocally(notes) {
  const lines = String(notes || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  const slides = [];
  lines.forEach((line, i) => {
    const refs = [...line.matchAll(REF_IN_TEXT)].map((m) => m[1]).filter((r) => parseReference(r));
    const text = line.length > 140 ? line.slice(0, 137).replace(/\s+\S*$/, "") + "…" : line;
    slides.push({ kind: "text", text: i === 0 ? text : text, ref: null });
    for (const r of refs) slides.push({ kind: "scripture", text: "", ref: formatReference(parseReference(r)) });
  });
  return slides;
}
