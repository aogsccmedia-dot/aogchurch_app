/**
 * Today's Word art direction, with the AI's help:
 *  - Llama reads the verse and picks the words to highlight, a short tagline, a colour palette that fits the mood
 *    and a scene for the background.
 *  - FLUX paints a soft, text-free background for the scene (no people, no faces).
 *  - Styles rotate day by day from minimal to bold and colourful; people can shuffle through all of them.
 * Everything is cached for the day, and there's always a safe fallback when the AI isn't available.
 */
import type { Env } from "../env.ts";
import { saDay, wordFor } from "./word.ts";

export const STYLES = ["minimal-light", "mesh", "minimal-dark", "pop", "rays", "waves", "photo", "editorial", "confetti"] as const;
export type Style = typeof STYLES[number];

const SCENES: Record<string, string> = {
  sunrise: "a gentle sunrise over soft rolling hills, warm golden light, misty atmosphere",
  stars: "a calm night sky full of stars and a soft milky way glow",
  ocean: "calm ocean waves at golden hour, sparkling light on the water",
  mountains: "majestic layered mountains in morning haze, light rays through clouds",
  garden: "a peaceful garden with soft blooming flowers and morning dew, shallow depth of field",
  light: "abstract rays of warm light breaking through soft clouds",
  fire: "abstract warm glowing embers and soft flame light, cozy and hopeful",
  rain: "soft rain on a window with warm bokeh lights behind",
  path: "a winding path through a sunlit forest, light filtering through trees",
  field: "a wide wheat field under a big sky at golden hour",
  river: "a quiet river flowing through green valley in soft light",
  abstract: "abstract flowing silk shapes and soft gradients, dreamy and modern",
};
const PALETTES: string[][] = [
  ["#1b1340", "#5a3fd0", "#f3b4d6", "#ffd27a"], ["#0d2b2a", "#1f7d6c", "#a8f0d6", "#f7d68f"], ["#2b0e1e", "#c23f5f", "#ffc3a3", "#ffe2a8"],
  ["#0a1d3b", "#2c6ade", "#a6e2ff", "#ffe08a"], ["#24170a", "#b9822f", "#ffe4b0", "#fff3da"], ["#ff5f6d", "#ffc371", "#7b2ff7", "#00d2ff"],
  ["#00c9a7", "#845ec2", "#ffc75f", "#f9f871"], ["#ff3d7f", "#ffb800", "#00b8ff", "#7cff6b"],
];
const HEX = /^#[0-9a-f]{6}$/i;

export interface ArtPlan { day: string; style: Style; palette: string[]; highlight: string | null; tagline: string | null; scene: string; ai: boolean; bg: string | null }

function fallback(day: string, verse: string): ArtPlan {
  const n = Math.floor(Date.parse(day + "T00:00:00Z") / 86400_000);
  const words = verse.replace(/[“”".,;:!?]/g, "").split(/\s+/).filter((w) => w.length > 4);
  return { day, style: STYLES[n % STYLES.length], palette: PALETTES[n % PALETTES.length], highlight: words.sort((a, b) => b.length - a.length)[0] || null,
    tagline: null, scene: Object.keys(SCENES)[n % Object.keys(SCENES).length], ai: false, bg: null };
}

function clean(raw: unknown, day: string, verse: string): ArtPlan {
  const base = fallback(day, verse);
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pal = Array.isArray(o.palette) ? o.palette.map(String).filter((c) => HEX.test(c)).slice(0, 4) : [];
  let hl = typeof o.highlight === "string" ? o.highlight.trim().replace(/^["“']|["”']$/g, "") : "";
  if (!hl || hl.split(/\s+/).length > 5 || !verse.toLowerCase().includes(hl.toLowerCase())) hl = base.highlight || "";
  let tag = typeof o.tagline === "string" ? o.tagline.trim().replace(/["“”]/g, "").slice(0, 42) : "";
  if (/https?:|www\.|@/.test(tag)) tag = "";
  const scene = typeof o.scene === "string" && SCENES[o.scene] ? o.scene : base.scene;
  return { ...base, palette: pal.length === 4 ? pal : base.palette, highlight: hl || null, tagline: tag || null, scene, ai: true };
}

const kvGet = async (env: Env, k: string) => { try { return await env.FILES_KV?.get(k); } catch { return null; } };
const kvPut = async (env: Env, k: string, v: string | ArrayBuffer, ttl = 3 * 86400) => { try { await env.FILES_KV?.put(k, v, { expirationTtl: ttl }); } catch { /* cache only */ } };

/** Today's plan: from cache, else ask the AI once (and remember it for the day). */
export async function artPlan(env: Env, day = saDay()): Promise<ArtPlan> {
  const w = wordFor(day);
  const key = `wordart:plan:${day}`;
  const cached = await kvGet(env, key);
  const withBg = (p: ArtPlan): ArtPlan => ({ ...p, bg: env.AI ? `/api/word/art-bg?d=${day}` : null });
  if (cached) { try { return withBg(JSON.parse(cached)); } catch { /* regenerate */ } }
  let plan = fallback(day, w.text);
  if (env.AI) {
    try {
      const out = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [
          { role: "system", content: "You are the art director for a church's daily Bible verse image. Reply with JSON only, no prose." },
          { role: "user", content: `Verse (${w.ref}): "${w.text}"\n\nChoose:\n- highlight: 1 to 4 consecutive words copied exactly from the verse that carry its heart\n- tagline: a warm 2 to 6 word line for young people that sums it up (no quotes, no emojis)\n- palette: 4 hex colours [dark, main, light, accent] that suit the verse's mood; good contrast with white text on the first two\n- scene: one of ${Object.keys(SCENES).join(", ")}\n\nJSON shape: {"highlight":"","tagline":"","palette":["#","#","#","#"],"scene":""}` },
        ],
        max_tokens: 200, temperature: 0.8, response_format: { type: "json_object" },
      }) as { response?: unknown };
      const r = out?.response;
      const parsed = typeof r === "string" ? JSON.parse(r.slice(r.indexOf("{"), r.lastIndexOf("}") + 1)) : r;
      plan = clean(parsed, day, w.text);
    } catch (e) { console.error("word art plan failed", e); }
  }
  await kvPut(env, key, JSON.stringify(plan));
  return withBg(plan);
}

/** The AI-painted background for today (JPEG). Generated once per day, then served from cache. */
export async function artBackground(env: Env, day: string): Promise<ArrayBuffer | null> {
  const key = `wordart:bg:${day}`;
  try { const hit = await env.FILES_KV?.get(key, "arrayBuffer"); if (hit) return hit; } catch { /* generate */ }
  if (!env.AI) return null;
  // One painter at a time per day.
  const lock = `wordart:lock:${day}`;
  if (await kvGet(env, lock)) return null;
  await kvPut(env, lock, "1", 120);
  try {
    const plan = await artPlan(env, day);
    const prompt = `${SCENES[plan.scene] || SCENES.abstract}, colour palette ${plan.palette.join(" ")}, cinematic, soft focus, lots of calm empty space for text, high quality digital painting, no text, no letters, no words, no people, no faces, no hands`;
    const out = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt, steps: 6 }) as { image?: string };
    if (!out?.image) return null;
    const bin = Uint8Array.from(atob(out.image), (c) => c.charCodeAt(0));
    await kvPut(env, key, bin.buffer as ArrayBuffer);
    return bin.buffer as ArrayBuffer;
  } catch (e) { console.error("word art background failed", e); return null; }
}

/** Cron: prepare tomorrow's (and today's) plan and background ahead of time, so the art is instant in the morning. */
export async function prepareWordArt(env: Env, now = new Date()): Promise<void> {
  const sa = new Date(now.getTime() + 2 * 3600_000);
  if (sa.getUTCMinutes() >= 10) return;   // once an hour is plenty
  for (const day of [saDay(now), saDay(new Date(now.getTime() + 86400_000))]) {
    await artPlan(env, day);
    await artBackground(env, day);
  }
}
