// Member voting: the admin sets up a vote for an event (e.g. "Youth of the Year" at the Youth Awards) with voting days.
// Only confirmed members can vote, once per vote, for another member. Results are live for members (if the admin allows).
// Ballots are secret: nobody, the admin included, can see who voted for whom — only the totals.
import type { Env } from "../env.ts";
import { HttpError, Router, clientIp, json, readJson } from "../lib/http.ts";
import { getSession, requireAdmin } from "../lib/auth.ts";
import { rateLimit } from "../lib/ratelimit.ts";
import { uuid } from "../lib/crypto.ts";

type Poll = { id: string; title: string; event_name: string | null; description: string | null; opens_at: string; closes_at: string; candidates: string; show_live: number; status: string; created_at: string };
type Person = { id: string; name: string; picture: string | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Voting days are in South African time: from 00:00 on the first day to 23:59 on the last. */
export const dayStart = (d: string) => new Date(`${d}T00:00:00+02:00`).toISOString();
export const dayEnd = (d: string) => new Date(`${d}T23:59:59+02:00`).toISOString();
export function pollState(p: Pick<Poll, "status" | "opens_at" | "closes_at">, now = new Date().toISOString()): "draft" | "upcoming" | "open" | "closed" {
  if (p.status === "draft") return "draft";
  if (p.status === "closed" || now > p.closes_at) return "closed";
  if (now < p.opens_at) return "upcoming";
  return "open";
}

const PERSON_SQL = `SELECT m.id, TRIM(COALESCE(NULLIF(m.preferred_name, ''), m.first_name) || ' ' || COALESCE(m.last_name, '')) AS name, u.picture
  FROM members m LEFT JOIN users u ON u.id = m.user_id`;

async function memberOf(env: Env, user: { id: string; email: string }) {
  return env.DB.prepare("SELECT id, status FROM members WHERE (user_id = ? OR lower(email) = lower(?)) AND status = 'member' ORDER BY created_at LIMIT 1")
    .bind(user.id, user.email).first<{ id: string; status: string }>();
}

async function candidatesFor(env: Env, p: Poll): Promise<Person[]> {
  if (p.candidates === "all") {
    return (await env.DB.prepare(`${PERSON_SQL} WHERE m.status = 'member' ORDER BY name LIMIT 2000`).all<Person>()).results;
  }
  return (await env.DB.prepare(`${PERSON_SQL} JOIN poll_candidates c ON c.member_id = m.id WHERE c.poll_id = ? AND m.status = 'member' ORDER BY c.sort, name`).bind(p.id).all<Person>()).results;
}
async function tally(env: Env, pollId: string) {
  const { results } = await env.DB.prepare("SELECT member_id, COUNT(*) AS votes FROM poll_votes WHERE poll_id = ? GROUP BY member_id ORDER BY votes DESC").bind(pollId).all<{ member_id: string; votes: number }>();
  return { counts: results, total: results.reduce((n, r) => n + r.votes, 0) };
}

export function voteRoutes(router: Router, env: Env): void {
  const needMember = async (req: Request) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in to vote.");
    const m = await memberOf(env, s.user);
    if (!m) throw new HttpError(403, "Voting is for confirmed church members.");
    return { s, m };
  };

  // ---------------- members
  router.get("/api/votes", async (req) => {
    const { m } = await needMember(req);
    const { results } = await env.DB.prepare("SELECT * FROM polls WHERE status != 'draft' ORDER BY closes_at DESC LIMIT 30").all<Poll>();
    const polls = await Promise.all(results.map(async (p) => {
      const mine = await env.DB.prepare("SELECT member_id FROM poll_votes WHERE poll_id = ? AND voter_id = ?").bind(p.id, m.id).first<{ member_id: string }>();
      const t = await env.DB.prepare("SELECT COUNT(*) AS n FROM poll_votes WHERE poll_id = ?").bind(p.id).first<{ n: number }>();
      return { id: p.id, title: p.title, event_name: p.event_name, opens_at: p.opens_at, closes_at: p.closes_at, state: pollState(p), voted: !!mine, votes: t?.n ?? 0 };
    }));
    const order = { open: 0, upcoming: 1, closed: 2, draft: 3 };
    polls.sort((a, b) => order[a.state] - order[b.state]);
    return json({ ok: true, polls, me: m.id });
  });

  router.get("/api/votes/:id", async (req, { id }) => {
    const { m } = await needMember(req);
    const p = await env.DB.prepare("SELECT * FROM polls WHERE id = ? AND status != 'draft'").bind(id).first<Poll>();
    if (!p) throw new HttpError(404, "That vote isn't available.");
    const state = pollState(p);
    const people = await candidatesFor(env, p);
    const mine = await env.DB.prepare("SELECT member_id FROM poll_votes WHERE poll_id = ? AND voter_id = ?").bind(p.id, m.id).first<{ member_id: string }>();
    const showResults = state === "closed" || !!p.show_live;
    const t = showResults ? await tally(env, p.id) : null;
    const byId = new Map(people.map((x) => [x.id, x]));
    const results = t ? t.counts.map((r) => ({ ...(byId.get(r.member_id) || { id: r.member_id, name: "Member", picture: null }), votes: r.votes })) : null;
    return json({ ok: true, poll: { id: p.id, title: p.title, event_name: p.event_name, description: p.description, opens_at: p.opens_at, closes_at: p.closes_at, state, show_live: !!p.show_live },
      candidates: people, me: m.id, my_vote: mine?.member_id ?? null, results, total: t?.total ?? null }, 200, { "Cache-Control": "no-store" });
  });

  router.post("/api/votes/:id", async (req, { id }) => {
    await rateLimit(env, "vote", clientIp(req), 30, 600);
    const { m } = await needMember(req);
    const p = await env.DB.prepare("SELECT * FROM polls WHERE id = ? AND status != 'draft'").bind(id).first<Poll>();
    if (!p) throw new HttpError(404, "That vote isn't available.");
    const state = pollState(p);
    if (state === "upcoming") throw new HttpError(409, "Voting hasn't opened yet.");
    if (state !== "open") throw new HttpError(409, "Voting has closed.");
    const { member_id } = await readJson<{ member_id?: string }>(req);
    if (!member_id) throw new HttpError(400, "Choose someone to vote for.");
    if (member_id === m.id) throw new HttpError(422, "You can't vote for yourself.");
    const ok = p.candidates === "all"
      ? await env.DB.prepare("SELECT 1 FROM members WHERE id = ? AND status = 'member'").bind(member_id).first()
      : await env.DB.prepare("SELECT 1 FROM poll_candidates c JOIN members m ON m.id = c.member_id WHERE c.poll_id = ? AND c.member_id = ? AND m.status = 'member'").bind(p.id, member_id).first();
    if (!ok) throw new HttpError(422, "That person isn't on this vote.");
    const r = await env.DB.prepare("INSERT OR IGNORE INTO poll_votes (poll_id, voter_id, member_id) VALUES (?,?,?)").bind(p.id, m.id, member_id).run();
    if (!r.meta.changes) throw new HttpError(409, "You've already voted in this one. Thank you!");
    return json({ ok: true });
  });

  // ---------------- admin (and youth leaders with the "votes" permission)
  router.get("/api/admin/votes", async (req) => {
    await requireAdmin(env, req);
    const { results } = await env.DB.prepare("SELECT * FROM polls ORDER BY created_at DESC LIMIT 50").all<Poll>();
    const polls = await Promise.all(results.map(async (p) => {
      const people = await candidatesFor(env, p);
      const t = await tally(env, p.id);
      const byId = new Map(people.map((x) => [x.id, x]));
      const eligible = (await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE status = 'member'").first<{ n: number }>())?.n ?? 0;
      return { ...p, state: pollState(p), show_live: !!p.show_live, candidate_count: people.length, total: t.total, eligible,
        results: t.counts.map((r) => ({ ...(byId.get(r.member_id) || { id: r.member_id, name: "Member", picture: null }), votes: r.votes })) };
    }));
    return json({ ok: true, polls });
  });

  router.get("/api/admin/votes/members", async (req) => {
    await requireAdmin(env, req);
    const q = (new URL(req.url).searchParams.get("q") || "").trim().toLowerCase();
    const like = `%${q}%`;
    const { results } = await env.DB.prepare(`${PERSON_SQL} WHERE m.status = 'member' AND (? = '' OR lower(m.first_name || ' ' || COALESCE(m.last_name, '') || ' ' || COALESCE(m.preferred_name, '')) LIKE ?) ORDER BY name LIMIT 40`).bind(q, like).all<Person>();
    return json({ ok: true, members: results });
  });

  router.post("/api/admin/votes", async (req) => {
    const s = await requireAdmin(env, req);
    if (req.headers.get("x-scc-admin") !== "1") throw new HttpError(403, "Missing request header.");
    const b = await readJson<{ title?: string; event_name?: string; description?: string; opens?: string; closes?: string; candidates?: string; member_ids?: string[]; show_live?: boolean }>(req);
    const title = String(b.title || "").trim().slice(0, 120);
    if (!title) throw new HttpError(422, "Give the vote a title, e.g. “Youth member of the year”.");
    if (!DATE.test(b.opens || "") || !DATE.test(b.closes || "")) throw new HttpError(422, "Choose the voting days.");
    if (b.closes! < b.opens!) throw new HttpError(422, "The last voting day must be on or after the first.");
    const mode = b.candidates === "all" ? "all" : "list";
    const ids = [...new Set((b.member_ids || []).map(String))].slice(0, 200);
    if (mode === "list" && ids.length < 2) throw new HttpError(422, "Add at least two members to vote for, or let members vote for anyone.");
    const id = uuid();
    const stmts = [env.DB.prepare("INSERT INTO polls (id, title, event_name, description, opens_at, closes_at, candidates, show_live, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, title, String(b.event_name || "").trim().slice(0, 120) || null, String(b.description || "").trim().slice(0, 600) || null, dayStart(b.opens!), dayEnd(b.closes!), mode, b.show_live === false ? 0 : 1, "open", s.user.email)];
    ids.forEach((mid, i) => stmts.push(env.DB.prepare("INSERT OR IGNORE INTO poll_candidates (poll_id, member_id, sort) SELECT ?, id, ? FROM members WHERE id = ? AND status = 'member'").bind(id, i, mid)));
    await env.DB.batch(stmts);
    return json({ ok: true, id });
  });

  router.patch("/api/admin/votes/:id", async (req, { id }) => {
    await requireAdmin(env, req);
    if (req.headers.get("x-scc-admin") !== "1") throw new HttpError(403, "Missing request header.");
    const b = await readJson<{ status?: string; show_live?: boolean; closes?: string }>(req);
    const p = await env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(id).first<Poll>();
    if (!p) throw new HttpError(404, "Vote not found.");
    const status = b.status && ["open", "closed", "draft"].includes(b.status) ? b.status : p.status;
    const closes = b.closes && DATE.test(b.closes) ? dayEnd(b.closes) : p.closes_at;
    await env.DB.prepare("UPDATE polls SET status = ?, show_live = ?, closes_at = ? WHERE id = ?").bind(status, b.show_live == null ? p.show_live : b.show_live ? 1 : 0, closes, id).run();
    return json({ ok: true });
  });

  router.delete("/api/admin/votes/:id", async (req, { id }) => {
    await requireAdmin(env, req);
    if (req.headers.get("x-scc-admin") !== "1") throw new HttpError(403, "Missing request header.");
    await env.DB.batch([env.DB.prepare("DELETE FROM poll_votes WHERE poll_id = ?").bind(id), env.DB.prepare("DELETE FROM poll_candidates WHERE poll_id = ?").bind(id), env.DB.prepare("DELETE FROM polls WHERE id = ?").bind(id)]);
    return json({ ok: true });
  });
}
