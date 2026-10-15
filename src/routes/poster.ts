/**
 * Poster maker for church members and the team: pick a weekday service and an upcoming date, add the details,
 * optionally a photo (used exactly as uploaded: never sent to AI, never altered), choose a look, download or share.
 * The AI helps with words (headline, tagline, colours) and can paint a text-free, people-free background.
 * Only today and future dates; 2026 by default, 2027 when asked.
 */
import type { Env } from "../env.ts";
import { HttpError, Router, clientIp, json, readJson, trustedWrite } from "../lib/http.ts";
import { getSession } from "../lib/auth.ts";
import { rateLimit } from "../lib/ratelimit.ts";
import { DAYS, groupLabel, nextOccurrence, saToday } from "../lib/groups.ts";
import { churchNames } from "../lib/names.ts";

const ADDRESS = "17 Humber Street, Woodmead, Sandton";
const SCENES: Record<string, string> = {
  sunrise: "a gentle sunrise over soft rolling hills, warm golden light, misty atmosphere",
  stars: "a calm night sky full of stars and a soft milky way glow",
  ocean: "calm ocean waves at golden hour, sparkling light on the water",
  mountains: "majestic layered mountains in morning haze, light rays through clouds",
  garden: "a peaceful garden with soft blooming flowers and morning dew, shallow depth of field",
  light: "abstract rays of warm light breaking through soft clouds",
  fire: "abstract warm glowing embers and soft flame light, hopeful",
  city: "a modern city skyline at dusk with soft bokeh lights, Johannesburg feel",
  abstract: "abstract flowing silk shapes and soft gradients, dreamy and modern",
  worship: "abstract stage lights and soft haze in a concert hall, purple and gold beams",
};
const HEX = /^#[0-9a-f]{6}$/i;
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Members (not revoked) and anyone on the team. */
async function posterUser(env: Env, req: Request) {
  const s = await getSession(env, req);
  if (!s) throw new HttpError(401, "Please sign in to make a poster.");
  if (s.kind === "admin" || s.role) return s;
  const m = await env.DB.prepare("SELECT 1 FROM members WHERE (user_id = ? OR lower(email) = lower(?)) AND status NOT IN ('revoked') LIMIT 1").bind(s.user.id, s.user.email).first();
  if (!m) throw new HttpError(403, "The poster maker is for church members. Complete joining first, then come back.");
  return s;
}

/** Upcoming dates for a weekday service: today (if it's that day) onwards, to the end of 2026, or of 2027 when asked. */
export function posterDates(day: number, today = saToday(), until = `${today.slice(0, 4)}-12-31`): string[] {
  const out: string[] = [];
  for (let d = nextOccurrence(day, today); d <= until; d = addDays(d, 7)) out.push(d);
  return out;
}

export function posterRoutes(router: Router, env: Env): void {
  router.get("/api/poster/options", async (req) => {
    await posterUser(env, req);
    const today = saToday(), y = Number(today.slice(0, 4));
    const { results } = await env.DB.prepare("SELECT id, day, title, start_time, end_time, ministry_group, frequency FROM weekly_services WHERE active = 1 AND day BETWEEN 1 AND 5 ORDER BY day, sort, title")
      .all<{ id: string; day: number; title: string; start_time: string | null; end_time: string | null; ministry_group: string; frequency: string }>();
    const until = `${y + 1}-12-31`;
    const { results: planned } = await env.DB.prepare("SELECT service_id, date, topic, speaker, mc, scripture FROM service_sessions WHERE date BETWEEN ? AND ? AND status = 'held'")
      .bind(today, until).all<{ service_id: string; date: string; topic: string; speaker: string | null; mc: string | null; scripture: string | null }>();
    return json({
      ok: true, today, year: y, next_year: y + 1, address: ADDRESS, scenes: Object.keys(SCENES),
      services: results.map((s) => ({
        ...s, day_label: DAYS[s.day], group_label: groupLabel(s.ministry_group),
        time: s.start_time ? (s.end_time ? `${s.start_time} – ${s.end_time}` : s.start_time) : "",
        dates: posterDates(s.day, today, `${y}-12-31`), dates_next_year: posterDates(s.day, today, until).filter((d) => d > `${y}-12-31`),
        planned: planned.filter((p) => p.service_id === s.id).map(({ service_id: _s, ...p }) => p),
      })),
    }, 200, { "Cache-Control": "no-store" });
  });

  // Speaker names to pick from (church members and the team, names only).
  router.get("/api/poster/people", async (req) => { await posterUser(env, req); return json({ ok: true, people: await churchNames(env) }, 200, { "Cache-Control": "private, max-age=300" }); });

  // AI help with the words and colours (never the photo).
  router.post("/api/poster/suggest", async (req) => {
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    const s = await posterUser(env, req);
    await rateLimit(env, "poster-ai", s.user.id, 30, 3600);
    const b = await readJson<{ service?: string; topic?: string; scripture?: string; speaker?: string }>(req);
    const service = String(b.service || "").slice(0, 80), topic = String(b.topic || "").slice(0, 160), scripture = String(b.scripture || "").slice(0, 300);
    if (!topic && !scripture) throw new HttpError(422, "Add the topic or the word of the day first.");
    const fallback = { headline: topic || service, tagline: null as string | null, palette: null as string[] | null, scene: "light", ai: false };
    if (!env.AI) return json({ ok: true, ...fallback });
    try {
      const out = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [
          { role: "system", content: "You write short, warm, Bible-faithful poster copy for a Pentecostal church in Sandton, South Africa. Reply with JSON only." },
          { role: "user", content: `Service: ${service}\nTopic: ${topic}\nWord of the day: ${scripture}\n\nGive:\n- headline: 2 to 6 punchy words for the poster (keep the topic's meaning; no quotes, no emojis)\n- tagline: one inviting line, max 12 words (no dates, times, places or names)\n- palette: 4 hex colours [dark, main, light, accent] that fit the mood, white text must read well on the first two\n- scene: one of ${Object.keys(SCENES).join(", ")}\n\nJSON: {"headline":"","tagline":"","palette":["#","#","#","#"],"scene":""}` },
        ],
        max_tokens: 220, temperature: 0.8, response_format: { type: "json_object" },
      }) as { response?: unknown };
      const r = out?.response;
      const o = (typeof r === "string" ? JSON.parse(r.slice(r.indexOf("{"), r.lastIndexOf("}") + 1)) : r) as Record<string, unknown>;
      const clean = (v: unknown, n: number) => typeof v === "string" ? v.replace(/["“”]/g, "").replace(/https?:\S+|www\.\S+/g, "").trim().slice(0, n) || null : null;
      const pal = Array.isArray(o.palette) ? o.palette.map(String).filter((c) => HEX.test(c)) : [];
      return json({ ok: true, headline: clean(o.headline, 48) || fallback.headline, tagline: clean(o.tagline, 90), palette: pal.length === 4 ? pal : null,
        scene: typeof o.scene === "string" && SCENES[o.scene] ? o.scene : "light", ai: true });
    } catch (e) { console.error("poster suggest failed", e); return json({ ok: true, ...fallback }); }
  });

  // AI-painted background for a scene (no text, no people). A few variants per scene, cached, so it stays fast and cheap.
  router.get("/api/poster/bg", async (req) => {
    await posterUser(env, req);
    const u = new URL(req.url), scene = u.searchParams.get("scene") || "", v = Math.max(0, Math.min(2, Number(u.searchParams.get("v")) || 0));
    if (!SCENES[scene]) throw new HttpError(404, "Unknown scene.");
    const key = `poster:bg:${scene}:${v}`;
    try { const hit = await env.FILES_KV?.get(key, "arrayBuffer"); if (hit) return new Response(hit, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=604800" } }); } catch { /* paint */ }
    if (!env.AI) throw new HttpError(404, "Not available.");
    await rateLimit(env, "poster-bg", clientIp(req), 12, 3600);
    const out = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
      prompt: `${SCENES[scene]}, variation ${v + 1}, cinematic, soft focus, calm empty space for text, high quality digital painting, portrait orientation, no text, no letters, no words, no logos, no people, no faces, no hands`, steps: 6, seed: 1000 + v * 77,
    }) as { image?: string };
    if (!out?.image) throw new HttpError(503, "The painter is busy. Try again in a moment.");
    const bin = Uint8Array.from(atob(out.image), (c) => c.charCodeAt(0));
    try { await env.FILES_KV?.put(key, bin.buffer as ArrayBuffer, { expirationTtl: 60 * 86400 }); } catch { /* cache only */ }
    return new Response(bin, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=604800" } });
  });
}
