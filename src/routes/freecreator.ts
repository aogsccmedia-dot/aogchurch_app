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

const TRANSLATIONS = ["kjv", "web", "asv", "bbe", "ylt"];
const PROMPTS: Record<string, [string, number]> = {
  tidy: ["You format worship song lyrics for church projection. Return ONLY the lyrics with section headers in square brackets like [Verse 1], [Chorus], [Bridge]. Remove chords, repeat markers like 'x2' (write the lines out instead), copyright notes and extra blank lines. Keep each stanza to at most 4–6 short lines. Do not invent or change words.", 1800],
  scriptures: ["You help a church media team. Suggest 6 well-known Bible passages for the topic. Reply ONLY with JSON: [{\"ref\":\"Book chapter:verse-verse\",\"why\":\"under 12 words\"}]. Use standard English book names.", 600],
  sermon: ["Turn sermon notes into projection slides. Each slide is short (max 20 words): a title slide, then main points and key quotes. When the notes cite a Bible verse, add a slide with kind \"scripture\" and the reference. Reply ONLY with JSON: [{\"kind\":\"text\"|\"scripture\",\"text\":\"...\",\"ref\":\"John 3:16\"}].", 2500],
  test: ["Reply with exactly: ready", 10],
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
