/**
 * FreeCreator Online: the desktop presentation app running in the browser for signed-in people.
 * The app itself is static (public/freecreator/app, built from the desktop source by tools/freecreator/sync.py).
 * These endpoints give it scripture (bible-api.com, public-domain translations, cached) and the church's
 * open-source AI (Workers AI) for tidying lyrics, suggesting scriptures and turning sermon notes into slides.
 */
import type { Env } from "../env.ts";
import { HttpError, Router, json, readJson, trustedWrite } from "../lib/http.ts";
import { getSession, isAdminEmail } from "../lib/auth.ts";
import { rateLimit } from "../lib/ratelimit.ts";
import { SCENES } from "./poster.ts";
import { churchFor, churchOfEmail, type FcChurch } from "../lib/fc-church.ts";
import { uuid } from "../lib/crypto.ts";

import { TRANSLATIONS, passage } from "../lib/bible.ts";
const PROMPTS: Record<string, [string, number]> = {
  tidy: ["You format worship song lyrics for church projection. Return ONLY the lyrics with section headers in square brackets like [Verse 1], [Chorus], [Bridge]. Remove chords, repeat markers like 'x2' (write the lines out instead), copyright notes and extra blank lines. Keep each stanza to at most 4–6 short lines. Do not invent or change words.", 1800],
  scriptures: ["You help a church media team. Suggest 6 well-known Bible passages for the topic. Reply ONLY with JSON: [{\"ref\":\"Book chapter:verse-verse\",\"why\":\"under 12 words\"}]. Use standard English book names.", 600],
  sermon: ["Turn sermon notes into projection slides. Each slide is short (max 20 words): a title slide, then main points and key quotes. When the notes cite a Bible verse, add a slide with kind \"scripture\" and the reference. Reply ONLY with JSON: [{\"kind\":\"text\"|\"scripture\",\"text\":\"...\",\"ref\":\"John 3:16\"}].", 2500],
  test: ["Reply with exactly: ready", 10],
  lowerthirds: ["You write lower-third captions for the livestream of {church}. From the service description, write 5 short lower thirds: the speaker (name + role), the message title, a welcome line, how to connect or give (generic, no made-up links or numbers), and a closing blessing. Reply ONLY with JSON: [{\"name\":\"max 40 chars\",\"title\":\"max 70 chars\"}].", 500],
  streamtext: ["You write YouTube/Facebook livestream titles and descriptions for {church}. Reply ONLY with JSON: {\"title\":\"max 90 chars\",\"description\":\"3 short paragraphs, inviting, no hashtags spam, no made-up links\"}.", 600],
};

const signedIn = async (env: Env, req: Request) => {
  const s = await getSession(env, req);
  if (!s) throw new HttpError(401, "Please sign in to use FreeCreator Online.");
  return s;
};

/** FreeCreator on a phone (as an extra camera) is limited to the main admin and the accounts listed in settings. */
export async function mobileAllowed(env: Env, email: string): Promise<boolean> {
  if (isAdminEmail(env, email)) return true;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'freecreator_mobile'").first<{ value: string }>().catch(() => null);
  try { return (JSON.parse(row?.value || "[]") as string[]).map((e) => e.toLowerCase()).includes(email.toLowerCase()); } catch { return false; }
}

export function freecreatorRoutes(router: Router, env: Env): void {
  /** Signed in AND a member of an active church workspace. Everything after this is scoped to that church. */
  const member = async (req: Request) => {
    const s = await signedIn(env, req);
    const church = await churchFor(env, s);
    if (!church) throw new HttpError(403, "FreeCreator Online is for members of a registered church. Sandton City Church members: your membership needs to be approved first.");
    return { s, church };
  };
  const leader = (c: FcChurch) => { if (c.role === "member") throw new HttpError(403, "Only your church's FreeCreator admins can do that."); };
  router.get("/api/freecreator/access", async (req) => {
    const s = await signedIn(env, req);
    const church = await churchFor(env, s);
    const pending = church ? null : await env.DB.prepare("SELECT name, status FROM fc_churches WHERE owner_user_id = ? AND status != 'active' ORDER BY created_at DESC LIMIT 1").bind(s.user.id).first();
    return json({ ok: true, church, pending, super: isAdminEmail(env, s.user.email), mobile: church ? await mobileAllowed(env, s.user.email) : false }, 200, { "Cache-Control": "no-store" });
  });

  // ---- Phones as cameras: the Studio opens a room with a 6-digit code; a phone joins with that code.
  // Signalling only (offer/answer); the video goes straight from the phone to the Studio over WebRTC.
  const write = (req: Request) => { if (!trustedWrite(req)) throw new HttpError(403, "Missing request header."); };
  router.post("/api/freecreator/cam/room", async (req) => {
    write(req); const { s, church } = await member(req);
    await rateLimit(env, "fc-room", s.user.id, 30, 3600);
    const now = new Date();
    await env.DB.prepare("DELETE FROM cam_rooms WHERE expires_at < ?").bind(now.toISOString()).run();
    await env.DB.prepare("DELETE FROM cam_links WHERE code NOT IN (SELECT code FROM cam_rooms)").run();
    let code = "";
    for (let i = 0; i < 5; i++) {
      code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      const r = await env.DB.prepare("INSERT OR IGNORE INTO cam_rooms (code, owner_id, church_id, expires_at) VALUES (?,?,?,?)").bind(code, s.user.id, church.id, new Date(now.getTime() + 8 * 3600_000).toISOString()).run();
      if (r.meta.changes) break;
    }
    return json({ ok: true, code });
  });
  router.post("/api/freecreator/cam/offer", async (req) => {
    write(req); const { s, church } = await member(req);
    if (!(await mobileAllowed(env, s.user.email))) throw new HttpError(403, "Phone cameras are only switched on for a few accounts. Ask the main admin.");
    await rateLimit(env, "fc-offer", s.user.id, 60, 3600);
    const b = await readJson<{ code?: string; sdp?: string; label?: string }>(req);
    const code = String(b.code || "").replace(/\D/g, ""), sdp = String(b.sdp || "");
    if (!sdp.startsWith("v=0") || sdp.length > 20000) throw new HttpError(422, "That didn't look like a camera connection.");
    const room = await env.DB.prepare("SELECT code FROM cam_rooms WHERE code = ? AND church_id = ? AND expires_at > ?").bind(code, church.id, new Date().toISOString()).first();
    if (!room) throw new HttpError(404, "That code isn't open. Check the code in the Studio (Inputs → Phone cameras).");
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO cam_links (id, code, user_id, label, offer) VALUES (?,?,?,?,?)").bind(id, code, s.user.id, String(b.label || "Phone").slice(0, 40), sdp).run();
    return json({ ok: true, id });
  });
  router.get("/api/freecreator/cam/answer", async (req) => {
    const { s } = await member(req), u = new URL(req.url);
    const row = await env.DB.prepare("SELECT answer FROM cam_links WHERE id = ? AND user_id = ?").bind(u.searchParams.get("id") || "", s.user.id).first<{ answer: string | null }>();
    if (!row) throw new HttpError(404, "Not found.");
    return json({ ok: true, sdp: row.answer }, 200, { "Cache-Control": "no-store" });
  });
  router.get("/api/freecreator/cam/pending", async (req) => {
    const { s } = await member(req), code = new URL(req.url).searchParams.get("code") || "";
    const room = await env.DB.prepare("SELECT 1 FROM cam_rooms WHERE code = ? AND owner_id = ?").bind(code, s.user.id).first();
    if (!room) throw new HttpError(404, "Not found.");
    const { results } = await env.DB.prepare("SELECT id, label, offer FROM cam_links WHERE code = ? AND answer IS NULL ORDER BY created_at LIMIT 5").bind(code).all();
    return json({ ok: true, links: results }, 200, { "Cache-Control": "no-store" });
  });
  router.post("/api/freecreator/cam/answer", async (req) => {
    write(req); const { s } = await member(req);
    const b = await readJson<{ code?: string; id?: string; sdp?: string }>(req);
    const sdp = String(b.sdp || "");
    if (!sdp.startsWith("v=0") || sdp.length > 20000) throw new HttpError(422, "Bad answer.");
    const r = await env.DB.prepare("UPDATE cam_links SET answer = ? WHERE id = ? AND code = ? AND EXISTS (SELECT 1 FROM cam_rooms WHERE code = ? AND owner_id = ?)")
      .bind(sdp, b.id || "", b.code || "", b.code || "", s.user.id).run();
    if (!r.meta.changes) throw new HttpError(404, "Not found.");
    return json({ ok: true });
  });

  router.get("/api/freecreator/bible", async (req) => {
    const { s } = await member(req);
    await rateLimit(env, "fc-bible", s.user.id, 400, 3600);
    const u = new URL(req.url), ref = (u.searchParams.get("ref") || "").trim().slice(0, 80), tr = (u.searchParams.get("tr") || "kjv").toLowerCase();
    if (!TRANSLATIONS.includes(tr)) throw new HttpError(422, "Unknown translation.");
    if (!ref) throw new HttpError(422, "Try a reference like John 3:16 or Psalm 23.");
    return json({ ok: true, ...(await passage(env, ref, tr)) }, 200, { "Cache-Control": "private, max-age=3600" });
  });

  // Upload speed check for streaming: the browser sends ~2 MB and times it.
  router.post("/api/freecreator/speedtest", async (req) => {
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    const { s } = await member(req);
    await rateLimit(env, "fc-speed", s.user.id, 20, 3600);
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 4 * 1024 * 1024) throw new HttpError(413, "Too big.");
    return json({ ok: true, bytes: buf.byteLength });
  });

  // AI-painted background for the Studio's slides (no text, no people), picked to suit the service. Cached per scene.
  router.get("/api/freecreator/paint", async (req) => {
    const { s } = await member(req);
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
    const { s, church } = await member(req);
    await rateLimit(env, "fc-ai", s.user.id, 40, 3600);
    const b = await readJson<{ task?: string; text?: string }>(req);
    const p = PROMPTS[String(b.task)];
    if (!p) throw new HttpError(422, "Unknown task.");
    if (!env.AI) return json({ ok: false, text: null });
    try {
      const out = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [{ role: "system", content: p[0].replace("{church}", church.name) }, { role: "user", content: String(b.text || "").slice(0, 15000) }], max_tokens: p[1], temperature: 0.3,
      }) as { response?: unknown };
      const r = out?.response;
      return json({ ok: true, text: typeof r === "string" ? r : JSON.stringify(r ?? "") });
    } catch (e) { console.error("freecreator ai failed", e); return json({ ok: false, text: null }); }
  });

  // ---- Shared church library (songs and shows), so the whole team works on the same service. Church-scoped.
  const COLLS = ["songs", "shows"];
  router.get("/api/freecreator/lib", async (req) => {
    const { s, church } = await member(req);
    const since = Number(new URL(req.url).searchParams.get("since")) || 0, now = Date.now();
    await env.DB.prepare("INSERT INTO fc_presence (church_id, user_id, name, seen_at) VALUES (?,?,?,?) ON CONFLICT(church_id, user_id) DO UPDATE SET seen_at = excluded.seen_at, name = excluded.name")
      .bind(church.id, s.user.id, s.user.given_name || s.user.name || "Someone", now).run();
    const { results } = await env.DB.prepare("SELECT coll, id, data, deleted, updated_at FROM fc_library WHERE church_id = ? AND updated_at > ? ORDER BY updated_at LIMIT 2000")
      .bind(church.id, since).all<{ coll: string; id: string; data: string | null; deleted: number; updated_at: number }>();
    const { results: here } = await env.DB.prepare("SELECT name FROM fc_presence WHERE church_id = ? AND user_id != ? AND seen_at > ?").bind(church.id, s.user.id, now - 45_000).all<{ name: string }>();
    return json({ ok: true, now, church: { id: church.id, name: church.name, role: church.role }, here: here.map((h) => h.name),
      items: results.map((r) => ({ coll: r.coll, id: r.id, deleted: !!r.deleted, at: r.updated_at, item: r.deleted || !r.data ? null : JSON.parse(r.data) })) }, 200, { "Cache-Control": "no-store" });
  });
  router.post("/api/freecreator/lib", async (req) => {
    write(req); const { s, church } = await member(req);
    await rateLimit(env, "fc-lib", s.user.id, 600, 3600);
    const b = await readJson<{ coll?: string; id?: string; item?: unknown; deleted?: boolean }>(req);
    const coll = String(b.coll), id = String(b.id || "").slice(0, 64);
    if (!COLLS.includes(coll) || !/^[\w-]{1,64}$/.test(id)) throw new HttpError(422, "Bad item.");
    const data = b.deleted ? null : JSON.stringify(b.item ?? null);
    if (data && data.length > 400_000) throw new HttpError(413, "That item is too big.");
    const at = Date.now();
    await env.DB.prepare(`INSERT INTO fc_library (church_id, coll, id, data, deleted, updated_at, updated_by) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(church_id, coll, id) DO UPDATE SET data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(church.id, coll, id, data, b.deleted ? 1 : 0, at, s.user.id).run();
    return json({ ok: true, at });
  });

  // ---- Churches: other churches register (approved by the main admin) and add their own members by hand.
  router.post("/api/freecreator/church/register", async (req) => {
    write(req); const s = await signedIn(env, req);
    await rateLimit(env, "fc-church", s.user.id, 3, 86400);
    if (await churchFor(env, s) || await churchOfEmail(env, s.user.email)) throw new HttpError(409, "You're already part of a church workspace. A person can be in one church at a time.");
    const b = await readJson<{ name?: string; city?: string; contact?: string; note?: string }>(req);
    const name = String(b.name || "").trim().slice(0, 120), city = String(b.city || "").trim().slice(0, 80);
    if (name.length < 3) throw new HttpError(422, "Please add the church's name.");
    const id = uuid();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO fc_churches (id, name, city, contact_email, note, owner_user_id, status) VALUES (?,?,?,?,?,?, 'pending')").bind(id, name, city || null, String(b.contact || s.user.email).slice(0, 200), String(b.note || "").slice(0, 600) || null, s.user.id),
      env.DB.prepare("INSERT OR IGNORE INTO fc_members (church_id, email, role, added_by) VALUES (?,?, 'owner', ?)").bind(id, s.user.email.toLowerCase(), s.user.id),
    ]);
    return json({ ok: true, id, status: "pending" }, 201);
  });
  router.get("/api/freecreator/church/members", async (req) => {
    const { church } = await member(req); leader(church);
    const { results } = await env.DB.prepare("SELECT email, role, created_at FROM fc_members WHERE church_id = ? ORDER BY role, email").bind(church.id).all();
    return json({ ok: true, church, members: results, automatic: church.id === "scc" });
  });
  router.post("/api/freecreator/church/members", async (req) => {
    write(req); const { s, church } = await member(req); leader(church);
    const b = await readJson<{ email?: string; role?: string; remove?: boolean }>(req);
    const email = String(b.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(422, "Enter a valid email address.");
    if (b.remove) {
      if (email === s.user.email.toLowerCase()) throw new HttpError(422, "You can't remove yourself.");
      await env.DB.prepare("DELETE FROM fc_members WHERE church_id = ? AND email = ? AND role != 'owner'").bind(church.id, email).run();
      return json({ ok: true });
    }
    const elsewhere = await churchOfEmail(env, email);
    if (elsewhere && elsewhere !== church.id) throw new HttpError(409, "That person is already in another church's workspace. A person can be in one church at a time.");
    const role = b.role === "admin" && church.role === "owner" ? "admin" : b.role === "media" && church.id === "scc" && ["owner", "admin", "media"].includes(church.role) ? "media" : "member";
    await env.DB.prepare("INSERT INTO fc_members (church_id, email, role, added_by) VALUES (?,?,?,?) ON CONFLICT(church_id, email) DO UPDATE SET role = CASE WHEN fc_members.role = 'owner' THEN 'owner' ELSE excluded.role END")
      .bind(church.id, email, role, s.user.id).run();
    return json({ ok: true });
  });
  // Main admin: approve or decline church registrations.
  router.get("/api/freecreator/churches", async (req) => {
    const s = await signedIn(env, req); if (!isAdminEmail(env, s.user.email)) throw new HttpError(403, "Main admin only.");
    const { results } = await env.DB.prepare("SELECT c.id, c.name, c.city, c.contact_email, c.note, c.status, c.created_at, (SELECT COUNT(*) FROM fc_members m WHERE m.church_id = c.id) AS members FROM fc_churches c ORDER BY c.status = 'pending' DESC, c.created_at DESC LIMIT 200").all();
    return json({ ok: true, churches: results });
  });
  router.post("/api/freecreator/churches/:id", async (req, { id }) => {
    write(req); const s = await signedIn(env, req); if (!isAdminEmail(env, s.user.email)) throw new HttpError(403, "Main admin only.");
    if (id === "scc") throw new HttpError(422, "Sandton City Church is always active.");
    const { status } = await readJson<{ status?: string }>(req);
    if (!["active", "declined", "pending"].includes(String(status))) throw new HttpError(422, "Bad status.");
    await env.DB.prepare("UPDATE fc_churches SET status = ? WHERE id = ?").bind(status, id).run();
    return json({ ok: true });
  });
}
