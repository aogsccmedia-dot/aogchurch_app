/**
 * Leader care for confirmed members.
 * - When someone becomes a confirmed member, a leader from the admin team is assigned:
 *   whoever currently cares for the fewest members (ties broken at random), never the member themselves.
 * - The leader gets an introduction email; a day later (and every few days until they answer) we ask
 *   "Have you connected?" with one-tap links. "Not yet" gives them more time; "Yes" asks how.
 * - After 4 unanswered/“not yet” check-ins the main admin is told, so nobody falls through the cracks.
 * - Leaders can log every contact and hand people over to another admin. If an admin's role is removed,
 *   their people are shared out again automatically.
 */
import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { HttpError } from "./http.ts";
import { randomToken, sha256Hex, uuid } from "./crypto.ts";
import { sendMail } from "./email.ts";
import * as T from "../emails/templates.ts";

export const CONTACT_METHODS: [string, string][] = [["whatsapp", "WhatsApp"], ["call", "Phone call"], ["email", "Email"], ["in_person", "In person"]];
const DAY = 86400_000;
const FIRST_ASK_HOURS = 24, REASK_DAYS = 3, ESCALATE_AFTER = 4;

export interface Leader { id: string; email: string; name: string; caring: number }

/** Admins who can be leaders, with how many confirmed members each already cares for. */
/** "kagiso moloto" → "Kagiso Moloto" (Google names are sometimes typed in lowercase). */
export const niceName = (n: string) => (n.includes("@") ? n : n.trim().replace(/\s+/g, " ").replace(/(^|[\s'-])(\p{Ll})/gu, (_m, a, c) => a + c.toUpperCase()));

export async function leaders(env: Env): Promise<Leader[]> {
  return (await leadersRaw(env)).map((l) => ({ ...l, name: niceName(l.name) }));
}
async function leadersRaw(env: Env): Promise<Leader[]> {
  // Only people with an Admin role are leaders. The main (super) admin account is never given members to look after.
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, COALESCE(NULLIF(u.given_name, ''), NULLIF(u.name, ''), u.email) AS name,
       (SELECT COUNT(*) FROM members m WHERE m.leader_user_id = u.id AND m.status = 'member') AS caring
     FROM admin_roles r JOIN users u ON u.id = r.user_id WHERE lower(u.email) != lower(?) ORDER BY name`).bind(adminEmail(env)).all<Leader>();
  return results;
}

/** Fair pick: fewest people in their care; ties at random. */
export function pickLeader(list: Leader[], excludeUserId?: string | null): Leader | null {
  const pool = list.filter((l) => l.id !== excludeUserId);
  if (!pool.length) return null;
  const min = Math.min(...pool.map((l) => l.caring));
  const tied = pool.filter((l) => l.caring === min);
  return tied[crypto.getRandomValues(new Uint32Array(1))[0] % tied.length];
}

interface MemberRowLite { id: string; first_name: string; last_name: string; preferred_name: string | null; ref_code: string; phone: string | null; whatsapp: string | null; email: string | null; date_of_birth: string | null; interests: string | null; user_id: string | null; leader_user_id: string | null }

const ageOf = (dob: string | null) => { if (!dob) return null; const d = new Date(dob), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return isFinite(a) ? a : null; };

/** Admins (the main admin or anyone with an admin role) lead; they're never assigned a leader themselves. */
export async function isAdminMember(env: Env, m: { user_id: string | null; email: string | null }) {
  if (m.email && m.email.toLowerCase() === adminEmail(env)) return true;
  return !!(await env.DB.prepare("SELECT 1 FROM admin_roles WHERE user_id = ? OR lower(email) = lower(?)").bind(m.user_id || "", m.email || "").first());
}
const NOT_ADMIN_SQL = `m.user_id IS NOT NULL AND m.user_id IN (SELECT user_id FROM admin_roles) OR lower(COALESCE(m.email, '')) IN (SELECT lower(email) FROM admin_roles)`;

/** Assign (or hand over to) a leader and email them. Returns the leader, or null if there's nobody to assign. */
export async function assignLeader(env: Env, memberId: string, opts: { toUserId?: string; handedBy?: string | null; now?: Date } = {}): Promise<Leader | null> {
  const m = await env.DB.prepare("SELECT id, first_name, last_name, preferred_name, ref_code, phone, whatsapp, email, date_of_birth, interests, user_id, leader_user_id FROM members WHERE id = ?")
    .bind(memberId).first<MemberRowLite>();
  if (!m) throw new HttpError(404, "Member not found.");
  if (!opts.toUserId && await isAdminMember(env, m)) return null;   // admins lead; they don't get a leader
  const all = await leaders(env);
  const leader = opts.toUserId ? all.find((l) => l.id === opts.toUserId) ?? null : pickLeader(all, m.user_id);
  if (opts.toUserId && !leader) throw new HttpError(422, "That person isn't on the admin team.");
  if (!leader) return null;
  if (leader.id === m.user_id) throw new HttpError(422, "Someone can't be their own leader.");
  const now = opts.now ?? new Date();
  await env.DB.prepare(`UPDATE members SET leader_user_id = ?, leader_assigned_at = ?, assigned_to = ?, followup_status = 'pending',
      followup_next_ask_at = ?, followup_asks = 0, updated_at = ? WHERE id = ?`)
    .bind(leader.id, now.toISOString(), leader.name, new Date(now.getTime() + FIRST_ASK_HOURS * 3600_000).toISOString(), now.toISOString(), m.id).run();
  let interests: string | null = null;
  try { interests = (JSON.parse(m.interests || "[]") as string[]).map((s) => s.replace(/_/g, " ")).join(", ") || null; } catch { /* ignore */ }
  const site = siteUrl(env);
  await sendMail(env, { to: leader.email, toName: leader.name, template: "leader_assigned", ...T.leaderAssigned({ site }, {
    leader: leader.name.split(" ")[0], member: `${m.preferred_name || m.first_name} ${m.last_name}`, first: m.preferred_name || m.first_name, ref: m.ref_code,
    phone: m.phone, whatsapp: m.whatsapp, email: m.email, age: ageOf(m.date_of_birth), interests, handedBy: opts.handedBy ?? null, peopleUrl: `${site}/admin/#people`,
  }) });
  return leader;
}

/** Cron: ask leaders "have you connected?" until they say yes; tell the main admin if it drags on. */
export async function processFollowups(env: Env, now = new Date()): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.first_name, m.last_name, m.preferred_name, m.ref_code, m.leader_user_id, m.leader_assigned_at, m.followup_asks,
        u.email AS leader_email, COALESCE(NULLIF(u.given_name, ''), NULLIF(u.name, ''), u.email) AS leader_name
     FROM members m JOIN users u ON u.id = m.leader_user_id
     WHERE m.status = 'member' AND m.followup_status IN ('pending', 'not_yet') AND m.followup_next_ask_at <= ? ORDER BY m.followup_next_ask_at LIMIT 40`)
    .bind(now.toISOString()).all<{ id: string; first_name: string; last_name: string; preferred_name: string | null; ref_code: string; leader_user_id: string; leader_assigned_at: string; followup_asks: number; leader_email: string; leader_name: string }>();
  const site = siteUrl(env);
  let sent = 0;
  for (const r of results) {
    const asks = r.followup_asks + 1;
    // Claim this round first so a slow email can't cause a double send.
    const claim = await env.DB.prepare("UPDATE members SET followup_asks = ?, followup_next_ask_at = ? WHERE id = ? AND followup_asks = ?")
      .bind(asks, new Date(now.getTime() + REASK_DAYS * DAY).toISOString(), r.id, r.followup_asks).run();
    if (!claim.meta.changes) continue;
    const token = randomToken();
    await env.DB.prepare("INSERT INTO followup_links (token_hash, member_id, leader_user_id) VALUES (?,?,?)").bind(await sha256Hex(token), r.id, r.leader_user_id).run();
    const base = `${site}/followup?t=${encodeURIComponent(token)}`;
    const member = `${r.preferred_name || r.first_name} ${r.last_name}`;
    if (await sendMail(env, { to: r.leader_email, toName: r.leader_name, template: "leader_followup", ...T.leaderFollowup({ site }, {
      leader: r.leader_name.split(" ")[0], member, first: r.preferred_name || r.first_name, yesUrl: `${base}&a=yes`, notYetUrl: `${base}&a=no`, asks }) })) sent++;
    if (asks === ESCALATE_AFTER) {
      const days = Math.max(1, Math.round((now.getTime() - new Date(r.leader_assigned_at).getTime()) / DAY));
      await sendMail(env, { to: adminEmail(env), template: "admin_followup_overdue", ...T.adminFollowupOverdue({ site }, { member, ref: r.ref_code, leader: r.leader_name, days }) });
    }
  }
  return sent;
}

export async function followupByToken(env: Env, token: string | null | undefined) {
  if (!token || token.length < 20 || token.length > 200) throw new HttpError(400, "This link isn't valid.");
  const r = await env.DB.prepare(
    `SELECT l.member_id, l.leader_user_id, m.first_name, m.last_name, m.preferred_name, m.leader_user_id AS current_leader, m.followup_status, m.followup_method, m.phone, m.whatsapp, m.email,
        COALESCE(NULLIF(u.given_name, ''), NULLIF(u.name, ''), u.email) AS leader_name
     FROM followup_links l JOIN members m ON m.id = l.member_id JOIN users u ON u.id = l.leader_user_id WHERE l.token_hash = ?`)
    .bind(await sha256Hex(token)).first<{ member_id: string; leader_user_id: string; first_name: string; last_name: string; preferred_name: string | null; current_leader: string | null; followup_status: string | null; followup_method: string | null; phone: string | null; whatsapp: string | null; email: string | null; leader_name: string }>();
  if (!r) throw new HttpError(404, "This link has expired. You can update this from My people in the admin.");
  if (r.current_leader !== r.leader_user_id) throw new HttpError(409, `${r.preferred_name || r.first_name} has since been handed to another leader. Thank you!`);
  return r;
}

/** Log a contact (also marks the first follow-up as done). */
export async function logContact(env: Env, memberId: string, leaderUserId: string, method: string, note: string | null, now = new Date()) {
  if (!CONTACT_METHODS.some(([k]) => k === method)) throw new HttpError(422, "Choose how you connected.", { method: "Choose how you connected." });
  const at = now.toISOString(), clean = note ? note.trim().slice(0, 1000) || null : null;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO member_contacts (id, member_id, leader_user_id, method, note, created_at) VALUES (?,?,?,?,?,?)").bind(uuid(), memberId, leaderUserId, method, clean, at),
    env.DB.prepare(`UPDATE members SET followup_status = 'met', followup_method = COALESCE(followup_method, ?), followup_note = COALESCE(followup_note, ?),
        followup_at = COALESCE(followup_at, ?), followup_next_ask_at = NULL, last_contact_at = ?, updated_at = ? WHERE id = ?`).bind(method, clean, at, at, at, memberId),
  ]);
}

/** "Not yet": ask again in a few days. */
export async function snoozeFollowup(env: Env, memberId: string, days = REASK_DAYS, now = new Date()) {
  const d = Math.min(14, Math.max(1, Math.round(days)));
  await env.DB.prepare("UPDATE members SET followup_status = 'not_yet', followup_next_ask_at = ?, updated_at = ? WHERE id = ?")
    .bind(new Date(now.getTime() + d * DAY).toISOString(), now.toISOString(), memberId).run();
  return d;
}

/** When someone leaves the admin team, share their people out fairly among the others. */
export async function reassignFrom(env: Env, leaderUserId: string, handedBy: string | null) {
  const { results } = await env.DB.prepare("SELECT id FROM members WHERE leader_user_id = ? AND status = 'member'").bind(leaderUserId).all<{ id: string }>();
  let moved = 0;
  for (const r of results) {
    await env.DB.prepare("UPDATE members SET leader_user_id = NULL WHERE id = ?").bind(r.id).run();
    if (await assignLeader(env, r.id, { handedBy })) moved++;
  }
  return moved;
}

/**
 * Cron catch-up: every confirmed member who isn't an admin has a leader. Anyone without one
 * (confirmed before leaders existed, or if an assignment failed) gets one now, and both they and
 * their leader are told by email.
 */
export async function backfillLeaders(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.email, m.first_name, m.preferred_name, m.last_name FROM members m
      WHERE m.status = 'member' AND m.leader_user_id IS NULL AND NOT (${NOT_ADMIN_SQL}) AND lower(COALESCE(m.email, '')) != lower(?)
      ORDER BY m.created_at LIMIT 20`).bind(adminEmail(env)).all<{ id: string; email: string | null; first_name: string; preferred_name: string | null; last_name: string }>();
  const site = siteUrl(env);
  let n = 0;
  for (const m of results) {
    const leader = await assignLeader(env, m.id).catch((e) => { console.error("backfill leader", e); return null; });
    if (!leader) continue;
    n++;
    if (m.email) await sendMail(env, { to: m.email, toName: `${m.first_name} ${m.last_name}`, template: "member_leader_intro", ...T.memberLeaderIntro({ site }, { name: m.preferred_name || m.first_name, leader: leader.name }) });
  }
  return n;
}
