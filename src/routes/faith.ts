/**
 * Daily Word (verse of the day + streaks) and the Prayer Wall (shared requests, "I prayed", answered prayers).
 * Reading is open to everyone; checking in, posting and praying need a Google sign-in.
 * Prayer Wall posts only appear after a leader approves them (safeguarding for young people).
 */
import type { Env } from "../env.ts";
import { HttpError, Router, clientIp, json, readJson } from "../lib/http.ts";
import { getSession, requireAdmin } from "../lib/auth.ts";
import { rateLimit } from "../lib/ratelimit.ts";
import { uuid } from "../lib/crypto.ts";
import { saDay, streakFrom, wordFor } from "../lib/word.ts";

const needUser = async (env: Env, req: Request) => {
  const s = await getSession(env, req);
  if (!s) throw new HttpError(401, "Please sign in with Google first.");
  return s;
};

async function wordState(env: Env, userId: string | null, today: string) {
  const readers = await env.DB.prepare("SELECT COUNT(*) AS n FROM word_checkins WHERE day = ?").bind(today).first<{ n: number }>();
  if (!userId) return { readers_today: readers?.n ?? 0, me: null };
  const { results } = await env.DB.prepare("SELECT day FROM word_checkins WHERE user_id = ? ORDER BY day DESC LIMIT 400").bind(userId).all<{ day: string }>();
  const s = streakFrom(results.map((r) => r.day), today);
  return { readers_today: readers?.n ?? 0, me: { done: results.some((r) => r.day === today), ...s } };
}

export function faithRoutes(router: Router, env: Env): void {
  // ---------- Daily Word ----------
  router.get("/api/word/today", async (req) => {
    const today = saDay();
    const s = await getSession(env, req);
    return json({ ok: true, word: wordFor(today), ...(await wordState(env, s?.user.id ?? null, today)) });
  });
  router.post("/api/word/today", async (req) => {
    const s = await needUser(env, req);
    const today = saDay();
    await env.DB.prepare("INSERT OR IGNORE INTO word_checkins (user_id, day) VALUES (?, ?)").bind(s.user.id, today).run();
    return json({ ok: true, ...(await wordState(env, s.user.id, today)) });
  });

  // ---------- Prayer Wall ----------
  router.get("/api/wall", async (req) => {
    const s = await getSession(env, req);
    const uid = s?.user.id ?? "";
    const { results } = await env.DB.prepare(
      `SELECT w.id, w.display_name, w.request, w.prayed_count, w.answered, w.answered_note, w.created_at, w.user_id = ? AS mine,
              EXISTS (SELECT 1 FROM prayer_wall_prayers p WHERE p.post_id = w.id AND p.user_id = ?) AS prayed
         FROM prayer_wall w WHERE w.status = 'approved' ORDER BY w.answered, w.created_at DESC LIMIT 60`).bind(uid, uid).all();
    const mine = s ? (await env.DB.prepare("SELECT id, request, status, prayed_count, answered, created_at FROM prayer_wall WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").bind(uid).all()).results : [];
    const total = await env.DB.prepare("SELECT COALESCE(SUM(prayed_count), 0) AS n FROM prayer_wall WHERE status = 'approved'").first<{ n: number }>();
    return json({ ok: true, posts: results, mine, prayers_total: total?.n ?? 0, signed_in: !!s });
  });
  router.post("/api/wall", async (req) => {
    const s = await needUser(env, req);
    await rateLimit(env, "wall", clientIp(req), 5, 86400);
    const b = await readJson<{ request?: string; show_name?: boolean }>(req);
    const text = String(b.request || "").trim();
    if (text.length < 10) throw new HttpError(422, "Please share a little more so people know how to pray.", { request: "At least 10 characters." });
    if (text.length > 600) throw new HttpError(422, "Please keep it under 600 characters.", { request: "Too long." });
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM prayer_wall WHERE user_id = ? AND created_at > ?").bind(s.user.id, new Date(Date.now() - 86400_000).toISOString()).first<{ n: number }>();
    if ((recent?.n ?? 0) >= 3) throw new HttpError(429, "You've shared a few requests today. Please give the team time to pray over them.");
    const id = uuid();
    await env.DB.prepare("INSERT INTO prayer_wall (id, user_id, display_name, request) VALUES (?,?,?,?)")
      .bind(id, s.user.id, b.show_name === false ? null : (s.user.given_name || s.user.name || "").split(" ")[0] || null, text).run();
    return json({ ok: true, id, message: "Thank you! A leader will look at it shortly, and then the church family can start praying." }, 201);
  });
  router.post("/api/wall/:id/pray", async (req, { id }) => {
    const s = await needUser(env, req);
    const post = await env.DB.prepare("SELECT id FROM prayer_wall WHERE id = ? AND status = 'approved'").bind(id).first();
    if (!post) throw new HttpError(404, "This request is no longer on the wall.");
    const r = await env.DB.prepare("INSERT OR IGNORE INTO prayer_wall_prayers (post_id, user_id) VALUES (?, ?)").bind(id, s.user.id).run();
    if (r.meta.changes) await env.DB.prepare("UPDATE prayer_wall SET prayed_count = prayed_count + 1 WHERE id = ?").bind(id).run();
    const c = await env.DB.prepare("SELECT prayed_count FROM prayer_wall WHERE id = ?").bind(id).first<{ prayed_count: number }>();
    return json({ ok: true, prayed_count: c?.prayed_count ?? 0 });
  });
  router.post("/api/wall/:id/answered", async (req, { id }) => {
    const s = await needUser(env, req);
    const { note } = await readJson<{ note?: string }>(req);
    const r = await env.DB.prepare("UPDATE prayer_wall SET answered = 1, answered_note = ?, answered_at = ? WHERE id = ? AND user_id = ?")
      .bind(String(note || "").trim().slice(0, 400) || null, new Date().toISOString(), id, s.user.id).run();
    if (!r.meta.changes) throw new HttpError(404, "Only the person who shared this can mark it answered.");
    return json({ ok: true });
  });
  router.delete("/api/wall/:id", async (req, { id }) => {
    const s = await needUser(env, req);
    const r = await env.DB.prepare("UPDATE prayer_wall SET status = 'hidden' WHERE id = ? AND user_id = ?").bind(id, s.user.id).run();
    if (!r.meta.changes) throw new HttpError(404, "Not found.");
    return json({ ok: true });
  });

  // ---------- admin moderation ----------
  router.get("/api/admin/wall", async (req) => {
    await requireAdmin(env, req);
    const { results } = await env.DB.prepare(
      `SELECT w.*, u.email, u.name FROM prayer_wall w LEFT JOIN users u ON u.id = w.user_id
        ORDER BY CASE w.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, w.created_at DESC LIMIT 200`).all();
    return json({ ok: true, posts: results });
  });
  router.patch("/api/admin/wall/:id", async (req, { id }) => {
    await requireAdmin(env, req);
    if (req.headers.get("x-scc-admin") !== "1") throw new HttpError(403, "Missing admin header.");
    const { status } = await readJson<{ status?: string }>(req);
    if (!["approved", "hidden", "pending"].includes(String(status))) throw new HttpError(422, "Invalid status.");
    const r = await env.DB.prepare("UPDATE prayer_wall SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN COALESCE(approved_at, ?) ELSE approved_at END WHERE id = ?")
      .bind(status, status, new Date().toISOString(), id).run();
    if (!r.meta.changes) throw new HttpError(404, "Not found.");
    return json({ ok: true });
  });
}
