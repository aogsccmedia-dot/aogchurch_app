/**
 * Postponed events: tell everyone, once.
 * When an event has postponed_at set, the 10-minute cron emails (in small batches) everyone who holds a ticket
 * (with the refund-by-email paragraph) and every other member, signed-in account and active letter subscriber.
 * Each address is mailed at most once per event: email_log remembers who already got it, so a retry or a second
 * cron run never sends twice. When nobody is left, the event is marked done in settings.
 */
import type { Env } from "../env.ts";
import { adminEmail, siteUrl } from "../env.ts";
import { sendMail } from "./email.ts";
import type { EventRow } from "./registrations.ts";
import * as T from "../emails/templates.ts";

const BATCH = 40;
const first = (n: string | null | undefined) => String(n || "").trim().split(/\s+/)[0] || "friend";

export async function processPostponements(env: Env): Promise<number> {
  const { results: events } = await env.DB.prepare("SELECT * FROM events WHERE postponed_at IS NOT NULL AND is_published = 1").all<EventRow>();
  let sent = 0;
  for (const e of events) {
    const doneKey = `postponed_mail_done_${e.id}`;
    if (await env.DB.prepare("SELECT 1 FROM settings WHERE key = ?").bind(doneKey).first()) continue;
    const site = siteUrl(env);
    const subject = `${e.title} has been postponed to early 2027`;
    const poster = `${site}/assets/events/youth-worship-night-2026-postponed-wide-1600.jpg`;
    const url = `${site}/event?e=${encodeURIComponent(e.slug)}`;
    const contact = adminEmail(env);

    // Ticket holders first (confirmed or awaiting approval), then the waitlist and everyone else.
    const { results: holders } = await env.DB.prepare(
      `SELECT name, email, ref_code, 1 + guests AS tickets, status FROM event_registrations WHERE event_id = ? AND status IN ('confirmed','pending','waitlist') ORDER BY created_at`,
    ).bind(e.id).all<{ name: string; email: string; ref_code: string; tickets: number; status: string }>();
    const { results: others } = await env.DB.prepare(
      `SELECT email, name FROM users WHERE email != ''
       UNION SELECT email, first_name FROM members WHERE email != '' AND status != 'revoked'
       UNION SELECT email, name FROM subscribers WHERE status = 'active'`,
    ).all<{ email: string; name: string | null }>();

    const audience = new Map<string, { name: string; holder: boolean; tickets?: number; ref?: string }>();
    for (const h of holders) {
      const k = h.email.toLowerCase();
      const have = audience.get(k);
      if (h.status === "waitlist") { if (!have) audience.set(k, { name: first(h.name), holder: false }); continue; }
      audience.set(k, { name: first(h.name), holder: true, tickets: (have?.holder ? have.tickets || 0 : 0) + h.tickets, ref: have?.holder && have.ref ? `${have.ref}, ${h.ref_code}` : h.ref_code });
    }
    for (const o of others) { const k = o.email.toLowerCase(); if (!audience.has(k)) audience.set(k, { name: first(o.name), holder: false }); }

    const { results: log } = await env.DB.prepare(
      "SELECT lower(to_email) AS email, SUM(status = 'sent') AS ok, COUNT(*) AS tries FROM email_log WHERE template IN ('event_postponed_ticket','event_postponed_general') AND subject = ? GROUP BY lower(to_email)",
    ).bind(subject).all<{ email: string; ok: number; tries: number }>();
    const done = new Map(log.map((r) => [r.email, r]));
    const todo = [...audience].filter(([email]) => { const d = done.get(email); return !d || (!d.ok && d.tries < 3); });

    for (const [email, a] of todo.slice(0, BATCH)) {
      const m = T.eventPostponed({ site }, { name: a.name, title: e.title, poster, url, holder: a.holder, tickets: a.tickets, ref: a.ref, contact });
      if (await sendMail(env, { to: email, ...m, template: a.holder ? "event_postponed_ticket" : "event_postponed_general" })) sent++;
    }
    if (todo.length <= BATCH) await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(doneKey, new Date().toISOString()).run();
  }
  return sent;
}
