// Church elections ("Voting"). The main admin (or anyone they give the "Voting" permission) sets one up:
//   - the event it's for, and the roles to fill, each with a short description of what the role means;
//   - the first voting day, how many rounds, how many days each round lasts and the break between rounds.
// Who can vote: confirmed members only, once per role per round, never for themselves.
// Who can be chosen: confirmed members who said on their join form that they have given their life to Jesus,
// at least five years ago. Round 2 onwards: the top few from the round before.
// Results are always live (totals only; ballots are secret, even from admins).
// When the last round closes, the winners are appointed, and everyone involved is emailed.
// Before voting starts, members get a reminder every two weeks to pray; and an email when each round opens.
import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { HttpError, Router, clientIp, json, readJson } from "../lib/http.ts";
import { getSession, requireAdmin } from "../lib/auth.ts";
import { rateLimit } from "../lib/ratelimit.ts";
import { uuid } from "../lib/crypto.ts";
import { sendMail } from "../lib/email.ts";
import * as T from "../emails/templates.ts";

type Poll = { id: string; title: string; event_name: string | null; description: string | null; opens_at: string; closes_at: string; status: string; created_at: string;
  rounds: number; round_days: number; gap_days: number; runoff: number; min_saved_years: number; last_reminder_at: string | null; reminded_rounds: string | null; completed_at: string | null };
type Role = { id: string; poll_id: string; name: string; description: string | null; seats: number; sort: number };
type Round = { round: number; opens_at: string; closes_at: string };
type Person = { id: string; name: string; picture: string | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Voting days are in South African time: 00:00 on the first day to 23:59 on the last. */
export const dayStart = (d: string) => new Date(`${d}T00:00:00+02:00`).toISOString();
export const dayEnd = (d: string) => new Date(`${d}T23:59:59+02:00`).toISOString();
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** The rounds' dates from the first voting day. */
export function schedule(first: string, rounds: number, days: number, gap: number): { round: number; opens: string; closes: string }[] {
  const out = [];
  let d = first;
  for (let r = 1; r <= rounds; r++) { const end = addDays(d, days - 1); out.push({ round: r, opens: d, closes: end }); d = addDays(end, gap + 1); }
  return out;
}

export type PollState = { state: "draft" | "cancelled" | "upcoming" | "open" | "between" | "complete"; round: number; next: Round | null };
export function pollState(p: Pick<Poll, "status">, rounds: Round[], now = new Date().toISOString()): PollState {
  if (p.status === "draft") return { state: "draft", round: 0, next: rounds[0] ?? null };
  if (p.status === "closed") return { state: "cancelled", round: 0, next: null };
  for (const r of rounds) if (now >= r.opens_at && now <= r.closes_at) return { state: "open", round: r.round, next: r };
  const upcoming = rounds.find((r) => now < r.opens_at);
  if (!upcoming) return { state: "complete", round: rounds.length, next: null };
  if (upcoming.round === 1) return { state: "upcoming", round: 0, next: upcoming };
  return { state: "between", round: upcoming.round - 1, next: upcoming };
}

const PERSON_SQL = `SELECT m.id, TRIM(COALESCE(NULLIF(m.preferred_name, ''), m.first_name) || ' ' || COALESCE(m.last_name, '')) AS name, u.picture
  FROM members m LEFT JOIN users u ON u.id = m.user_id`;
/** Saved, by their own answer on the join form, at least `years` years ago (the year they gave). */
const ELIGIBLE = (years: number) => `m.status = 'member' AND m.salvation_status = 'saved'
  AND CAST(substr(trim(COALESCE(m.salvation_year, '')), 1, 4) AS INTEGER) BETWEEN 1900 AND ${new Date().getUTCFullYear() - years}`;

async function memberOf(env: Env, user: { id: string; email: string }) {
  return env.DB.prepare("SELECT id FROM members WHERE (user_id = ? OR lower(email) = lower(?)) AND status = 'member' ORDER BY created_at LIMIT 1").bind(user.id, user.email).first<{ id: string }>();
}
const roundsOf = async (env: Env, id: string) => (await env.DB.prepare("SELECT round, opens_at, closes_at FROM poll_rounds WHERE poll_id = ? ORDER BY round").bind(id).all<Round>()).results;
const rolesOf = async (env: Env, id: string) => (await env.DB.prepare("SELECT * FROM poll_roles WHERE poll_id = ? ORDER BY sort").bind(id).all<Role>()).results;

async function candidates(env: Env, p: Poll, round: number, roleId: string): Promise<Person[]> {
  if (round <= 1) return (await env.DB.prepare(`${PERSON_SQL} WHERE ${ELIGIBLE(p.min_saved_years)} ORDER BY name LIMIT 2000`).all<Person>()).results;
  return (await env.DB.prepare(`${PERSON_SQL} JOIN poll_finalists f ON f.member_id = m.id WHERE f.poll_id = ? AND f.round = ? AND f.role_id = ? AND m.status = 'member' ORDER BY name`)
    .bind(p.id, round, roleId).all<Person>()).results;
}
async function tally(env: Env, pollId: string, round: number, roleId: string) {
  const { results } = await env.DB.prepare("SELECT member_id, COUNT(*) AS votes FROM poll_ballots WHERE poll_id = ? AND round = ? AND role_id = ? GROUP BY member_id ORDER BY votes DESC")
    .bind(pollId, round, roleId).all<{ member_id: string; votes: number }>();
  return results;
}
/** Top `n` by votes, keeping anyone tied with the last place. */
export function topWithTies(rows: { member_id: string; votes: number }[], n: number) {
  if (rows.length <= n) return rows;
  const cut = rows[n - 1].votes;
  return rows.filter((r, i) => i < n || r.votes === cut);
}

/**
 * Moves an election along when rounds close: picks the finalists for the next round, and when the last round has
 * closed, appoints the winners and emails them and the main admin. Safe to call often (it only acts once).
 */
export async function settle(env: Env, p: Poll, now = new Date().toISOString()): Promise<void> {
  if (p.status !== "open" || p.completed_at) return;
  const rounds = await roundsOf(env, p.id);
  const roles = await rolesOf(env, p.id);
  for (const r of rounds) {
    if (now <= r.closes_at) break;
    if (r.round < p.rounds) {
      const done = await env.DB.prepare("SELECT 1 FROM poll_finalists WHERE poll_id = ? AND round = ? LIMIT 1").bind(p.id, r.round + 1).first();
      if (done) continue;
      const stmts = [];
      for (const role of roles) {
        const top = topWithTies(await tally(env, p.id, r.round, role.id), Math.max(p.runoff, role.seats));
        for (const t of top) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO poll_finalists (poll_id, round, role_id, member_id) VALUES (?,?,?,?)").bind(p.id, r.round + 1, role.id, t.member_id));
      }
      if (stmts.length) await env.DB.batch(stmts);
    } else {
      const claim = await env.DB.prepare("UPDATE polls SET completed_at = ? WHERE id = ? AND completed_at IS NULL").bind(now, p.id).run();
      if (!claim.meta.changes) return;
      const site = siteUrl(env);
      const appointed: { role: string; name: string; email: string | null; votes: number }[] = [];
      for (const role of roles) {
        const rows = await tally(env, p.id, r.round, role.id);
        for (const w of rows.slice(0, role.seats)) {
          await env.DB.prepare("INSERT OR IGNORE INTO poll_appointments (poll_id, role_id, member_id, votes) VALUES (?,?,?,?)").bind(p.id, role.id, w.member_id, w.votes).run();
          const m = await env.DB.prepare("SELECT COALESCE(NULLIF(preferred_name, ''), first_name) AS first, last_name, email FROM members WHERE id = ?").bind(w.member_id).first<{ first: string; last_name: string; email: string | null }>();
          if (m) appointed.push({ role: role.name, name: `${m.first} ${m.last_name}`.trim(), email: m.email, votes: w.votes });
        }
      }
      for (const a of appointed) if (a.email) await sendMail(env, { to: a.email, ...T.electionAppointed({ site }, { name: a.name.split(" ")[0], role: a.role, title: p.title, event: p.event_name }), template: "election_appointed" });
      await sendMail(env, { to: adminEmail(env), ...T.electionResults({ site }, { title: p.title, event: p.event_name, appointed: appointed.map((a) => ({ role: a.role, name: a.name, votes: a.votes })) }), template: "election_results" });
    }
  }
}

export function voteRoutes(router: Router, env: Env): void {
  const needMember = async (req: Request) => {
    const s = await getSession(env, req);
    if (!s) throw new HttpError(401, "Please sign in to vote.");
    const m = await memberOf(env, s.user);
    if (!m) throw new HttpError(403, "Voting is for confirmed church members.");
    return { s, m };
  };
  const pollById = (id: string) => env.DB.prepare("SELECT * FROM polls WHERE id = ?").bind(id).first<Poll>();

  // ---------------- members
  router.get("/api/votes", async (req) => {
    const { m } = await needMember(req);
    const { results } = await env.DB.prepare("SELECT * FROM polls WHERE status IN ('open') ORDER BY opens_at DESC LIMIT 20").all<Poll>();
    const polls = await Promise.all(results.map(async (p) => {
      await settle(env, p);
      const rounds = await roundsOf(env, p.id);
      const st = pollState(p, rounds);
      const roles = await rolesOf(env, p.id);
      const mine = st.state === "open" ? (await env.DB.prepare("SELECT COUNT(*) AS n FROM poll_ballots WHERE poll_id = ? AND round = ? AND voter_id = ?").bind(p.id, st.round, m.id).first<{ n: number }>())?.n ?? 0 : 0;
      return { id: p.id, title: p.title, event_name: p.event_name, state: st.state, round: st.round, rounds: p.rounds, opens_at: st.next?.opens_at ?? p.opens_at, closes_at: st.next?.closes_at ?? p.closes_at,
        roles: roles.length, voted: st.state === "open" && mine >= roles.length, voted_roles: mine };
    }));
    const order = { open: 0, between: 1, upcoming: 2, complete: 3, cancelled: 4, draft: 5 };
    polls.sort((a, b) => order[a.state] - order[b.state]);
    return json({ ok: true, polls, me: m.id, year: new Date().getUTCFullYear() }, 200, { "Cache-Control": "no-store" });
  });

  router.get("/api/votes/:id", async (req, { id }) => {
    const { m } = await needMember(req);
    const p = await pollById(id);
    if (!p || p.status === "draft") throw new HttpError(404, "That vote isn't available.");
    await settle(env, p);
    const rounds = await roundsOf(env, p.id);
    const st = pollState(p, rounds);
    const roles = await rolesOf(env, p.id);
    const showRound = st.state === "open" ? st.round : st.state === "between" || st.state === "complete" ? st.round : 0;
    const out = await Promise.all(roles.map(async (role) => {
      const people = showRound ? await candidates(env, p, showRound, role.id) : [];
      const byId = new Map(people.map((x) => [x.id, x]));
      const counts = showRound ? await tally(env, p.id, showRound, role.id) : [];
      const total = counts.reduce((n, r) => n + r.votes, 0);
      const mine = st.state === "open" ? await env.DB.prepare("SELECT member_id FROM poll_ballots WHERE poll_id = ? AND round = ? AND role_id = ? AND voter_id = ?").bind(p.id, st.round, role.id, m.id).first<{ member_id: string }>() : null;
      const appointed = st.state === "complete" ? (await env.DB.prepare(`${PERSON_SQL} JOIN poll_appointments a ON a.member_id = m.id WHERE a.poll_id = ? AND a.role_id = ?`).bind(p.id, role.id).all<Person>()).results : [];
      return { id: role.id, name: role.name, description: role.description, seats: role.seats,
        candidates: st.state === "open" ? people.filter((x) => x.id !== m.id) : [], my_vote: mine?.member_id ?? null, total,
        results: counts.map((r) => ({ ...(byId.get(r.member_id) || { id: r.member_id, name: "Member", picture: null }), votes: r.votes })), appointed };
    }));
    return json({ ok: true, poll: { id: p.id, title: p.title, event_name: p.event_name, description: p.description, rounds: p.rounds, state: st.state, round: st.round,
      next: st.next, schedule: rounds, min_saved_years: p.min_saved_years }, roles: out, me: m.id }, 200, { "Cache-Control": "no-store" });
  });

  router.post("/api/votes/:id", async (req, { id }) => {
    await rateLimit(env, "vote", clientIp(req), 60, 600);
    const { m } = await needMember(req);
    const p = await pollById(id);
    if (!p || p.status === "draft") throw new HttpError(404, "That vote isn't available.");
    await settle(env, p);
    const st = pollState(p, await roundsOf(env, p.id));
    if (st.state === "upcoming" || st.state === "between") throw new HttpError(409, "Voting for this round hasn't opened yet.");
    if (st.state !== "open") throw new HttpError(409, "Voting has closed.");
    const { role_id, member_id } = await readJson<{ role_id?: string; member_id?: string }>(req);
    const role = role_id ? await env.DB.prepare("SELECT * FROM poll_roles WHERE id = ? AND poll_id = ?").bind(role_id, p.id).first<Role>() : null;
    if (!role) throw new HttpError(400, "Choose the role you're voting for.");
    if (!member_id) throw new HttpError(400, "Choose someone to vote for.");
    if (member_id === m.id) throw new HttpError(422, "You can't vote for yourself.");
    const ok = st.round <= 1
      ? await env.DB.prepare(`SELECT 1 FROM members m WHERE m.id = ? AND ${ELIGIBLE(p.min_saved_years)}`).bind(member_id).first()
      : await env.DB.prepare("SELECT 1 FROM poll_finalists WHERE poll_id = ? AND round = ? AND role_id = ? AND member_id = ?").bind(p.id, st.round, role.id, member_id).first();
    if (!ok) throw new HttpError(422, st.round <= 1 ? `Only confirmed members who have been saved for at least ${p.min_saved_years} years can be chosen.` : "That person isn't in this round.");
    const r = await env.DB.prepare("INSERT OR IGNORE INTO poll_ballots (poll_id, round, role_id, voter_id, member_id) VALUES (?,?,?,?,?)").bind(p.id, st.round, role.id, m.id, member_id).run();
    if (!r.meta.changes) throw new HttpError(409, "You've already voted for this role in this round. Thank you!");
    return json({ ok: true });
  });

  // ---------------- admin: the main admin, or anyone given the "Voting" permission
  const guardWrite = (req: Request) => { if (req.headers.get("x-scc-admin") !== "1") throw new HttpError(403, "Missing request header."); };

  router.get("/api/admin/votes", async (req) => {
    await requireAdmin(env, req);
    const { results } = await env.DB.prepare("SELECT * FROM polls ORDER BY created_at DESC LIMIT 50").all<Poll>();
    const eligibleVoters = (await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE status = 'member'").first<{ n: number }>())?.n ?? 0;
    const polls = await Promise.all(results.map(async (p) => {
      await settle(env, p);
      const rounds = await roundsOf(env, p.id), roles = await rolesOf(env, p.id), st = pollState(p, rounds);
      const r = st.round || 1;
      const perRole = await Promise.all(roles.map(async (role) => {
        const counts = await tally(env, p.id, r, role.id);
        const people = new Map((await env.DB.prepare(`${PERSON_SQL} WHERE m.id IN (${counts.map(() => "?").join(",") || "''"})`).bind(...counts.map((c) => c.member_id)).all<Person>()).results.map((x) => [x.id, x]));
        const appointed = (await env.DB.prepare(`${PERSON_SQL} JOIN poll_appointments a ON a.member_id = m.id WHERE a.poll_id = ? AND a.role_id = ?`).bind(p.id, role.id).all<Person>()).results;
        return { id: role.id, name: role.name, description: role.description, seats: role.seats, total: counts.reduce((n, c) => n + c.votes, 0),
          results: counts.map((c) => ({ ...(people.get(c.member_id) || { id: c.member_id, name: "Member", picture: null }), votes: c.votes })), appointed };
      }));
      const voters = (await env.DB.prepare("SELECT COUNT(DISTINCT voter_id) AS n FROM poll_ballots WHERE poll_id = ? AND round = ?").bind(p.id, r).first<{ n: number }>())?.n ?? 0;
      return { ...p, state: st.state, round: st.round, next: st.next, schedule: rounds, roles: perRole, voters, eligible_voters: eligibleVoters };
    }));
    return json({ ok: true, polls });
  });

  // Who can be chosen (round 1): for the setup form, so the admin sees how many qualify.
  router.get("/api/admin/votes/eligible", async (req) => {
    await requireAdmin(env, req);
    const years = Math.max(0, Math.min(50, Number(new URL(req.url).searchParams.get("years") || 5) || 5));
    const { results } = await env.DB.prepare(`${PERSON_SQL} WHERE ${ELIGIBLE(years)} ORDER BY name LIMIT 500`).all<Person>();
    const members = (await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE status = 'member'").first<{ n: number }>())?.n ?? 0;
    return json({ ok: true, eligible: results, count: results.length, members, years });
  });

  router.post("/api/admin/votes", async (req) => {
    const s = await requireAdmin(env, req); guardWrite(req);
    const b = await readJson<{ title?: string; event_name?: string; description?: string; first_day?: string; rounds?: number; round_days?: number; gap_days?: number; runoff?: number;
      roles?: { name?: string; description?: string; seats?: number }[] }>(req, 64 * 1024);
    const title = String(b.title || "").trim().slice(0, 120);
    if (!title) throw new HttpError(422, "Give the vote a name, e.g. “Youth committee 2027”.");
    const roles = (b.roles || []).map((r) => ({ name: String(r.name || "").trim().slice(0, 80), description: String(r.description || "").trim().slice(0, 300), seats: Math.max(1, Math.min(10, Math.round(Number(r.seats) || 1))) })).filter((r) => r.name).slice(0, 20);
    if (!roles.length) throw new HttpError(422, "Add at least one role to fill, with a short description of what it means.");
    if (roles.some((r) => r.description.length < 5)) throw new HttpError(422, "Say briefly what each role means, so members know what they're voting for.");
    if (!DATE.test(b.first_day || "")) throw new HttpError(422, "Choose the first voting day.");
    const today = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
    if (b.first_day! < today) throw new HttpError(422, "The first voting day can't be in the past.");
    const rounds = Math.max(1, Math.min(3, Math.round(Number(b.rounds) || 1)));
    const days = Math.max(2, Math.min(21, Math.round(Number(b.round_days) || 7)));
    const gap = Math.max(1, Math.min(30, Math.round(Number(b.gap_days) || 7)));
    const runoff = Math.max(2, Math.min(10, Math.round(Number(b.runoff) || 3)));
    const plan = schedule(b.first_day!, rounds, days, gap);
    const id = uuid();
    const stmts = [env.DB.prepare(`INSERT INTO polls (id, title, event_name, description, opens_at, closes_at, candidates, show_live, status, created_by, rounds, round_days, gap_days, runoff, min_saved_years)
        VALUES (?,?,?,?,?,?, 'all', 1, 'open', ?,?,?,?,?,5)`)
      .bind(id, title, String(b.event_name || "").trim().slice(0, 120) || null, String(b.description || "").trim().slice(0, 600) || null, dayStart(plan[0].opens), dayEnd(plan.at(-1)!.closes), s.user.email, rounds, days, gap, runoff)];
    plan.forEach((r) => stmts.push(env.DB.prepare("INSERT INTO poll_rounds (poll_id, round, opens_at, closes_at) VALUES (?,?,?,?)").bind(id, r.round, dayStart(r.opens), dayEnd(r.closes))));
    roles.forEach((r, i) => stmts.push(env.DB.prepare("INSERT INTO poll_roles (id, poll_id, name, description, seats, sort) VALUES (?,?,?,?,?,?)").bind(uuid(), id, r.name, r.description, r.seats, i)));
    await env.DB.batch(stmts);
    return json({ ok: true, id, schedule: plan });
  });

  router.patch("/api/admin/votes/:id", async (req, { id }) => {
    await requireAdmin(env, req); guardWrite(req);
    const { status } = await readJson<{ status?: string }>(req);
    if (status !== "closed" && status !== "open") throw new HttpError(400, "Cancel or restore the vote.");
    const r = await env.DB.prepare("UPDATE polls SET status = ? WHERE id = ? AND completed_at IS NULL").bind(status, id).run();
    if (!r.meta.changes) throw new HttpError(409, "This vote is finished and can't be changed.");
    return json({ ok: true });
  });

  router.delete("/api/admin/votes/:id", async (req, { id }) => {
    await requireAdmin(env, req); guardWrite(req);
    await env.DB.batch(["poll_ballots", "poll_finalists", "poll_appointments", "poll_rounds", "poll_roles", "poll_candidates", "poll_votes"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE poll_id = ?`).bind(id))
      .concat([env.DB.prepare("DELETE FROM polls WHERE id = ?").bind(id)]));
    return json({ ok: true });
  });
}

/**
 * Cron: move elections along, and email members:
 *  - every 14 days before voting starts: "Voting for X starts on …, please pray";
 *  - when each round opens: "Voting is open".
 */
export async function processElections(env: Env, now = new Date()): Promise<number> {
  const iso = now.toISOString();
  const { results } = await env.DB.prepare("SELECT * FROM polls WHERE status = 'open' AND completed_at IS NULL").all<Poll>();
  let sent = 0;
  for (const p of results) {
    await settle(env, p, iso);
    const rounds = await roundsOf(env, p.id);
    const st = pollState(p, rounds, iso);
    const site = siteUrl(env);
    const roles = (await rolesOf(env, p.id)).map((r) => ({ name: r.name, description: r.description || "" }));
    let mail: ReturnType<typeof T.electionReminder> | null = null;
    if (st.state === "upcoming" && st.next) {
      const due = !p.last_reminder_at || now.getTime() - Date.parse(p.last_reminder_at) >= 14 * 86400_000 - 3600_000;
      const sa = new Date(now.getTime() + 2 * 3600_000);
      if (due && sa.getUTCHours() >= 9 && sa.getUTCHours() < 18) {
        const claim = await env.DB.prepare("UPDATE polls SET last_reminder_at = ? WHERE id = ? AND (last_reminder_at IS NULL OR last_reminder_at = ?)").bind(iso, p.id, p.last_reminder_at).run();
        if (claim.meta.changes) mail = T.electionReminder({ site }, { title: p.title, event: p.event_name, opens: st.next.opens_at, roles, kind: "pray", url: `${site}/vote?p=${p.id}` });
      }
    } else if (st.state === "open") {
      const done: number[] = JSON.parse(p.reminded_rounds || "[]");
      if (!done.includes(st.round)) {
        const claim = await env.DB.prepare("UPDATE polls SET reminded_rounds = ? WHERE id = ? AND COALESCE(reminded_rounds, '') = ?").bind(JSON.stringify([...done, st.round]), p.id, p.reminded_rounds || "").run();
        if (claim.meta.changes) mail = T.electionReminder({ site }, { title: p.title, event: p.event_name, opens: st.next!.opens_at, closes: st.next!.closes_at, round: st.round, rounds: p.rounds, roles, kind: "open", url: `${site}/vote?p=${p.id}` });
      }
    }
    if (!mail) continue;
    const { results: members } = await env.DB.prepare("SELECT DISTINCT lower(email) AS email, COALESCE(NULLIF(preferred_name, ''), first_name) AS name FROM members WHERE status = 'member' AND email IS NOT NULL AND email != '' AND COALESCE(comm_email, 1) = 1 LIMIT 2000").all<{ email: string; name: string }>();
    for (const m of members) if (await sendMail(env, { to: m.email, toName: m.name, ...mail, template: "election_reminder" })) sent++;
  }
  return sent;
}
