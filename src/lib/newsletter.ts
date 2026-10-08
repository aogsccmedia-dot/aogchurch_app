import type { Env } from "../env.ts";
import { siteUrl } from "../env.ts";
import { randomToken, uuid } from "./crypto.ts";
import { sendMail } from "./email.ts";
import * as T from "../emails/templates.ts";
import { formatWhen } from "./time.ts";

interface Sub { id: string; email: string; name: string | null; status: string; token: string }

export const unsubscribeUrl = (env: Env, token: string) => `${siteUrl(env)}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;

/**
 * Add someone to the weekly letter.
 * verified=true (Google account, or explicit consent in the join form) activates immediately;
 * otherwise we send a confirmation email first (double opt-in).
 */
export async function subscribe(env: Env, o: { email: string; name?: string | null; source: string; userId?: string | null; verified: boolean }): Promise<"active" | "pending"> {
  const email = o.email.toLowerCase();
  const now = new Date().toISOString();
  let sub = await env.DB.prepare("SELECT * FROM subscribers WHERE email = ?").bind(email).first<Sub>();
  if (sub?.status === "active") {
    if (o.userId) await env.DB.prepare("UPDATE subscribers SET user_id = COALESCE(user_id, ?) WHERE id = ?").bind(o.userId, sub.id).run();
    return "active";
  }
  if (!sub) {
    sub = { id: uuid(), email, name: o.name ?? null, status: "pending", token: randomToken(24) };
    await env.DB.prepare("INSERT INTO subscribers (id, email, name, status, token, source, user_id) VALUES (?,?,?,?,?,?,?)")
      .bind(sub.id, email, sub.name, "pending", sub.token, o.source, o.userId ?? null).run();
  } else if (o.name && !sub.name) {
    await env.DB.prepare("UPDATE subscribers SET name = ? WHERE id = ?").bind(o.name, sub.id).run();
  }
  const b = { site: siteUrl(env) };
  if (o.verified) {
    await env.DB.prepare("UPDATE subscribers SET status = 'active', confirmed_at = ?, unsubscribed_at = NULL, user_id = COALESCE(user_id, ?) WHERE id = ?")
      .bind(now, o.userId ?? null, sub.id).run();
    const m = T.subscribeWelcome(b, o.name || sub.name, unsubscribeUrl(env, sub.token));
    await sendMail(env, { to: email, ...m, template: "subscribe_welcome" });
    return "active";
  }
  const confirm = `${siteUrl(env)}/api/newsletter/confirm?token=${encodeURIComponent(sub.token)}`;
  const m = T.subscribeConfirm(b, o.name || sub.name, confirm);
  await sendMail(env, { to: email, ...m, template: "subscribe_confirm" });
  return "pending";
}

export async function confirmSubscription(env: Env, token: string): Promise<boolean> {
  const sub = await env.DB.prepare("SELECT * FROM subscribers WHERE token = ?").bind(token).first<Sub>();
  if (!sub) return false;
  if (sub.status !== "active") {
    await env.DB.prepare("UPDATE subscribers SET status = 'active', confirmed_at = ?, unsubscribed_at = NULL WHERE id = ?").bind(new Date().toISOString(), sub.id).run();
    const m = T.subscribeWelcome({ site: siteUrl(env) }, sub.name, unsubscribeUrl(env, sub.token));
    await sendMail(env, { to: sub.email, ...m, template: "subscribe_welcome" });
  }
  return true;
}

export async function unsubscribe(env: Env, token: string): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE token = ?").bind(new Date().toISOString(), token).run();
  return r.meta.changes > 0;
}

// ---------------------------------------------------------------- announcements

export interface AnnouncementRow {
  id: string; subject: string; preheader: string | null; heading: string; body: string;
  scripture_text: string | null; scripture_ref: string | null; services: string; include_events: number;
  cta_label: string | null; cta_url: string | null; status: string; scheduled_for: string | null;
}

/** Build the email content for an announcement, pulling in the coming week's events when enabled. */
export async function buildAnnouncement(env: Env, a: AnnouncementRow, ref = new Date()): Promise<T.AnnouncementData> {
  let services: T.AnnouncementData["services"] = [];
  try { services = JSON.parse(a.services || "[]"); } catch { /* ignore */ }
  let events: T.AnnouncementData["events"] = [];
  if (a.include_events) {
    const { results } = await env.DB.prepare(
      `SELECT title, slug, starts_at, ends_at, location FROM events WHERE is_published = 1 AND starts_at >= ? AND starts_at < ? ORDER BY starts_at LIMIT 8`,
    ).bind(ref.toISOString(), new Date(ref.getTime() + 8 * 86400_000).toISOString())
      .all<{ title: string; slug: string; starts_at: string; ends_at: string | null; location: string | null }>();
    events = results.map((e) => ({ title: e.title, when: formatWhen(e.starts_at, e.ends_at), location: e.location, url: `${siteUrl(env)}/event?e=${encodeURIComponent(e.slug)}` }));
  }
  return { subject: a.subject, preheader: a.preheader, heading: a.heading, body: a.body, scripture_text: a.scripture_text,
    scripture_ref: a.scripture_ref, services, events, cta_label: a.cta_label, cta_url: a.cta_url };
}

export function renderAnnouncement(env: Env, data: T.AnnouncementData, name: string | null, token: string) {
  const first = name ? name.split(" ")[0] : null;
  return T.announcement({ site: siteUrl(env) }, data, first, unsubscribeUrl(env, token));
}

const BATCH = 40; // keeps each cron run well inside Worker subrequest limits

/**
 * Cron worker: start any due announcements, then send the next batch of pending deliveries.
 * Safe to run every few minutes; it picks up where it left off.
 */
export async function processAnnouncements(env: Env, now = new Date()): Promise<{ sent: number; failed: number }> {
  const due = await env.DB.prepare("SELECT * FROM announcements WHERE status = 'scheduled' AND scheduled_for <= ? ORDER BY scheduled_for")
    .bind(now.toISOString()).all<AnnouncementRow>();
  for (const a of due.results) {
    // Snapshot the audience at send time.
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO email_deliveries (id, announcement_id, subscriber_id, email)
        SELECT lower(hex(randomblob(16))), ?, id, email FROM subscribers WHERE status = 'active'`).bind(a.id),
      env.DB.prepare(`UPDATE announcements SET status = 'sending', started_at = ?,
        recipients = (SELECT COUNT(*) FROM email_deliveries WHERE announcement_id = ?) WHERE id = ?`).bind(now.toISOString(), a.id, a.id),
    ]);
  }

  let sent = 0, failed = 0;
  const sending = await env.DB.prepare("SELECT * FROM announcements WHERE status = 'sending' ORDER BY started_at").all<AnnouncementRow>();
  for (const a of sending.results) {
    const budget = BATCH - sent - failed;
    if (budget <= 0) break;
    const data = await buildAnnouncement(env, a, now);
    const { results: batch } = await env.DB.prepare(
      `SELECT d.id, d.email, s.name, s.token, s.status AS sub_status FROM email_deliveries d JOIN subscribers s ON s.id = d.subscriber_id
        WHERE d.announcement_id = ? AND d.status = 'pending' LIMIT ?`,
    ).bind(a.id, budget).all<{ id: string; email: string; name: string | null; token: string; sub_status: string }>();
    for (const d of batch) {
      if (d.sub_status !== "active") { await env.DB.prepare("UPDATE email_deliveries SET status = 'failed', error = 'unsubscribed' WHERE id = ?").bind(d.id).run(); continue; }
      const m = renderAnnouncement(env, data, d.name, d.token);
      const ok = await sendMail(env, {
        to: d.email, ...m, template: "announcement",
        headers: { "List-Unsubscribe": `<${unsubscribeUrl(env, d.token)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      await env.DB.prepare("UPDATE email_deliveries SET status = ?, sent_at = ?, error = ? WHERE id = ?")
        .bind(ok ? "sent" : "failed", new Date().toISOString(), ok ? null : "send failed", d.id).run();
      ok ? sent++ : failed++;
    }
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM email_deliveries WHERE announcement_id = ? AND status = 'pending'").bind(a.id).first<{ n: number }>();
    await env.DB.prepare(`UPDATE announcements SET
        sent_count = (SELECT COUNT(*) FROM email_deliveries WHERE announcement_id = ?1 AND status = 'sent'),
        failed_count = (SELECT COUNT(*) FROM email_deliveries WHERE announcement_id = ?1 AND status = 'failed'),
        status = CASE WHEN ?2 = 0 THEN 'sent' ELSE status END,
        sent_at = CASE WHEN ?2 = 0 THEN ?3 ELSE sent_at END
      WHERE id = ?1`).bind(a.id, left?.n ?? 0, new Date().toISOString()).run();
  }
  return { sent, failed };
}
