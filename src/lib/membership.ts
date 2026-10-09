/**
 * Membership check-ins.
 * Four months after joining (and every four months after each confirmation) a member is emailed:
 * "Still a member?" with two buttons → /membership?t=…&a=stay | revoke. If there's no answer after
 * 14 days, one friendly reminder is sent. Members can also confirm or revoke from /me.
 */
import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { HttpError } from "./http.ts";
import { randomToken, sha256Hex } from "./crypto.ts";
import { sendMail } from "./email.ts";
import * as T from "../emails/templates.ts";

export const CHECKIN_MONTHS = 4;
const REMIND_AFTER_DAYS = 14;
const BATCH = 25;

export interface MemberRow { id: string; ref_code: string; first_name: string; preferred_name: string | null; last_name: string; email: string | null; status: string; created_at: string; next_checkin_at: string | null; last_confirmed_at: string | null; revoked_at: string | null }

export const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const firstName = (m: MemberRow) => m.preferred_name || m.first_name;

async function sendCheckin(env: Env, m: MemberRow, reminder: boolean, now: Date) {
  const token = randomToken(24);
  await env.DB.prepare("UPDATE members SET checkin_token_hash = ?, checkin_sent_at = ?, checkin_reminded = ? WHERE id = ?")
    .bind(await sha256Hex(token), now.toISOString(), reminder ? 1 : 0, m.id).run();
  const site = siteUrl(env);
  const link = (a: string) => `${site}/membership?t=${encodeURIComponent(token)}&a=${a}`;
  const mail = T.membershipCheckin({ site }, { name: firstName(m), ref: m.ref_code, since: m.created_at, stayUrl: link("stay"), revokeUrl: link("revoke"), reminder });
  return sendMail(env, { to: m.email!, toName: `${m.first_name} ${m.last_name}`, ...mail, template: reminder ? "membership_checkin_reminder" : "membership_checkin" });
}

/** Cron: send due check-ins and reminders (daytime only, small batches). */
export async function processCheckins(env: Env, now = new Date()) {
  const h = now.getUTCHours();
  if (h < 6 || h > 16) return { sent: 0 };   // 08:00–18:59 SAST
  const iso = now.toISOString();
  const { results: due } = await env.DB.prepare(
    `SELECT * FROM members WHERE status != 'revoked' AND email IS NOT NULL AND email != ''
       AND next_checkin_at IS NOT NULL AND next_checkin_at <= ?
       AND (checkin_sent_at IS NULL OR checkin_sent_at < next_checkin_at)
     ORDER BY next_checkin_at LIMIT ?`).bind(iso, BATCH).all<MemberRow>();
  let sent = 0;
  for (const m of due) if (await sendCheckin(env, m, false, now)) sent++;
  const remindBefore = new Date(now.getTime() - REMIND_AFTER_DAYS * 86400_000).toISOString();
  const { results: quiet } = await env.DB.prepare(
    `SELECT * FROM members WHERE status != 'revoked' AND email IS NOT NULL AND checkin_token_hash IS NOT NULL
       AND checkin_reminded = 0 AND checkin_sent_at >= next_checkin_at AND checkin_sent_at <= ?
     ORDER BY checkin_sent_at LIMIT ?`).bind(remindBefore, BATCH).all<MemberRow>();
  for (const m of quiet) if (await sendCheckin(env, m, true, now)) sent++;
  return { sent };
}

export async function memberByToken(env: Env, token: string | null | undefined) {
  if (!token || token.length < 20 || token.length > 100) throw new HttpError(400, "This link isn't valid.");
  const m = await env.DB.prepare("SELECT * FROM members WHERE checkin_token_hash = ?").bind(await sha256Hex(token)).first<MemberRow>();
  if (!m) throw new HttpError(404, "This link has expired or was already used. You can manage your membership from your profile.");
  return m;
}

export async function confirmMembership(env: Env, m: MemberRow, now = new Date()) {
  if (m.status === "revoked") throw new HttpError(409, "This membership was revoked. You're always welcome to join again.");
  await env.DB.prepare("UPDATE members SET last_confirmed_at = ?, next_checkin_at = ?, checkin_token_hash = NULL, checkin_reminded = 0, updated_at = ? WHERE id = ?")
    .bind(now.toISOString(), addMonths(now, CHECKIN_MONTHS).toISOString(), now.toISOString(), m.id).run();
  return { next_checkin_at: addMonths(now, CHECKIN_MONTHS).toISOString() };
}

export async function revokeMembership(env: Env, m: MemberRow, reason: string | null, via: string, now = new Date()) {
  if (m.status === "revoked") return { already: true };
  const why = reason ? reason.trim().slice(0, 500) || null : null;
  await env.DB.prepare("UPDATE members SET status = 'revoked', revoked_at = ?, revoke_reason = ?, checkin_token_hash = NULL, next_checkin_at = NULL, updated_at = ? WHERE id = ?")
    .bind(now.toISOString(), why, now.toISOString(), m.id).run();
  const note = `[${now.toISOString().slice(0, 10)}] Membership revoked by the member (${via})${why ? `: “${why}”` : ""}.`;
  await env.DB.prepare("UPDATE members SET admin_notes = CASE WHEN admin_notes IS NULL OR admin_notes = '' THEN ? ELSE admin_notes || char(10) || ? END WHERE id = ?")
    .bind(note, note, m.id).run();
  const site = siteUrl(env);
  if (m.email) await sendMail(env, { to: m.email, toName: `${m.first_name} ${m.last_name}`, ...T.membershipRevoked({ site }, { name: firstName(m) }), template: "membership_revoked" });
  await sendMail(env, { to: adminEmail(env), ...T.adminMemberRevoked({ site }, { name: `${m.first_name} ${m.last_name}`, ref: m.ref_code, reason: why, via }), template: "admin_member_revoked" });
  return { already: false };
}

/** Cron: members who joined in the last 30 days but never received their welcome email get it now. */
export async function processWelcomes(env: Env, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT * FROM members WHERE welcome_sent_at IS NULL AND status != 'revoked' AND email IS NOT NULL AND email != '' AND created_at >= ? ORDER BY created_at LIMIT 20`)
    .bind(since).all<MemberRow>();
  let sent = 0;
  for (const m of results) {
    const ok = await sendMail(env, { to: m.email!, toName: `${m.first_name} ${m.last_name}`, ...T.joinWelcome({ site: siteUrl(env) }, firstName(m), m.ref_code), template: "join_welcome" });
    if (ok) { sent++; await env.DB.prepare("UPDATE members SET welcome_sent_at = ? WHERE id = ?").bind(now.toISOString(), m.id).run(); }
  }
  return { sent };
}
