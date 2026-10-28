/**
 * Weekly ticket reminders: every Wednesday from 12:00 South African time, everyone holding a confirmed ticket for an
 * upcoming published event gets a short reminder with their own ticket links, until the week of the event.
 * Each booking gets at most one reminder per week (recorded in event_reminders), sent in small batches by the
 * 10-minute cron so a big event never overloads email. Admins can switch it off with the setting
 * event_weekly_reminders = "0".
 */
import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { sendMail } from "./email.ts";
import { calendarUrl, formatWhen } from "./time.ts";
import { ticketDownloadUrl, ticketUrl } from "./tickets.ts";
import type { EventRow, RegRow } from "./registrations.ts";
import * as T from "../emails/templates.ts";

const TZ = "Africa/Johannesburg";
const BATCH = 40;
const saDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const saHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d));
const saWeekday = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
const entryTime = (iso: string) => new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso));

/** "this Friday", "next Friday", "in 3 weeks" (South African calendar days). */
export function countdown(startsAt: string, now: Date): string {
  const days = Math.round((Date.parse(saDate(new Date(startsAt))) - Date.parse(saDate(now))) / 86400_000);
  const day = new Intl.DateTimeFormat("en-ZA", { weekday: "long", timeZone: TZ }).format(new Date(startsAt));
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `this ${day}`;
  if (days < 14) return `next ${day}`;
  return `in ${Math.floor(days / 7)} weeks`;
}

/** Is it reminder time? Wednesdays from 12:00 SAST (until the end of the day, so a big list can finish in batches). */
export const reminderWindow = (now: Date) => saWeekday(now) === "Wed" && saHour(now) >= 12;

export function reminderEmail(env: Env, e: EventRow, o: { name: string; ref: string; tickets: number; ticketUrl: string; pdfUrl: string | null }, now: Date) {
  const site = siteUrl(env);
  return T.eventWeeklyReminder({ site }, {
    name: o.name, title: e.title, when: formatWhen(e.starts_at, e.ends_at), location: e.location, ref: o.ref,
    cover: e.cover_image ? `${site}${e.cover_image}` : null, countdown: countdown(e.starts_at, now), entry: entryTime(e.starts_at),
    tickets: o.tickets, ticketUrl: o.ticketUrl, pdfUrl: o.pdfUrl, eventUrl: `${site}/event?e=${encodeURIComponent(e.slug)}`, calendarUrl: calendarUrl(e),
  });
}

export async function processEventReminders(env: Env, now = new Date()): Promise<number> {
  await sendTestIfAsked(env, now);
  if (!reminderWindow(now)) return 0;
  const off = await env.DB.prepare("SELECT value FROM settings WHERE key = 'event_weekly_reminders'").first<{ value: string }>();
  if (off?.value === "0") return 0;
  const week = saDate(now);
  // Confirmed bookings with valid tickets for published events that haven't started yet, not reminded this week.
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.event_id, r.ref_code, r.name, r.email, r.guests, r.status, r.amount_due,
            (SELECT code FROM tickets t WHERE t.registration_id = r.id AND t.status = 'valid' ORDER BY seq LIMIT 1) AS code,
            (SELECT COUNT(*) FROM tickets t WHERE t.registration_id = r.id AND t.status = 'valid') AS n
       FROM event_registrations r JOIN events e ON e.id = r.event_id
      WHERE r.status = 'confirmed' AND e.is_published = 1 AND e.starts_at > ?
        AND NOT EXISTS (SELECT 1 FROM event_reminders x WHERE x.registration_id = r.id AND x.week = ?)
      ORDER BY e.starts_at, r.created_at LIMIT ?`)
    .bind(now.toISOString(), week, BATCH).all<RegRow & { code: string | null; n: number }>();
  const events = new Map<string, EventRow | null>();
  let sent = 0;
  for (const r of results) {
    // Claim first, so two overlapping runs never send the same person two reminders.
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO event_reminders (registration_id, week, sent_at) VALUES (?,?,?)").bind(r.id, week, now.toISOString()).run();
    if (!claim.meta.changes) continue;
    if (!r.code) continue;   // no valid ticket: nothing to remind about
    if (!events.has(r.event_id)) events.set(r.event_id, await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(r.event_id).first<EventRow>());
    const e = events.get(r.event_id); if (!e) continue;
    const m = reminderEmail(env, e, { name: r.name.split(" ")[0], ref: r.ref_code, tickets: r.n, ticketUrl: ticketUrl(env, r.code), pdfUrl: await ticketDownloadUrl(env, r) }, now);
    if (await sendMail(env, { to: r.email, toName: r.name, ...m, template: "event_weekly_reminder" })) sent++;
    else await env.DB.prepare("DELETE FROM event_reminders WHERE registration_id = ? AND week = ?").bind(r.id, week).run();   // try again later today
  }
  return sent;
}

/**
 * A test of this week's reminder, with the real next event, to the main admin inbox: set the setting
 * event_reminder_test = "1" (or an email address) and the next cron run sends it, then clears the setting.
 */
async function sendTestIfAsked(env: Env, now: Date) {
  const t = await env.DB.prepare("SELECT value FROM settings WHERE key = 'event_reminder_test'").first<{ value: string }>().catch(() => null);
  if (!t?.value) return;
  await env.DB.prepare("DELETE FROM settings WHERE key = 'event_reminder_test'").run();
  const to = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t.value) ? t.value : adminEmail(env);
  const e = await env.DB.prepare("SELECT * FROM events WHERE is_published = 1 AND starts_at > ? ORDER BY starts_at LIMIT 1").bind(now.toISOString()).first<EventRow>();
  if (!e) return;
  const site = siteUrl(env), ev = `${site}/event?e=${encodeURIComponent(e.slug)}`;
  const m = reminderEmail(env, e, { name: "Thandi", ref: "SCC-TEST", tickets: 2, ticketUrl: ev, pdfUrl: null }, now);
  await sendMail(env, { to, ...m, subject: `[Test] ${m.subject}`, template: "test_event_weekly_reminder" });
}
