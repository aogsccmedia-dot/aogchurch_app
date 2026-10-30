// Messages: anyone signed in can message a church leader (anyone with a role, plus the church office / main admin).
// Leaders reply in the same thread. Members can't message each other. New messages are emailed (at most once per
// thread every few minutes, so a quick back-and-forth doesn't flood anyone's inbox).
import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { HttpError, Router, json, readJson, trustedWrite } from "../lib/http.ts";
import { getSession } from "../lib/auth.ts";
import { rateLimit } from "../lib/ratelimit.ts";
import { uuid } from "../lib/crypto.ts";
import { sendMail } from "../lib/email.ts";
import * as T from "../emails/templates.ts";
import { isAdminEmail } from "../lib/auth.ts";

type Leader = { id: string; name: string; picture: string | null; role: string; email: string };
const MAIL_GAP_MS = 4 * 60_000;

async function me(env: Env, req: Request) {
  const s = await getSession(env, req);
  if (!s) throw new HttpError(401, "Please sign in.");
  return s;
}

/** Everyone people can message: the team (with their ministry title) and the church office. */
export async function leaders(env: Env): Promise<Leader[]> {
  const [{ results }, office] = await Promise.all([env.DB.prepare(
    `SELECT u.id, COALESCE(m.preferred_name || ' ' || m.last_name, m.first_name || ' ' || m.last_name, u.name, u.email) AS name, u.picture, u.email,
            COALESCE(p.title, r.title, CASE WHEN p.user_id IS NOT NULL THEN 'Pastor' WHEN r.role = 'youth_leader' THEN 'Youth leader' ELSE 'Church leader' END) AS role
       FROM users u LEFT JOIN admin_roles r ON r.user_id = u.id LEFT JOIN pastors p ON p.user_id = u.id LEFT JOIN members m ON m.user_id = u.id
      WHERE r.user_id IS NOT NULL OR p.user_id IS NOT NULL GROUP BY u.id ORDER BY name`).all<Leader>(),
    env.DB.prepare("SELECT id, email, picture FROM users WHERE lower(email) = ?").bind(adminEmail(env)).first<{ id: string; email: string; picture: string | null }>(),
  ]);
  const out = results.map((l) => ({ ...l, name: String(l.name || l.email).trim() }));
  if (office && !out.some((l) => l.id === office.id)) out.unshift({ id: office.id, name: "Church office", picture: office.picture, role: "Main admin · AOG Sandton City Church", email: office.email });
  return out;
}
/** The verified sticker next to a name: black for the main admin, purple star for verified pastors, blue for admins, gold for leaders and verified members. */
type Badge = "super" | "pastor" | "admin" | "member" | null;
async function badge(env: Env, id: string, email?: string | null): Promise<Badge> {
  if (email && isAdminEmail(env, email)) return "super";
  const r = await env.DB.prepare(`SELECT (SELECT role FROM admin_roles WHERE user_id = ?1) AS role, EXISTS (SELECT 1 FROM pastors WHERE user_id = ?1) AS pastor,
      EXISTS (SELECT 1 FROM members m JOIN users u ON u.id = ?1 WHERE (m.user_id = ?1 OR lower(m.email) = lower(u.email)) AND m.status = 'member') AS member`).bind(id).first<{ role: string | null; pastor: number; member: number }>();
  if (!email) { const u = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(id).first<{ email: string }>(); if (u && isAdminEmail(env, u.email)) return "super"; }
  return r?.pastor ? "pastor" : r?.role === "admin" ? "admin" : r?.role || r?.member ? "member" : null;
}
const isLeader = async (env: Env, id: string) => (await leaders(env)).find((l) => l.id === id) || null;

async function thread(env: Env, id: string, uid: string) {
  const t = await env.DB.prepare("SELECT * FROM chat_threads WHERE id = ?").bind(id).first<Record<string, string | number | null>>();
  if (!t || (t.starter_id !== uid && t.leader_id !== uid)) throw new HttpError(404, "Conversation not found.");
  return t;
}
async function person(env: Env, id: string) {
  return env.DB.prepare(`SELECT u.id, COALESCE(m.preferred_name, m.first_name, u.given_name, u.name, u.email) AS first,
      COALESCE(m.preferred_name || ' ' || m.last_name, m.first_name || ' ' || m.last_name, u.name, u.email) AS name, u.picture, u.email
      FROM users u LEFT JOIN members m ON m.user_id = u.id WHERE u.id = ?`).bind(id).first<{ id: string; first: string; name: string; picture: string | null; email: string }>();
}

type Who = { name: string; picture: string | null; email: string; badge: Badge };
/** Names, photos and verified badges for many people in one query per 90 people (instead of two or three each). */
async function people(env: Env, ids: string[]): Promise<Map<string, Who>> {
  const out = new Map<string, Who>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 90) {
    const part = uniq.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT u.id, u.email, u.picture,
        COALESCE((SELECT COALESCE(m.preferred_name || ' ' || m.last_name, m.first_name || ' ' || m.last_name) FROM members m WHERE m.user_id = u.id LIMIT 1), u.name, u.email) AS name,
        (SELECT role FROM admin_roles r WHERE r.user_id = u.id) AS role, EXISTS (SELECT 1 FROM pastors p WHERE p.user_id = u.id) AS pastor,
        EXISTS (SELECT 1 FROM members mm WHERE (mm.user_id = u.id OR lower(mm.email) = lower(u.email)) AND mm.status = 'member') AS member
      FROM users u WHERE u.id IN (${part.map(() => "?").join(",")})`).bind(...part).all<{ id: string; email: string; picture: string | null; name: string; role: string | null; pastor: number; member: number }>();
    for (const r of results) out.set(r.id, { name: r.name, picture: r.picture, email: r.email,
      badge: isAdminEmail(env, r.email) ? "super" : r.pastor ? "pastor" : r.role === "admin" ? "admin" : r.role || r.member ? "member" : null });
  }
  return out;
}

export function chatRoutes(router: Router, env: Env): void {
  router.get("/api/chat/leaders", async (req) => {
    const s = await me(env, req);
    const q = (new URL(req.url).searchParams.get("q") || "").trim().toLowerCase();
    const list = (await leaders(env)).filter((l) => l.id !== s.user.id && (!q || `${l.name} ${l.role}`.toLowerCase().includes(q)));
    const who = await people(env, list.map((l) => l.id));
    const out = list.map(({ email: _e, ...l }) => ({ ...l, badge: who.get(l.id)?.badge ?? null }));
    return json({ ok: true, leaders: out });
  });
  // Just the unread count (the home screen's badge): one small query instead of the whole conversation list.
  router.get("/api/chat/unread", async (req) => {
    const s = await me(env, req);
    const r = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN starter_id = ?1 THEN starter_unread ELSE leader_unread END), 0) AS n
      FROM chat_threads WHERE starter_id = ?1 OR leader_id = ?1`).bind(s.user.id).first<{ n: number }>();
    return json({ ok: true, unread: Number(r?.n) || 0 }, 200, { "Cache-Control": "no-store" });
  });

  router.get("/api/chat", async (req) => {
    const s = await me(env, req);
    const { results } = await env.DB.prepare("SELECT * FROM chat_threads WHERE starter_id = ? OR leader_id = ? ORDER BY last_at DESC LIMIT 100").bind(s.user.id, s.user.id).all<Record<string, string | number | null>>();
    const ls = await leaders(env);
    const others = results.map((t) => String(t.starter_id === s.user.id ? t.leader_id : t.starter_id));
    const who = await people(env, others);
    const threads = results.map((t) => {
      const mine = t.starter_id === s.user.id, other = String(mine ? t.leader_id : t.starter_id);
      const lead = ls.find((l) => l.id === other), p = who.get(other);
      return { id: t.id, with: { id: other, name: lead?.name || p?.name || "Member", picture: lead?.picture ?? p?.picture ?? null, role: lead?.role || "Member", badge: p?.badge ?? null },
        last_at: t.last_at, preview: t.last_preview, from_me: t.last_sender === s.user.id, unread: Number(mine ? t.starter_unread : t.leader_unread) || 0 };
    });
    return json({ ok: true, threads, unread: threads.reduce((n, t) => n + t.unread, 0), am_leader: ls.some((l) => l.id === s.user.id) }, 200, { "Cache-Control": "no-store" });
  });

  router.post("/api/chat/start", async (req) => {
    const s = await me(env, req);
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    const { to } = await readJson<{ to?: string }>(req);
    if (!to || to === s.user.id) throw new HttpError(400, "Choose a leader to message.");
    if (!(await isLeader(env, to))) throw new HttpError(403, "You can message church leaders here.");
    const found = await env.DB.prepare("SELECT id FROM chat_threads WHERE (starter_id = ? AND leader_id = ?) OR (starter_id = ? AND leader_id = ?)").bind(s.user.id, to, to, s.user.id).first<{ id: string }>();
    if (found) return json({ ok: true, id: found.id });
    const id = uuid();
    await env.DB.prepare("INSERT INTO chat_threads (id, starter_id, leader_id) VALUES (?,?,?)").bind(id, s.user.id, to).run();
    return json({ ok: true, id });
  });

  router.get("/api/chat/:id", async (req, { id }) => {
    const s = await me(env, req);
    const t = await thread(env, id, s.user.id);
    const mine = t.starter_id === s.user.id, other = String(mine ? t.leader_id : t.starter_id);
    const since = new URL(req.url).searchParams.get("since");
    const { results } = await env.DB.prepare(`SELECT id, sender_id, body, created_at FROM chat_messages WHERE thread_id = ? ${since ? "AND created_at > ?" : ""} ORDER BY created_at DESC LIMIT 200`)
      .bind(...(since ? [id, since] : [id])).all<{ id: string; sender_id: string; body: string; created_at: string }>();
    await env.DB.prepare(`UPDATE chat_threads SET ${mine ? "starter_unread" : "leader_unread"} = 0, ${mine ? "starter_seen_at" : "leader_seen_at"} = ? WHERE id = ?`).bind(new Date().toISOString(), id).run();
    const lead = await isLeader(env, other), p = lead ? null : await person(env, other);
    return json({ ok: true, me: s.user.id, with: { id: other, name: lead?.name || p?.name || "Member", picture: lead?.picture ?? p?.picture ?? null, role: lead?.role || "Member", badge: await badge(env, other, lead?.email ?? p?.email) },
      seen_at: (mine ? t.leader_seen_at : t.starter_seen_at) ?? null,
      messages: results.reverse().map((m) => ({ ...m, mine: m.sender_id === s.user.id })) }, 200, { "Cache-Control": "no-store" });
  });

  // Live: waits (up to ~20 s) until something changes — a new message, the other person starts or stops typing, or they
  // see your messages — then answers straight away. The page asks again at once, so messages arrive in about a second.
  router.get("/api/chat/:id/live", async (req, { id }) => {
    const s = await me(env, req);
    const t0 = await thread(env, id, s.user.id);
    const mine = t0.starter_id === s.user.id, u = new URL(req.url);
    const since = u.searchParams.get("since") || "", typingWas = u.searchParams.get("typing") === "1", seenWas = u.searchParams.get("seen") || "";
    const waitMs = Math.min(20_000, Math.max(0, Number(u.searchParams.get("wait") ?? 20_000) || 0));
    const deadline = Date.now() + waitMs;
    for (let i = 0; ; i++) {
      const [msgs, t] = await Promise.all([
        env.DB.prepare(`SELECT id, sender_id, body, created_at FROM chat_messages WHERE thread_id = ? ${since ? "AND created_at > ?" : ""} ORDER BY created_at LIMIT 100`).bind(...(since ? [id, since] : [id])).all<{ id: string; sender_id: string; body: string; created_at: string }>(),
        env.DB.prepare("SELECT starter_typing_at, leader_typing_at, starter_seen_at, leader_seen_at FROM chat_threads WHERE id = ?").bind(id).first<Record<string, string | null>>(),
      ]);
      const otherTyping = (mine ? t?.leader_typing_at : t?.starter_typing_at) ?? null;
      const typing = !!otherTyping && Date.now() - Date.parse(otherTyping) < 6000;
      const seen = (mine ? t?.leader_seen_at : t?.starter_seen_at) ?? "";
      const fresh = msgs.results;
      if (fresh.some((m) => m.sender_id !== s.user.id)) {
        await env.DB.prepare(`UPDATE chat_threads SET ${mine ? "starter_unread" : "leader_unread"} = 0, ${mine ? "starter_seen_at" : "leader_seen_at"} = ? WHERE id = ?`).bind(new Date().toISOString(), id).run();
      }
      if (fresh.length || typing !== typingWas || seen !== seenWas || Date.now() >= deadline) {
        return json({ ok: true, messages: fresh.map((m) => ({ ...m, mine: m.sender_id === s.user.id })), typing, seen_at: seen || null }, 200, { "Cache-Control": "no-store" });
      }
      await new Promise((r) => setTimeout(r, i < 10 ? 600 : 1000));
    }
  });

  // "…is typing": the page pings this every few seconds while someone types.
  router.post("/api/chat/:id/typing", async (req, { id }) => {
    const s = await me(env, req);
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    const t = await thread(env, id, s.user.id);
    const { on } = await readJson<{ on?: boolean }>(req);
    await env.DB.prepare(`UPDATE chat_threads SET ${t.starter_id === s.user.id ? "starter_typing_at" : "leader_typing_at"} = ? WHERE id = ?`).bind(on === false ? null : new Date().toISOString(), id).run();
    return json({ ok: true });
  });

  router.post("/api/chat/:id", async (req, { id }, ctx) => {
    const s = await me(env, req);
    if (!trustedWrite(req)) throw new HttpError(403, "Missing request header.");
    await rateLimit(env, "chat", s.user.id, 60, 600);
    const t = await thread(env, id, s.user.id);
    const { body } = await readJson<{ body?: string }>(req);
    const text = String(body || "").replace(/\s+$/g, "").slice(0, 2000);
    if (!text.trim()) throw new HttpError(400, "Type a message.");
    const mine = t.starter_id === s.user.id, other = String(mine ? t.leader_id : t.starter_id), now = new Date().toISOString();
    const mid = uuid();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO chat_messages (id, thread_id, sender_id, body, created_at) VALUES (?,?,?,?,?)").bind(mid, id, s.user.id, text, now),
      env.DB.prepare(`UPDATE chat_threads SET last_at = ?, last_preview = ?, last_sender = ?, ${mine ? "leader_unread = leader_unread + 1" : "starter_unread = starter_unread + 1"}, ${mine ? "starter_typing_at" : "leader_typing_at"} = NULL WHERE id = ?`)
        .bind(now, text.slice(0, 140), s.user.id, id),
    ]);
    // Email the other person, at most once every few minutes per thread.
    const mailedCol = mine ? "leader_mailed" : "starter_mailed", last = t[mailedCol] as string | null;
    if (!last || Date.now() - Date.parse(last) > MAIL_GAP_MS) {
      const [to, from] = await Promise.all([person(env, other), person(env, s.user.id)]);
      const lead = await isLeader(env, s.user.id);
      if (to?.email) {
        await env.DB.prepare(`UPDATE chat_threads SET ${mailedCol} = ? WHERE id = ?`).bind(now, id).run();
        const mail = sendMail(env, { to: to.email, ...T.newMessage({ site: siteUrl(env) }, { to: to.first || "friend", from: lead ? `${lead.name} (${lead.role})` : (from?.name || "A member"),
          preview: text.slice(0, 280), url: `${siteUrl(env)}/messages?c=${id}` }), template: "chat_message" }).catch(() => false);
        if (typeof ctx?.waitUntil === "function") ctx.waitUntil(mail); else await mail;
      }
    }
    return json({ ok: true, message: { id: mid, sender_id: s.user.id, body: text, created_at: now, mine: true } });
  });
}
