// Ask SCC retrieval (RAG): find the parts of the church's own website that best match a question.
// Meaning-based search with an open embedding model on Workers AI (bge-base), with the page vectors cached in KV.
// If the AI is unavailable, a simple word-overlap search is used instead, so answers still have church context.
import type { Env } from "../env.ts";
import { KB } from "./kb.generated.ts";

const EMBED = "@cf/baai/bge-base-en-v1.5";
type Chunk = (typeof KB)[number];
let mem: { key: string; vecs: number[][] } | null = null;

function kbKey(): string {
  let h = 2166136261;
  for (const c of KB) for (let i = 0; i < c.text.length; i += 7) { h ^= c.text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `rag:v1:${KB.length}:${(h >>> 0).toString(36)}`;
}
const norm = (v: number[]) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
const dot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const r = await env.AI!.run(EMBED, { text: texts.slice(i, i + 50) }) as { data?: number[][] };
    if (!r?.data?.length) throw new Error("no embeddings");
    out.push(...r.data.map(norm));
  }
  return out;
}

async function kbVectors(env: Env): Promise<number[][]> {
  const key = kbKey();
  if (mem?.key === key) return mem.vecs;
  const kv = env.FILES_KV as KVNamespace | undefined;
  const cached = kv ? await kv.get(key, "json").catch(() => null) as number[][] | null : null;
  if (cached?.length === KB.length) { mem = { key, vecs: cached }; return cached; }
  const vecs = (await embed(env, KB.map((c) => `${c.title}\n${c.text}`))).map((v) => v.map((x) => Math.round(x * 1e4) / 1e4));
  if (kv) await kv.put(key, JSON.stringify(vecs), { expirationTtl: 60 * 86400 }).catch(() => {});
  mem = { key, vecs };
  return vecs;
}

const STOP = new Set("the and for you your are how what who why when where can get with our this that from have has was were will would about into does did not all any its it's i'm".split(" "));
const WORDS = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, ""));
function keywordSearch(q: string, k: number): Chunk[] {
  const qs = new Set(WORDS(q));
  return KB.map((c) => ({ c, s: WORDS(`${c.title} ${c.text}`).reduce((n, w) => n + (qs.has(w) ? 1 : 0), 0) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.c);
}

/** The k most relevant church passages for a question (empty when nothing is close enough). */
export async function retrieve(env: Env, question: string, k = 5): Promise<Chunk[]> {
  if (!env.AI) return keywordSearch(question, k);
  try {
    const [vecs, [q]] = await Promise.all([kbVectors(env), embed(env, [question])]);
    return vecs.map((v, i) => ({ c: KB[i], s: dot(v, q) })).filter((x) => x.s > 0.55).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.c);
  } catch {
    return keywordSearch(question, k);
  }
}

export function contextBlock(chunks: Chunk[]): string {
  return chunks.map((c) => `[${c.title}] ${c.text.replace(/\s+/g, " ").slice(0, 900)}`).join("\n");
}
