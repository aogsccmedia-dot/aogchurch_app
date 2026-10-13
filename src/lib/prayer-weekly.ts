// Every Monday morning: email church members this week's prayer wall so the whole church prays together.
// Only approved, not-yet-answered requests. If the wall is empty, nobody gets anything.
// Sent in batches across the morning's cron runs (each member once a week); one-click opt-out in every email.
import type { Env } from "../env.ts";
import { siteUrl } from "../env.ts";
import { randomToken } from "./crypto.ts";
import { sendMail } from "./email.ts";
import * as T from "../emails/templates.ts";

const BATCH = 120;

export async function prayerItems(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(display_name, ''), 'Someone') AS who, request, prayed_count AS prayed FROM prayer_wall
      WHERE status = 'approved' AND answered = 0 ORDER BY created_at DESC LIMIT 25`).all<{ who: string; request: string; prayed: number }>();
  return results.map((r) => ({ ...r, request: r.request.slice(0, 400) }));
}

/** Monday 07:00–10:00 SAST. Returns how many emails went out in this run. */
export async function processPrayerWeekly(env: Env, now = new Date()): Promise<number> {
  const sa = new Date(now.getTime() + 2 * 3600_000);
  if (sa.getUTCDay() !== 1 || sa.getUTCHours() < 7 || sa.getUTCHours() >= 10) return 0;
  if ((await env.DB.prepare("SELECT value FROM settings WHERE key = 'prayer_weekly_enabled'").first<{ value: string }>())?.value === "0") return 0;
  const week = sa.toISOString().slice(0, 10);
  const items = await prayerItems(env);
  if (!items.length) return 0;   // nothing on the wall → send nothing
  const { results } = await env.DB.prepare(
    `SELECT m.email, COALESCE(NULLIF(m.preferred_name, ''), m.first_name) AS name FROM members m
       LEFT JOIN prayer_weekly p ON lower(p.email) = lower(m.email)
      WHERE m.status = 'member' AND m.email IS NOT NULL AND m.email != '' AND COALESCE(m.comm_email, 1) = 1
        AND COALESCE(p.opted_out, 0) = 0 AND COALESCE(p.last_sent, '') != ?
      GROUP BY lower(m.email) LIMIT ?`).bind(week, BATCH).all<{ email: string; name: string }>();
  const site = siteUrl(env);
  let n = 0;
  for (const m of results) {
    const email = m.email.toLowerCase();
    let tok = (await env.DB.prepare("SELECT token FROM prayer_weekly WHERE email = ?").bind(email).first<{ token: string }>())?.token;
    if (!tok) { tok = randomToken(18); await env.DB.prepare("INSERT OR IGNORE INTO prayer_weekly (email, token) VALUES (?, ?)").bind(email, tok).run(); }
    await env.DB.prepare("UPDATE prayer_weekly SET last_sent = ?, updated_at = ? WHERE email = ?").bind(week, new Date().toISOString(), email).run();
    const ok = await sendMail(env, { to: m.email, toName: m.name, ...T.prayerWeekly({ site }, { name: (m.name || "friend").split(" ")[0], items, unsub: `${site}/api/prayer/weekly/stop?token=${encodeURIComponent(tok)}` }), template: "prayer_weekly" });
    if (ok) n++;
  }
  return n;
}
