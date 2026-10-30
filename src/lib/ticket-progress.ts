/**
 * Ticket money against a target, for church leaders only: the main admin, church admins and verified pastors (elders).
 * Never youth leaders, members or visitors. A progress email goes to the same people every Sunday evening (SAST).
 */
import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { sendMail } from "./email.ts";
import type { Session } from "./auth.ts";
import * as T from "../emails/templates.ts";

/** Only the main admin, church admins and verified pastors (not youth leaders). */
export const seesTicketMoney = (s: Session | null | undefined) => !!s && !s.visitor && (s.role === "super" || s.role === "staff" || !!s.pastor);

export interface EventProgress {
  id: string; title: string; starts_at: string; price: number; target: number | null;
  money: number; tickets: number; pending_money: number; pending_tickets: number; week_money: number; week_tickets: number; percent: number | null;
}

/** Paid events that haven't finished yet (and the last week's ones), with what's been sold. */
export async function ticketProgress(env: Env, now = new Date()): Promise<EventProgress[]> {
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const { results } = await env.DB.prepare(`SELECT e.id, e.title, e.starts_at, e.ticket_price AS price, e.ticket_target AS target,
      COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN COALESCE(r.amount_due, (1 + r.guests) * e.ticket_price) END), 0) AS money,
      COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN 1 + r.guests END), 0) AS tickets,
      COALESCE(SUM(CASE WHEN r.status = 'pending' THEN COALESCE(r.amount_due, (1 + r.guests) * e.ticket_price) END), 0) AS pending_money,
      COALESCE(SUM(CASE WHEN r.status = 'pending' THEN 1 + r.guests END), 0) AS pending_tickets,
      COALESCE(SUM(CASE WHEN r.status = 'confirmed' AND r.created_at >= ?1 THEN COALESCE(r.amount_due, (1 + r.guests) * e.ticket_price) END), 0) AS week_money,
      COALESCE(SUM(CASE WHEN r.status = 'confirmed' AND r.created_at >= ?1 THEN 1 + r.guests END), 0) AS week_tickets
    FROM events e LEFT JOIN event_registrations r ON r.event_id = e.id
    WHERE e.ticket_price > 0 AND e.starts_at >= ?2 GROUP BY e.id ORDER BY e.starts_at`).bind(since, new Date(now.getTime() - 86400_000).toISOString())
    .all<Omit<EventProgress, "percent">>();
  return results.map((e) => ({ ...e, percent: e.target ? Math.min(100, Math.round((e.money / e.target) * 1000) / 10) : null }));
}

/** The people who get the weekly email: main admin, church admins, verified pastors. */
export async function leaderEmails(env: Env): Promise<{ email: string; first: string }[]> {
  const { results } = await env.DB.prepare(`SELECT DISTINCT lower(u.email) AS email, COALESCE(u.given_name, u.name, '') AS first FROM users u
      WHERE u.id IN (SELECT user_id FROM admin_roles WHERE role = 'admin') OR u.id IN (SELECT user_id FROM pastors)`).all<{ email: string; first: string }>();
  const out = new Map(results.map((r) => [r.email, r]));
  if (!out.has(adminEmail(env))) out.set(adminEmail(env), { email: adminEmail(env), first: "" });
  return [...out.values()];
}

const SAST = 2 * 3600_000;
/** Sundays from 18:00 SAST: once a week, to church leaders only. */
export async function processTicketRecon(env: Env, now: Date, opts: { test?: boolean } = {}): Promise<number> {
  const sa = new Date(now.getTime() + SAST);
  const week = new Date(sa.getTime() - sa.getUTCDay() * 86400_000).toISOString().slice(0, 10);   // that week's Sunday
  if (!opts.test) {
    if (sa.getUTCDay() !== 0 || sa.getUTCHours() < 18) return 0;
    const done = await env.DB.prepare("SELECT value FROM settings WHERE key = 'ticket_recon_week'").first<{ value: string }>();
    if (done?.value === week) return 0;
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('ticket_recon_week', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(week).run();
  }
  const events = await ticketProgress(env, now);
  if (!events.length) return 0;
  const to = opts.test ? [{ email: adminEmail(env), first: "" }] : await leaderEmails(env);
  let n = 0;
  for (const r of to) {
    const mail = T.ticketRecon({ site: siteUrl(env) }, { name: (r.first || "").split(" ")[0] || "church leader", events, url: `${siteUrl(env)}/admin/#overview` });
    if (await sendMail(env, { to: r.email, ...mail, subject: (opts.test ? "[Test] " : "") + mail.subject, template: "ticket_recon" })) n++;
  }
  return n;
}
