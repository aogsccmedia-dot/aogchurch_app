/**
 * Weekly service reminders.
 * - Only services an admin has switched "Email reminders" on for.
 * - Evening services: reminder at 09:00 on the day. Morning services (before 12:00): at 17:00 the day before.
 * - Sent once per service date (reminder_runs), skipped when the service is marked "no service".
 * - Services that don't run every week (twice a month / monthly) only remind when a date has been planned.
 * - Everyone on the weekly letter and every active member, except people who stopped service reminders.
 *   Each email carries a one-tap "stop service reminders" link that leaves the weekly letter alone.
 */
import type { Env } from "../env.ts";
import { siteUrl } from "../env.ts";
import { randomToken, sha256Hex } from "./crypto.ts";
import { sendMail } from "./email.ts";
import { DAYS, saToday } from "./groups.ts";
import * as T from "../emails/templates.ts";

interface Svc { id: string; day: number; title: string; start_time: string | null; end_time: string | null; frequency: string }

const saNow = (now: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return { date: saToday(now), time: parts };
};
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDay();
const timeLabel = (s: Svc) => (s.start_time ? (s.end_time ? `${s.start_time} – ${s.end_time}` : s.start_time) : "");

/** The service date a reminder is due for right now (or null). */
export function dueDate(s: Svc, now = new Date()): { date: string; tonight: boolean } | null {
  const { date, time } = saNow(now);
  const morning = !!s.start_time && s.start_time < "12:00";
  if (morning) { const tomorrow = addDays(date, 1); return weekday(tomorrow) === s.day && time >= "17:00" ? { date: tomorrow, tonight: false } : null; }
  return weekday(date) === s.day && time >= "09:00" && (!s.start_time || time < s.start_time) ? { date, tonight: true } : null;
}

/** People who get service reminders: letter subscribers + active members, minus anyone who opted out. */
export async function reminderRecipients(env: Env): Promise<{ email: string; name: string | null }[]> {
  const { results } = await env.DB.prepare(
    `SELECT lower(email) AS email, MAX(name) AS name FROM (
        SELECT email, name FROM subscribers WHERE status = 'active' AND service_reminders = 1
        UNION ALL
        SELECT email, COALESCE(preferred_name, first_name) AS name FROM members WHERE status != 'revoked' AND email IS NOT NULL AND email != '' AND service_reminders = 1
      ) WHERE lower(email) NOT IN (SELECT lower(email) FROM subscribers WHERE service_reminders = 0)
          AND lower(email) NOT IN (SELECT lower(email) FROM members WHERE service_reminders = 0 AND email IS NOT NULL)
      GROUP BY lower(email) ORDER BY lower(email) LIMIT 2000`).all<{ email: string; name: string | null }>();
  return results;
}

async function stopLink(env: Env, email: string) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO reminder_links (token_hash, email) VALUES (?, ?)").bind(await sha256Hex(token), email).run();
  return `${siteUrl(env)}/reminders?t=${encodeURIComponent(token)}`;
}

/** Send the reminder for one service date to everyone (once). Returns how many were sent. */
export async function sendServiceReminder(env: Env, s: Svc, date: string, tonight: boolean, force = false): Promise<number> {
  const session = await env.DB.prepare("SELECT status, topic, speaker, poster_attachment_id FROM service_sessions WHERE service_id = ? AND date = ?")
    .bind(s.id, date).first<{ status: string; topic: string; speaker: string | null; poster_attachment_id: string | null }>();
  if (session?.status === "cancelled") return 0;
  if (s.frequency !== "weekly" && !session && !force) return 0;   // only on dates that are actually planned
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO reminder_runs (service_id, date) VALUES (?, ?)").bind(s.id, date).run();
  if (!claim.meta.changes && !force) return 0;
  const site = siteUrl(env);
  const when = new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
  let sent = 0;
  for (const r of await reminderRecipients(env)) {
    const stopUrl = await stopLink(env, r.email);
    const mail = T.serviceReminder({ site }, {
      name: r.name ? r.name.split(" ")[0] : null, title: s.title, when, time: timeLabel(s), tonight,
      topic: session?.topic ?? null, speaker: session?.speaker ?? null,
      posterUrl: session?.poster_attachment_id ? `${site}/api/media/${session.poster_attachment_id}` : null, stopUrl,
    });
    const ok = await sendMail(env, { to: r.email, toName: r.name || undefined, ...mail, template: "service_reminder",
      headers: { "List-Unsubscribe": `<${stopUrl.replace("/reminders?", "/api/reminders/stop?")}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    if (ok) sent++;
  }
  await env.DB.prepare("UPDATE reminder_runs SET sent = ? WHERE service_id = ? AND date = ?").bind(sent, s.id, date).run();
  return sent;
}

/** Cron (every 10 minutes): send any reminders that are due. */
export async function processServiceReminders(env: Env, now = new Date()): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, day, title, start_time, end_time, frequency FROM weekly_services WHERE active = 1 AND reminders = 1").all<Svc>();
  let total = 0;
  for (const s of results) {
    const due = dueDate(s, now);
    if (due) total += await sendServiceReminder(env, s, due.date, due.tonight);
  }
  // Tidy old one-tap links (older than a year).
  await env.DB.prepare("DELETE FROM reminder_links WHERE created_at < ?").bind(new Date(now.getTime() - 365 * 86400_000).toISOString()).run();
  return total;
}

/** Turn service reminders off/on for an email address (both the letter list and the member record). */
export async function setReminders(env: Env, email: string, on: boolean) {
  await env.DB.batch([
    env.DB.prepare("UPDATE subscribers SET service_reminders = ? WHERE lower(email) = lower(?)").bind(on ? 1 : 0, email),
    env.DB.prepare("UPDATE members SET service_reminders = ? WHERE lower(email) = lower(?)").bind(on ? 1 : 0, email),
  ]);
}
export async function emailForReminderToken(env: Env, token: string | null | undefined): Promise<string | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const r = await env.DB.prepare("SELECT email FROM reminder_links WHERE token_hash = ?").bind(await sha256Hex(token)).first<{ email: string }>();
  return r?.email ?? null;
}
export async function remindersOn(env: Env, email: string): Promise<boolean> {
  const off = await env.DB.prepare("SELECT 1 FROM subscribers WHERE lower(email) = lower(?) AND service_reminders = 0 UNION SELECT 1 FROM members WHERE lower(email) = lower(?) AND service_reminders = 0").bind(email, email).first();
  return !off;
}
export { DAYS };
