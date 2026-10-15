/**
 * FreeCreator Online: the desktop presentation app running in the browser for signed-in people.
 * The app itself is static (public/freecreator/app, built from the desktop source by tools/freecreator/sync.py).
 * These endpoints give it scripture (bible-api.com, public-domain translations, cached) and the church's
 * open-source AI (Workers AI) for tidying lyrics, suggesting scriptures and turning sermon notes into slides.
 */
import type { Env } from "../env.ts";
import { HttpError, Router, json, readJson, trustedWrite } from "../lib/http.ts";
import { getSession } from "../lib/auth.ts";
import { rateLimit } from "../lib/ratelimit.ts";
import { SCENES } from "./poster.ts";

const TRANSLATIONS = ["kjv", "web", "asv", "bbe", "ylt"];
const PROMPTS: Record<string, [string, number]> = {
  tidy: ["You format worship song lyrics for church projection. Return ONLY the lyrics with section headers in square brackets like [Verse 1], [Chorus], [Bridge]. Remove chords, repeat markers like 'x2' (write the lines out instead), copyright notes and extra blank lines. Keep each stanza to at most 4–6 short lines. Do not invent or change words.", 1800],
  scriptures: ["You help a church media team. Suggest 6 well-known Bible passages for the topic. Reply ONLY with JSON: [{\"ref\":\"Book chapter:verse-verse\",\"why\":\"under 12 words\"}]. Use standard English book names.", 600],
  sermon: ["Turn sermon notes into projection slides. Each slide is short (max 20 words): a title slide, then main points and key quotes. When the notes cite a Bible verse, add a slide with kind \"scripture\" and the reference. Reply ONLY with JSON: [{\"kind\":\"text\"|\"scripture\",\"text\":\"...\",\"ref\":\"John 3:16\"}].", 2500],
  test: ["Reply with exactly: ready", 10],
  lowerthirds: ["You write lower-third captions for a church livestream in Sandton, South Africa. From the service description, write 5 short lower thirds: the speaker (name + role), the message title, a welcome line, how to connect or give (generic, no made-up links or numbers), and a closing blessing. Reply ONLY with JSON: [{\"name\":\"max 40 chars\",\"title\":\"max 70 chars\"}].", 500],
  streamtext: ["You write YouTube/Facebook livestream titles and descriptions for a warm Pentecostal church (AOG Sandton City Church, 17 Humber Street, Woodmead, Sandton). Reply ONLY with JSON: {\"title\":\"max 90 chars\",\"description\":\"3 short paragraphs, inviting, no hashtags spam, no made-up links\"}.", 600],
};

const signedIn = async (env: Env, req: Request) => {
  const s = await getSession(env, req);
  if (!s) throw new HttpError(401, "Please sign in to use FreeCreator Online.");
  return s;
};

export function freecreatorRoutes(router: Router, env: Env): void {
  router.get("/api/freecreator/bible", async (req) => {
    const s = await signedIn(env, req);
    await rateLimit(env, "fc-bible", s.user.id, 300, 3600);
    const u = new URL(req.url), ref = (u.searchParams.get("ref") || "").trim().slice(0, 80), tr = (u.searchParams.get("tr") || "kjv").toLowerCase();
    if (!ref || !/^[1-3]?\s?[A-Za-z ]+\s\d/.test(ref)) throw new HttpError(422, "Try a reference like John 3:16 or Psalm 23.");
    if (!TRANSLATIONS.includes(tr)) throw new HttpError(422, "Unknown translation.");
    const src = `https://bible-api.com/${encodeURIComponent(ref)}?translation=${tr}`;
    const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default, key = new Request(`https://cache.internal/bible/${tr}/${encodeURIComponent(ref.toLowerCase())}`);
    let data = await cache?.match(key).then((r) => r?.json()).catch(() => null) as { reference?: string; translation_id?: string; verses?: { chapter: number; verse: number; text: string }[] } | null;
    if (!data) {
      const res = await fetch(src, { headers: { "user-agent": "aogsccyouth.com FreeCreator Online" } }).catch(() => null);
      if (!res) throw new HttpError(503, "Couldn't reach the Bible service. Try again in a moment.");
      if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 503, res.status === 404 ? `Couldn't find ${ref}.` : "The Bible service is busy. Try again in a moment.");
      data = await res.json();
      await cache?.put(key, new Response(JSON.stringify(data), { headers: { "cache-control": "max-age=2592000", "content-type": "application/json" } })).catch(() => {});
    }
    const verses = (data?.verses || []).map((v) => ({ chapter: v.chapter, verse: v.verse, text: String(v.text || "").replace(/\s+/g, " ").trim() }));
    if (!verses.length) throw new HttpError(404, `Couldn't find ${ref}.`);
    return json({ ok: true, reference: data?.reference || ref, translation: (data?.translation_id || tr).toUpperCase(), verses });
  });

  // Upload speed check for streaming: the browser sends ~2 MB and times it.
  router.post("/api/freecreator/speedtest", async (req) => {
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    const s = await signedIn(env, req);
    await rateLimit(env, "fc-speed", s.user.id, 20, 3600);
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 4 * 1024 * 1024) throw new HttpError(413, "Too big.");
    return json({ ok: true, bytes: buf.byteLength });
  });

  // AI-painted background for the Studio's slides (no text, no people), picked to suit the service. Cached per scene.
  router.get("/api/freecreator/paint", async (req) => {
    const s = await signedIn(env, req);
    const u = new URL(req.url), topic = (u.searchParams.get("topic") || "").toLowerCase().slice(0, 200), v = Math.max(0, Math.min(2, Number(u.searchParams.get("v")) || 0));
    const words: Record<string, string> = { star: "stars", night: "stars", sea: "ocean", water: "ocean", baptism: "ocean", mountain: "mountains", faith: "mountains", garden: "garden", growth: "garden", light: "light", hope: "sunrise", new: "sunrise", morning: "sunrise", fire: "fire", spirit: "fire", revival: "fire", city: "city", youth: "city", worship: "worship", praise: "worship", music: "worship" };
    const scene = Object.entries(words).find(([w]) => topic.includes(w))?.[1] || "abstract";
    const key = `fc:bg:${scene}:${v}`;
    try { const hit = await env.FILES_KV?.get(key, "arrayBuffer"); if (hit) return new Response(hit, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } }); } catch { /* paint */ }
    if (!env.AI) throw new HttpError(404, "Not available.");
    await rateLimit(env, "fc-paint", s.user.id, 10, 3600);
    const out = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: `${SCENES[scene]}, wide 16:9 cinematic background, soft and calm with lots of empty space for words, high quality, no text, no letters, no words, no logos, no people, no faces, no hands`, steps: 6, seed: 4000 + v * 91 }) as { image?: string };
    if (!out?.image) throw new HttpError(503, "The painter is busy. Try again in a moment.");
    const bin = Uint8Array.from(atob(out.image), (c) => c.charCodeAt(0));
    try { await env.FILES_KV?.put(key, bin.buffer as ArrayBuffer, { expirationTtl: 60 * 86400 }); } catch { /* cache only */ }
    return new Response(bin, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  });

  router.post("/api/freecreator/ai", async (req) => {
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    const s = await signedIn(env, req);
    await rateLimit(env, "fc-ai", s.user.id, 40, 3600);
    const b = await readJson<{ task?: string; text?: string }>(req);
    const p = PROMPTS[String(b.task)];
    if (!p) throw new HttpError(422, "Unknown task.");
    if (!env.AI) return json({ ok: false, text: null });
    try {
      const out = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [{ role: "system", content: p[0] }, { role: "user", content: String(b.text || "").slice(0, 15000) }], max_tokens: p[1], temperature: 0.3,
      }) as { response?: unknown };
      const r = out?.response;
      return json({ ok: true, text: typeof r === "string" ? r : JSON.stringify(r ?? "") });
    } catch (e) { console.error("freecreator ai failed", e); return json({ ok: false, text: null }); }
  });
}
